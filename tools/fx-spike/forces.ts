/**
 * Invisible FX — the FORCES gate: steps the `fxForces` math deterministically and drives it through
 * the real library `Emitter`, so a force that silently stops pushing fails here rather than in a
 * shipped game.
 *
 *   pnpm --filter fx-spike run forces      (root: pnpm check:fx-forces)
 *
 * Proves, offline:
 *  1. `readFxForces` is the one clamp — garbage dropped, ranges pinned, angles wrapped.
 *  2. Absent forces = no change: an effect without `fxForces` round-trips byte-identical, and
 *     removing the last force removes the behavior.
 *  3. Gravity accelerates along its angle (½·g·t²), frame-rate independently.
 *  4. Vortex: radial > 0 moves particles OUT, < 0 IN; swirl turns CW / CCW as labelled; the radius
 *     bounds its reach.
 *  5. Attractor pulls / repels and absorbs; drag decays speed exactly; wind gusts stay in range;
 *     turbulence is bounded and divergence-free; a switched-off force does nothing.
 *  6. The real `Emitter` runs the behavior in both movement couplings (own velocity / folded into
 *     `moveAcceleration`'s), recycles absorbed particles, and the doc survives the ship chain.
 */

import { Container } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_BEHAVIOR_TYPES,
	FX_FORCES_BEHAVIOR_TYPE,
	FxForcesBehavior,
	behaviorsOf,
	fxForceAcceleration,
	normalizeEffectDoc,
	readFxForces,
	registerFxBehaviors,
	stepFxForces,
	type EffectDoc,
	type FxForce,
	type FxForceSample,
	type FxVec,
} from 'engine-fx';
import {
	addForce,
	defaultEmitterConfig,
	FX_PRESETS,
	forcesOf,
	newLayer,
	removeForce,
	setForceField,
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
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

/** Integrate one point particle from `start` at rest for `seconds` at a fixed `dt`. */
function simulate(
	forces: FxForce[],
	start: FxVec,
	seconds: number,
	dt: number,
	vel: FxVec = { x: 0, y: 0 },
): { pos: FxVec; vel: FxVec; absorbed: boolean } {
	const pos = { ...start };
	const v = { ...vel };
	const scratch = { x: 0, y: 0 };
	const drag = forces
		.filter((f) => f.enabled && f.kind === 'drag')
		.reduce((k, f) => k + (f.kind === 'drag' ? f.amount : 0), 0);
	let absorbed = false;
	const steps = Math.round(seconds / dt);
	for (let i = 0; i < steps; i++) {
		const s: FxForceSample = { x: pos.x, y: pos.y, originX: 0, originY: 0, age: i * dt, seed: 0 };
		const ox = v.x;
		const oy = v.y;
		if (stepFxForces(forces, s, v, dt, drag, scratch)) {
			absorbed = true;
			break;
		}
		pos.x += ((ox + v.x) / 2) * dt;
		pos.y += ((oy + v.y) / 2) * dt;
	}
	return { pos, vel: v, absorbed };
}

const forces = (...raw: unknown[]): FxForce[] => readFxForces({ forces: raw });

// ---------------------------------------------------------------------------
console.log('fx forces — the one clamp');
const clamped = forces(
	{ kind: 'gravity', strength: 1e9, angle: -90 },
	{ kind: 'nope' },
	null,
	'gravity',
	{ kind: 'vortex', swirl: Number.NaN, direction: 'sideways', falloff: 99, radius: -5 },
	{ kind: 'drag', amount: '3', enabled: false },
);
assert(clamped.length === 3, 'unknown kinds and non-objects are dropped (3 of 6 survive)');
assert(clamped[0].kind === 'gravity' && clamped[0].strength === 10000, 'strength pinned to max');
assert(clamped[0].kind === 'gravity' && clamped[0].angle === 270, '−90° wraps to 270°');
assert(clamped[0].enabled === true, 'absent `enabled` reads as on');
const vx = clamped[1];
assert(
	vx.kind === 'vortex' &&
		vx.swirl === 1500 &&
		vx.direction === 'cw' &&
		vx.falloff === 4 &&
		vx.radius === 0,
	'NaN → default, bad enum → cw, falloff pinned to 4, negative radius → 0',
);
assert(
	clamped[2].kind === 'drag' && clamped[2].amount === 1.5 && clamped[2].enabled === false,
	'a non-number is the default; `enabled: false` is kept',
);
assert(readFxForces(undefined).length === 0 && readFxForces({}).length === 0, 'no config ⇒ []');
assert(
	JSON.stringify(readFxForces({ forces: clamped })) === JSON.stringify(clamped),
	'the clamp is idempotent',
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx forces — absent forces change nothing');
const base = defaultEmitterConfig();
const baseSnap = JSON.stringify(base);
assert(forcesOf(base).length === 0, 'a stock layer has no forces');
assert(
	!behaviorsOf(base).some((b) => b.type === FX_FORCES_BEHAVIOR_TYPE),
	'…and no fxForces behavior',
);
const withGravity = addForce(base, 'gravity');
assert(JSON.stringify(base) === baseSnap, 'addForce does not mutate its input');
assert(forcesOf(withGravity).length === 1, 'addForce appends one entry');
const removed = removeForce(withGravity, 0);
assert(JSON.stringify(removed) === baseSnap, 'removing the last force restores the stock config');
const plainDoc: EffectDoc = {
	version: 1,
	id: 'plain',
	name: 'plain',
	layers: [{ ...newLayer('l1'), config: base }],
};
assert(
	JSON.stringify(normalizeEffectDoc(JSON.parse(JSON.stringify(plainDoc)))) ===
		JSON.stringify(plainDoc),
	'an effect without forces round-trips byte-identical',
);
const off = setForceField(withGravity, 0, 'enabled', false);
const offRun = simulate(forcesOf(off), { x: 0, y: 0 }, 1, 1 / 60);
assert(offRun.pos.x === 0 && offRun.pos.y === 0, 'a switched-off force moves nothing');

// ---------------------------------------------------------------------------
console.log('');
console.log('fx forces — gravity');
const g = forces({ kind: 'gravity', strength: 600, angle: 90 });
const fall = simulate(g, { x: 0, y: 0 }, 1, 1 / 60);
assert(near(fall.pos.y, 300, 0.5) && near(fall.pos.x, 0, 1e-9), `90° falls ½gt² = 300px down`);
assert(near(fall.vel.y, 600, 1e-6), 'velocity grows by g·t');
const right = simulate(
	forces({ kind: 'gravity', strength: 600, angle: 0 }),
	{ x: 0, y: 0 },
	1,
	1 / 60,
);
assert(near(right.pos.x, 300, 0.5) && near(right.pos.y, 0, 1e-6), '0° pulls right');
const up = simulate(
	forces({ kind: 'gravity', strength: 600, angle: 270 }),
	{ x: 0, y: 0 },
	1,
	1 / 60,
);
assert(near(up.pos.y, -300, 0.5), '270° pulls up');
const coarse = simulate(g, { x: 0, y: 0 }, 1, 1 / 30);
const fine = simulate(g, { x: 0, y: 0 }, 1, 1 / 240);
assert(near(coarse.pos.y, fine.pos.y, 0.5), '30 fps and 240 fps land within 0.5px');

// ---------------------------------------------------------------------------
console.log('');
console.log('fx forces — vortex');
const dist = (p: FxVec): number => Math.hypot(p.x, p.y);
const out = simulate(
	forces({ kind: 'vortex', swirl: 0, radial: 800 }),
	{ x: 100, y: 0 },
	0.5,
	1 / 60,
);
assert(dist(out.pos) > 150, `radial > 0 is centrifugal (100px → ${dist(out.pos).toFixed(0)}px)`);
const inward = simulate(
	forces({ kind: 'vortex', swirl: 0, radial: -200 }),
	{ x: 100, y: 0 },
	0.5,
	1 / 60,
);
assert(
	dist(inward.pos) < 90,
	`radial < 0 is centripetal (100px → ${dist(inward.pos).toFixed(0)}px)`,
);
const cw = simulate(
	forces({ kind: 'vortex', swirl: 800, radial: 0, direction: 'cw' }),
	{ x: 100, y: 0 },
	0.1,
	1 / 60,
);
assert(cw.pos.y > 0, 'CW from the right of the centre moves DOWN on screen (clockwise)');
const ccw = simulate(
	forces({ kind: 'vortex', swirl: 800, radial: 0, direction: 'ccw' }),
	{ x: 100, y: 0 },
	0.1,
	1 / 60,
);
assert(ccw.pos.y < 0, 'CCW moves UP');
const acc = { x: 0, y: 0 };
fxForceAcceleration(
	forces({ kind: 'vortex', swirl: 1000, radial: 500, radius: 50 }),
	{ x: 100, y: 0, originX: 0, originY: 0, age: 0, seed: 0 },
	acc,
);
assert(acc.x === 0 && acc.y === 0, 'outside its radius a vortex does nothing');
fxForceAcceleration(
	forces({ kind: 'vortex', swirl: 1000, radial: 0, radius: 200, falloff: 1 }),
	{ x: 100, y: 0, originX: 0, originY: 0, age: 0, seed: 0 },
	acc,
);
assert(near(Math.hypot(acc.x, acc.y), 500, 1e-6), 'linear falloff halves the swirl at half radius');
fxForceAcceleration(
	forces({ kind: 'vortex', swirl: 1000, radial: 500, x: 40, y: 0 }),
	{ x: 140, y: 0, originX: 10, originY: 0, age: 0, seed: 0 },
	acc,
);
assert(near(acc.x, 500, 1e-6), 'the centre is an offset from the emitter origin (origin + x)');
fxForceAcceleration(
	forces({ kind: 'vortex', swirl: 1000, radial: 500 }),
	{ x: 0, y: 0, originX: 0, originY: 0, age: 0, seed: 0 },
	acc,
);
assert(
	acc.x === 0 && acc.y === 0 && Number.isFinite(acc.x),
	'at the exact centre: no NaN, no push',
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx forces — attractor, drag, wind, turbulence');
const pull = simulate(forces({ kind: 'attractor', strength: 400 }), { x: 100, y: 0 }, 0.3, 1 / 60);
assert(pull.pos.x < 100 && near(pull.pos.y, 0, 1e-9), 'positive strength pulls toward the point');
const push = simulate(forces({ kind: 'attractor', strength: -400 }), { x: 100, y: 0 }, 0.3, 1 / 60);
assert(push.pos.x > 100, 'negative strength pushes away');
const sink = simulate(
	forces({ kind: 'attractor', strength: 2000, absorb: 10 }),
	{ x: 100, y: 0 },
	2,
	1 / 60,
);
assert(sink.absorbed, 'a particle reaching the absorb radius is reported for removal');

const drag = forces({ kind: 'drag', amount: 1 });
const slowed = simulate(drag, { x: 0, y: 0 }, 1, 1 / 60, { x: 500, y: 0 });
assert(near(slowed.vel.x, 500 * Math.exp(-1), 1e-6), 'drag decays speed to v·e^(−k·t) exactly');
const slowedCoarse = simulate(drag, { x: 0, y: 0 }, 1, 1 / 20, { x: 500, y: 0 });
assert(near(slowedCoarse.vel.x, slowed.vel.x, 1e-6), '…at any frame rate');
const terminal = simulate([...g, ...drag], { x: 0, y: 0 }, 10, 1 / 60);
assert(near(terminal.vel.y, 600, 1), 'gravity + drag settles at the terminal speed g/k');

const steady = forces({ kind: 'wind', strength: 300, angle: 0, gust: 0 });
const gusty = forces({ kind: 'wind', strength: 300, angle: 0, gust: 1, gustFrequency: 2 });
let minA = Infinity;
let maxA = -Infinity;
let steadyOk = true;
for (let t = 0; t < 2; t += 0.01) {
	const sample = { x: 0, y: 0, originX: 0, originY: 0, age: t, seed: 0.3 };
	fxForceAcceleration(steady, sample, acc);
	if (!near(acc.x, 300, 1e-9)) steadyOk = false;
	fxForceAcceleration(gusty, sample, acc);
	minA = Math.min(minA, acc.x);
	maxA = Math.max(maxA, acc.x);
}
assert(steadyOk, 'gust 0 is a steady push');
assert(minA >= -1e-9 && maxA <= 600 + 1e-9 && maxA - minA > 500, 'gust 1 swings 0..2× strength');

const turb = forces({ kind: 'turbulence', strength: 400, scale: 120, speed: 0.5 });
let maxMag = 0;
let maxDiv = 0;
let anyPush = false;
const h = 0.01;
const ax = (x: number, y: number): FxVec => {
	const o = { x: 0, y: 0 };
	fxForceAcceleration(turb, { x, y, originX: 0, originY: 0, age: 0.7, seed: 0.1 }, o);
	return o;
};
for (let x = -300; x <= 300; x += 23) {
	for (let y = -300; y <= 300; y += 29) {
		const a = ax(x, y);
		maxMag = Math.max(maxMag, Math.hypot(a.x, a.y));
		if (Math.hypot(a.x, a.y) > 1) anyPush = true;
		const div = (ax(x + h, y).x - ax(x - h, y).x + ax(x, y + h).y - ax(x, y - h).y) / (2 * h);
		maxDiv = Math.max(maxDiv, Math.abs(div));
	}
}
assert(anyPush && maxMag <= 400 * 1.001, `turbulence pushes and never exceeds its strength`);
assert(maxDiv < 1e-3, 'turbulence is divergence-free (particles swirl, never bunch into sinks)');
const a1 = ax(37, -12);
const a2 = ax(37, -12);
assert(a1.x === a2.x && a1.y === a2.y, 'turbulence is deterministic for a sample');

// ---------------------------------------------------------------------------
console.log('');
console.log('fx forces — the real Emitter');
registerFxBehaviors(Emitter);
const known = (Emitter as unknown as { knownBehaviors: Record<string, unknown> }).knownBehaviors;
assert(!!known[FX_FORCES_BEHAVIOR_TYPE], 'registerFxBehaviors registers fxForces');
assert(
	FX_BEHAVIOR_TYPES.includes(FX_FORCES_BEHAVIOR_TYPE),
	'fxForces is listed in FX_BEHAVIOR_TYPES',
);

interface LiveParticle {
	x: number;
	y: number;
	next: LiveParticle | null;
}
const live = (em: Emitter): LiveParticle[] => {
	const outList: LiveParticle[] = [];
	let p = (em as unknown as { _activeParticlesFirst: LiveParticle | null })._activeParticlesFirst;
	for (; p; p = p.next) outList.push(p);
	return outList;
};
const oneShot = (behaviors: EmitterConfigV3['behaviors']): EmitterConfigV3 =>
	({
		lifetime: { min: 5, max: 5 },
		frequency: 10,
		emitterLifetime: -1,
		maxParticles: 1,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors,
	}) as EmitterConfigV3;
const run = (config: EmitterConfigV3, seconds: number, owner = { x: 0, y: 0 }): Emitter => {
	const em = new Emitter(new Container(), config);
	em.updateOwnerPos(owner.x, owner.y);
	em.emit = true;
	em.update(0);
	const steps = Math.round(seconds * 60);
	for (let i = 0; i < steps; i++) em.update(1 / 60);
	return em;
};
const gravityEntry = { type: FX_FORCES_BEHAVIOR_TYPE, config: { forces: g } };

const noMove = run(oneShot([gravityEntry]), 1);
const nm = live(noMove)[0];
assert(
	!!nm && near(nm.y, 300, 3),
	`no movement behavior: gravity alone drops ~300px (${nm?.y.toFixed(1)})`,
);
assert(
	noMove.getBehavior(FX_FORCES_BEHAVIOR_TYPE) instanceof FxForcesBehavior,
	'the emitter built the production behavior from the config',
);

const withSpeed = run(
	oneShot([
		{ type: 'rotationStatic', config: { min: 0, max: 0 } },
		{
			type: 'fxSpeed',
			config: {
				speed: {
					list: [
						{ time: 0, value: 200 },
						{ time: 1, value: 200 },
					],
				},
			},
		},
		gravityEntry,
	]),
	1,
);
const ws = live(withSpeed)[0];
assert(
	!!ws && near(ws.x, 200, 4) && near(ws.y, 300, 3),
	`eased speed + gravity superpose: (${ws?.x.toFixed(0)}, ${ws?.y.toFixed(0)}) ≈ (200, 300)`,
);

const accelSlot = {
	type: 'moveAcceleration',
	config: { accel: { x: 0, y: 0 }, minStart: 0, maxStart: 0, rotate: false, maxSpeed: 0 },
};
const folded = run(oneShot([gravityEntry, accelSlot]), 1);
const fo = live(folded)[0];
assert(
	!!fo && near(fo.y, 300, 12),
	`acceleration mode: gravity folds into its velocity (${fo?.y.toFixed(1)})`,
);
const foldedVel = (fo as unknown as { config: { velocity: FxVec; fxForceVel: FxVec } }).config;
assert(
	near(foldedVel.velocity.y, 600, 1) && foldedVel.fxForceVel.y === 0,
	"…the movement's velocity carries it (the forces' own velocity stays at rest)",
);
const capped = run(
	oneShot([gravityEntry, { ...accelSlot, config: { ...accelSlot.config, maxSpeed: 100 } }]),
	1,
);
const cp = live(capped)[0] as unknown as { config: { velocity: FxVec } };
assert(
	near(Math.hypot(cp.config.velocity.x, cp.config.velocity.y), 100, 10.5),
	"the movement's max speed caps forced motion too",
);

const vortexRun = run(
	oneShot([
		{
			type: FX_FORCES_BEHAVIOR_TYPE,
			config: { forces: forces({ kind: 'vortex', swirl: 0, radial: 600, x: -50 }) },
		},
	]),
	0.5,
	{ x: 300, y: 200 },
);
const vp = live(vortexRun)[0];
assert(
	!!vp && vp.x > 300 + 40 && near(vp.y, 200, 1e-6),
	`a vortex centred 50px left of a moved emitter flings its particle right (x=${vp?.x.toFixed(0)})`,
);

const sinkRun = run(
	{
		...oneShot([
			{
				type: 'spawnShape',
				config: { type: 'torus', data: { x: 0, y: 0, radius: 120, innerRadius: 100 } },
			},
			{
				type: FX_FORCES_BEHAVIOR_TYPE,
				config: { forces: forces({ kind: 'attractor', strength: 3000, absorb: 15 }) },
			},
		]),
		maxParticles: 20,
		frequency: 0.05,
	},
	1,
);
const kept = live(sinkRun).filter((p) => Math.hypot(p.x, p.y) <= 15);
assert(kept.length === 0, 'the emitter recycles absorbed particles (none live inside the sink)');
assert(
	sinkRun.particleCount < 20,
	`…so the sink thins the stream (${sinkRun.particleCount} of 20 alive at a 5s lifetime)`,
);

// Angle convention: the library's Direction is the same frame the forces use (90° = screen DOWN).
const dirRun = run(
	oneShot([
		{ type: 'rotationStatic', config: { min: 90, max: 90 } },
		{
			type: 'moveSpeed',
			config: {
				speed: {
					list: [
						{ time: 0, value: 100 },
						{ time: 1, value: 99 },
					],
				},
			},
		},
	]),
	1,
);
const dp = live(dirRun)[0];
assert(
	!!dp && dp.y > 90,
	'Direction 90° launches DOWN on screen — the convention the forces share',
);

const launchSin = (key: string): number => {
	const preset = FX_PRESETS.find((p) => p.key === key);
	const rot = preset
		? behaviorsOf(preset.build()).find((b) => b.type === 'rotationStatic')
		: undefined;
	const c = rot ? (Number(rot.config.min) + Number(rot.config.max)) / 2 : Number.NaN;
	return Math.sin((c * Math.PI) / 180);
};
assert(
	['fountain', 'fire', 'smoke', 'sparks'].every((k) => launchSin(k) < -0.9),
	'the Fountain / Fire / Smoke / Sparks presets launch UP (270°) in that convention',
);
assert(launchSin('rain') > 0.9, 'the Rain preset launches DOWN (90°)');

// ---------------------------------------------------------------------------
console.log('');
console.log('fx forces — the ship chain');
let cfg = addForce(base, 'vortex');
cfg = addForce(cfg, 'drag');
cfg = setForceField(cfg, 0, 'radial', -99999);
cfg = setForceField(cfg, 0, 'direction', 'ccw');
assert(forcesOf(cfg)[0].kind === 'vortex', 'forces keep authoring order');
const v0 = forcesOf(cfg)[0];
assert(
	v0.kind === 'vortex' && v0.radial === -20000 && v0.direction === 'ccw',
	'setForceField clamps through readFxForce',
);
assert(setForceField(cfg, 0, 'kind', 'gravity') === cfg, "a force's kind is not a field");
assert(setForceField(cfg, 9, 'radial', 1) === cfg, 'an out-of-range index is a no-op');
const forcedDoc: EffectDoc = {
	...plainDoc,
	id: 'forced',
	layers: [{ ...newLayer('l1'), config: cfg }],
};
// author → /api/fx/save (normalize) → deploy/effects (normalize + JSON) → bake embeds → game registers.
const saved = normalizeEffectDoc(JSON.parse(JSON.stringify(forcedDoc)));
const deployed = normalizeEffectDoc(JSON.parse(JSON.stringify(saved, null, '\t')), 'forced');
const baked = JSON.parse(JSON.stringify({ effects: [deployed] })) as { effects: EffectDoc[] };
assert(
	JSON.stringify(baked.effects[0].layers[0].config) === JSON.stringify(cfg),
	'the fxForces behavior travels save → export → bake VERBATIM (nothing strips it)',
);
const shipped = new Emitter(new Container(), baked.effects[0].layers[0].config);
const sb = shipped.getBehavior(FX_FORCES_BEHAVIOR_TYPE) as FxForcesBehavior | null;
assert(
	!!sb && sb.forces.length === 2 && sb.forces[1].kind === 'drag',
	'…and the shipped config builds the behavior with both forces',
);

console.log('');
if (failures) {
	console.error(`fx forces: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx forces: all green');
