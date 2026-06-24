/**
 * Invisible FX — Phase 4 (pipeline wiring), increment 2 headless harness: the
 * export → bake → register pure logic that makes an authored effect TRAVEL into a
 * built game (§8). Run:
 *
 *   pnpm --filter fx-spike run pipeline
 *
 * The R2 reads/writes + the SvelteKit bundle import can't run here, so — exactly as
 * the sibling tools do — we verify OFFLINE the pure decisions the three stages stand
 * on, against the REAL `engine-fx` `normalizeEffectDoc`:
 *
 *   1. EXPORT shape — what `exportEffects` lands in `deploy/effects/`: each doc is the
 *      PURE normalized EffectDoc (editor-only junk stripped), the index row shape, and
 *      the distinct `art.assetKey` set the bake checks (`referencedAssetKeys`).
 *   2. BAKE embedding — an effect list → `bundle.effects` only when non-empty (parity),
 *      and `bakedEffects()`'s `source.effects ?? []` resolution returns the embedded docs.
 *   3. DANGLING-assetKey detection — an effect referencing an atlas NOT among the shipped
 *      editor-art sheets is flagged (the invisible-effect guard, §8).
 *
 * The pure helpers here MIRROR (and so pin) the production logic in
 * `apps/launcher-api/src/lib/server/effectExport.ts`, `scripts/bake-editor-doc.mjs`,
 * and `apps/lines/src/editor-scenes.ts` `bakedEffects()`; the WebGL pixels + the live
 * R2 round-trip still need owner-verify (see the design doc).
 */

import { normalizeEffectDoc, type EffectDoc } from 'engine-fx';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const baseConfig = () => ({
	lifetime: { min: 0.5, max: 0.8 },
	frequency: 0.012,
	emitterLifetime: -1,
	maxParticles: 200,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [{ type: 'alpha', config: { alpha: { list: [{ time: 0, value: 1 }] } } }],
});

// ---------------------------------------------------------------------------
// Pure mirrors of the production stages (kept in lock-step with the real code).
// ---------------------------------------------------------------------------

/** Mirror of `effectExport.ts` `assetKeysOf` — distinct, non-empty layer assetKeys. */
function assetKeysOf(effect: EffectDoc): string[] {
	const keys = new Set<string>();
	for (const layer of effect.layers) {
		const k = layer.art?.assetKey;
		if (typeof k === 'string' && k) keys.add(k);
	}
	return [...keys];
}

/** Mirror of `exportEffects`'s pure core: normalize each saved doc, fix the id to its file
 *  stem, build the index + the referenced-assetKey set. (R2 read/write is the impure shell.) */
function exportEffects(saved: { id: string; raw: unknown }[]): {
	effects: EffectDoc[];
	index: { id: string; name: string; layers: number }[];
	referencedAssetKeys: string[];
} {
	const effects: EffectDoc[] = [];
	for (const { id, raw } of saved) {
		const doc = normalizeEffectDoc(raw, id);
		doc.id = id;
		effects.push(doc);
	}
	const index = effects.map((e) => ({ id: e.id, name: e.name, layers: e.layers.length }));
	const referenced = new Set<string>();
	for (const e of effects) for (const k of assetKeysOf(e)) referenced.add(k);
	return { effects, index, referencedAssetKeys: [...referenced] };
}

/** Mirror of `bake-editor-doc.mjs`'s embed decision: only carry `effects` when non-empty. */
function bakeEmbed(effects: EffectDoc[]): { effects?: EffectDoc[] } {
	return effects.length > 0 ? { effects } : {};
}

/** Mirror of `bakedEffects()` (`editor-scenes.ts`): `source.effects ?? []`. */
function bakedEffects(bundle: { effects?: EffectDoc[] } | null): EffectDoc[] {
	if (!bundle) return [];
	return bundle.effects ?? [];
}

/** Mirror of the bake's dangling-assetKey guard: referenced keys NOT among shipped atlases. */
function danglingKeys(
	referenced: string[],
	shippedSheetKeys: string[],
	shippedImageKeys: string[],
) {
	const shipped = new Set([...shippedSheetKeys, ...shippedImageKeys]);
	return referenced.filter((k) => !shipped.has(k));
}

// ---------------------------------------------------------------------------
// 1. EXPORT shape — pure docs land, editor junk stripped, index + assetKeys.
// ---------------------------------------------------------------------------
console.log('fx pipeline — export shape (what lands in deploy/effects/)');

const sparksManifest = 'borut/bookofborut/manifests/atlas_manifest_FX.json';
const glowManifest = 'borut/bookofborut/manifests/atlas_manifest_Glow.json';

