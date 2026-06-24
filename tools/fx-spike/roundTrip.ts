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
			trigger: { on: 'event', eventType: 'winShow', duration: 800 },
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
		{ key: 'noart', config: {}, placement: { space: 'free' }, particleKind: 'sprite' }, // no art → dropped
		{ key: 'badconfig', config: 'not-an-object', art: { assetKey: 'a', frames: [] } }, // bad config → dropped
		'not even an object',
	],
};
const cleaned = normalizeEffectDoc(dirty, 'd');
assert(cleaned.version === EFFECT_DOC_VERSION, 'bad version forced to schema version');
assert(!('camera' in cleaned), 'editor-only camera state dropped');
assert(!('selectedLayer' in cleaned), 'editor-only selection dropped');
assert(!('rogue' in cleaned), 'rogue top-level field dropped');
assert(cleaned.layers.length === 1 && cleaned.layers[0].key === 'ok', 'invalid layers dropped');
assert(!('_uiHint' in cleaned.layers[0]), 'unknown layer field dropped');

console.log('fx round-trip — absent doc');
const empty = normalizeEffectDoc(undefined, 'fallback');
assert(empty.id === 'fallback' && empty.layers.length === 0, 'absent doc ⇒ empty effect');

console.log('fx round-trip — spine-particle gating (Tier C field discipline)');
const spineLayer = normalizeEffectDoc({
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
	spineLayer.layers[0].particleKind === 'spine' &&
		eq(spineLayer.layers[0].spineParticle, {
			skeletonKey: 'coin_rig',
			animation: 'spin',
			loop: true,
		}),
	'spine layer keeps its spineParticle config',
);
assert(
	spineLayer.layers[1].spineParticle === undefined,
	'sprite layer drops a stray spineParticle (kind discipline)',
);

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
