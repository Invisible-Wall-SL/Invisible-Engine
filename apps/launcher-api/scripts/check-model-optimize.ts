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
 *   6. the derive is deterministic (same master, same bytes).
 *
 *   pnpm --filter launcher-api check:model-optimize
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
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
	tierCopyEqualsFull,
	type DerivedModelTier,
	type ModelDeriveOptions,
} from '../src/lib/server/modelOptimize';
import { buildMasterGlb } from './lib/modelFixtures';

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
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const tileDoc = await io.readBinary(tileFull.glb);
await tileDoc.transform(dequantize());
const edgeSet = (name: string) => {
	const node = tileDoc
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

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall model-optimiser checks passed');
process.exit(failures ? 1 : 0);
