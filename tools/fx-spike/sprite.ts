/**
 * Invisible FX — the SPRITE TRANSFORM gate: the `fxSprite` rotation offset + pivot, through the
 * pure model helpers and the real library `Emitter`.
 *
 *   pnpm --filter fx-spike run sprite      (root: pnpm check:fx-sprite)
 *
 * Proves, offline:
 *  1. `readFxSprite` is the one clamp, and the defaults (0°, centred) carry NO behavior, so an
 *     untouched effect stays byte-identical.
 *  2. The rotation offset draws the art at `rotation + θ` with no shear, while `particle.rotation`
 *     (the launch direction and every rotation writer's target) is left alone — so the particle
 *     flies exactly where it did without the offset.
 *  3. The pivot lands on the particle's anchor; recycling restores the library default, so a
 *     pooled particle never keeps a stale pivot after the behavior is switched off.
 *  4. A preset keeps the layer's sprite transform; the doc survives the ship chain verbatim.
 */

import { Container, type Sprite } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_BEHAVIOR_TYPES,
	FX_SPRITE_BEHAVIOR_TYPE,
	FxSpriteBehavior,
	behaviorsOf,
	normalizeEffectDoc,
	readFxSprite,
	registerFxBehaviors,
	type EffectDoc,
} from 'engine-fx';
import {
	applyPreset,
	defaultEmitterConfig,
	newLayer,
	setSpriteTransform,
	spriteTransform,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

console.log('fx sprite — the model');
const clamped = readFxSprite({ rotation: 540, anchorX: -3, anchorY: Number.NaN });
assert(
	clamped.rotation === -180 && clamped.anchorX === 0 && clamped.anchorY === 0.5,
	'readFxSprite wraps rotation, pins the anchor, maps NaN to the default',
);
const base = defaultEmitterConfig();
const t0 = spriteTransform(base);
assert(
	t0.rotation === 0 && t0.anchorX === 0.5 && t0.anchorY === 0.5,
	'no behavior reads as 0°, centred',
);
const rotated = setSpriteTransform(base, { rotation: 90 });
assert(
	behaviorsOf(rotated).filter((b) => b.type === FX_SPRITE_BEHAVIOR_TYPE).length === 1,
	'a rotation adds one fxSprite behavior',
);
const top = setSpriteTransform(rotated, { anchorY: 0 });
const tt = spriteTransform(top);
assert(tt.rotation === 90 && tt.anchorX === 0.5 && tt.anchorY === 0, 'fields patch independently');
const back = setSpriteTransform(setSpriteTransform(top, { rotation: 0 }), { anchorY: 0.5 });
assert(
	JSON.stringify(back) === JSON.stringify(base),
	'returning to the defaults removes the behavior — the config is byte-identical again',
);
assert(
	JSON.stringify(base) === JSON.stringify(defaultEmitterConfig()),
	'edits never mutate the input',
);

console.log('');
console.log('fx sprite — the real Emitter');
registerFxBehaviors(Emitter);
const known = (Emitter as unknown as { knownBehaviors: Record<string, unknown> }).knownBehaviors;
assert(!!known[FX_SPRITE_BEHAVIOR_TYPE], 'registerFxBehaviors registers fxSprite');
assert(
	FX_BEHAVIOR_TYPES.includes(FX_SPRITE_BEHAVIOR_TYPE),
	'fxSprite is listed in FX_BEHAVIOR_TYPES',
);

interface LiveParticle {
	x: number;
	y: number;
	rotation: number;
	anchor: { x: number; y: number };
	skew: { x: number; y: number };
	scale: { x: number; y: number };
	next: LiveParticle | null;
}
const first = (em: Emitter): LiveParticle | null =>
	(em as unknown as { _activeParticlesFirst: LiveParticle | null })._activeParticlesFirst;
const pool = (em: Emitter): LiveParticle | null =>
	(em as unknown as { _poolFirst: LiveParticle | null })._poolFirst;

/** One particle launched at 30° with a 45°/s spin, flying for `seconds`. */
const oneShot = (extra: EmitterConfigV3['behaviors']): EmitterConfigV3 =>
	({
		lifetime: { min: 5, max: 5 },
		frequency: 10,
		emitterLifetime: -1,
		maxParticles: 1,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'rotation',
				config: { minStart: 30, maxStart: 30, minSpeed: 45, maxSpeed: 45, accel: 0 },
			},
			{ type: 'moveSpeedStatic', config: { min: 100, max: 100 } },
			...extra,
		],
	}) as EmitterConfigV3;
const run = (config: EmitterConfigV3, seconds: number): Emitter => {
	const em = new Emitter(new Container(), config);
	em.emit = true;
	em.update(0);
	for (let i = 0; i < Math.round(seconds * 60); i++) em.update(1 / 60);
	return em;
};

const spriteEntry = {
	type: FX_SPRITE_BEHAVIOR_TYPE,
	config: { rotation: 90, anchorX: 0.5, anchorY: 0 },
};
const plain = first(run(oneShot([]), 1));
const withXf = run(oneShot([spriteEntry]), 1);
const p = first(withXf);
assert(
	!!plain && !!p && near(p.x, plain.x) && near(p.y, plain.y) && near(p.rotation, plain.rotation),
	'the offset does not change where the particle flies or its rotation (launch + spin intact)',
);
assert(
	withXf.getBehavior(FX_SPRITE_BEHAVIOR_TYPE) instanceof FxSpriteBehavior,
	'the emitter built the production behavior from the config',
);
if (p) {
	// Read PIXI's own local matrix: it must be a pure rotation by r + 90° (scaled), no shear.
	const sprite = p as unknown as Sprite;
	sprite.updateLocalTransform();
	const m = sprite.localTransform;
	const want = p.rotation + Math.PI / 2;
	const k = p.scale.x;
	const ok =
		near(m.a, k * Math.cos(want)) &&
		near(m.b, k * Math.sin(want)) &&
		near(m.c, -k * Math.sin(want)) &&
		near(m.d, k * Math.cos(want));
	assert(ok, 'the art draws at rotation + 90° with no shear (PIXI local matrix)');
	assert(p.anchor.x === 0.5 && p.anchor.y === 0, 'the pivot is the particle anchor (Top)');
}
withXf.init(oneShot([]));
const recycled = pool(withXf);
assert(
	!!recycled &&
		recycled.anchor.x === 0.5 &&
		recycled.anchor.y === 0.5 &&
		recycled.skew.x === 0 &&
		recycled.skew.y === 0,
	're-init without the behavior recycles particles back to centred, unskewed',
);

console.log('');
console.log('fx sprite — presets + the ship chain');
const layer = { ...newLayer('l1'), config: top };
const preset = applyPreset(layer, 'sparks');
const pt = spriteTransform(preset.config);
assert(
	preset.config !== top && pt.rotation === 90 && pt.anchorY === 0,
	'applying a preset keeps the sprite rotation + pivot',
);
const doc: EffectDoc = {
	version: 1,
	id: 'sprite',
	name: 'sprite',
	layers: [layer],
};
const saved = normalizeEffectDoc(JSON.parse(JSON.stringify(doc)));
const deployed = normalizeEffectDoc(JSON.parse(JSON.stringify(saved, null, '\t')), 'sprite');
assert(
	JSON.stringify(deployed.layers[0].config) === JSON.stringify(top),
	'the fxSprite behavior travels save → export → bake VERBATIM',
);

console.log('');
if (failures) {
	console.error(`fx sprite: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx sprite: all green');
