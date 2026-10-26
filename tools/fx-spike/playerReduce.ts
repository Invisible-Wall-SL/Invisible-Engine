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
import { Container, Texture } from 'pixi.js';
import {
	EFFECT_DOC_VERSION,
	FX_MATERIAL_LAYER_CAP,
	bindArt,
	createFxMaterialSlots,
	fxMaterialMount,
	fxMaterialPeakParticles,
	planEffect,
	planLayer,
	type EffectDoc,
	type EmitterLayer,
} from 'engine-fx';
import { setCustomElementFx } from '../../packages/constants-shared/elementFx';
import { REFERENCE_GRAPHS, compileShaderEffect } from '../../packages/engine-shadergraph/index';
import {
	mountParticleMaterial,
	particleMaterialSlotsFor,
} from '../../packages/pixi-svelte/src/lib/particleMaterial/mount';

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
	'an `event` trigger stays DORMANT at mount (the event-bus subscription flips it on)',
);
assert(
	evented.trigger.mode === 'event' && evented.trigger.eventType === 'bigWin',
	'the plan carries the event trigger (mode + eventType) for the runtime subscription',
);
assert(
	ambient.trigger.mode === 'always',
	'an ambient layer plan carries the `always` trigger mode',
);

const rigParticle = planLayer(
	layer({
		key: 'sp',
		particleKind: 'spine',
		spineParticle: { skeletonKey: 'coin', animation: 'spin', loop: true },
	}),
);
assert(
	rigParticle.render === true,
	'a `spine` particle layer (Tier C) now RENDERS (Phase-0 verdict — native pooled RigParticle)',
);
assert(
	rigParticle.particleKind === 'spine',
	'the plan marks a rig layer `particleKind: rig` (the runtime branches on it)',
);
assert(
	rigParticle.spineParticle?.skeletonKey === 'coin' &&
		rigParticle.spineParticle?.animation === 'spin' &&
		rigParticle.spineParticle?.loop === true,
	'the plan carries the spineParticle config (skeleton/clip/loop) through to the runtime',
);
assert(
	planLayer(layer({ key: 'spx', particleKind: 'spine' })).render === false,
	'a `spine` layer with NO spineParticle config is skipped (can’t resolve a skeleton, fail-safe)',
);
assert(
	planLayer(layer({ key: 'sprite' })).particleKind === 'sprite',
	'a sprite layer plan stays `particleKind: sprite` (the bindArt/key path, unchanged)',
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
	plan.filter((p) => p.render).length === 3,
	'all three layers render now (two sprite + the native rig-particle layer)',
);
assert(
	plan[2].particleKind === 'spine' && plan[2].spineParticle?.skeletonKey === 'coin',
	'the rig layer renders with its spineParticle config carried through',
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
assert(anim?.framerate === -1, 'flipbook matches particle life');
// No `loop`: the library coerces loop:false at framerate <= 0, so emitting it was dead config.
assert(anim !== undefined && !('loop' in anim), 'flipbook does NOT emit a dead loop flag');
assert(anim?.textures === tex, 'flipbook carries the live textures');

// A static multi-frame layer's per-frame WEIGHTS (art.weights) flow through the player: EffectLayer
// resolves art.frames → textures and passes art.weights alongside, and bindArt realises them as a
// repeated-texture multiset (heavier frame repeats more). The flipbook path ignores weights.
const wBound = bindArt(cfg, tex, false, [80, 10, 10]);
const wList =
	((wBound.behaviors.find((b) => b.type === 'textureRandom')?.config as { textures?: unknown[] })
		?.textures as unknown[]) ?? [];
assert(wList.length > tex.length, 'weights expand the textureRandom list into a repeated multiset');
assert(
	wList.filter((t) => t === tex[0]).length > wList.filter((t) => t === tex[1]).length,
	'the heavier-weighted frame repeats more often than a lighter one',
);
const wAnim = bindArt(cfg, tex, true, [80, 10, 10]);
assert(
	wAnim.behaviors.some((b) => b.type === 'animatedSingle') &&
		!wAnim.behaviors.some((b) => b.type === 'textureRandom'),
	'the flipbook (animated) path ignores weights and plays all frames',
);

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

// ---------------------------------------------------------------------------
// 4. Material or plain (Shader Graph step 8d.3): the plan, the mount decision, the game cap.
// ---------------------------------------------------------------------------
console.log('fx player — material or plain');
const glowMaterial = { kind: 'custom:pulse', time: 'loop', intensity: 2 } as const;
assert(
	JSON.stringify(planLayer(layer({ key: 'm', material: glowMaterial })).material) ===
		JSON.stringify(glowMaterial),
	'a sprite layer with a material plans it',
);
assert(
	!('material' in planLayer(layer({ key: 'p' }))),
	'a layer without one plans none (its plan is what it was)',
);
assert(
	planLayer(
		layer({
			key: 'r',
			particleKind: 'spine',
			spineParticle: { skeletonKey: 'coin', animation: 'spin' },
			material: glowMaterial,
		}),
	).material === undefined,
	'a Tier-C rig layer plans no material, even when one is stored',
);

{
	const slots = createFxMaterialSlots();
	assert(slots.cap === FX_MATERIAL_LAYER_CAP && FX_MATERIAL_LAYER_CAP === 8, 'the game cap is 8');
	const decide = (over: Partial<Parameters<typeof fxMaterialMount>[0]> = {}) =>
		fxMaterialMount({ rigParticles: false, registered: true, slots, ...over });
	const rig = decide({ rigParticles: true });
	const missing = decide({ registered: false });
	assert(
		!rig.on && rig.plain === 'rig particles' && !missing.on && missing.plain === 'not registered',
		'rig particles and an unregistered kind draw plain…',
	);
	assert(slots.drawing === 0, '…and take no slot');
	const first = Array.from({ length: 8 }, () => decide());
	assert(
		first.every((d) => d.on) && slots.drawing === 8,
		'eight registered layers draw through their material',
	);
	const ninth = decide();
	assert(
		!ninth.on && ninth.plain === 'over the game cap',
		'the ninth draws plain: over the game cap',
	);
	slots.release();
	assert(
		!ninth.on && slots.drawing === 7,
		'a slot freed later does not turn the ninth on (decided at mount, kept for its life)',
	);
	assert(decide().on && slots.drawing === 8, 'a layer mounting after that takes the free slot');
	for (let i = 0; i < 20; i++) slots.release();
	assert(slots.drawing === 0, 'releasing more than was claimed never goes below 0');
}

{
	const drivenLayer = layer({ key: 'd', config: { ...baseConfig(), maxParticles: 80 } });
	const peak = (params: EffectDoc['params']) => fxMaterialPeakParticles(drivenLayer, params);
	assert(peak(undefined) === 80, 'capacity is Max particles at mount when nothing drives it');
	assert(
		peak([
			{
				id: 'n',
				kind: 'number',
				default: 0.5,
				min: 0,
				max: 1,
				drives: [{ id: 'a', layer: 'd', path: 'emitter.maxParticles', from: 40, to: 300 }],
			},
		]) === 300,
		'a mapped Max-particles drive sizes it to the top of its range',
	);
	assert(
		peak([
			{
				id: 'n',
				kind: 'number',
				default: 100,
				min: 10,
				max: 250,
				drives: [{ id: 'a', layer: 'd', path: 'emitter.maxParticles' }],
			},
			{
				id: 'b',
				kind: 'bool',
				default: false,
				drives: [{ id: 'a', layer: 'd', path: 'emitter.maxParticles', from: 20, to: 120 }],
			},
		]) === 250,
		'an as-is drive takes its parameter max; a switch its larger end',
	);
	assert(
		peak([
			{
				id: 'n',
				kind: 'number',
				default: 100,
				drives: [{ id: 'a', layer: 'd', path: 'emitter.maxParticles' }],
			},
			{
				id: 'o',
				kind: 'number',
				default: 1,
				drives: [{ id: 'a', layer: 'other', path: 'emitter.maxParticles', from: 1, to: 999 }],
			},
		]) === Infinity,
		'an as-is drive on a parameter with no max has no bound: Infinity',
	);
	assert(
		peak([
			{
				id: 'o',
				kind: 'number',
				default: 1,
				drives: [{ id: 'a', layer: 'other', path: 'emitter.maxParticles', from: 1, to: 999 }],
			},
		]) === 80,
		'another layer’s drive is not counted',
	);
	assert(
		peak([
			{
				id: 'n',
				kind: 'number',
				default: 0.5,
				drives: [{ id: 'a', layer: 'd', path: 'emitter.maxParticles', from: 0, to: 100 }],
			},
		]) === 1000 &&
			peak([
				{
					id: 'n',
					kind: 'number',
					default: 50,
					max: 100,
					drives: [{ id: 'a', layer: 'd', path: 'emitter.maxParticles' }],
				},
			]) === 1000,
		'a drive that can write 0 or less counts as the library’s 1000 (a mapped end, or no min)',
	);
}

{
	// The emitter's mount (`mountParticleMaterial`) for every reason decided before a renderer is built.
	const compiled = compileShaderEffect({ ...REFERENCE_GRAPHS[0], id: 'pulse' });
	if (!compiled.ok) throw new Error('the reference graph does not compile');
	setCustomElementFx([compiled.effect]);
	const slots = createFxMaterialSlots(1);
	const host = new Container();
	const mount = (kind: string, rigParticles = false) =>
		mountParticleMaterial({
			spec: { kind },
			host,
			textures: [],
			maxParticles: 10,
			rigParticles,
			slots,
		});
	const unregistered = mount('custom:deleted');
	const rigged = mount('custom:pulse', true);
	assert(
		unregistered.material === undefined && unregistered.state === 'not registered',
		'an unregistered kind mounts no renderer: plain',
	);
	assert(
		rigged.material === undefined && rigged.state === 'rig particles',
		'a rig-particle emitter with a registered material mounts no renderer: plain',
	);
	slots.claim();
	const capped = mount('custom:pulse');
	assert(
		capped.material === undefined && capped.state === 'over the game cap' && slots.drawing === 1,
		'with every slot held, a registered kind mounts plain and takes nothing',
	);
	assert(
		host.children.length === 0,
		'a plain layer leaves nothing in its host: it is a layer with no material',
	);

	// Refused by the renderer at mount: the slot is claimed, then given back.
	const free = createFxMaterialSlots(1);
	const refusedBy = (peakParticles: number | undefined, textures: Texture[]) =>
		mountParticleMaterial({
			spec: { kind: 'custom:pulse', peakParticles },
			host,
			textures,
			maxParticles: 200,
			rigParticles: false,
			slots: free,
		});
	const overPeak = refusedBy(2000, [Texture.WHITE]);
	const unbounded = refusedBy(Infinity, [Texture.WHITE]);
	const noFrames = refusedBy(undefined, []);
	assert(
		overPeak.state === 'Max particles can be driven over 512' && overPeak.material === undefined,
		'Max particles 200 at mount but drivable to 2000: plain from mount, never mid-play',
	);
	assert(
		unbounded.state === 'Max particles driven with no bound' && unbounded.material === undefined,
		'Max particles driven with no bound: plain from mount',
	);
	assert(
		noFrames.state === 'no frames when it mounted',
		'no frames when it mounted: plain, with its own reason',
	);
	assert(
		free.drawing === 0 && host.children.length === 0,
		'each refusal gives its slot back and leaves nothing in the host',
	);

	// A renderer whose construction throws (here Pixi's program, which needs a canvas Node lacks).
	let threw = false;
	try {
		refusedBy(100, [Texture.WHITE]);
	} catch {
		threw = true;
	}
	assert(
		threw && free.drawing === 0 && host.children.length === 0,
		'a construction that throws gives its slot back and leaves nothing in the host',
	);
	setCustomElementFx([]);
}

{
	// One count per game: each Pixi app's state keys its own slots.
	const appA = {};
	const appB = {};
	const a = particleMaterialSlotsFor(appA);
	assert(a === particleMaterialSlotsFor(appA), 'an app gets the same slots each time');
	const filled = Array.from({ length: 8 }, () => a.claim()).every(Boolean);
	const b = particleMaterialSlotsFor(appB);
	assert(
		filled && !a.claim() && Array.from({ length: 8 }, () => b.claim()).every(Boolean),
		'two apps on one page each get their own 8',
	);
}

console.log('');
if (failures === 0) {
	console.log('FX PLAYER-REDUCE: PASSED');
} else {
	console.error(`FX PLAYER-REDUCE: ${failures} FAILURE(S)`);
	process.exit(1);
}
