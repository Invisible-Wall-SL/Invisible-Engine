/**
 * The 3D model optimiser (`docs/design/3d/assets-evaluation.md` §3, §5): ONE master GLB in, one
 * GLB + its textures per quality tier out. Pure Node — glTF-Transform + meshoptimizer (wasm) +
 * our own KTX2 encoder — so the launcher derives every tier with no Blender and no native binary.
 *
 * Per tier: take the tier's window on the master LOD chain (`_LOD<n>` / `_LODU` nodes), generating
 * any missing level with meshoptimizer `simplify` from the nearest richer level (an authored
 * `_LOD<n>` always beats a generated one; `_LODU` is never generated), resize every kept map from
 * the master, drop what the tier drops (multiplying AO into base colour when the ORM map goes),
 * encode KTX2 with the tier's encoding and a mip chain, then dedup / prune / resample / meshopt.
 * Textures are EXTERNAL (`_tex/<hash>[@<tier>].ktx2`, relative to the GLB), content-addressed by
 * their master image so models sharing a texture share the file.
 *
 * Encoding is the expensive step: the caller passes a {@link ModelTextureCache} keyed by everything
 * that decides the bytes, so a re-export re-encodes only what changed. Encodes run sequentially
 * (the wasm is synchronous and its heaps stack).
 */
