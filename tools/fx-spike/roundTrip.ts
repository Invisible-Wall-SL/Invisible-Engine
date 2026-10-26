/**
 * Invisible FX — Phase 1 EffectDoc round-trip headless harness (design doc §4 / §7).
 *
 *   pnpm --filter fx-spike run roundtrip
 *
 * Proves, HEADLESSLY (no R2, no browser, no WebGL), the two data contracts Phase 1 stands
 * on, the way the Flow round-trip harness validates the FlowDoc contract offline
 * ([[feedback_validate_data_contracts_offline]]):
 *
 *  A. SAVE↔RELOAD — an authored `EffectDoc` survives the exact path the `/api/fx/save`
 *     endpoint + loader take (author → JSON.stringify → normalizeEffectDoc → JSON round-trip
 *     → normalizeEffectDoc → IDENTICAL doc), normalize is idempotent, editor-only junk +
 *     malformed layers are dropped, and an absent doc degrades to an empty effect.
 *
 *  B. CONFIG↔LIBRARY — the nested `EmitterConfigV3` is passed through VERBATIM by normalize
 *     AND feeds cleanly into `@barvynkoa/particle-emitter`'s `upgradeConfig(config, textures)`
 *     — the EXACT call `ParticleEmitter.svelte` makes (`updatedConfig = upgradeConfig(props.
 *     config, textures)`). This is the "reduces exactly to the runtime contract" proof: if
 *     our schema's `config` didn't match what the library eats, this throws.
 */

import { upgradeConfig, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	EFFECT_DOC_VERSION,
	normalizeEffectDoc,
	validateEffectMaterials,
	weightedTextures,
	type EffectDoc,
	type EmitterConfigV3 as FxEmitterConfigV3,
} from 'engine-fx';

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

// ---------------------------------------------------------------------------
// A canonical V3 config (the modern library shape the doc mandates nesting verbatim).
// Behaviors are the V3 `{ type, config }` entries `upgradeConfig` leaves untouched.
// ---------------------------------------------------------------------------
const sparksConfig: EmitterConfigV3 = {
	lifetime: { min: 0.5, max: 0.7 },
	frequency: 0.01,
	emitterLifetime: -1,
	maxParticles: 200,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [
		{
			type: 'alpha',
			config: {
				alpha: {
					list: [
						{ time: 0, value: 1 },
						{ time: 1, value: 0 },
					],
				},
			},
		},
		{
			type: 'scale',
			config: {
				scale: {
					list: [
						{ time: 0, value: 0.4 },
						{ time: 1, value: 0.1 },
					],
				},
			},
		},
		{
			type: 'moveSpeed',
			config: {
				speed: {
					list: [
						{ time: 0, value: 400 },
						{ time: 1, value: 200 },
					],
				},
			},
		},
		{ type: 'rotationStatic', config: { min: 240, max: 300 } },
		{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 10 } } },
	],
};

// ---------------------------------------------------------------------------
// A representative authored EffectDoc — every layer feature Phase 1 (+ B/C surface) carries.
// ---------------------------------------------------------------------------
const authored: EffectDoc = {
	version: EFFECT_DOC_VERSION,
	id: 'coin-burst',
	name: 'Coin Burst',
	layers: [
		{
			key: 'sparks',
			config: sparksConfig as FxEmitterConfigV3,
			art: { assetKey: 'fx_coins', frames: ['coin_0', 'coin_1', 'coin_2'], animated: true },
			placement: { space: 'free', offset: { x: 12, y: -4 } },
			particleKind: 'sprite',
			trigger: { on: 'event', eventType: 'winShow', duration: 800, stopEventType: 'winHide' },
		},
		{
			key: 'glow',
			config: { ...sparksConfig, maxParticles: 40 } as FxEmitterConfigV3,
			art: { assetKey: 'fx_coins', frames: ['glow'] },
			placement: { space: 'bone', bone: 'hand_tip', offset: { x: 0, y: 0 } },
			particleKind: 'sprite',
			trigger: { on: 'always' },
		},
	],
};

// ===========================================================================
// A. SAVE↔RELOAD
// ===========================================================================
console.log('fx round-trip — save↔reload identity');

const stored = normalizeEffectDoc(JSON.parse(JSON.stringify(authored)), 'coin-burst');
const reloaded = normalizeEffectDoc(JSON.parse(JSON.stringify(stored)), 'coin-burst');
const canonical = normalizeEffectDoc(authored, 'coin-burst');

