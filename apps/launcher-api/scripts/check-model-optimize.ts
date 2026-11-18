/**
 * The 3D model optimiser (`src/lib/server/modelOptimize.ts`) on Node-built masters
 * (`scripts/lib/modelFixtures.ts`), against the tier profile in `constants-shared/modelTiers.ts`:
 *
 *   1. one prop master → four tier GLBs whose LOD window, generated-level budgets, map set, sizes
 *      and encodings match the profile; meshopt + quantised geometry, KTX2 textures kept external,
 *      every KTX2 side ÷4 with a full mip chain;
 *   2. an authored `_LOD1` beats the generated level (its exact tris, `source: 'authored'`);
 *   3. `_LODU` ships in `ultra` only, and only then does `ultra` differ from `full`; a 1024² master
 *      with no `_LODU` gives an `ultra` identical to `full` (not written);
 *   4. `quarter` drops the normal and ORM maps and multiplies AO into base colour;
 *   5. a tile's generated LOD1 reaches its budget and keeps every footprint-edge vertex (watertight
 *      against its neighbours);
 *   6. the derive is deterministic (same master, same bytes);
 *   7. two materials sharing one base-colour image with different AO maps get two base colours at
 *      `quarter` (distinct names and bytes, each material pointing at its own): `_tex/` is shared
 *      by every model, so a texture's name must hash everything that decides its bytes;
 *   8. a KHR_mesh_quantization master still gets its generated levels: a quantised tile's LOD1
 *      reaches its budget and keeps its footprint edges, and a quantised prop derives its last
 *      (sloppy-eligible) level within budget;
 *   9. `modelLimitIssues` passes the fixtures, flags a GLB claiming too many vertices or images, a
 *      meshopt view that decodes too much, poisoned accessor fields and garbage bytes (without
 *      throwing), and `deriveModelTier` refuses an over-limit master.
 *
 *   pnpm --filter launcher-api check:model-optimize
 */
