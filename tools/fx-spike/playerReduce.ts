/**
 * Invisible FX — Phase 4 (pipeline wiring), increment 1 headless harness for the RUNTIME
 * player's pure reduction:
 *
 *   pnpm --filter fx-spike run player
 *
 * The runtime `<EffectPlayer>` (pixi-svelte) + `bakedEffects()` reader can't render WebGL
 * here (authed game, real GPU), so — exactly as the sibling tools do — we verify OFFLINE the
 * pure decisions the player stands on: for an authored `EffectDoc`, the per-layer mount plan
 * (`planEffect`/`planLayer` in `engine-fx`) — which layers mount, free vs bone-wrapped, the
 * offset, emit gating (ambient vs event) — AND the shared `bindArt` output (art-bound vs not,
 * static `textureRandom` vs animated `animatedSingle`, live textures carried, V1/V2 left to
 * `upgradeConfig`). The WebGL pixels (a real game playing the effect) still need live
 * owner-verify (see the design doc).
 */

import { upgradeConfig, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	EFFECT_DOC_VERSION,
	bindArt,
	planEffect,
	planLayer,
	type EffectDoc,
	type EmitterLayer,
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

const baseConfig = (): EmitterConfigV3 => ({
	lifetime: { min: 0.5, max: 0.8 },
	frequency: 0.012,
	emitterLifetime: -1,
	maxParticles: 200,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [{ type: 'alpha', config: { alpha: { list: [{ time: 0, value: 1 }] } } }],
});

const layer = (over: Partial<EmitterLayer>): EmitterLayer => ({
	key: 'layer-x',
	config: baseConfig(),
	art: { assetKey: 'sparks', frames: ['s1'] },
	placement: { space: 'free' },
	particleKind: 'sprite',
	...over,
});

// ---------------------------------------------------------------------------
// 1. Per-layer mount plan — free vs bone, offset, emit gating, Tier-C skip.
// ---------------------------------------------------------------------------
console.log('fx player — per-layer mount plan');

const free = planLayer(
	layer({ key: 'free', placement: { space: 'free', offset: { x: 5, y: -3 } } }),
);
assert(free.render && free.mount === 'free', 'a free sprite layer renders, mounts free');
assert(eq(free.offset, { x: 5, y: -3 }), 'free layer carries its offset');
assert(free.bone === undefined, 'free layer has no bone');
assert(free.emit === true, 'free layer with no trigger emits (ambient by default)');

const bone = planLayer(
	layer({ key: 'bone', placement: { space: 'bone', bone: 'torch_tip', offset: { x: 0, y: 2 } } }),
);
assert(bone.render && bone.mount === 'bone', 'a bone-placed layer mounts bone-wrapped');
assert(bone.bone === 'torch_tip', 'bone layer resolves its bone name');
assert(eq(bone.offset, { x: 0, y: 2 }), 'bone layer carries its offset');

const boneNoName = planLayer(layer({ key: 'bn', placement: { space: 'bone' } }));
assert(
	boneNoName.mount === 'free' && boneNoName.bone === undefined,
	'a bone layer with NO bone name falls back to a free mount (never silently vanishes)',
);

const ambient = planLayer(layer({ key: 'amb', trigger: { on: 'always' } }));
assert(ambient.emit === true, 'an `always` (ambient) trigger emits now');

const evented = planLayer(layer({ key: 'evt', trigger: { on: 'event', eventType: 'bigWin' } }));
assert(
	evented.emit === false,
	'an `event` trigger stays DORMANT (the event-bus subscription is a later increment)',
);

const spineParticle = planLayer(
	layer({
		key: 'sp',
		particleKind: 'spine',
		spineParticle: { skeletonKey: 'coin', animation: 'spin' },
	}),
);
assert(
	spineParticle.render === false,
	'a `spine` particle layer (Tier C / Phase 3) is NOT mounted this increment',
);

// ---------------------------------------------------------------------------
// 2. Whole-doc plan in document order.
// ---------------------------------------------------------------------------
console.log('fx player — whole-doc plan');
const doc: EffectDoc = {
	version: EFFECT_DOC_VERSION,
	id: 'torch',
	name: 'Torch FX',
	layers: [
		layer({ key: 'flame', placement: { space: 'bone', bone: 'tip' } }),
		layer({ key: 'embers', placement: { space: 'free', offset: { x: 0, y: -10 } } }),
		layer({
			key: 'coins',
			particleKind: 'spine',
			spineParticle: { skeletonKey: 'coin', animation: 'spin' },
		}),
	],
};
const plan = planEffect(doc);
assert(plan.length === 3, 'plan has one entry per layer, in document order');
assert(plan.map((p) => p.key).join(',') === 'flame,embers,coins', 'plan preserves layer order');
assert(
	plan.filter((p) => p.render).length === 2,
	'the spine-particle layer is excluded from the rendered set; the two sprite layers render',
);
assert(plan[0].mount === 'bone' && plan[1].mount === 'free', 'mix of bone + free mounts resolved');

// ---------------------------------------------------------------------------
// 3. The shared bindArt the player feeds each <ParticleEmitter> (V3 art binding).
// ---------------------------------------------------------------------------
console.log('fx player — shared bindArt (V3 art binding the runtime contract turns on)');
const cfg = baseConfig();
const before = JSON.stringify(cfg);
const tex = [{ id: 't0' }, { id: 't1' }, { id: 't2' }] as unknown[];

// upgradeConfig is a NO-OP for V3 → without bindArt the emitter is textureless (the trap).
const noop = upgradeConfig(JSON.parse(JSON.stringify(cfg)), tex as never);
assert(
	!(noop as EmitterConfigV3).behaviors.some((b) => b.type === 'textureRandom'),
	'upgradeConfig leaves a V3 config WITHOUT an art behavior (the invisible-particle trap)',
);

const staticBound = bindArt(cfg, tex, false);
const artStatic = staticBound.behaviors.find((b) =>
	['textureRandom', 'animatedSingle'].includes(b.type),
);
assert(JSON.stringify(cfg) === before, 'bindArt does not mutate the input config (pure)');
assert(artStatic?.type === 'textureRandom', 'static art ⇒ a textureRandom behavior');
assert(
	(artStatic?.config as { textures?: unknown[] }).textures === tex,
	'the LIVE texture objects are carried through (not JSON-cloned away)',
);

const animBound = bindArt(cfg, tex, true);
const artAnim = animBound.behaviors.find((b) =>
	['textureRandom', 'animatedSingle'].includes(b.type),
);
assert(artAnim?.type === 'animatedSingle', '>1 texture + animated ⇒ an animatedSingle flipbook');
const anim = (
	artAnim?.config as { anim?: { framerate?: number; loop?: boolean; textures?: unknown[] } }
).anim;
assert(anim?.framerate === -1 && anim?.loop === true, 'flipbook matches particle life + loops');
assert(anim?.textures === tex, 'flipbook carries the live textures');

const unbound = bindArt(cfg, [], false);
assert(
	!unbound.behaviors.some((b) => ['textureRandom', 'animatedSingle'].includes(b.type)),
	'0 textures ⇒ NO art behavior (an unbound layer renders nothing, by design)',
);

// A V1/V2 (no `behaviors`) config must NOT be touched by bindArt — it binds via upgradeConfig.
const v1 = {
	lifetime: { min: 1, max: 1 },
	frequency: 0.1,
	pos: { x: 0, y: 0 },
	alpha: { start: 1, end: 0 },
};
const upgraded = upgradeConfig(JSON.parse(JSON.stringify(v1)), tex as never);
assert(
	Array.isArray((upgraded as EmitterConfigV3).behaviors),
	'a V1/V2 config still binds its art through upgradeConfig (the existing path, untouched)',
);

console.log('');
if (failures === 0) {
	console.log('FX PLAYER-REDUCE: PASSED');
} else {
	console.error(`FX PLAYER-REDUCE: ${failures} FAILURE(S)`);
	process.exit(1);
}
