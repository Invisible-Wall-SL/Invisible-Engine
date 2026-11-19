/**
 * Master GLBs for the model gates, built in Node (CI has no Blender) to the Blender conventions
 * (`docs/conventions/blender-3d-assets.md`): `<id>_LOD<n>` / `_LODU` mesh nodes, `SK_<name>`
 * sockets, power-of-two maps. Deterministic: same options, same bytes.
 */
import { Document, NodeIO, type Texture } from '@gltf-transform/core';
import { KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import sharp from 'sharp';

/** A UV sphere: `segments × rings × 2` triangles, radius 0.5, centred 0.5 above the origin. */
function sphere(doc: Document, name: string, segments: number, rings: number) {
	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	for (let r = 0; r <= rings; r++) {
		const v = r / rings;
		const phi = v * Math.PI;
		for (let s = 0; s <= segments; s++) {
			const u = s / segments;
			const theta = u * Math.PI * 2;
			const x = Math.sin(phi) * Math.cos(theta);
			const y = Math.cos(phi);
			const z = Math.sin(phi) * Math.sin(theta);
			pos.push(x * 0.5, y * 0.5 + 0.5, z * 0.5);
			nrm.push(x, y, z);
			uv.push(u, v);
		}
	}
	const idx: number[] = [];
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < segments; s++) {
			const a = r * (segments + 1) + s;
			const b = a + segments + 1;
			idx.push(a, b, a + 1, b, b + 1, a + 1);
		}
	const buffer = doc.getRoot().listBuffers()[0];
	const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint32Array) =>
		doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
		.setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
		.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
		.setIndices(acc('SCALAR', new Uint32Array(idx)));
	return doc.createMesh(name).addPrimitive(prim);
}

/** A flat grid tile on the XZ plane, `n × n × 2` triangles, 1 m wide, its UVs split in four
 *  islands (seams the simplifier must be allowed to cross). */
function tileGrid(doc: Document, name: string, n: number) {
	const pos: number[] = [];
	const uv: number[] = [];
	const idx: number[] = [];
	const half = n / 2;
	for (let qz = 0; qz < 2; qz++)
		for (let qx = 0; qx < 2; qx++) {
			const base = pos.length / 3;
			for (let z = 0; z <= half; z++)
				for (let x = 0; x <= half; x++) {
					const gx = qx * half + x;
					const gz = qz * half + z;
					pos.push(gx / n - 0.5, 0.02 * Math.sin(gx * 1.7) * Math.cos(gz * 1.3), gz / n - 0.5);
					uv.push(x / half / 2 + qx / 2, z / half / 2 + qz / 2);
				}
			for (let z = 0; z < half; z++)
				for (let x = 0; x < half; x++) {
					const a = base + z * (half + 1) + x;
					const b = a + half + 1;
					idx.push(a, b, a + 1, b, b + 1, a + 1);
				}
		}
	const buffer = doc.getRoot().listBuffers()[0];
	const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint32Array) =>
		doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
		.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
		.setIndices(acc('SCALAR', new Uint32Array(idx)));
	return doc.createMesh(name).addPrimitive(prim);
}

type PngKind = 'color' | 'normal' | 'orm' | 'ormFlip' | 'ramp';

/** A deterministic `side²` PNG; `kind` picks the content (an `orm` AO map is dark in its left half,
 *  an `ormFlip` one in its right half). */
async function png(side: number, kind: PngKind): Promise<Uint8Array> {
	const w = kind === 'ramp' ? 256 : side;
	const h = kind === 'ramp' ? 4 : side;
	const data = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			if (kind === 'color') data.set([(x * 255) / w, (y * 255) / h, ((x ^ y) & 255) / 2 + 64], i);
			else if (kind === 'normal')
				data.set([128 + 40 * Math.sin(x / 9), 128 + 40 * Math.cos(y / 7), 255], i);
			else if (kind === 'orm') data.set([x < w / 2 ? 64 : 255, 160, 32], i);
			else if (kind === 'ormFlip') data.set([x < w / 2 ? 255 : 64, 160, 32], i);
			else data.set([Math.floor(x / 64) * 80, Math.floor(x / 64) * 80, Math.floor(x / 64) * 80], i);
		}
	return new Uint8Array(
		await sharp(data, { raw: { width: w, height: h, channels: 3 } })
			.png()
			.toBuffer(),
	);
}

export interface FixtureOptions {
	id: string;
	/** Master map side; 0 = no textures. */
	textureSide: number;
	/** Which master levels exist, and the sphere segments each is built with. */
	levels: { level: number | 'U'; segments: number }[];
	normal?: boolean;
	orm?: boolean;
	ramp?: boolean;
	tile?: boolean;
	/** Name the base-colour texture this instead of `<id>_base`. */
	baseName?: string;
	/** As Blender exports a texture-driven Principled BSDF: no roughness / metallic factor written
	 *  (glTF's default, 1.0, applies). */
	blenderFactors?: boolean;
	/** A KHR_materials_clearcoat texture (an extension-only texture). */
	clearcoat?: boolean;
	/** A base colour whose PNG header (and so its size) reads but whose pixels do not decode: it
	 *  passes the upload checks and fails the derive. */
	corruptBase?: boolean;
	/** Blender's Ctrl+P habit: the first level sits at x = 2 and every other level and the socket
	 *  are its children (a tier that drops it must not drop them). */
	nested?: boolean;
	/** A collision box carried as a mesh (`<id>_COL`), as a non-`ie_export` master does. */
	collision?: boolean;
}