import { createHash } from 'node:crypto';
import {
	Document,
	Format,
	Logger,
	NodeIO,
	type Material,
	type Node,
	type Primitive,
	type Texture,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import {
	compactPrimitive,
	dedup,
	getPrimitiveVertexCount,
	meshopt,
	prune,
	resample,
	simplifyPrimitive,
	VertexCountMethod,
	weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import {
	MODEL_LOD_ULTRA,
	MODEL_RAMP_RULE,
	modelMapSize,
	modelTierFile,
	type ModelLodGenerate,
	type ModelLodLevel,
	type ModelTextureEncoding,
	type ModelTieredMap,
	type ModelTierId,
	type ModelTierProfile,
} from 'constants-shared/modelTiers';
import type { ModelExportLod, ModelExportMap } from 'constants-shared/models';
import { KTX2_ENCODER_REVISION, MAX_ENCODE_PIXELS } from './ktx2Dimensions';
import { encodeModelTextureToKtx2 } from './ktx2Encode';

/** Bumped when the derive's output for the same inputs changes (cache keys carry it). */
export const MODEL_OPTIMIZER_REVISION = 1;

/** The subfolder textures live in, relative to the model GLBs. */
export const MODEL_TEXTURE_DIR = '_tex';

export interface ModelTextureCache {
	get(key: string): Promise<Uint8Array | null>;
	put(key: string, bytes: Uint8Array): Promise<void>;
}

/** What one tier is derived with: the resolved profile (model.json → Game Config → code default). */
export interface ModelDeriveOptions {
	tier: ModelTierId;
	profile: Readonly<Record<ModelTierId, ModelTierProfile>>;
	lodGenerate: ModelLodGenerate;
	cache?: ModelTextureCache;
}

export interface DerivedTexture {
	/** Relative to the GLB: `_tex/<hash>[@<tier>].<ktx2|png>`. */
	uri: string;
	bytes: Uint8Array;
	map: ModelExportMap;
	role: ModelTieredMap | 'ramp';
}

export interface DerivedModelTier {
	glb: Uint8Array;
	textures: DerivedTexture[];
	lods: ModelExportLod[];
	maps: Partial<Record<ModelTieredMap | 'ramp', ModelExportMap | 'dropped'>>;
	vramBytes: number;
}

const QUIET = new Logger(Logger.Verbosity.WARN);

let ioPromise: Promise<NodeIO> | null = null;

/** One IO for the process: every extension, the meshopt codec, wasm ready. */
async function modelIo(): Promise<NodeIO> {
	ioPromise ??= (async () => {
		await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
		return new NodeIO().setLogger(QUIET).registerExtensions(ALL_EXTENSIONS).registerDependencies({
			'meshopt.decoder': MeshoptDecoder,
			'meshopt.encoder': MeshoptEncoder,
		});
	})();
	return ioPromise;
}

const LOD_NAME = /^(.*)_LOD(\d+|U)$/;

/** `PR_crate_LOD1` → `{ base: 'PR_crate', level: 1 }`; `_LODU` → `MODEL_LOD_ULTRA`. */
export function parseLodName(name: string): { base: string; level: ModelLodLevel } | null {
	const m = LOD_NAME.exec(name);
	if (!m) return null;
	return { base: m[1], level: m[2] === 'U' ? MODEL_LOD_ULTRA : Number(m[2]) };
}

const lodName = (base: string, level: ModelLodLevel) =>
	`${base}_LOD${level === MODEL_LOD_ULTRA ? 'U' : level}`;

/** Most detailed first: `_LODU`, then LOD0, LOD1, … */
const byDetail = (a: ModelLodLevel, b: ModelLodLevel) => a - b;

/** Triangles a mesh node draws. */
function nodeTris(node: Node): number {
	let tris = 0;
	for (const prim of node.getMesh()?.listPrimitives() ?? [])
		tris += getPrimitiveVertexCount(prim, VertexCountMethod.RENDER) / 3;
	return Math.round(tris);
}

/** The master's LOD chains, grouped by base name. A mesh node with no `_LOD<n>` suffix is LOD0. */
function lodGroups(doc: Document): Map<string, Map<ModelLodLevel, Node>> {
	const groups = new Map<string, Map<ModelLodLevel, Node>>();
	for (const node of doc.getRoot().listNodes()) {
		if (!node.getMesh()) continue;
		const parsed = parseLodName(node.getName()) ?? { base: node.getName(), level: 0 };
		const group = groups.get(parsed.base) ?? new Map<ModelLodLevel, Node>();
		group.set(parsed.level, node);
		groups.set(parsed.base, group);
	}
	return groups;
}

/** A deep copy of `prim` whose index buffer `simplify` may rewrite without touching the source. */
function clonePrimitive(prim: Primitive): Primitive {
	const copy = prim.clone();
	for (const semantic of prim.listSemantics()) {
		const accessor = prim.getAttribute(semantic);
		if (accessor) copy.setAttribute(semantic, accessor.clone());
	}
	const indices = prim.getIndices();
	if (indices) copy.setIndices(indices.clone());
	for (const target of prim.listTargets()) copy.removeTarget(target);
	for (const target of prim.listTargets()) {
		const t = target.clone();
		for (const semantic of target.listSemantics()) {
			const accessor = target.getAttribute(semantic);
			if (accessor) t.setAttribute(semantic, accessor.clone());
		}
		copy.addTarget(t);
	}
	return copy;
}

/** `simplifySloppy` (ignores topology) for a prop's last level that `simplify` could not reach. */
function simplifySloppy(prim: Primitive, targetTris: number, error: number): void {
	const indices = prim.getIndices();
	const positions = prim.getAttribute('POSITION')?.getArray();
	if (!indices || !(positions instanceof Float32Array)) return;
	const [out] = MeshoptSimplifier.simplifySloppy(
		Uint32Array.from(indices.getArray() ?? []),
		positions,
		3,
		null,
		Math.max(3, Math.floor(targetTris) * 3),
		error,
	);
	if (out.length >= 3) indices.setArray(new Uint32Array(out));
}

/**
 * A tile's simplify: the vertices on its footprint's outer edges (min/max X and Z, glTF Y-up) are
 * locked so neighbouring tiles stay watertight, and nothing else is. meshoptimizer's own
 * `LockBorder` locks every open edge, UV seams included, which left a decimated AI tile at 1,847
 * tris for a 500 budget. `Permissive` lets interior collapses cross attribute seams.
 */
function simplifyKeepingFootprint(prim: Primitive, ratio: number, error: number): void {
	const indices = prim.getIndices();
	const positions = prim.getAttribute('POSITION')?.getArray();
	if (!indices || !(positions instanceof Float32Array)) return;
	const count = positions.length / 3;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i++) {
		min[i % 3] = Math.min(min[i % 3], positions[i]);
		max[i % 3] = Math.max(max[i % 3], positions[i]);
	}
	const eps = 1e-4 * Math.max(max[0] - min[0], max[2] - min[2]);
	const lock = new Uint8Array(count);
	for (let v = 0; v < count; v++) {
		const x = positions[v * 3];
		const z = positions[v * 3 + 2];
		if (x - min[0] < eps || max[0] - x < eps || z - min[2] < eps || max[2] - z < eps) lock[v] = 1;
	}
	const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
	const attrs = uv instanceof Float32Array ? uv : new Float32Array(count);
	const source = Uint32Array.from(indices.getArray() ?? []);
	const target = Math.max(3, Math.floor((source.length / 3) * ratio) * 3);
	const [out] = MeshoptSimplifier.simplifyWithAttributes(
		source,
		positions,
		3,
		attrs,
		attrs.length / count,
		new Array(attrs.length / count).fill(0.5),
		lock,
		target,
		error,
		['Permissive'],
	);
	if (out.length >= 3) indices.setArray(new Uint32Array(out));
}

/** A generated level: `source`'s mesh simplified towards `targetTris`, beside it, same skin. */
function generateLevel(
	doc: Document,
	source: Node,
	base: string,
	level: ModelLodLevel,
	targetTris: number,
	gen: ModelLodGenerate,
	sloppy: boolean,
): Node {
	const srcMesh = source.getMesh();
	if (!srcMesh) throw new Error(`${source.getName()} has no mesh`);
	const ratio = Math.min(1, targetTris / Math.max(1, nodeTris(source)));
	const mesh = doc.createMesh(lodName(base, level));
	for (const prim of srcMesh.listPrimitives()) {
		const target = (getPrimitiveVertexCount(prim, VertexCountMethod.RENDER) / 3) * ratio;
		let copy = clonePrimitive(prim);
		// meshoptimizer stops at the error bound before the ratio; loosen it (×3, three times at most)
		// while the level is still over its budget by more than 10 %.
		for (let attempt = 0, error = gen.targetError; ; attempt++, error *= 3) {
			if (gen.lockBorder) simplifyKeepingFootprint(copy, ratio, error);
			else simplifyPrimitive(copy, { simplifier: MeshoptSimplifier, ratio, error });
			const tris = getPrimitiveVertexCount(copy, VertexCountMethod.RENDER) / 3;
			if (tris <= target * 1.1) break;
			if (attempt === 3) {
				if (sloppy) simplifySloppy(copy, target, error);
				break;
			}
			copy.dispose();
			copy = clonePrimitive(prim);
		}
		compactPrimitive(copy);
		mesh.addPrimitive(copy);
	}
	const node = doc
		.createNode(lodName(base, level))
		.setMesh(mesh)
		.setSkin(source.getSkin())
		.setTranslation(source.getTranslation())
		.setRotation(source.getRotation())
		.setScale(source.getScale())
		.setExtras({ ie_lod_source: 'generated' });
	const parent = source.getParentNode();
	if (parent) parent.addChild(node);
	else
		for (const scene of doc.getRoot().listScenes())
			if (scene.listChildren().includes(source)) scene.addChild(node);
	return node;
}

/** The master levels a tier ships, most detailed first (`[from, to]`, `_LODU` only if authored). */
function windowLevels(
	profile: ModelTierProfile,
	present: ReadonlySet<ModelLodLevel>,
	lastLevel: number,
): ModelLodLevel[] {
	const [from, to] = profile.lods;
	const levels: ModelLodLevel[] = [];
	if (from === MODEL_LOD_ULTRA && present.has(MODEL_LOD_ULTRA)) levels.push(MODEL_LOD_ULTRA);
	for (let l = Math.max(0, from); l <= Math.min(to, lastLevel); l++) levels.push(l);
	return levels;
}

/** Ship the tier's window of every LOD chain, generating the levels the master lacks. */
function applyLodWindow(doc: Document, opts: ModelDeriveOptions): ModelExportLod[] {
	const profile = opts.profile[opts.tier];
	const shipped: ModelExportLod[] = [];
	for (const [base, group] of lodGroups(doc)) {
		const levels = windowLevels(profile, new Set(group.keys()), opts.lodGenerate.tris.length - 1);
		// The whole chain down to the window's end, not just the window: a level generated from LOD0
		// in one tier and from LOD1 in another would differ between tiers.
		const last = levels.at(-1) ?? 0;
		for (let level = 0; level <= last; level++) {
			if (group.has(level)) continue;
			const richer = [...group.keys()]
				.filter((l) => l < level)
				.sort(byDetail)
				.at(-1);
			if (richer === undefined) continue;
			const source = group.get(richer);
			if (!source) continue;
			const sloppy = opts.lodGenerate.sloppyLastLevel && level === opts.lodGenerate.tris.length - 1;
			group.set(
				level,
				generateLevel(
					doc,
					source,
					base,
					level,
					opts.lodGenerate.tris[level],
					opts.lodGenerate,
					sloppy,
				),
			);
		}
		const keep = levels.filter((l) => group.has(l));
		for (const [level, node] of group) {
			if (keep.includes(level)) continue;
			node.detach();
			node.dispose();
		}
		for (const level of keep.sort(byDetail)) {
			const node = group.get(level);
			if (!node) continue;
			node.setName(lodName(base, level));
			const generated =
				(node.getExtras() as { ie_lod_source?: string }).ie_lod_source === 'generated';
			shipped.push({ level, tris: nodeTris(node), source: generated ? 'generated' : 'authored' });
		}
	}
	return shipped;
}

/** The role a texture plays in the materials that use it; a ramp/palette is named so. */
function textureRoles(
	doc: Document,
): Map<Texture, { role: ModelTieredMap | 'ramp'; materials: Material[] }> {
	const roles = new Map<Texture, { role: ModelTieredMap | 'ramp'; materials: Material[] }>();
	const note = (texture: Texture | null, role: ModelTieredMap, material: Material) => {
		if (!texture) return;
		const isRamp = /ramp|palette/i.test(`${texture.getName()} ${texture.getURI()}`);
		const entry = roles.get(texture) ?? { role: isRamp ? 'ramp' : role, materials: [] };
		entry.materials.push(material);
		roles.set(texture, entry);
	};
	for (const material of doc.getRoot().listMaterials()) {
		note(material.getBaseColorTexture(), 'baseColor', material);
		note(material.getNormalTexture(), 'normal', material);
		note(material.getMetallicRoughnessTexture(), 'orm', material);
		note(material.getOcclusionTexture(), 'orm', material);
		note(material.getEmissiveTexture(), 'emissive', material);
	}
	return roles;
}

/** Remove a dropped map from every material slot it fills. Roughness and metal fall back to the
 *  material factors (the constants the runtime reads when the ORM map is dropped). */
function dropTexture(texture: Texture, materials: Material[]): void {
	for (const m of materials) {
		if (m.getNormalTexture() === texture) m.setNormalTexture(null);
		if (m.getMetallicRoughnessTexture() === texture) m.setMetallicRoughnessTexture(null);
		if (m.getOcclusionTexture() === texture) m.setOcclusionTexture(null);
		if (m.getEmissiveTexture() === texture) m.setEmissiveTexture(null);
		if (m.getBaseColorTexture() === texture) m.setBaseColorTexture(null);
	}
}

const sha = (...parts: (string | Uint8Array)[]) => {
	const h = createHash('sha256');
	for (const p of parts) h.update(p);
	return h.digest('hex');
};

/** Decode to straight RGBA at `w`×`h`. */
async function rgbaAt(bytes: Uint8Array, w: number, h: number) {
	const { data, info } = await sharp(Buffer.from(bytes))
		.ensureAlpha()
		.resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** Multiply AO (the ORM map's red channel) into base colour, in place. */
async function bakeAo(base: { width: number; height: number; data: Uint8Array }, orm: Uint8Array) {
	const ao = await rgbaAt(orm, base.width, base.height);
	for (let i = 0; i < base.data.length; i += 4) {
		const k = ao.data[i] / 255;
		base.data[i] = Math.round(base.data[i] * k);
		base.data[i + 1] = Math.round(base.data[i + 1] * k);
		base.data[i + 2] = Math.round(base.data[i + 2] * k);
	}
}

/** Bytes per texel once transcoded: UASTC → BC7/ASTC 4×4 (8 bpp); ETC1S → BC1/ETC1 (4 bpp). */
const VRAM_BPP: Record<ModelTextureEncoding, number> = { uastc: 8, etc1s: 4, png: 32 };
const mipLevels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;
const vramOf = (map: ModelExportMap) =>
	Math.round(((map.w * map.h * VRAM_BPP[map.enc]) / 8) * (map.mips > 1 ? 4 / 3 : 1));

/** One texture of one tier: resized from the master, maybe AO-baked, encoded (or cached). */
async function deriveTexture(
	texture: Texture,
	role: ModelTieredMap,
	materials: Material[],
	opts: ModelDeriveOptions,
): Promise<DerivedTexture | 'dropped'> {
	const master = texture.getImage();
	const size = texture.getSize();
	if (!master || !size) throw new Error(`texture ${texture.getName()} has no image`);
	const side = Math.max(size[0], size[1]);
	const target = modelMapSize(side, opts.tier, role, opts.profile);
	if (target === null) return 'dropped';
	const tierProfile = opts.profile[opts.tier];
	const enc = tierProfile.encoding[role];
	// ktx2-encoder refuses more than ~12 Mpix, so a 4096² ultra map is halved until it fits — it
	// then matches `full`'s and the tier writes no copy for it (docs/status/3d.md open item).
	let fit = target;
	while (
		enc !== 'png' &&
		fit > 4 &&
		((size[0] * fit) / side) * ((size[1] * fit) / side) > MAX_ENCODE_PIXELS
	)
		fit /= 2;
	const w = Math.max(4, Math.round((size[0] * fit) / side));
	const h = Math.max(4, Math.round((size[1] * fit) / side));
	const aoSource =
		role === 'baseColor' && tierProfile.bakeAoIntoBaseColor
			? (materials.map((m) => m.getOcclusionTexture()?.getImage()).find((i) => i) ?? null)
			: null;
	const aoDropped = aoSource && modelMapSize(side, opts.tier, 'orm', opts.profile) === null;
	const name = sha(role, master).slice(0, 16);
	const ext = enc === 'png' ? 'png' : 'ktx2';
	const uri = modelTierFile(`${MODEL_TEXTURE_DIR}/${name}.${ext}`, opts.tier);
	const key = sha(
		JSON.stringify({ r: MODEL_OPTIMIZER_REVISION, k: KTX2_ENCODER_REVISION, role, w, h, enc }),
		master,
		aoDropped && aoSource ? aoSource : '',
	);
	let bytes = (await opts.cache?.get(key)) ?? null;
	if (!bytes) {
		const rgba = await rgbaAt(master, w, h);
		if (aoDropped && aoSource) await bakeAo(rgba, aoSource);
		bytes =
			enc === 'png'
				? new Uint8Array(
						await sharp(Buffer.from(rgba.data), { raw: { width: w, height: h, channels: 4 } })
							.png()
							.toBuffer(),
					)
				: await encodeModelTextureToKtx2(rgba, {
						mode: enc,
						colorSpace: role === 'baseColor' || role === 'emissive' ? 'srgb' : 'linear',
						normalMap: role === 'normal',
						mipmaps: true,
					});
		await opts.cache?.put(key, bytes);
	}
	const map: ModelExportMap = { file: uri, w, h, enc, mips: enc === 'png' ? 1 : mipLevels(w, h) };
	return { uri, bytes, map, role };
}

/** The ramp/palette: the master's own PNG at every tier, one shared file (never tiered). */
async function rampTexture(texture: Texture): Promise<DerivedTexture> {
	const master = texture.getImage();
	const size = texture.getSize();
	if (!master || !size) throw new Error(`texture ${texture.getName()} has no image`);
	const png =
		texture.getMimeType() === 'image/png'
			? master
			: new Uint8Array(await sharp(Buffer.from(master)).png().toBuffer());
	const uri = `${MODEL_TEXTURE_DIR}/${sha('ramp', master).slice(0, 16)}.png`;
	return {
		uri,
		bytes: png,
		map: { file: uri, w: size[0], h: size[1], enc: MODEL_RAMP_RULE.encoding, mips: 1 },
		role: 'ramp',
	};
}

/** GLB with the textures left external: glTF-Transform's own GLB writer embeds every image. */
async function writeGlbExternalTextures(io: NodeIO, doc: Document): Promise<Uint8Array> {
	const buffers = doc.getRoot().listBuffers();
	buffers.forEach((b, i) => b.setURI(i === 0 ? 'bin' : ''));
	const { json, resources } = await io.writeJSON(doc, { format: Format.GLTF });
	const bin = resources.bin ?? new Uint8Array(0);
	if (json.buffers?.[0]) delete json.buffers[0].uri;
	for (const img of json.images ?? []) if (img.uri && !resources[img.uri]) delete img.uri;
	const pad = (n: number) => (4 - (n % 4)) % 4;
	const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
	const jsonLen = jsonBytes.length + pad(jsonBytes.length);
	const binLen = bin.length + pad(bin.length);
	const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonLen, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(jsonBytes, 20);
	out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
	if (bin.length) {
		view.setUint32(20 + jsonLen, binLen, true);
		view.setUint32(24 + jsonLen, 0x004e4942, true);
		out.set(bin, 28 + jsonLen);
	}
	return out;
}

/** Derive one tier from the master GLB. */
export async function deriveModelTier(
	master: Uint8Array,
	opts: ModelDeriveOptions,
): Promise<DerivedModelTier> {
	const io = await modelIo();
	const doc = (await io.readBinary(master)).setLogger(QUIET);
	await doc.transform(weld());
	const lods = applyLodWindow(doc, opts);

	const textures: DerivedTexture[] = [];
	const maps: DerivedModelTier['maps'] = {};
	let vramBytes = 0;
	for (const [texture, { role, materials }] of textureRoles(doc)) {
		const derived =
			role === 'ramp'
				? await rampTexture(texture)
				: await deriveTexture(texture, role, materials, opts);
		if (derived === 'dropped') {
			dropTexture(texture, materials);
			maps[role] = 'dropped';
			continue;
		}
		texture
			.setImage(derived.bytes)
			.setURI(derived.uri)
			.setMimeType(derived.map.enc === 'png' ? 'image/png' : 'image/ktx2');
		textures.push(derived);
		maps[role] = derived.map;
		vramBytes += vramOf(derived.map);
	}
	if (textures.some((t) => t.map.enc !== 'png'))
		doc.createExtension(KHRTextureBasisu).setRequired(true);

	await doc.transform(
		dedup(),
		// `keepLeaves`: an `SK_<name>` socket is an empty leaf node, which prune drops by default.
		prune({ keepExtras: true, keepLeaves: true }),
		resample(),
		meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
	);
	const unique = new Map(textures.map((t) => [t.uri, t]));
	return {
		glb: await writeGlbExternalTextures(io, doc),
		textures: [...unique.values()],
		lods,
		maps,
		vramBytes,
	};
}

/** Facts about the master the index and the validator need. */
export async function inspectModelMaster(master: Uint8Array): Promise<{
	clips: string[];
	sockets: string[];
	levels: { base: string; level: ModelLodLevel; tris: number }[];
	textures: { name: string; w: number; h: number }[];
	extras: Record<string, unknown>;
}> {
	const io = await modelIo();
	const doc = (await io.readBinary(master)).setLogger(QUIET);
	const levels: { base: string; level: ModelLodLevel; tris: number }[] = [];
	for (const [base, group] of lodGroups(doc))
		for (const [level, node] of group) levels.push({ base, level, tris: nodeTris(node) });
	const textures = doc
		.getRoot()
		.listTextures()
		.map((t) => {
			const size = t.getSize();
			return { name: t.getName() || t.getURI(), w: size?.[0] ?? 0, h: size?.[1] ?? 0 };
		});
	return {
		clips: doc
			.getRoot()
			.listAnimations()
			.map((a) => a.getName()),
		sockets: doc
			.getRoot()
			.listNodes()
			.map((n) => n.getName())
			.filter((n) => n.startsWith('SK_'))
			.map((n) => n.slice(3)),
		levels,
		textures,
		extras: (doc.getRoot().getDefaultScene()?.getExtras() ?? {}) as Record<string, unknown>,
	};
}

/** The GLB's JSON chunk as text and its BIN chunk. */
function glbChunks(glb: Uint8Array): { json: string; bin: Uint8Array } {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const jsonLen = view.getUint32(12, true);
	const json = new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)).trimEnd();
	const bin = glb.byteLength > 20 + jsonLen ? glb.subarray(28 + jsonLen) : new Uint8Array(0);
	return { json, bin };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
	a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);

/**
 * Whether a tier's derive is `full`'s byte for byte once its `@<tier>` names are read as `full`'s
 * (an `ultra` over a 2048² master with no `_LODU`): such a copy is not written, and the runtime
 * falls back to `full`.
 */
export function tierCopyEqualsFull(
	tier: ModelTierId,
	copy: DerivedModelTier,
	full: DerivedModelTier,
): boolean {
	const unsuffix = (s: string) => s.replaceAll(`@${tier}.`, '.');
	const a = glbChunks(copy.glb);
	const b = glbChunks(full.glb);
	if (unsuffix(a.json) !== b.json || !sameBytes(a.bin, b.bin)) return false;
	if (copy.textures.length !== full.textures.length) return false;
	return copy.textures.every((t) => {
		const twin = full.textures.find((f) => f.uri === unsuffix(t.uri));
		return !!twin && sameBytes(twin.bytes, t.bytes);
	});
}