// An authored doc carrying EDITOR-ONLY junk at the doc + layer level (the sidecar fields a
// careless save might smuggle onto the payload). The export must strip them all.
const authoredRaw = {
	version: 1,
	id: 'will-be-overwritten-by-stem',
	name: 'Torch Burst',
	camera: { x: 10, y: 20, scale: 1.5 }, // editor-only — must NOT travel
	selectedLayer: 'sparks', // editor-only — must NOT travel
	layers: [
		{
			key: 'sparks',
			config: baseConfig(),
			art: { assetKey: sparksManifest, frames: ['s1', 's2'], animated: true },
			placement: { space: 'bone', bone: 'tip', offset: { x: 0, y: -2 } },
			particleKind: 'sprite',
			trigger: { on: 'event', eventType: 'bigWin' },
			_swatch: '#ff0', // editor-only junk on a layer — must NOT travel
		},
		{
			key: 'glow',
			config: baseConfig(),
			art: { assetKey: glowManifest, frames: ['g1'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
	],
};

const exported = exportEffects([{ id: 'torch_burst', raw: authoredRaw }]);
const doc0 = exported.effects[0];

assert(exported.effects.length === 1, 'one saved effect exports one EffectDoc');
assert(doc0.id === 'torch_burst', "the exported doc's id is fixed to its file stem");
assert(doc0.name === 'Torch Burst', 'the human name survives the export');
assert(
	!('camera' in (doc0 as Record<string, unknown>)) &&
		!('selectedLayer' in (doc0 as Record<string, unknown>)),
	'doc-level editor-only state (camera/selectedLayer) is STRIPPED — only the pure doc travels',
);
assert(
	!('_swatch' in (doc0.layers[0] as unknown as Record<string, unknown>)),
	'layer-level editor-only junk (_swatch) is STRIPPED',
);
assert(
	eq(doc0.layers[0].config, baseConfig()),
	'the nested EmitterConfigV3 travels VERBATIM (the verbatim contract holds)',
);
assert(
	eq(
		doc0.layers.map((l) => l.key),
		['sparks', 'glow'],
	),
	'layers travel in document order',
);
assert(
	eq(exported.index, [{ id: 'torch_burst', name: 'Torch Burst', layers: 2 }]),
	'the deploy/effects/index.json row shape is { id, name, layers }',
);
assert(
	eq([...exported.referencedAssetKeys].sort(), [glowManifest, sparksManifest].sort()),
	'referencedAssetKeys is the DISTINCT set of every layer art.assetKey',
);

// A doc whose two layers share an atlas yields ONE referenced key (distinct).
const shared = exportEffects([
	{
		id: 'twin',
		raw: {
			name: 'Twin',
			layers: [
				{
					key: 'a',
					config: baseConfig(),
					art: { assetKey: sparksManifest, frames: ['s1'] },
					placement: { space: 'free' },
					particleKind: 'sprite',
				},
				{
					key: 'b',
					config: baseConfig(),
					art: { assetKey: sparksManifest, frames: ['s2'] },
					placement: { space: 'free' },
					particleKind: 'sprite',
				},
			],
		},
	},
]);
assert(
	eq(shared.referencedAssetKeys, [sparksManifest]),
	'two layers sharing an atlas ⇒ one referenced key (deduped)',
);

// An un-authored project (no saved effects) exports nothing.
const none = exportEffects([]);
assert(
	none.effects.length === 0 && none.index.length === 0 && none.referencedAssetKeys.length === 0,
	'an un-authored project exports NO effects (parity-safe fall-through)',
);

// ---------------------------------------------------------------------------
// 2. BAKE embedding — non-empty embeds, empty omits; bakedEffects() resolves.
// ---------------------------------------------------------------------------
console.log('fx pipeline — bake embedding + bakedEffects() resolution');

const embedded = bakeEmbed(exported.effects);
assert('effects' in embedded, 'a non-empty effect set embeds `effects` in the bundle');
assert(
	bakedEffects(embedded).length === 1 && bakedEffects(embedded)[0].id === 'torch_burst',
	'bakedEffects() returns the embedded EffectDoc[] (the bundle round-trips into the runtime)',
);
assert(
	eq(bakedEffects(embedded)[0], doc0),
	'the embedded doc is byte-identical to the exported one',
);

const emptyEmbed = bakeEmbed(none.effects);
assert(
	!('effects' in emptyEmbed),
	'an empty effect set OMITS `effects` — the bundle stays byte-identical (parity, §8)',
);
assert(bakedEffects(emptyEmbed).length === 0, 'bakedEffects() returns [] when no effects baked');
assert(
	bakedEffects(null).length === 0,
	'bakedEffects() returns [] for an un-baked game (dev parity)',
);

// ---------------------------------------------------------------------------
// 3. DANGLING-assetKey detection — the invisible-effect guard (§8).
// ---------------------------------------------------------------------------
console.log('fx pipeline — dangling-assetKey guard (the invisible-effect trap, §8)');

// Both atlases the effect references ARE shipped as editor-art sheets → no dangling key.
const allShipped = danglingKeys(exported.referencedAssetKeys, [sparksManifest, glowManifest], []);
assert(
	allShipped.length === 0,
	'every referenced atlas shipped ⇒ no dangling key (effect is visible)',
);

// Only the sparks atlas is shipped; the glow atlas is missing → glow is dangling (invisible).
const oneMissing = danglingKeys(exported.referencedAssetKeys, [sparksManifest], []);
assert(
	eq(oneMissing, [glowManifest]),
	'an atlas NOT among the shipped sheets is flagged dangling (would render invisible)',
);

// A referenced key shipped as a standalone IMAGE (not a sheet) also resolves — no false positive.
const asImage = danglingKeys([glowManifest], [sparksManifest], [glowManifest]);
assert(asImage.length === 0, 'an atlas shipped as a standalone editor-art image also resolves');

console.log('');
if (failures === 0) {
	console.log('FX PIPELINE: PASSED');
} else {
	console.error(`FX PIPELINE: ${failures} FAILURE(S)`);
	process.exit(1);
}
