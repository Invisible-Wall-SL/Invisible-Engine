/**
 * Invisible FX — headless harness for the ADVANCED emitter-param helpers added to
 * `fxModel.client.ts` (emission direction + spin, the speed↔gravity movement model,
 * colour tint, blend mode, and the preset library). Same offline discipline as
 * `modelHelpers.ts`:
 *
 *   pnpm --filter fx-spike run params
 *
 * Proves: (1) every setter is PURE (returns a new config, never mutates its input) and
 * round-trips through its reader; (2) the rotation behaviors stay mutually exclusive
 * (exactly one of `rotation`/`rotationStatic`) and the movement behaviors stay mutually
 * exclusive (`moveSpeed` XOR `moveAcceleration`) — the library would double-move / throw
 * otherwise; (3) every preset, and every edited config, still feeds `upgradeConfig` (the
 * exact guard `ParticleEmitter.svelte`/`FxStage` run) without throwing — the verbatim
 * runtime contract holds. WebGL pixels still need live owner-verify (design doc).
 */

import { upgradeConfig, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_PRESETS,
	applyPreset,
	blendMode,
	burst,
	defaultEmitterConfig,
	emissionArc,
	gravity,
	movementModel,
	newLayer,
	particleColor,
	particleSpin,
	setBlendMode,
	setBurst,
	setColorEnabled,
	setEmissionArc,
	setGravity,
	setMovementModel,
	setParticleColor,
	setParticleSpin,
	setSpawnKind,
	spawnKind,
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

const stubTextures = [{}, {}] as unknown as Parameters<typeof upgradeConfig>[1];
const feeds = (c: EmitterConfigV3): boolean => {
	try {
		upgradeConfig(JSON.parse(JSON.stringify(c)), stubTextures);
		return true;
	} catch {
		return false;
	}
};
const typesOf = (c: EmitterConfigV3): string[] =>
	(Array.isArray(c.behaviors) ? c.behaviors : []).map((b) => (b as { type: string }).type);
const count = (c: EmitterConfigV3, type: string): number =>
	typesOf(c).filter((t) => t === type).length;

const base = defaultEmitterConfig();
const baseSnap = JSON.stringify(base);

// ---------------------------------------------------------------------------
// 1. Emission arc (direction + spread).
// ---------------------------------------------------------------------------
console.log('fx params — emission direction + spread');
// The default config carries `rotationStatic { min:0, max:360 }` ⇒ centre 180, spread 180.
const arc0 = emissionArc(base);
assert(
	!!arc0 && arc0.center === 180 && arc0.spread === 180,
	'default reads as centre 180 / spread 180',
);
const up = setEmissionArc(base, 90, 18);
assert(JSON.stringify(base) === baseSnap, 'setEmissionArc does not mutate the source');
const upArc = emissionArc(up);
assert(
	!!upArc && upArc.center === 90 && upArc.spread === 18,
	'emission arc round-trips (centre 90 / spread 18)',
);
assert(
	count(up, 'rotation') + count(up, 'rotationStatic') === 1,
	'exactly one rotation behavior present',
);
assert(feeds(up), 'directional config feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 2. Particle spin — upgrades rotationStatic ⇄ rotation, preserving the arc.
// ---------------------------------------------------------------------------
console.log('fx params — particle spin');
const spin0 = particleSpin(base);
assert(
	spin0.minSpeed === 0 && spin0.maxSpeed === 0 && spin0.accel === 0,
	'default (rotationStatic) has no spin',
);
const spun = setParticleSpin(up, { minSpeed: -200, maxSpeed: 200, accel: 0 });
assert(
	count(spun, 'rotation') === 1 && count(spun, 'rotationStatic') === 0,
	'spin upgrades to `rotation` (no static left)',
);
const spunArc = emissionArc(spun);
assert(
	!!spunArc && spunArc.center === 90 && spunArc.spread === 18,
	'spin upgrade preserves the emission arc',
);
const spunRead = particleSpin(spun);
assert(spunRead.minSpeed === -200 && spunRead.maxSpeed === 200, 'spin speed round-trips');
// Zeroing the spin downgrades back to the lighter rotationStatic, keeping the arc.
const calm = setParticleSpin(spun, { minSpeed: 0, maxSpeed: 0, accel: 0 });
assert(
	count(calm, 'rotationStatic') === 1 && count(calm, 'rotation') === 0,
	'zero spin downgrades to rotationStatic',
);
assert(emissionArc(calm)?.center === 90, 'downgrade preserves the emission arc');
assert(feeds(spun), 'spinning config feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 2b. Burst spawn — a fifth spawn kind, mutually exclusive with spawnShape AND
//     the rotation behavior (burst owns the launch direction).
// ---------------------------------------------------------------------------
console.log('fx params — burst spawn');
assert(spawnKind(base) === 'circle', 'default reads as the circle spawn kind');
assert(burst(base) === undefined, 'default has no burst behavior');
const bz = setSpawnKind(base, 'burst');
assert(JSON.stringify(base) === baseSnap, 'setSpawnKind does not mutate the source');
assert(spawnKind(bz) === 'burst', 'switched to the burst kind');
assert(count(bz, 'spawnBurst') === 1, 'exactly one spawnBurst behavior');
assert(count(bz, 'spawnShape') === 0, 'burst removes the spawnShape behavior');
assert(
	count(bz, 'rotation') === 0 && count(bz, 'rotationStatic') === 0,
	'burst strips the rotation behavior (burst owns direction)',
);
assert(emissionArc(bz) === undefined, 'no rotation behavior ⇒ Emission section hides during burst');
assert(!!burst(bz), 'burst params readable after switch');
assert(feeds(bz), 'burst config feeds upgradeConfig');
const bz2 = setBurst(bz, 'spacing', 12);
assert(burst(bz2)?.spacing === 12, 'burst spacing round-trips');
const bz3 = setBurst(bz2, 'distance', 40);
assert(
	burst(bz3)?.distance === 40 && burst(bz3)?.spacing === 12,
	'burst distance set independently',
);
// setBurst on a non-burst config forces burst (strips spawnShape).
const bzAuto = setBurst(base, 'start', 90);
assert(
	spawnKind(bzAuto) === 'burst' && burst(bzAuto)?.start === 90 && count(bzAuto, 'spawnShape') === 0,
	'setBurst on a shape config forces the burst kind',
);
// Switching back to a shape drops burst AND restores a rotation behavior (so movement has direction).
const backToCircle = setSpawnKind(bz3, 'circle');
assert(count(backToCircle, 'spawnBurst') === 0, 'shape kind removes the burst behavior');
assert(spawnKind(backToCircle) === 'circle', 'back to the circle spawn kind');
assert(
	count(backToCircle, 'rotation') + count(backToCircle, 'rotationStatic') === 1,
	'switching back to a shape restores a rotation behavior',
);
assert(feeds(backToCircle), 'shape-after-burst config feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 3. Movement model — moveSpeed XOR moveAcceleration.
// ---------------------------------------------------------------------------
console.log('fx params — movement model (speed ⇄ gravity)');
assert(movementModel(base) === 'speed', 'default is the eased-speed model');
const grav = setMovementModel(base, 'gravity');
assert(JSON.stringify(base) === baseSnap, 'setMovementModel does not mutate the source');
assert(movementModel(grav) === 'gravity', 'switched to gravity');
assert(
	count(grav, 'moveAcceleration') === 1 && count(grav, 'moveSpeed') === 0,
	'gravity removes moveSpeed, adds moveAcceleration',
);
assert(!!gravity(grav), 'gravity params readable after switch');
assert(feeds(grav), 'gravity config feeds upgradeConfig');
// Carry the start speed across: default moveSpeed starts at 300 ⇒ gravity minStart 300.
assert(gravity(grav)?.minStart === 300, 'start speed carried into the gravity model');
const backToSpeed = setMovementModel(grav, 'speed');
assert(
	count(backToSpeed, 'moveSpeed') === 1 && count(backToSpeed, 'moveAcceleration') === 0,
	'speed removes moveAcceleration, adds moveSpeed',
);
assert(
	setMovementModel(grav, 'gravity') === grav,
	'setMovementModel is a no-op when already in the model',
);

console.log('fx params — gravity fields');
const g1 = setGravity(base, 'accelY', 1500);
assert(
	gravity(g1)?.accelY === 1500 && movementModel(g1) === 'gravity',
	'setGravity on a speed config forces gravity + sets accelY',
);
const g2 = setGravity(g1, 'accelX', -200);
assert(
	gravity(g2)?.accelX === -200 && gravity(g2)?.accelY === 1500,
	'accelX set independently of accelY',
);
const g3 = setGravity(g2, 'rotate', true);
assert(gravity(g3)?.rotate === true, 'rotate flag set');
assert(gravity(setGravity(g3, 'maxStart', 800))?.maxStart === 800, 'maxStart set');
assert(feeds(g3), 'edited gravity config feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 4. Colour tint.
// ---------------------------------------------------------------------------
console.log('fx params — colour tint');
assert(particleColor(base) === undefined, 'default has no colour behavior');
const col = setColorEnabled(base, true);
assert(JSON.stringify(base) === baseSnap, 'setColorEnabled does not mutate the source');
assert(!!particleColor(col), 'enabling colour adds a `color` behavior');
assert(count(col, 'color') === 1, 'exactly one color behavior');
const col2 = setParticleColor(col, 'start', '#123456');
assert(particleColor(col2)?.start === '#123456', 'start tint round-trips');
const col3 = setParticleColor(col2, 'end', '#abcdef');
assert(particleColor(col3)?.end === '#abcdef', 'end tint round-trips');
// Setting colour on a config without one auto-adds it (no double-up).
const colAuto = setParticleColor(base, 'start', '#ff0000');
assert(
	count(colAuto, 'color') === 1 && particleColor(colAuto)?.start === '#ff0000',
	'setParticleColor adds the behavior if absent',
);
assert(
	particleColor(setColorEnabled(col3, false)) === undefined,
	'disabling colour removes the behavior',
);
assert(feeds(col3), 'coloured config feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 5. Blend mode.
// ---------------------------------------------------------------------------
console.log('fx params — blend mode');
assert(blendMode(base) === 'normal', 'default blend is normal (no behavior)');
const add = setBlendMode(base, 'add');
assert(JSON.stringify(base) === baseSnap, 'setBlendMode does not mutate the source');
assert(
	blendMode(add) === 'add' && count(add, 'blendMode') === 1,
	'add upserts a blendMode behavior',
);
const screen = setBlendMode(add, 'screen');
assert(
	blendMode(screen) === 'screen' && count(screen, 'blendMode') === 1,
	'switching blend replaces (never stacks)',
);
assert(
	count(setBlendMode(screen, 'normal'), 'blendMode') === 0,
	'normal removes the blendMode behavior',
);
assert(feeds(add), 'additive config feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 6. Presets — each builds a self-contained, library-valid config.
// ---------------------------------------------------------------------------
console.log('fx params — preset library');
assert(FX_PRESETS.length >= 8, 'preset library is populated');
for (const p of FX_PRESETS) {
	const cfg = p.build();
	const okFeeds = feeds(cfg);
	// No preset may carry two of a mutually-exclusive behavior pair.
	const rotOk = count(cfg, 'rotation') + count(cfg, 'rotationStatic') <= 1;
	const moveOk = count(cfg, 'moveAcceleration') === 0 || count(cfg, 'moveSpeed') === 0;
	const spawnOk = count(cfg, 'spawnShape') === 0 || count(cfg, 'spawnBurst') === 0;
	const oneAlpha = count(cfg, 'alpha') <= 1;
	assert(
		okFeeds && rotOk && moveOk && spawnOk && oneAlpha,
		`preset "${p.key}" is a valid, conflict-free config`,
	);
}
// The explosion preset demonstrates the burst behavior end-to-end.
assert(
	spawnKind(FX_PRESETS.find((p) => p.key === 'explosion')!.build()) === 'burst',
	'explosion preset uses a burst spawn',
);
// applyPreset swaps config, preserves art/placement/trigger.
const layer = { ...newLayer('l1'), art: { assetKey: 'sparks', frames: ['spark'] } };
const fountainLayer = applyPreset(layer, 'fountain');
assert(fountainLayer.art.assetKey === 'sparks', 'applyPreset preserves the layer art');
assert(movementModel(fountainLayer.config) === 'gravity', 'fountain preset uses the gravity model');
assert(
	emissionArc(fountainLayer.config)?.center === 90,
	'fountain preset emits upward (centre 90)',
);
assert(applyPreset(layer, 'nope') === layer, 'unknown preset key is a no-op');

console.log('');
if (failures > 0) {
	console.error(`FX PARAMS: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FX PARAMS: PASSED');