import { Logger, NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, getBounds, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import {
	MODEL_CLASS_DEFAULTS,
	MODEL_LOD_ULTRA,
	MODEL_TIERS,
	modelMapSize,
	type ModelTierId,
	type ModelTierProfile,
} from 'constants-shared/modelTiers';
import {
	deriveModelTier,
	MODEL_LIMITS,
	modelLimitIssues,
	tierCopyEqualsFull,
	type DerivedModelTier,
	type ModelDeriveOptions,
} from '../src/lib/server/modelOptimize';
import { buildMasterGlb, buildSharedBaseColorGlb } from './lib/modelFixtures';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (!ok) failures += 1;
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

const cacheMap = new Map<string, Uint8Array>();
const cache = {
	get: async (k: string) => cacheMap.get(k) ?? null,
	put: async (k: string, b: Uint8Array) => void cacheMap.set(k, b),
};

const derive = (
	master: Uint8Array,
	cls: keyof typeof MODEL_CLASS_DEFAULTS,
	tier: ModelTierId,
	profile: Readonly<Record<ModelTierId, ModelTierProfile>> = MODEL_CLASS_DEFAULTS[cls].tiers,
): Promise<DerivedModelTier> => {
	const opts: ModelDeriveOptions = {
		tier,
		profile,
		lodGenerate: MODEL_CLASS_DEFAULTS[cls].lodGenerate,
		cache,
	};
	return deriveModelTier(master, opts);
};

const glbJson = (glb: Uint8Array) => {
	const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as {
		extensionsUsed?: string[];
		images?: { uri?: string; bufferView?: number; mimeType?: string }[];
		nodes: { name?: string; mesh?: number }[];
		materials?: {
			name?: string;
			pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
		}[];
		textures?: { source?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[];
	};
};

/** KTX2 header: pixelWidth/pixelHeight at 20/24, levelCount at 40. */
const ktx2Header = (bytes: Uint8Array) => {
	const v = new DataView(bytes.buffer, bytes.byteOffset);
	return { w: v.getUint32(20, true), h: v.getUint32(24, true), levels: v.getUint32(40, true) };
};

// ── 1–4: a prop ──────────────────────────────────────────────────────────────────────────────────
console.log('prop master, 1024² base/normal/ORM, authored LOD0 + LOD1');
const prop = await buildMasterGlb({
	id: 'PR_orb',
	textureSide: 1024,
	normal: true,
	orm: true,
	levels: [
		{ level: 0, segments: 76 },
		{ level: 1, segments: 30 },
	],
});
const propDefaults = MODEL_CLASS_DEFAULTS.prop;
const tiers = {} as Record<ModelTierId, DerivedModelTier>;
for (const tier of MODEL_TIERS) tiers[tier] = await derive(prop, 'prop', tier);

for (const tier of MODEL_TIERS) {
	const out = tiers[tier];
	const json = glbJson(out.glb);
	const [from, to] = propDefaults.tiers[tier].lods;
	const want = [];
	for (let l = Math.max(0, from); l <= to; l++) want.push(l);
	check(
		`${tier}: ships master levels ${want.join(',')}`,
		JSON.stringify(out.lods.map((l) => l.level)) === JSON.stringify(want),
		JSON.stringify(out.lods),
	);
	for (const lod of out.lods.filter((l) => l.source === 'generated'))
		check(
			`${tier}: generated LOD${lod.level} within 10 % of its ${propDefaults.lodGenerate.tris[lod.level]}-tri budget`,
			lod.tris <= propDefaults.lodGenerate.tris[lod.level] * 1.1,
			`${lod.tris} tris`,
		);
	const used = json.extensionsUsed ?? [];
	check(
		`${tier}: meshopt + quantised geometry, KTX2 textures`,
		['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'].every((e) =>
			used.includes(e),
		),
		used.join(', '),
	);
	check(
		`${tier}: every image is an external _tex/ file`,
		(json.images ?? []).every((i) => i.uri?.startsWith('_tex/') && i.bufferView === undefined),
		JSON.stringify(json.images),
	);
	for (const map of ['baseColor', 'normal', 'orm'] as const) {
		const size = modelMapSize(1024, tier, map, propDefaults.tiers);
		const got = out.maps[map];
		if (size === null) {
			check(`${tier}: ${map} dropped`, got === 'dropped', JSON.stringify(got));
			continue;
		}
		const enc = propDefaults.tiers[tier].encoding[map];
		check(
			`${tier}: ${map} ${size}² ${enc}`,
			typeof got === 'object' && got.w === size && got.h === size && got.enc === enc,
			JSON.stringify(got),
		);
		const file = typeof got === 'object' ? out.textures.find((t) => t.uri === got.file) : undefined;
		const head = file ? ktx2Header(file.bytes) : null;
		check(
			`${tier}: ${map} KTX2 is ${size}², ÷4, with ${Math.log2(size) + 1} mips`,
			!!head &&
				head.w === size &&
				head.h === size &&
				head.w % 4 === 0 &&
				head.levels === Math.log2(size) + 1,
			JSON.stringify(head),
		);
	}
}
const authored = tiers.full.lods.find((l) => l.level === 1);
check(
	'an authored _LOD1 beats the generated one (900 tris, authored)',
	authored?.source === 'authored' && authored.tris === 900,
	JSON.stringify(authored),
);
check(
	'a 1024² master with no _LODU: ultra is full byte for byte (no @ultra copy)',
	tierCopyEqualsFull('ultra', tiers.ultra, tiers.full),
);
check('half differs from full', !tierCopyEqualsFull('half', tiers.half, tiers.full));

console.log('quarter AO bake (base colour kept as PNG by override, to read it back)');
const pngQuarter = {
	...propDefaults.tiers,
	quarter: {
		...propDefaults.tiers.quarter,
		encoding: { ...propDefaults.tiers.quarter.encoding, baseColor: 'png' as const },
	},
};
const quarterPng = await derive(prop, 'prop', 'quarter', pngQuarter);
const base = quarterPng.textures.find((t) => t.role === 'baseColor');
if (base) {
	const { data, info } = await sharp(Buffer.from(base.bytes))
		.raw()
		.toBuffer({ resolveWithObject: true });
	const lum = (x: number) => {
		let sum = 0;
		for (let y = 0; y < info.height; y++) {
			const i = (y * info.width + x) * info.channels;
			sum += data[i] + data[i + 1] + data[i + 2];
		}
		return sum / info.height;
	};
	// The fixture's base colour is symmetric in brightness around the middle column only roughly;
	// its AO is 0.25 on the left half, 1.0 on the right.
	const left = lum(info.width / 2 - 2) / (lum(info.width / 2 + 2) || 1);
	check(
		'quarter: AO multiplied into base colour (left half ~¼ as bright)',
		left > 0.15 && left < 0.4,
		`${left.toFixed(2)}`,
	);
	check(
		'quarter: no normal / ORM texture shipped',
		quarterPng.textures.every((t) => t.role === 'baseColor'),
	);
} else check('quarter: base colour derived', false);

console.log('_LODU');
const withU = await buildMasterGlb({
	id: 'PR_orbu',
	textureSide: 0,
	levels: [
		{ level: 'U', segments: 120 },
		{ level: 0, segments: 76 },
	],
});
const uUltra = await derive(withU, 'prop', 'ultra');
const uFull = await derive(withU, 'prop', 'full');
check(
	'_LODU ships in ultra (authored, top level)',
	uUltra.lods[0]?.level === MODEL_LOD_ULTRA && uUltra.lods[0].source === 'authored',
	JSON.stringify(uUltra.lods),
);
check('_LODU is not in full', !uFull.lods.some((l) => l.level === MODEL_LOD_ULTRA));
check('with _LODU, ultra differs from full', !tierCopyEqualsFull('ultra', uUltra, uFull));
check(
	'no tier generates a _LODU',
	!(await derive(prop, 'prop', 'ultra')).lods.some((l) => l.level === MODEL_LOD_ULTRA),
);

// ── 5: a tile ────────────────────────────────────────────────────────────────────────────────────
console.log('tile master, 40×40 grid in four UV islands, LOD0 only');
const tile = await buildMasterGlb({
	id: 'TL_grid',
	textureSide: 0,
	tile: true,
	levels: [{ level: 0, segments: 40 }],
});
const tileFull = await derive(tile, 'tile', 'full');
const lod1 = tileFull.lods.find((l) => l.level === 1);
check(
	`tile LOD1 generated within 10 % of ${MODEL_CLASS_DEFAULTS.tile.lodGenerate.tris[1]} tris`,
	!!lod1 && lod1.tris <= MODEL_CLASS_DEFAULTS.tile.lodGenerate.tris[1] * 1.1,
	JSON.stringify(lod1),
);
await MeshoptDecoder.ready;
const io = new NodeIO()
	.setLogger(new Logger(Logger.Verbosity.WARN))
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const readDequantized = async (glb: Uint8Array) => {
	const doc = await io.readBinary(glb);
	await doc.transform(dequantize());
	return doc;
};
const tileDoc = await readDequantized(tileFull.glb);
const edgeSet = (name: string, doc: Document = tileDoc) => {
	const node = doc
		.getRoot()
		.listNodes()
		.find((n) => n.getName() === name);
	const prim = node?.getMesh()?.listPrimitives()[0];
	const pos = prim?.getAttribute('POSITION');
	const m = node?.getWorldMatrix();
	const out = new Set<string>();
	if (!pos || !m) return out;
	const el: number[] = [];
	for (let i = 0; i < pos.getCount(); i++) {
		pos.getElement(i, el);
		const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
		const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
		if (Math.abs(Math.abs(x) - 0.5) < 1e-3 || Math.abs(Math.abs(z) - 0.5) < 1e-3)
			out.add(`${x.toFixed(3)},${z.toFixed(3)}`);
	}
	return out;
};
const edge0 = edgeSet('TL_grid_LOD0');
const edge1 = edgeSet('TL_grid_LOD1');
const missing = [...edge0].filter((p) => !edge1.has(p));
check(
	`tile LOD1 keeps all ${edge0.size} footprint-edge vertices`,
	edge0.size > 0 && missing.length === 0,
	`${missing.length} missing, e.g. ${missing.slice(0, 3).join(' ')}`,
);

// ── 6: determinism ───────────────────────────────────────────────────────────────────────────────
const again = await derive(prop, 'prop', 'half');
check(
	'the same master derives the same half GLB',
	Buffer.compare(Buffer.from(again.glb), Buffer.from(tiers.half.glb)) === 0,
);

// ── 7: texture names ─────────────────────────────────────────────────────────────────────────────
console.log('two materials, one base-colour image, different AO maps, at quarter');
const shared = await derive(await buildSharedBaseColorGlb('PR_pair', 256), 'prop', 'quarter');
const sharedJson = glbJson(shared.glb);
const baseUriOf = (material: string) => {
	const m = sharedJson.materials?.find((x) => x.name === material);
	const t = sharedJson.textures?.[m?.pbrMetallicRoughness?.baseColorTexture?.index ?? -1];
	const src = t?.extensions?.KHR_texture_basisu?.source ?? t?.source;
	return src === undefined ? undefined : sharedJson.images?.[src]?.uri;
};
const uriA = baseUriOf('M_PR_pair_a');
const uriB = baseUriOf('M_PR_pair_b');
const texA = shared.textures.find((t) => t.uri === uriA);
const texB = shared.textures.find((t) => t.uri === uriB);
check(
	'each material points at its own base colour (two distinct names)',
	!!uriA && !!uriB && uriA !== uriB,
	`${uriA} ${uriB}`,
);
check(
	'…both shipped, with different bytes (each its own AO)',
	!!texA && !!texB && Buffer.compare(Buffer.from(texA.bytes), Buffer.from(texB.bytes)) !== 0,
	shared.textures.map((t) => t.uri).join(' '),
);

// ── 8: a quantised master ────────────────────────────────────────────────────────────────────────
const quantised = async (glb: Uint8Array) => {
	const doc = await io.readBinary(glb);
	await doc.transform(quantize());
	return io.writeBinary(doc);
};
console.log('the tile master, KHR_mesh_quantization');
const qTile = await quantised(tile);
check(
	'the quantised fixture stores Int16/Uint16 positions',
	glbJson(qTile).extensionsUsed?.includes('KHR_mesh_quantization') === true,
);
const qTileFull = await derive(qTile, 'tile', 'full');
const qLod1 = qTileFull.lods.find((l) => l.level === 1);
check(
	`quantised tile LOD1 generated within 10 % of ${MODEL_CLASS_DEFAULTS.tile.lodGenerate.tris[1]} tris`,
	!!qLod1 &&
		qLod1.source === 'generated' &&
		qLod1.tris <= MODEL_CLASS_DEFAULTS.tile.lodGenerate.tris[1] * 1.1,
	JSON.stringify(qTileFull.lods),
);
const qTileDoc = await readDequantized(qTileFull.glb);
const qEdge0 = edgeSet('TL_grid_LOD0', qTileDoc);
const qMissing = [...qEdge0].filter((p) => !edgeSet('TL_grid_LOD1', qTileDoc).has(p));
check(
	`quantised tile LOD1 keeps all ${qEdge0.size} footprint-edge vertices`,
	qEdge0.size > 0 && qMissing.length === 0,
	`${qMissing.length} missing, e.g. ${qMissing.slice(0, 3).join(' ')}`,
);
console.log('the prop master, KHR_mesh_quantization (sloppy last level)');
const lastLevel = propDefaults.lodGenerate.tris.length - 1;
check(
	'the prop class simplifies its last level sloppily',
	propDefaults.lodGenerate.sloppyLastLevel,
);
const qPropQuarter = await derive(await quantised(prop), 'prop', 'quarter');
const qLast = qPropQuarter.lods.find((l) => l.level === lastLevel);
check(
	`quantised prop LOD${lastLevel} generated within 10 % of ${propDefaults.lodGenerate.tris[lastLevel]} tris`,
	!!qLast &&
		qLast.source === 'generated' &&
		qLast.tris <= propDefaults.lodGenerate.tris[lastLevel] * 1.1,
	JSON.stringify(qPropQuarter.lods),
);

// ── 9: input limits ──────────────────────────────────────────────────────────────────────────────
console.log('input limits');
/** A GLB of a JSON chunk alone: what the limit check reads, with no buffer behind its claims. */
const jsonOnlyGlb = (json: unknown) => {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const len = Math.ceil(text.length / 4) * 4;
	const out = new Uint8Array(20 + len).fill(0x20, 20);
	const v = new DataView(out.buffer);
	v.setUint32(0, 0x46546c67, true);
	v.setUint32(4, 2, true);
	v.setUint32(8, out.length, true);
	v.setUint32(12, len, true);
	v.setUint32(16, 0x4e4f534a, true);
	out.set(text, 20);
	return out;
};
const fixtures = { prop, withU, tile, qTile };
check(
	'every fixture master is within the limits',
	Object.values(fixtures).every((g) => modelLimitIssues(g).length === 0),
	JSON.stringify(
		Object.fromEntries(Object.entries(fixtures).map(([k, g]) => [k, modelLimitIssues(g)])),
	),
);
const hugeCount = MODEL_LIMITS.vertices + 250_000;
const huge = jsonOnlyGlb({
	asset: { version: '2.0' },
	accessors: [{ count: hugeCount, type: 'VEC3', componentType: 5126 }],
	meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 0 } }] }],
});
const hugeIssues = modelLimitIssues(huge);
check(
	`a GLB claiming ${hugeCount.toLocaleString('en-US')} vertices is flagged (counted once)`,
	hugeIssues.some((i) => i.startsWith(`${hugeCount.toLocaleString('en-US')} vertices`)),
	JSON.stringify(hugeIssues),
);
const manyImages = modelLimitIssues(
	jsonOnlyGlb({
		asset: { version: '2.0' },
		images: Array.from({ length: MODEL_LIMITS.textures + 1 }, (_, i) => ({ uri: `${i}.png` })),
	}),
);
check(
	`a GLB with ${MODEL_LIMITS.textures + 1} images is flagged`,
	manyImages.some((i) => i.includes('images')),
	JSON.stringify(manyImages),
);
const negative = modelLimitIssues(
	jsonOnlyGlb({
		asset: { version: '2.0' },
		accessors: [{ count: -1, type: 'VEC3', componentType: 5126 }],
	}),
);
check('a negative accessor count is flagged', negative.length > 0, JSON.stringify(negative));
const garbage = [
	new Uint8Array(0),
	new TextEncoder().encode('definitely not a GLB file at all'),
	(() => {
		const g = huge.slice();
		new DataView(g.buffer).setUint32(12, 1e9, true);
		return g;
	})(),
	(() => {
		const g = huge.slice();
		g.fill(0x7b, 20);
		return g;
	})(),
];
let threw = false;
const garbageIssues = garbage.map((g) => {
	try {
		return modelLimitIssues(g);
	} catch {
		threw = true;
		return [];
	}
});
check(
	'garbage bytes are an issue each, never a throw',
	!threw && garbageIssues.every((i) => i.length > 0),
	JSON.stringify(garbageIssues),
);
const meshoptBomb = modelLimitIssues(
	jsonOnlyGlb({
		asset: { version: '2.0' },
		extensionsUsed: ['EXT_meshopt_compression'],
		buffers: [{ byteLength: 4 }],
		bufferViews: [
			{
				buffer: 0,
				byteLength: 4,
				extensions: {
					EXT_meshopt_compression: {
						buffer: 0,
						byteLength: 4,
						byteStride: 4,
						count: 268_435_456,
						mode: 'ATTRIBUTES',
					},
				},
			},
		],
	}),
);
check(
	'a meshopt bufferView that decodes to 1 GiB is flagged with no accessor naming it',
	meshoptBomb.some((m) => m.includes('decoded geometry')),
	JSON.stringify(meshoptBomb),
);
let poisonThrew = false;
const poisoned = [
	{ count: 10, type: { toString: 1 }, componentType: 5126 },
	{ count: 10, type: 'VEC3', componentType: { valueOf: 1, toString: 1 } },
	{ count: 10, type: 'constructor', componentType: 5126 },
	{ count: 10, type: '__proto__', componentType: 5126 },
].map((accessor) => {
	try {
		return modelLimitIssues(
			jsonOnlyGlb({
				asset: { version: '2.0' },
				accessors: [accessor, { count: 200_000_000, type: 'VEC3', componentType: 5126 }],
			}),
		);
	} catch {
		poisonThrew = true;
		return [];
	}
});
check(
	'prototype keys and objects in type / componentType are malformed, never a throw or a NaN sum',
	!poisonThrew &&
		poisoned.every(
			(i) =>
				i.some((m) => m.includes('malformed')) && i.some((m) => m.includes('decoded geometry')),
		),
	JSON.stringify(poisoned),
);
const refused = await derive(huge, 'prop', 'full').then(
	() => '',
	(e: Error) => e.message,
);
check(
	'deriveModelTier refuses an over-limit master',
	refused.includes('over the model limits'),
	refused || 'it derived',
);