export async function buildMasterGlb(opts: FixtureOptions): Promise<Uint8Array> {
	const doc = new Document();
	doc.createBuffer();
	const scene = doc.createScene('Scene');
	const material = doc.createMaterial('M_' + opts.id);
	if (!opts.blenderFactors) material.setRoughnessFactor(0.8).setMetallicFactor(0);
	const tex = async (name: string, kind: PngKind): Promise<Texture> =>
		doc
			.createTexture(name)
			.setImage(await png(opts.textureSide, kind))
			.setMimeType('image/png');
	if (opts.textureSide) {
		const base = await tex(opts.baseName ?? `${opts.id}_base`, 'color');
		const image = base.getImage();
		if (opts.corruptBase && image) base.setImage(image.slice(0, 64));
		material.setBaseColorTexture(base);
		if (opts.normal) material.setNormalTexture(await tex(`${opts.id}_normal`, 'normal'));
		if (opts.orm) {
			const orm = await tex(`${opts.id}_orm`, 'orm');
			material.setOcclusionTexture(orm).setMetallicRoughnessTexture(orm);
		}
	}
	if (opts.ramp) material.setEmissiveTexture(await tex(`${opts.id}_ramp`, 'ramp'));
	if (opts.clearcoat) {
		const ext = doc.createExtension(KHRMaterialsClearcoat);
		material.setExtension(
			'KHR_materials_clearcoat',
			ext
				.createClearcoat()
				.setClearcoatFactor(1)
				.setClearcoatTexture(await tex(`${opts.id}_clearcoat`, 'color')),
		);
	}
	let first: ReturnType<Document['createNode']> | undefined;
	for (const { level, segments } of opts.levels) {
		const name = `${opts.id}_LOD${level}`;
		const mesh = opts.tile
			? tileGrid(doc, name, segments)
			: sphere(doc, name, segments, segments / 2);
		for (const p of mesh.listPrimitives()) p.setMaterial(material);
		const node = doc.createNode(name).setMesh(mesh);
		if (opts.nested && first) {
			// Parented to the first level, which sits at x = 2: undo that so it stays at the origin.
			first.addChild(node.setTranslation([-2, 0, 0]));
		} else {
			if (opts.nested) node.setTranslation([2, 0, 0]);
			scene.addChild(node);
			first ??= node;
		}
	}
	const socket = doc.createNode('SK_top');
	if (opts.nested && first) first.addChild(socket.setTranslation([-2, 1, 0]));
	else scene.addChild(socket.setTranslation([0, 1, 0]));
	// What `ie_export` writes for the master; a tier must say what IT ships instead.
	if (opts.nested)
		scene.setExtras({
			ie: { id: opts.id, lods: opts.levels.map((l) => ({ level: `LOD${l.level}` })) },
		});
	if (opts.collision) {
		const name = `${opts.id}_COL`;
		scene.addChild(doc.createNode(name).setMesh(sphere(doc, name, 8, 4)));
	}
	return new NodeIO().registerExtensions([KHRMaterialsClearcoat]).writeBinary(doc);
}

/**
 * Two prop spheres (`<id>_a`, `<id>_b`, LOD0 only), each with its own material, sharing ONE
 * base-colour texture but each with its own ORM (AO dark on the left for `_a`, on the right for
 * `_b`): a tier that bakes AO into base colour must give each its own base colour.
 */
export async function buildSharedBaseColorGlb(id: string, side: number): Promise<Uint8Array> {
	const doc = new Document();
	doc.createBuffer();
	const scene = doc.createScene('Scene');
	const base = doc
		.createTexture(`${id}_base`)
		.setImage(await png(side, 'color'))
		.setMimeType('image/png');
	for (const [part, kind] of [
		['a', 'orm'],
		['b', 'ormFlip'],
	] as const) {
		const orm = doc
			.createTexture(`${id}_${part}_orm`)
			.setImage(await png(side, kind))
			.setMimeType('image/png');
		const material = doc
			.createMaterial(`M_${id}_${part}`)
			.setBaseColorTexture(base)
			.setOcclusionTexture(orm)
			.setMetallicRoughnessTexture(orm);
		const name = `${id}_${part}_LOD0`;
		const mesh = sphere(doc, name, 40, 20);
		for (const p of mesh.listPrimitives()) p.setMaterial(material);
		scene.addChild(doc.createNode(name).setMesh(mesh));
	}
	return new NodeIO().writeBinary(doc);
}
