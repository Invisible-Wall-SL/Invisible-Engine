/**
 * Invisible FX — the PATH gate: the `fxPath` curve math and the behavior driven through the real
 * library `Emitter` (`docs/design/fx-paths.md`).
 *
 *   pnpm --filter fx-spike run path      (root: pnpm check:fx-path)
 *
 * Proves, offline:
 *  1. `readFxPath` is the one clamp — garbage dropped, enums defaulted, fewer than two points reset.
 *  2. The curves: a polyline's length is its segments', a spline passes through its points, a Bézier
 *     with no handles is a polyline, and distances along the table are true px.
 *  3. Spawn along: even waves are evenly spaced in distance, random stays on the curve, a sweep
 *     walks the curve at the travel rate; the Direction becomes relative to the tangent.
 *  4. Travel: the origin moves along the curve, keeps the authored `pos`, survives an emitter
 *     rotation and a parameter rebuild, restarts with emission and runs faster under Turbo.
 *  5. Follow: by speed (true px/s, orient, die at the end), by life, and with forces stacking on it.
 *  6. No path = no change, and the doc survives the ship chain verbatim.
 */

import { Container } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_BEHAVIOR_TYPES,
	FX_FORCES_BEHAVIOR_TYPE,
	FX_PATH_BEHAVIOR_TYPE,
	FxPathBehavior,
	FxPathTable,
	fxPathTravelProgress,
	normalizeEffectDoc,
	readFxPath,
	registerFxBehaviors,
	type EffectDoc,
	type FxPathConfig,
	type FxPathEmitter,
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
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
console.log('fx path — the clamp');
const garbage = readFxPath({
	curve: { kind: 'nurbs', points: [{ x: 'a' }], tension: 9 },
	emit: 'everywhere',
	travel: { duration: -3, repeat: 'sometimes' },
	follow: { enabled: 'yes', speedMin: 4 },
});
assert(garbage.curve.kind === 'catmullRom', 'an unknown curve kind reads as the spline');
assert(garbage.curve.points.length === 3, 'fewer than two points resets to the default curve');
assert(garbage.curve.tension === 1, 'tension is pinned into 0..1');
assert(garbage.emit === 'shape', 'an unknown emit reads as "shape" (the path places nothing)');
assert(garbage.travel.duration === 0.01 && garbage.travel.repeat === 'loop', 'travel pinned');
assert(!garbage.follow.enabled && garbage.follow.speedMin === 1, 'follow pinned (not "yes")');
assert(
	readFxPath(undefined).curve.points.length === 3 && readFxPath(null).emit === 'shape',
	'no config reads as the default, inert path',
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx path — the curves');
const line = (points: { x: number; y: number }[], extra: Partial<FxPathConfig['curve']> = {}) =>
	readFxPath({ curve: { kind: 'polyline', points, ...extra } }).curve;
const L1 = new FxPathTable(
	line([
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 50 },
	]),
);
assert(near(L1.length, 150, 1e-9), `polyline length is its segments' (${L1.length})`);
const mid = L1.pointAt(125, { x: 0, y: 0 });
assert(near(mid.x, 100, 1e-9) && near(mid.y, 25, 1e-9), 'pointAt walks true distance');
assert(near(L1.angleAt(125), Math.PI / 2, 1e-9), 'the tangent on a downward segment is +90°');
assert(
	JSON.stringify(L1.segmentStarts) === '[0,100]' &&
		L1.segmentAt(99) === 0 &&
		L1.segmentAt(101) === 1,
	'segment starts are the distances of the anchors (the stage inserts a point by them)',
);
const pick = L1.nearest(104, 30);
assert(
	near(pick.s, 130, 1e-9) && near(pick.distance, 4, 1e-9),
	'nearest finds the closest point on the curve',
);
const closed = new FxPathTable(
	line(
		[
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 100, y: 100 },
		],
		{ closed: true },
	),
);
assert(
	near(closed.length, 200 + Math.SQRT2 * 100, 1e-6),
	'closed joins the last point to the first',
);