// ── LOD tree: sockets, nested levels, collision meshes ───────────────────────────────────────────
console.log('LOD tree: a socket and LOD1 parented to LOD0 (at x = 2), plus a _COL mesh');
const nested = await buildMasterGlb({
	id: 'PR_nest',
	textureSide: 0,
	nested: true,
	collision: true,
	levels: [
		{ level: 0, segments: 76 },
		{ level: 1, segments: 30 },
	],
});
for (const tier of MODEL_TIERS) {
	const out = await derive(nested, 'prop', tier);
	const doc = await io.readBinary(out.glb);
	const nodes = doc.getRoot().listNodes();
	const socket = nodes.find((n) => n.getName() === 'SK_top');
	const at = socket?.getWorldMatrix().slice(12, 15) ?? [];
	check(
		`${tier}: the socket ships, where the master had it (0, 1, 0)`,
		!!socket && Math.hypot(at[0], at[1] - 1, at[2]) < 1e-3,
		JSON.stringify(at),
	);
	const lodNodes = nodes.filter((n) => /_LOD(\d+|U)$/.test(n.getName()));
	check(
		`${tier}: every shipped level is a node with its mesh, as the index names it`,
		lodNodes.length === out.lods.length &&
			lodNodes.every((n) => !!n.getMesh()) &&
			out.lods.every((l) => lodNodes.some((n) => n.getName() === l.node)),
		JSON.stringify({ nodes: lodNodes.map((n) => n.getName()), lods: out.lods }),
	);
	const lod1 = lodNodes.find((n) => n.getName() === 'PR_nest_LOD1');
	if (lod1) {
		const { min, max } = getBounds(lod1);
		check(
			`${tier}: LOD1 stays where it was in the world (centred on x = 0)`,
			Math.abs((min[0] + max[0]) / 2) < 0.02,
			`x ${((min[0] + max[0]) / 2).toFixed(3)}`,
		);
	}
	check(
		`${tier}: the _COL mesh is not geometry, and its box is in extras.ie.collision`,
		!nodes.some((n) => n.getName().endsWith('_COL')) &&
			JSON.stringify(doc.getRoot().listScenes()[0]?.getExtras()).includes('"PR_nest_COL"') &&
			!out.lods.some((l) => l.node?.includes('_COL')),
		JSON.stringify(out.lods),
	);
	const ieLods = (
		doc.getRoot().listScenes()[0]?.getExtras() as { ie?: { lods?: { level: string }[] } }
	).ie?.lods;
	check(
		`${tier}: extras.ie.lods names the levels this file ships`,
		JSON.stringify(ieLods?.map((l) => l.level)) ===
			JSON.stringify(out.lods.map((l) => `LOD${l.level}`)),
		JSON.stringify(ieLods),
	);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall model-optimiser checks passed');
process.exit(failures ? 1 : 0);