assert(eq(stored, reloaded), 'stored doc reloads byte-identical (normalize ∘ JSON round-trip)');
assert(eq(stored, canonical), 'authored doc canonicalizes to the stored form');
assert(stored.version === EFFECT_DOC_VERSION, 'version stamped');
assert(stored.id === 'coin-burst' && stored.name === 'Coin Burst', 'id + name preserved');
assert(
	eq(
		authored.layers.map((l) => l.key),
		stored.layers.map((l) => l.key),
	),
	'no layer dropped, order preserved',
);
assert(
	eq(stored.layers[0].art, authored.layers[0].art),
	'art (assetKey/frames/animated) preserved',
);
assert(
	stored.layers[1].placement.space === 'bone' && stored.layers[1].placement.bone === 'hand_tip',
	'bone placement preserved',
);
assert(eq(stored.layers[0].trigger, authored.layers[0].trigger), 'event trigger preserved');
assert(eq(stored.layers[1].trigger, { on: 'always' }), 'ambient (always) trigger preserved');

console.log('fx round-trip — idempotence');
assert(eq(normalizeEffectDoc(stored), stored), 'normalizeEffectDoc is idempotent');

console.log('fx round-trip — junk + malformed rejection');
const dirty = {
	version: 99,
	id: 'd',
	name: 'Dirty',
	camera: { zoom: 2 }, // editor-only state — must vanish (belongs in .fx.meta.json)
	selectedLayer: 'sparks', // editor-only — must vanish
	rogue: true,
	layers: [
		{
			key: 'ok',
			config: { lifetime: { min: 1, max: 1 }, frequency: 0.1, pos: { x: 0, y: 0 }, behaviors: [] },
			art: { assetKey: 'a', frames: ['f'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			_uiHint: 'drop me', // unknown layer field — must vanish
		},
		{ label: 'no key — dropped' },
		{ key: 'noart', config: {}, placement: { space: 'free' }, particleKind: 'sprite' }, // unbound art → KEPT (empty art block; the editor authors a layer before binding art)
		{ key: 'badconfig', config: 'not-an-object', art: { assetKey: 'a', frames: [] } }, // bad config → dropped
		'not even an object',
	],
};
const cleaned = normalizeEffectDoc(dirty, 'd');
assert(cleaned.version === EFFECT_DOC_VERSION, 'bad version forced to schema version');
assert(!('camera' in cleaned), 'editor-only camera state dropped');
assert(!('selectedLayer' in cleaned), 'editor-only selection dropped');
assert(!('rogue' in cleaned), 'rogue top-level field dropped');
assert(
	eq(
		cleaned.layers.map((l) => l.key),
		['ok', 'noart'],
	),
	'malformed layers dropped; an unbound-art sprite layer is KEPT (not destroyed at save)',
);
assert(!('_uiHint' in cleaned.layers[0]), 'unknown layer field dropped');
assert(
	eq(cleaned.layers[1].art, { assetKey: '', frames: [] }),
	'unbound sprite layer keeps an empty art block (author binds art later)',
);

console.log('fx round-trip — absent doc');
const empty = normalizeEffectDoc(undefined, 'fallback');
assert(empty.id === 'fallback' && empty.layers.length === 0, 'absent doc ⇒ empty effect');

console.log('fx round-trip — rig-particle gating (Tier C field discipline)');
const rigLayer = normalizeEffectDoc({
	id: 's',
	name: 's',
	layers: [
		{
			key: 'coins',
			config: { lifetime: { min: 1, max: 1 }, frequency: 0.1, pos: { x: 0, y: 0 }, behaviors: [] },
			art: { assetKey: 'a', frames: ['f'] },
			placement: { space: 'free' },
			particleKind: 'spine',
			spineParticle: { skeletonKey: 'coin_rig', animation: 'spin', loop: true },
		},
		{
			// particleKind sprite must NOT carry spineParticle through.
			key: 'sprite',
			config: { lifetime: { min: 1, max: 1 }, frequency: 0.1, pos: { x: 0, y: 0 }, behaviors: [] },
			art: { assetKey: 'a', frames: ['f'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			spineParticle: { skeletonKey: 'x', animation: 'y' },
		},
	],
});
assert(
	rigLayer.layers[0].particleKind === 'spine' &&
		eq(rigLayer.layers[0].spineParticle, {
			skeletonKey: 'coin_rig',
			animation: 'spin',
			loop: true,
		}),
	'rig layer keeps its spineParticle config',
);
assert(
	rigLayer.layers[1].spineParticle === undefined,
	'sprite layer drops a stray spineParticle (kind discipline)',
);

console.log('fx round-trip — art mix weights (per-frame spawn share)');
// A valid, aligned weights array survives normalize; an unaligned/degenerate one is dropped (uniform).
const weighted = normalizeEffectDoc({
	id: 'w',
	name: 'w',
	layers: [
		{
			key: 'ok',
			config: { lifetime: { min: 1, max: 1 }, frequency: 0.1, pos: { x: 0, y: 0 }, behaviors: [] },
			art: { assetKey: 'a', frames: ['x', 'y'], weights: [70, 30] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
		{
			key: 'badlen',
			config: { lifetime: { min: 1, max: 1 }, frequency: 0.1, pos: { x: 0, y: 0 }, behaviors: [] },
			art: { assetKey: 'a', frames: ['x', 'y'], weights: [1] }, // length ≠ frames → dropped
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
		{
			key: 'single',
			config: { lifetime: { min: 1, max: 1 }, frequency: 0.1, pos: { x: 0, y: 0 }, behaviors: [] },
			art: { assetKey: 'a', frames: ['x'], weights: [5] }, // single frame → weights meaningless, dropped
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
	],
});
assert(eq(weighted.layers[0].art.weights, [70, 30]), 'aligned mix weights survive normalize');
assert(
	weighted.layers[1].art.weights === undefined,
	'length-mismatched weights dropped (→ uniform)',
);
assert(weighted.layers[2].art.weights === undefined, 'weights on a single-frame layer dropped');
assert(
	eq(normalizeEffectDoc(weighted), weighted),
	'weights are an idempotent fixed point through normalize',
);

console.log('fx round-trip — weightedTextures expansion (bindArt seam)');
const T = { a: 'A', b: 'B' } as const;
const noWeights = weightedTextures([T.a, T.b]);
assert(noWeights.length === 2, 'no weights ⇒ uniform list (one entry each)');
const mix = weightedTextures([T.a, T.b], [75, 25]) as string[];
const countA = mix.filter((t) => t === T.a).length;
const countB = mix.filter((t) => t === T.b).length;
assert(countA > countB && Math.abs(countA / mix.length - 0.75) < 0.02, '75/25 mix repeats A ~3× B');
assert(
	(weightedTextures([T.a, T.b], [1, 0]) as string[]).every((t) => t === T.a),
	'a 0-share frame is excluded from the mix',
);
assert(
	weightedTextures([T.a, T.b], [0, 0]).length === 2,
	'all-zero weights fall back to the uniform list (never empty)',
);
assert(
	weightedTextures([T.a, T.b], [1, 2, 3]).length === 2,
	'a length-mismatched weights arg falls back to uniform',
);

console.log('fx round-trip — a layer material (Shader Graph step 8d.3)');
{
	const plainConfig = (): FxEmitterConfigV3 =>
		({
			lifetime: { min: 1, max: 1 },
			frequency: 0.1,
			pos: { x: 0, y: 0 },
			behaviors: [],
		}) as unknown as FxEmitterConfigV3;
	const spriteLayer = (key: string, material?: unknown) => ({
		key,
		config: plainConfig(),
		art: { assetKey: 'a', frames: ['f'] },
		placement: { space: 'free' },
		particleKind: 'sprite',
		...(material === undefined ? {} : { material }),
	});
	const material = {
		kind: 'custom:ember-glow',
		time: 'loop',
		intensity: 2.5,
		params: { tint: '#ff8800', speed: 1.5, wobble: true, mode: 'spiral' },
	};
	// author → /api/fx/save (normalize) → deploy/effects (normalize + tab JSON, `effectExport.ts`).
	const authoredDoc = {
		id: 'mat',
		name: 'Mat',
		layers: [spriteLayer('ember', material), spriteLayer('plain')],
	};
	const saved = normalizeEffectDoc(JSON.parse(JSON.stringify(authoredDoc)), 'mat');
	const exported = normalizeEffectDoc(JSON.parse(JSON.stringify(saved, null, '\t')), 'mat');
	assert(eq(saved.layers[0].material, material), 'a well-formed material is saved verbatim');
	assert(eq(exported, saved), '…and survives save → normalize → export unchanged');
	assert(
		eq(exported.layers[1], {
			key: 'plain',
			config: plainConfig(),
			art: { assetKey: 'a', frames: ['f'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		}) && !('material' in exported.layers[1]),
		'a layer without one has no `material` key',
	);
	assert(
		JSON.stringify(stored) === JSON.stringify(authored),
		'a canonical doc with no material normalizes byte for byte to itself (no key added)',
	);

	const mixed = normalizeEffectDoc({
		id: 'm',
		name: 'm',
		layers: [
			spriteLayer('loud', {
				kind: 'custom:x',
				intensity: 9,
				time: 'forever',
				params: { a: 1, b: NaN, c: {}, __proto__x: 2 },
			}),
			spriteLayer('quiet', { kind: 'custom:x', intensity: -1, params: {} }),
			spriteLayer('nokind', { intensity: 1 }),
			spriteLayer('builtin', { kind: 'glow' }),
			spriteLayer('badid', { kind: 'custom:has space' }),
			spriteLayer('notobj', 'custom:x'),
			{
				...spriteLayer('rig', { kind: 'custom:x' }),
				particleKind: 'spine',
				spineParticle: { skeletonKey: 'coin', animation: 'spin' },
			},
		],
	});
	const byKey = (k: string) => mixed.layers.find((l) => l.key === k);
	assert(
		eq(byKey('loud')?.material, {
			kind: 'custom:x',
			intensity: 4,
			params: { a: 1, __proto__x: 2 },
		}),
		'strength clamped to 4, an unknown time mode dropped, non-scalar / non-finite params dropped',
	);
	assert(
		eq(byKey('quiet')?.material, { kind: 'custom:x', intensity: 0 }),
		'strength clamped to 0; an empty params set left out',
	);
	assert(
		['nokind', 'builtin', 'badid', 'notobj'].every((k) => byKey(k) && !('material' in byKey(k)!)),
		'a material with no kind, a built-in kind, a malformed id or not an object is dropped (the layer is kept)',
	);
	assert(
		byKey('rig')?.particleKind === 'spine' && !('material' in byKey('rig')!),
		'a Tier-C rig layer drops its material (sprite layers only)',
	);
	assert(eq(normalizeEffectDoc(mixed), mixed), 'a normalized material is a fixed point');

	const compiled = new Set(['custom:ember-glow']);
	const issues = validateEffectMaterials(
		{
			layers: [
				...saved.layers,
				...normalizeEffectDoc({ layers: [spriteLayer('gone', { kind: 'custom:deleted' })] }).layers,
			],
		},
		(kind) => compiled.has(kind),
	);
	assert(
		issues.length === 1 &&
			issues[0].layer === 'gone' &&
			issues[0].kind === 'custom:deleted' &&
			issues[0].code === 'material-not-compiled',
		'validation names a material whose kind the project does not compile, and only it',
	);
}

// ===========================================================================
// B. CONFIG↔LIBRARY — the nested config is what the runtime actually eats.
// ===========================================================================
console.log('fx round-trip — nested config feeds the library verbatim');

// The nested config must be passed through normalize UNTOUCHED (verbatim contract).
assert(
	eq(stored.layers[0].config, sparksConfig),
	'normalize keeps layer.config byte-identical (no reshape)',
);

// upgradeConfig(config, textures) is the EXACT call ParticleEmitter.svelte makes. Feed our
// reloaded doc's config through it with stub textures (the library only needs array-like art
// for a V3 config — it returns the config with `textureBehaviors` resolved). If our schema's
// `config` weren't a real EmitterConfigV3, this throws — proving the data contract offline.
const stubTextures = [{}, {}, {}] as unknown as Parameters<typeof upgradeConfig>[1];
let upgraded: EmitterConfigV3 | undefined;
try {
	upgraded = upgradeConfig(reloaded.layers[0].config, stubTextures);
} catch (err) {
	failures++;
	console.error(`  ✗ upgradeConfig threw on the nested config: ${(err as Error).message}`);
}
if (upgraded) {
	assert(Array.isArray(upgraded.behaviors), 'upgradeConfig returns a V3 config with behaviors');
	assert(
		eq(upgraded.lifetime, sparksConfig.lifetime) && upgraded.frequency === sparksConfig.frequency,
		'library preserves the core emitter params (lifetime/frequency) through upgrade',
	);
	// A pure V3 config is already current → upgradeConfig must not strip authored behaviors.
	assert(
		upgraded.behaviors.length >= sparksConfig.behaviors.length,
		'authored behaviors survive the library upgrade path',
	);
}

console.log('');
if (failures > 0) {
	console.error(`FX ROUND-TRIP: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FX ROUND-TRIP: PASSED');