const sparse = [
	{ x: 0, y: 0 },
	{ x: 80, y: -60 },
	{ x: 200, y: 40 },
	{ x: 300, y: 0 },
];
const spline = new FxPathTable(readFxPath({ curve: { kind: 'catmullRom', points: sparse } }).curve);
const hits = sparse.every((p) => {
	let best = Infinity;
	for (let s = 0; s <= spline.length; s += 0.25) {
		const q = spline.pointAt(s, { x: 0, y: 0 });
		best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
	}
	return best < 0.5;
});
assert(hits, 'the Catmull-Rom spline passes through every point');
assert(spline.length > new FxPathTable(line(sparse)).length, '…and is longer than its polyline');
const flatBezier = new FxPathTable(readFxPath({ curve: { kind: 'bezier', points: sparse } }).curve);
assert(
	near(flatBezier.length, new FxPathTable(line(sparse)).length, 1e-9),
	'a Bézier with no handles is the polyline',
);
const arc = new FxPathTable(
	readFxPath({
		curve: {
			kind: 'bezier',
			points: [
				{ x: 0, y: 0, out: { x: 0, y: -55.23 } },
				{ x: 100, y: -100, in: { x: -55.23, y: 0 } },
			],
		},
	}).curve,
);
assert(
	near(arc.length, (Math.PI / 2) * 100, 0.5),
	`a quarter-circle Bézier measures ≈ πr/2 (${arc.length.toFixed(2)})`,
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx path — the real Emitter');
registerFxBehaviors(Emitter);
const known = (Emitter as unknown as { knownBehaviors: Record<string, unknown> }).knownBehaviors;
assert(!!known[FX_PATH_BEHAVIOR_TYPE], 'registerFxBehaviors registers fxPath');
assert(FX_BEHAVIOR_TYPES.includes(FX_PATH_BEHAVIOR_TYPE), 'fxPath is listed in FX_BEHAVIOR_TYPES');
registerFxBehaviors(Emitter);
const updateSrc = String((Emitter.prototype as unknown as { update: unknown }).update);
assert(
	!/original\.call\(this, delta\);[\s\S]*original\.call/.test(updateSrc),
	'registering twice wraps update once',
);

interface Live {
	x: number;
	y: number;
	rotation: number;
	age: number;
	next: Live | null;
}
const live = (em: Emitter): Live[] => {
	const out: Live[] = [];
	let p = (em as unknown as { _activeParticlesFirst: Live | null })._activeParticlesFirst;
	for (; p; p = p.next) out.push(p);
	return out;
};
const cfg = (
	behaviors: EmitterConfigV3['behaviors'],
	o: Partial<EmitterConfigV3> = {},
): EmitterConfigV3 =>
	({
		lifetime: { min: 50, max: 50 },
		frequency: 1000,
		emitterLifetime: -1,
		maxParticles: 1000,
		particlesPerWave: 1,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors,
		...o,
	}) as EmitterConfigV3;
const straight = [
	{ x: -100, y: 0 },
	{ x: 100, y: 0 },
];
const pathEntry = (c: FxPathConfig) => ({ type: FX_PATH_BEHAVIOR_TYPE, config: c });
const make = (config: EmitterConfigV3): Emitter => {
	const em = new Emitter(new Container(), config);
	em.emit = true;
	return em;
};

// Even: one wave of 5 on a straight line from −100 to 100.
const evenEm = make(
	cfg(
		[
			pathEntry({
				curve: { kind: 'polyline', points: straight },
				emit: 'along',
				along: { distribution: 'even' },
			}),
		],
		{ particlesPerWave: 5 },
	),
);
evenEm.update(0.001);
const evenXs = live(evenEm)
	.map((p) => Math.round(p.x))
	.sort((a, b) => a - b);
assert(
	JSON.stringify(evenXs) === JSON.stringify([-100, -50, 0, 50, 100]),
	`an even wave of 5 lands at −100, −50, 0, 50, 100 (${evenXs.join(', ')})`,
);
assert(evenEm.getBehavior(FX_PATH_BEHAVIOR_TYPE) instanceof FxPathBehavior, 'built from config');

// Even on a curve: spaced evenly in DISTANCE, not curve parameter.
const curvy = [
	{ x: 0, y: 0, out: { x: 200, y: 0 } },
	{ x: 100, y: 100, in: { x: 0, y: -10 } },
];
const curvyTable = new FxPathTable(readFxPath({ curve: { kind: 'bezier', points: curvy } }).curve);
const curvyEm = make(
	cfg(
		[
			pathEntry({
				curve: { kind: 'bezier', points: curvy },
				emit: 'along',
				along: { distribution: 'even' },
			}),
		],
		{ particlesPerWave: 9 },
	),
);
curvyEm.update(0.001);
const cps = live(curvyEm);
const expectEven = cps.every((p, i) => {
	const q = curvyTable.pointAt((i / 8) * curvyTable.length, { x: 0, y: 0 });
	return near(p.x, q.x, 1e-6) && near(p.y, q.y, 1e-6);
});
assert(cps.length === 9 && expectEven, 'an even wave on a curve sits at equal arc lengths');

// Even stream (single-particle waves): spread over the curve, no clumping.
const streamEm = make(
	cfg(
		[
			pathEntry({
				curve: { kind: 'polyline', points: straight },
				emit: 'along',
				along: { distribution: 'even' },
			}),
		],
		{ frequency: 0.01 },
	),
);
for (let i = 0; i < 20; i++) streamEm.update(0.01);
const streamXs = live(streamEm)
	.map((p) => p.x)
	.sort((a, b) => a - b);
let maxGap = 0;
for (let i = 1; i < streamXs.length; i++) maxGap = Math.max(maxGap, streamXs[i] - streamXs[i - 1]);
assert(
	streamXs.length >= 19 && maxGap < 25 && streamXs[0] < -80 && streamXs.at(-1)! > 80,
	`an even single-particle stream covers the line (${streamXs.length} particles, max gap ${maxGap.toFixed(1)}px)`,
);

// Random: always on the line.
const randEm = make(
	cfg([pathEntry({ curve: { kind: 'polyline', points: straight }, emit: 'along' })], {
		particlesPerWave: 50,
	}),
);
randEm.update(0.001);
assert(
	live(randEm).every((p) => p.y === 0 && p.x >= -100 && p.x <= 100),
	'random spawns stay on the curve',
);

// Jitter: off the line by at most the jitter, along the normal.
const jitEm = make(
	cfg(
		[
			pathEntry({
				curve: { kind: 'polyline', points: straight },
				emit: 'along',
				along: { jitter: 10 },
			}),
		],
		{ particlesPerWave: 50 },
	),
);
jitEm.update(0.001);
assert(
	live(jitEm).every((p) => Math.abs(p.y) <= 10) && live(jitEm).some((p) => Math.abs(p.y) > 1),
	'jitter scatters along the normal, within its px',
);

// Direction relative to the tangent: a line pointing down, Direction 0 → particles launch down.
const downEm = make(
	cfg(
		[
			pathEntry({
				curve: {
					kind: 'polyline',
					points: [
						{ x: 0, y: 0 },
						{ x: 0, y: 100 },
					],
				},
				emit: 'along',
				along: { direction: 'tangent' },
			}),
			{ type: 'rotationStatic', config: { min: 0, max: 0 } },
			{ type: 'moveSpeedStatic', config: { min: 100, max: 100 } },
		],
		{ particlesPerWave: 3 },
	),
);
downEm.update(0.001);
const before = live(downEm).map((p) => p.y);
downEm.update(0.5);
const after = live(downEm).map((p) => p.y);
assert(
	live(downEm).every((p) => near(p.x, 0, 1e-6)) &&
		after.every((y, i) => near(y - before[i], 50, 1e-6)),
	'Direction "along the path": a launch of 0° follows the tangent (down the line)',
);

// Sweep: one particle per 0.1 s, a 1 s linear pass over 0..100.
const sweepPath = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
];
const sweepEm = make(
	cfg(
		[
			pathEntry({
				curve: { kind: 'polyline', points: sweepPath },
				emit: 'along',
				along: { distribution: 'sweep' },
				travel: { duration: 1, repeat: 'once', ease: 'linear' },
			}),
		],
		{ frequency: 0.1 },
	),
);
for (let i = 0; i < 8; i++) sweepEm.update(0.1);
const sweepXs = live(sweepEm).map((p) => p.x);
const steps = sweepXs.slice(1).map((x, i) => x - sweepXs[i]);
assert(
	sweepXs.length >= 8 && near(sweepXs[0], 0, 1e-6) && steps.every((d) => near(d, 10, 1e-6)),
	`a sweep walks the curve at the travel rate (${sweepXs.map((x) => x.toFixed(0)).join(', ')})`,
);
assert(
	near(fxPathTravelProgress({ duration: 2, repeat: 'pingpong', ease: 'linear' }, 3), 0.5, 1e-9) &&
		near(fxPathTravelProgress({ duration: 2, repeat: 'loop', ease: 'linear' }, 3), 0.5, 1e-9) &&
		fxPathTravelProgress({ duration: 2, repeat: 'once', ease: 'linear' }, 30) === 1 &&
		near(fxPathTravelProgress({ duration: 1, repeat: 'once', ease: 'in' }, 0.5), 0.25, 1e-9),
	'travel timing: ping-pong turns back, loop wraps, once holds, easing applies',
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx path — travel');
const travelCfg = (c: Partial<FxPathConfig> = {}) =>
	cfg(
		[
			pathEntry({
				curve: { kind: 'polyline', points: sweepPath },
				emit: 'travel',
				travel: { duration: 1, repeat: 'loop', ease: 'linear' },
				...c,
			}),
		],
		{ pos: { x: 5, y: 7 }, frequency: 0.25 },
	);
const travel = make(travelCfg());
for (let i = 0; i < 3; i++) travel.update(0.1);
assert(
	near(travel.spawnPos.x, 5 + 30, 1e-6) && near(travel.spawnPos.y, 7, 1e-6),
	`the origin travels the curve and keeps the authored pos (${travel.spawnPos.x.toFixed(2)}, ${travel.spawnPos.y.toFixed(2)})`,
);
const clock = (em: Emitter) => (em as unknown as FxPathEmitter).fxPathClock!;
// A parameter rebuild puts a fresh instance in the slot: the clock is on the emitter, so it holds.
const slots = travel as unknown as { initBehaviors: unknown[]; updateBehaviors: unknown[] };
const at = slots.initBehaviors.findIndex((b) => b instanceof FxPathBehavior);
const old = slots.initBehaviors[at];
const fresh = new FxPathBehavior(travelCfg().behaviors[0].config as FxPathConfig);
slots.initBehaviors[at] = fresh;
slots.updateBehaviors[slots.updateBehaviors.indexOf(old)] = fresh;
travel.update(0.1);
assert(
	near(clock(travel).t, 0.4, 1e-9),
	'a rebuilt behavior keeps the pass (the clock is on the emitter)',
);
assert(near(travel.spawnPos.x, 45, 1e-6), '…and the origin carries on from where it was');
// Particles born along the move sit on the line between the frame's positions.
assert(
	live(travel).every((p) => near(p.y, 7, 1e-6) && p.x >= 5 && p.x <= 105),
	'particles spawned during the move are born on the travelled line',
);
// The emitter turns (a bone, a flight heading): the base turns and the path turns with it.
travel.rotate(Math.PI / 2);
travel.update(0.1);
assert(
	near(travel.spawnPos.x, -7, 1e-6) && near(travel.spawnPos.y, 5 + 50, 1e-6),
	`a rotated emitter turns its pos and its path (${travel.spawnPos.x.toFixed(2)}, ${travel.spawnPos.y.toFixed(2)})`,
);
travel.rotate(0);
// Emission restarts → the pass restarts.
travel.emit = false;
travel.update(0.1);
travel.emit = true;
travel.update(0.1);
assert(near(clock(travel).t, 0.1, 1e-9), 'switching emission back on restarts the pass');
// Travel switched off by an edit: the offset is taken back.
const plain = new FxPathBehavior({ curve: { kind: 'polyline', points: sweepPath }, emit: 'shape' });
slots.initBehaviors[at] = plain;
travel.update(0.1);
assert(
	near(travel.spawnPos.x, 5, 1e-6) && near(travel.spawnPos.y, 7, 1e-6),
	'switching travel off returns the origin to the authored pos',
);
// Turbo: the particle clock multiplies dt, so the pass runs faster.
const normal = make(travelCfg());
const turbo = make(travelCfg());
for (let i = 0; i < 4; i++) {
	normal.update(0.05);
	turbo.update(0.05 * 2);
}
assert(
	near(normal.spawnPos.x, 25, 1e-6) && near(turbo.spawnPos.x, 45, 1e-6),
	`Turbo (dt × 2) runs the pass twice as fast (${normal.spawnPos.x.toFixed(0)} vs ${turbo.spawnPos.x.toFixed(0)})`,
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx path — follow');
const elbow = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 100 },
];
const followCfg = (follow: FxPathConfig['follow'], extra: EmitterConfigV3['behaviors'] = []) =>
	cfg([pathEntry({ curve: { kind: 'polyline', points: elbow }, follow }), ...extra], {
		maxParticles: 1,
		lifetime: { min: 2, max: 2 },
	});
