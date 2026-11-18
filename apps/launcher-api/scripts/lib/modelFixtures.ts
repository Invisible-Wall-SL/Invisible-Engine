/**
 * Master GLBs for the model gates, built in Node (CI has no Blender) to the Blender conventions
 * (`docs/conventions/blender-3d-assets.md`): `<id>_LOD<n>` / `_LODU` mesh nodes, `SK_<name>`
 * sockets, power-of-two maps. Deterministic: same options, same bytes.
 */
import { Document, NodeIO, type Texture } from '@gltf-transform/core';
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

/** A deterministic `side²` PNG; `kind` picks the content (an AO map is dark in its left half). */
async function png(side: number, kind: 'color' | 'normal' | 'orm' | 'ramp'): Promise<Uint8Array> {
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
}

export async function buildMasterGlb(opts: FixtureOptions): Promise<Uint8Array> {
	const doc = new Document();
	doc.createBuffer();
	const scene = doc.createScene('Scene');
	const material = doc
		.createMaterial('M_' + opts.id)
		.setRoughnessFactor(0.8)
		.setMetallicFactor(0);
	const tex = async (name: string, kind: 'color' | 'normal' | 'orm' | 'ramp'): Promise<Texture> =>
		doc
			.createTexture(name)
			.setImage(await png(opts.textureSide, kind))
			.setMimeType('image/png');
	if (opts.textureSide) {
		material.setBaseColorTexture(await tex(`${opts.id}_base`, 'color'));
		if (opts.normal) material.setNormalTexture(await tex(`${opts.id}_normal`, 'normal'));
		if (opts.orm) {
			const orm = await tex(`${opts.id}_orm`, 'orm');
			material.setOcclusionTexture(orm).setMetallicRoughnessTexture(orm);
		}
	}
	if (opts.ramp) material.setEmissiveTexture(await tex(`${opts.id}_ramp`, 'ramp'));
	for (const { level, segments } of opts.levels) {
		const name = `${opts.id}_LOD${level}`;
		const mesh = opts.tile
			? tileGrid(doc, name, segments)
			: sphere(doc, name, segments, segments / 2);
		for (const p of mesh.listPrimitives()) p.setMaterial(material);
		scene.addChild(doc.createNode(name).setMesh(mesh));
	}
	scene.addChild(doc.createNode('SK_top').setTranslation([0, 1, 0]));
	return new NodeIO().writeBinary(doc);
}

/**
 * A clip library (`anim/<skeleton>/<set>.glb`): a two-bone armature and one looping animation per
 * name, rotating the child bone about X, keyed at 30 fps. No mesh, no material.
 */
export async function buildClipLibraryGlb(clips: string[]): Promise<Uint8Array> {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('Scene');
	const root = doc.createNode('root');
	const pelvis = doc.createNode('pelvis').setTranslation([0, 0.95, 0]);
	root.addChild(pelvis);
	scene.addChild(doc.createNode('RIG_ie_humanoid').addChild(root));
	doc.createSkin('RIG_ie_humanoid').addJoint(root).addJoint(pelvis);
	const acc = (type: 'SCALAR' | 'VEC4', array: Float32Array) =>
		doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	clips.forEach((name, i) => {
		const frames = 31;
		const times = new Float32Array(frames).map((_, f) => f / 30);
		const rot = new Float32Array(frames * 4);
		for (let f = 0; f < frames; f++) {
			const a = Math.sin((f / (frames - 1)) * Math.PI * 2) * 0.1 * (i + 1);
			rot.set([Math.sin(a / 2), 0, 0, Math.cos(a / 2)], f * 4);
		}
		const sampler = doc
			.createAnimationSampler()
			.setInput(acc('SCALAR', times))
			.setOutput(acc('VEC4', rot))
			.setInterpolation('LINEAR');
		const channel = doc
			.createAnimationChannel()
			.setTargetNode(pelvis)
			.setTargetPath('rotation')
			.setSampler(sampler);
		doc.createAnimation(name).addSampler(sampler).addChannel(channel);
	});
	return new NodeIO().writeBinary(doc);
}