const bySpeed = make(followCfg({ enabled: true, by: 'speed', speed: 100, orient: true }));
bySpeed.update(0);
for (let i = 0; i < 90; i++) bySpeed.update(1 / 60);
const sp = live(bySpeed)[0];
assert(
	!!sp && near(sp.x, 100, 1e-6) && near(sp.y, 50, 1e-6),
	`by speed: 1.5 s at 100 px/s turns the corner to (100, 50) (${sp?.x.toFixed(1)}, ${sp?.y.toFixed(1)})`,
);
assert(!!sp && near(sp.rotation, Math.PI / 2, 1e-9), '…oriented to the tangent (90°, down)');
const byLife = make(followCfg({ enabled: true, by: 'life' }));
byLife.update(0);
for (let i = 0; i < 60; i++) byLife.update(1 / 60);
const lp = live(byLife)[0];
assert(
	!!lp && near(lp.x, 100, 1e-6) && near(lp.y, 0, 1e-6),
	`by life: halfway through a 2 s life it is halfway along (${lp?.x.toFixed(1)}, ${lp?.y.toFixed(1)})`,
);
const dies = make(followCfg({ enabled: true, by: 'speed', speed: 400, end: 'die' }));
dies.update(0);
for (let i = 0; i < 40; i++) dies.update(1 / 60);
assert(live(dies).length === 0, 'end "die": a particle past the end is recycled');
const stops = make(followCfg({ enabled: true, by: 'speed', speed: 400, end: 'stop' }));
stops.update(0);
for (let i = 0; i < 40; i++) stops.update(1 / 60);
const st = live(stops)[0];
assert(
	!!st && near(st.x, 100, 1e-6) && near(st.y, 100, 1e-6),
	'end "stop": it holds at the last point',
);
// Forces stack: gravity pulls the follower off its line by ½·g·t².
const gravity = {
	type: FX_FORCES_BEHAVIOR_TYPE,
	config: { forces: [{ kind: 'gravity', enabled: true, strength: 200, angle: 90 }] },
};
const forced = make(
	followCfg(
		{
			enabled: true,
			by: 'speed',
			speed: 50,
		},
		[gravity],
	),
);
forced.update(0);
for (let i = 0; i < 60; i++) forced.update(1 / 60);
const fp = live(forced)[0];
assert(
	!!fp && near(fp.x, 50, 1e-6) && near(fp.y, 100, 0.5),
	`forces stack on a follower: (50, 0) on the path + ½·200·1² down = (${fp?.x.toFixed(1)}, ${fp?.y.toFixed(1)})`,
);
// Off the path (shape emit): a follower starts at the curve's first point and traces its shape.
const offset = make(
	cfg(
		[
			pathEntry({
				curve: {
					kind: 'polyline',
					points: [
						{ x: 40, y: 40 },
						{ x: 140, y: 40 },
					],
				},
				follow: { enabled: true, by: 'speed', speed: 100 },
			}),
		],
		{ maxParticles: 1, lifetime: { min: 2, max: 2 } },
	),
);
offset.update(0);
for (let i = 0; i < 30; i++) offset.update(1 / 60);
const op = live(offset)[0];
assert(
	!!op && near(op.x, 90, 1e-6) && near(op.y, 40, 1e-6),
	`a follower born off the path traces the drawn curve (${op?.x.toFixed(1)}, ${op?.y.toFixed(1)})`,
);
// The path runs AFTER placement, so a spawn shape listed after it in the config cannot undo it.
const listedFirst = make(
	cfg(
		[
			pathEntry({
				curve: {
					kind: 'polyline',
					points: [
						{ x: 40, y: 40 },
						{ x: 140, y: 40 },
					],
				},
				follow: { enabled: true, by: 'speed', speed: 100 },
			}),
			{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 0 } } },
		],
		{ maxParticles: 1, lifetime: { min: 2, max: 2 } },
	),
);
listedFirst.update(0);
const lf = live(listedFirst)[0];
assert(
	!!lf && near(lf.x, 40, 1e-6) && near(lf.y, 40, 1e-6),
	'…whatever the order of the spawn shape in the config (fxPath runs after placement)',
);

// ---------------------------------------------------------------------------
console.log('');
console.log('fx path — no path = no change, and the ship chain');
const noPath = make(
	cfg([{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 0 } } }], {
		pos: { x: 3, y: 4 },
	}),
);
for (let i = 0; i < 10; i++) noPath.update(0.1);
assert(
	noPath.spawnPos.x === 3 &&
		noPath.spawnPos.y === 4 &&
		(noPath as unknown as FxPathEmitter).fxPathClock === undefined,
	'an emitter without fxPath is never touched by the tick hook',
);
const doc: EffectDoc = {
	version: 1,
	id: 'pathed',
	name: 'Pathed',
	layers: [
		{
			key: 'l1',
			config: travelCfg({ follow: { enabled: true, orient: true } }),
			art: { assetKey: 'a', frames: ['f'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
	],
};
const saved = normalizeEffectDoc(JSON.parse(JSON.stringify(doc)));
const deployed = normalizeEffectDoc(JSON.parse(JSON.stringify(saved, null, '\t')), 'pathed');
const baked = JSON.parse(JSON.stringify({ effects: [deployed] })) as { effects: EffectDoc[] };
assert(
	JSON.stringify(baked.effects[0].layers[0].config) === JSON.stringify(doc.layers[0].config),
	'the fxPath behavior travels save → export → bake VERBATIM',
);
const shipped = new Emitter(new Container(), baked.effects[0].layers[0].config);
const sb = shipped.getBehavior(FX_PATH_BEHAVIOR_TYPE) as FxPathBehavior | null;
assert(
	!!sb && sb.path.emit === 'travel' && sb.path.follow.orient,
	'…and the shipped config builds the behavior',
);

console.log('');
if (failures) {
	console.error(`fx path: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx path: all green');
