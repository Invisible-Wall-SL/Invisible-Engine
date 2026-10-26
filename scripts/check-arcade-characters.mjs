// Arcade characters, the mechanics half (packages/engine-mechanics/src/behaviours.js and the P10.11
// additions to motion.js; docs/design/game-families.md §4.3): every behaviour preset and every
// brain condition / transition replays bit-identically under a seed (against the committed trace in
// packages/engine-mechanics/fixtures/arcade-characters-replay.json); steer obeys accel, decel,
// maxSpeed and turnRate; the solid response stops and slides and does not tunnel; paths sample,
// walk and find their nearest point; controllers follow the input map and the pointer. The
// launcher half (the loop, Flow, animInputs, shipping) is apps/launcher-api's check:arcade-characters.
//
// Run: pnpm check:arcade-characters            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	BEHAVIOURS,
	BEHAVIOUR_DEFAULTS,
	CONDITIONS,
	CONTROLLER_ACTIONS,
	PATH_LEAD,
	brainVelocity,
	controllerVelocity,
	createBrain,
	createBrainWorld,
	setBrainState,
	stepBrain,
} from '../packages/engine-mechanics/src/behaviours.js';
import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	PATH_SUBDIVISIONS,
	nearestDistance,
	pointAt,
	samplePath,
	steer,
	stepBody,
	stepSolid,
} from '../packages/engine-mechanics/src/motion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_FIXTURE = join(
	ROOT,
	'packages/engine-mechanics/fixtures/arcade-characters-replay.json',
);
const UPDATE = process.argv.includes('--update');

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (e) {
		console.error(`✗ ${name}`);
		throw e;
	}
};

const box = (id, x, y, w, h, extra = {}) => ({
	id,
	shape: 'box',
	w,
	h,
	x,
	y,
	vx: 0,
	vy: 0,
	tags: [],
	...extra,
});
const circle = (id, x, y, r, extra = {}) => ({
	id,
	shape: 'circle',
	r,
	x,
	y,
	vx: 0,
	vy: 0,
	tags: [],
	...extra,
});
const FIELD = { w: 800, h: 600 };
const DT = 1 / 60;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const speedOf = (v) => Math.hypot(v.vx, v.vy);
const headingDeg = (v) => (Math.atan2(v.vy, v.vx) * 180) / Math.PI;

// --- steer ------------------------------------------------------------------------------------

check('steer: no movement settings ⇒ the desired velocity at once', () => {
	const b = box('b', 0, 0, 10, 10, { vx: 50, vy: -20 });
	steer(b, { vx: -300, vy: 40 }, undefined, DT);
	assert.deepEqual([b.vx, b.vy], [-300, 40]);
	steer(b, { vx: 7, vy: 8 }, {}, DT);
	assert.deepEqual([b.vx, b.vy], [7, 8]);
});

check('steer: accel limits speeding up; the target is reached, never passed', () => {
	const b = box('b', 0, 0, 10, 10);
	const movement = { accel: 600 };
	steer(b, { vx: 300, vy: 0 }, movement, DT);
	assert.ok(near(b.vx, 10));
	let steps = 1;
	while (b.vx < 300) {
		steer(b, { vx: 300, vy: 0 }, movement, DT);
		assert.ok(b.vx <= 300);
		steps += 1;
	}
	assert.equal(steps, 30);
});

check('steer: decel limits slowing, reversing brakes; decel absent ⇒ accel', () => {
	const b = box('b', 0, 0, 10, 10, { vx: 300 });
	steer(b, { vx: 0, vy: 0 }, { accel: 600, decel: 1200 }, DT);
	assert.ok(near(b.vx, 280));
	const c = box('c', 0, 0, 10, 10, { vx: 300 });
	steer(c, { vx: 0, vy: 0 }, { accel: 600 }, DT);
	assert.ok(near(c.vx, 290));
	const r = box('r', 0, 0, 10, 10, { vx: 100 });
	steer(r, { vx: -100, vy: 0 }, { accel: 6000, decel: 60 }, DT);
	assert.ok(near(r.vx, 99), 'a reversal at the same speed brakes at decel');
	const d = box('d', 0, 0, 10, 10, { vx: 100 });
	steer(d, { vx: 0, vy: 0 }, { decel: 600 }, DT);
	assert.ok(near(d.vx, 90), 'decel alone limits slowing');
	steer(d, { vx: 500, vy: 0 }, { decel: 600 }, DT);
	assert.equal(d.vx, 500, 'accel absent ⇒ speeding up is instant');
});

check('steer: maxSpeed caps |v| (diagonals too), after accel', () => {
	const b = box('b', 0, 0, 10, 10);
	steer(b, { vx: 400, vy: 300 }, { maxSpeed: 250 }, DT);
	assert.ok(near(speedOf(b), 250));
	assert.ok(near(b.vx / b.vy, 400 / 300));
	steer(b, { vx: 100, vy: 0 }, { maxSpeed: 250 }, DT);
	assert.deepEqual([b.vx, b.vy], [100, 0], 'under the cap is untouched');
});

check('steer: turnRate limits the heading change; a standing body turns at once', () => {
	const b = box('b', 0, 0, 10, 10, { vx: 100 });
	steer(b, { vx: 0, vy: 100 }, { turnRate: 90 }, DT);
	assert.ok(near(headingDeg(b), 1.5, 1e-9));
	assert.ok(near(speedOf(b), 100, 1e-9));
	let steps = 1;
	while (headingDeg(b) < 90 - 1e-9) {
		steer(b, { vx: 0, vy: 100 }, { turnRate: 90 }, DT);
		steps += 1;
	}
	assert.equal(steps, 60, 'a quarter turn at 90°/s takes a second');
	const left = box('l', 0, 0, 10, 10, { vx: 100 });
	steer(left, { vx: 0, vy: -100 }, { turnRate: 180 }, DT);
	assert.ok(near(headingDeg(left), -3), 'turns the short way');
	const still = box('s', 0, 0, 10, 10);
	steer(still, { vx: 0, vy: -100 }, { turnRate: 10 }, DT);
	assert.deepEqual([still.vx, still.vy], [0, -100]);
	const stop = box('t', 0, 0, 10, 10, { vx: 100 });
	steer(stop, { vx: 0, vy: 0 }, { turnRate: 10 }, DT);
	assert.deepEqual([stop.vx, stop.vy], [0, 0], 'stopping is not a turn');
});

check('steer: bad numbers are ignored (instant / uncapped)', () => {
	const b = box('b', 0, 0, 10, 10);
	steer(
		b,
		{ vx: 500, vy: 0 },
		{ accel: Number.NaN, maxSpeed: -5, turnRate: Number.POSITIVE_INFINITY },
		DT,
	);
	assert.deepEqual([b.vx, b.vy], [500, 0]);
});

// --- the solid response -------------------------------------------------------------------

const wall = (id, x, y, w, h) => box(id, x, y, w, h, { solid: true });

check('solid: a body driven into a wall stops flush, vx zeroed, hitX', () => {
	const w = wall('w', 200, 300, 20, 400);
	const b = box('b', 175, 300, 20, 20, { vx: 600 });
	const hit = stepSolid(b, DT, [w], FIELD);
	assert.deepEqual(hit, { hitX: true, hitY: false });
	assert.equal(b.x, 180);
	assert.equal(b.vx, 0);
	b.vx = 600;
	assert.deepEqual(stepSolid(b, DT, [w], FIELD), { hitX: true, hitY: false }, 'pressing on hits');
	assert.equal(b.x, 180);
	b.vx = 0;
	assert.deepEqual(stepSolid(b, DT, [w], FIELD), { hitX: false, hitY: false }, 'resting is no hit');
	b.vx = -60;
	assert.deepEqual(stepSolid(b, DT, [w], FIELD), { hitX: false, hitY: false }, 'leaving is free');
	assert.equal(b.x, 179);
});

check('solid: diagonal into a wall slides along it, keeping the along-wall speed', () => {
	const w = wall('w', 200, 300, 20, 400);
	const b = box('b', 185, 300, 20, 20, { vx: 300, vy: 120 });
	for (let i = 0; i < 30; i++) {
		b.vx = 300;
		const hit = stepSolid(b, DT, [w], FIELD);
		assert.ok(hit.hitX && !hit.hitY);
		assert.equal(b.vy, 120);
	}
	assert.equal(b.x, 180);
	assert.ok(near(b.y, 300 + 30 * 120 * DT, 1e-9));
});

check('solid: onto a floor stops y, x keeps sliding (hitY)', () => {
	const floor = wall('f', 400, 500, 800, 20);
	const b = box('b', 100, 470, 20, 20, { vx: 90, vy: 900 });
	const hit = stepSolid(b, DT, [floor], FIELD);
	assert.deepEqual(hit, { hitX: false, hitY: true });
	assert.equal(b.y, 480);
	assert.equal(b.vy, 0);
	assert.ok(near(b.x, 101.5));
	b.vy = 0;
	for (let i = 0; i < 20; i++)
		assert.deepEqual(stepSolid(b, DT, [floor], FIELD), { hitX: false, hitY: false });
	assert.equal(b.y, 480, 'running along the floor never catches on it');
});

check('solid: no tunnelling at any speed below body size / dt', () => {
	const thin = wall('w', 300, 300, 2, 400);
	for (let speed = 30; speed < 20 / DT; speed += 37) {
		const b = box('b', 288, 300, 20, 20, { vx: speed });
		for (let i = 0; i < 4; i++) {
			b.vx = speed;
			stepSolid(b, DT, [thin], FIELD);
			assert.ok(b.x <= 289, `speed ${speed}`);
		}
	}
	const c = circle('c', 289, 300, 10, { vx: 19.9 / DT });
	stepSolid(c, DT, [thin], FIELD);
	assert.equal(c.x, 289, 'a circle is pushed as its box');
	const fast = box('fast', 288, 300, 20, 20, { vx: 23 / DT });
	stepSolid(fast, DT, [thin], FIELD);
	assert.ok(fast.x > 301, 'past body + wall per step it passes: the documented limit');
});

check('solid: only solid bodies block, never the body itself; pass/wrap edges after', () => {
	const self = box('s', 100, 100, 20, 20, { vx: 60, solid: true });
	const ghost = box('g', 112, 100, 20, 20);
	assert.deepEqual(stepSolid(self, DT, [self, ghost], FIELD), { hitX: false, hitY: false });
	assert.equal(self.x, 101);
	const edge = box('e', 795, 300, 20, 20, { vx: 600 });
	stepSolid(edge, DT, [], FIELD);
	assert.equal(edge.x, 790, 'clamped by the field as stepBody');
	const wrap = box('r', 795, 300, 20, 20, { vx: 600, edges: 'wrap' });
	stepSolid(wrap, DT, [], FIELD);
	assert.equal(wrap.x, 5);
	const plain = box('p', 795, 300, 20, 20, { vx: 600 });
	assert.deepEqual(stepBody({ ...plain }, DT, FIELD), { ...plain, x: 790 });
});

check('solid: into an inside corner of two walls stops on both axes', () => {
	const solids = [wall('right', 220, 300, 20, 200), wall('bottom', 150, 330, 200, 20)];
	const b = box('b', 195, 305, 20, 20, { vx: 600, vy: 600 });
	const hit = stepSolid(b, DT, solids, FIELD);
	assert.deepEqual(hit, { hitX: true, hitY: true });
	assert.deepEqual([b.x, b.y, b.vx, b.vy], [200, 310, 0, 0]);
});

check('solid: two adjacent walls entered in one step push back out of both', () => {
	const solids = [wall('far', 230, 300, 20, 200), wall('near', 212, 300, 4, 200)];
	const b = box('b', 190, 300, 20, 20, { vx: 1500 });
	stepSolid(b, DT, solids, FIELD);
	assert.equal(b.x, 200);
	assert.equal(b.vx, 0);
});

check('solid: an overlap it did not move into settles along the shallower axis', () => {
	const mover = wall('m', 100, 100, 40, 40);
	const b = box('b', 125, 102, 20, 20, { vy: 0 });
	assert.deepEqual(stepSolid(b, DT, [mover], FIELD), { hitX: true, hitY: false });
	assert.equal(b.x, 130);
	const under = box('u', 100, 125, 20, 20, { vy: -30 });
	assert.deepEqual(stepSolid(under, DT, [mover], FIELD), { hitX: false, hitY: true });
	assert.equal(under.y, 130);
	assert.equal(under.vy, 0, 'moving into it is zeroed');
});

// --- paths ------------------------------------------------------------------------------------

const L_PATH = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 50 },
];

check('paths: an open polyline (smoothing 0) keeps its points; cum and length', () => {
	const p = samplePath({ points: L_PATH });
	assert.deepEqual(p.points, L_PATH);
	assert.deepEqual(p.cum, [0, 100, 150]);
	assert.equal(p.length, 150);
	assert.equal(p.closed, false);
	assert.notEqual(p.points[0], L_PATH[0], 'copies, never aliases');
});

check('paths: a closed path counts its closing segment and wraps', () => {
	const p = samplePath({ points: L_PATH, closed: true });
	assert.equal(p.length, 150 + Math.hypot(100, 50));
	assert.deepEqual(pointAt(p, p.length), { x: 0, y: 0 });
	assert.deepEqual(pointAt(p, p.length + 50), { x: 50, y: 0 });
	assert.deepEqual(pointAt(p, -50), pointAt(p, p.length - 50));
	const mid = pointAt(p, 150 + Math.hypot(100, 50) / 2);
	assert.ok(near(mid.x, 50) && near(mid.y, 25), 'along the closing segment');
});

check('paths: pointAt interpolates and clamps an open path', () => {
	const p = samplePath({ points: L_PATH });
	assert.deepEqual(pointAt(p, 0), { x: 0, y: 0 });
	assert.deepEqual(pointAt(p, 40), { x: 40, y: 0 });
	assert.deepEqual(pointAt(p, 125), { x: 100, y: 25 });
	assert.deepEqual(pointAt(p, 150), { x: 100, y: 50 });
	assert.deepEqual(pointAt(p, 9999), { x: 100, y: 50 });
	assert.deepEqual(pointAt(p, -9), { x: 0, y: 0 });
	assert.deepEqual(pointAt(p, Number.NaN), { x: 0, y: 0 });
});

check('paths: smoothing subdivides through every authored point, longer the smoother', () => {
	const open = samplePath({ points: L_PATH, smoothing: 1 });
	assert.equal(open.points.length, 2 * PATH_SUBDIVISIONS + 1);
	for (const [i, pt] of L_PATH.entries())
		assert.deepEqual(open.points[i * PATH_SUBDIVISIONS], pt, `passes through point ${i}`);
	const half = samplePath({ points: L_PATH, smoothing: 0.5 });
	const flat = samplePath({ points: L_PATH, smoothing: 0 });
	assert.ok(flat.length < half.length && half.length < open.length);
	const loop = samplePath({ points: L_PATH, closed: true, smoothing: 1 });
	assert.equal(loop.points.length, 3 * PATH_SUBDIVISIONS);
	for (let i = 1; i < open.cum.length; i++) assert.ok(open.cum[i] >= open.cum[i - 1]);
	assert.deepEqual(samplePath({ points: L_PATH, smoothing: 2 }), open, 'clamped to 1');
});

check('paths: nearestDistance finds the arc distance of the nearest point', () => {
	const p = samplePath({ points: L_PATH });
	assert.equal(nearestDistance(p, 30, -40), 30);
	assert.equal(nearestDistance(p, 140, 20), 120);
	assert.equal(nearestDistance(p, -50, -50), 0);
	assert.equal(nearestDistance(p, 500, 500), 150);
	const loop = samplePath({ points: L_PATH, closed: true });
	const d = nearestDistance(loop, 40, 30);
	assert.ok(d > 150 && d < loop.length, 'on the closing segment');
	const back = pointAt(loop, d);
	assert.ok(near(back.y / back.x, 0.5));
	assert.equal(nearestDistance(samplePath({ points: [{ x: 5, y: 5 }] }), 0, 0), 0);
	assert.throws(() => samplePath({ points: [] }));
});

// --- controllers ------------------------------------------------------------------------------

const keys = (...held) => ({ held: (a) => held.includes(a), pointer: () => undefined });
const pointing = (p) => ({ held: () => false, pointer: () => p });

check('controllers: the fixed input-map actions', () => {
	assert.deepEqual(CONTROLLER_ACTIONS, ['left', 'right', 'up', 'down']);
});

check('controllers: topDown 8-way, a diagonal no faster than a straight line', () => {
	const self = box('p', 0, 0, 10, 10);
	const c = { kind: 'topDown', speed: 200 };
	assert.deepEqual(controllerVelocity(c, keys(), self, undefined, DT), { vx: 0, vy: 0 });
	assert.deepEqual(controllerVelocity(c, keys('left'), self, undefined, DT), { vx: -200, vy: 0 });
	assert.deepEqual(controllerVelocity(c, keys('down'), self, undefined, DT), { vx: 0, vy: 200 });
	const diag = controllerVelocity(c, keys('right', 'up'), self, undefined, DT);
	assert.ok(near(speedOf(diag), 200, 1e-9));
	assert.ok(diag.vx > 0 && diag.vy < 0);
	assert.deepEqual(controllerVelocity(c, keys('left', 'right'), self, undefined, DT), {
		vx: 0,
		vy: 0,
	});
	assert.deepEqual(controllerVelocity(c, keys('left', 'right', 'up'), self, undefined, DT), {
		vx: 0,
		vy: -200,
	});
});

check('controllers: sideScroll reads left/right only', () => {
	const self = box('p', 0, 0, 10, 10, { vy: 33 });
	const c = { kind: 'sideScroll', speed: 150 };
	assert.deepEqual(controllerVelocity(c, keys('right', 'up'), self, undefined, DT), {
		vx: 150,
		vy: 0,
	});
	assert.deepEqual(controllerVelocity(c, keys('down'), self, undefined, DT), { vx: 0, vy: 0 });
});

check('controllers: pointer follows on its axes, arrives without overshooting', () => {
	const target = { x: 400, y: 120 };
	for (const axes of ['x', 'y', 'xy']) {
		const self = box('p', 100, 500, 40, 10);
		const c = { kind: 'pointer', axes, speed: 900 };
		let last = Infinity;
		for (let i = 0; i < 60; i++) {
			const v = controllerVelocity(c, pointing(target), self, undefined, DT);
			assert.ok(speedOf(v) <= 900 + 1e-9);
			self.vx = v.vx;
			self.vy = v.vy;
			stepBody(self, DT, FIELD);
			const gap = Math.hypot(
				axes === 'y' ? 0 : target.x - self.x,
				axes === 'x' ? 0 : target.y - self.y,
			);
			assert.ok(gap <= last + 1e-9, 'never moves away');
			last = gap;
			if (axes !== 'y') assert.ok(self.x <= target.x + 1e-9, 'no overshoot on x');
			if (axes !== 'x') assert.ok(self.y >= target.y - 1e-9, 'no overshoot on y');
		}
		assert.ok(last < 1e-9, `${axes} arrives`);
		if (axes === 'x') assert.equal(self.y, 500);
		if (axes === 'y') assert.equal(self.x, 100);
	}
});

check('controllers: pointer speed falls back to maxSpeed, else snaps; no pointer, no move', () => {
	const self = box('p', 100, 100, 10, 10);
	const c = { kind: 'pointer', axes: 'xy' };
	const capped = controllerVelocity(c, pointing({ x: 500, y: 100 }), self, { maxSpeed: 60 }, DT);
	assert.deepEqual(capped, { vx: 60, vy: 0 });
	const snap = controllerVelocity(c, pointing({ x: 500, y: 100 }), self, undefined, DT);
	assert.ok(near(snap.vx * DT, 400, 1e-9));
	assert.deepEqual(controllerVelocity(c, keys('left'), self, undefined, DT), { vx: 0, vy: 0 });
});

// --- brains: transitions and conditions ------------------------------------------------------

const brainOf = (spec, seed = 'brain', at = { x: 0, y: 0 }) =>
	createBrain(spec, { rng: createRng(seed), at });
const S = (id, behaviour = 'idle', params) => ({ id, behaviour, ...(params ? { params } : {}) });
const T = (id, from, to, when = []) => ({ id, from, to, when });
const worldFor = (self, bodies, extra = {}) =>
	createBrainWorld({ self, bodies: [self, ...bodies], ...extra });

check('brain: the catalogue', () => {
	assert.deepEqual(BEHAVIOURS, [
		'idle',
		'wander',
		'patrol',
		'followPath',
		'chase',
		'flee',
		'keepDistance',
		'hover',
		'shootAt',
	]);
	assert.deepEqual(CONDITIONS, [
		'targetWithin',
		'targetBeyond',
		'touching',
		'hitSolid',
		'timer',
		'variable',
		'random',
	]);
	assert.deepEqual(BEHAVIOUR_DEFAULTS.chase, { tag: 'player', range: 200, speed: 160 });
});

check('brain: starts in initial (else the first state); no states throws', () => {
	assert.equal(brainOf({ initial: 'b', states: [S('a'), S('b')], transitions: [] }).state, 'b');
	assert.equal(brainOf({ initial: 'zz', states: [S('a'), S('b')], transitions: [] }).state, 'a');
	assert.throws(() => brainOf({ initial: 'a', states: [], transitions: [] }));
});

check('brain: timer counts ms in the state; entering resets the clock and memory', () => {
	const brain = brainOf({
		initial: 'a',
		states: [S('a'), S('b')],
		transitions: [T('ab', 'a', 'b', [{ kind: 'timer', ms: 500 }])],
	});
	const self = box('s', 0, 0, 10, 10);
	const world = worldFor(self, []);
	let fired;
	let steps = 0;
	while (!fired) {
		fired = stepBrain(brain, world, DT);
		steps += 1;
	}
	assert.equal(steps, 30);
	assert.deepEqual(fired, { from: 'a', to: 'b' });
	assert.equal(brain.time, 0);
	assert.deepEqual(brain.memory, {});
});

check('brain: `*` first in authored order, then the state; at most one per step', () => {
	const brain = brainOf({
		initial: 'a',
		states: [S('a'), S('b'), S('c'), S('d')],
		transitions: [T('ad', 'a', 'd'), T('any-c', '*', 'c'), T('any-b', '*', 'b')],
	});
	const world = worldFor(box('s', 0, 0, 10, 10), []);
	assert.deepEqual(stepBrain(brain, world, DT), { from: 'a', to: 'c' });
	assert.deepEqual(stepBrain(brain, world, DT), { from: 'c', to: 'b' }, 'never re-enters c');
	assert.deepEqual(stepBrain(brain, world, DT), { from: 'b', to: 'c' });
});

check('brain: an explicit self-transition re-enters; an unknown target is skipped', () => {
	const brain = brainOf({
		initial: 'a',
		states: [S('a')],
		transitions: [T('ghost', 'a', 'nowhere'), T('aa', 'a', 'a', [{ kind: 'timer', ms: 100 }])],
	});
	const world = worldFor(box('s', 0, 0, 10, 10), []);
	for (let i = 0; i < 5; i++) assert.equal(stepBrain(brain, world, DT), undefined);
	assert.deepEqual(stepBrain(brain, world, DT), { from: 'a', to: 'a' });
	assert.equal(brain.time, 0);
});

check('brain: targetWithin / targetBeyond (beyond with no such body), centre to centre', () => {
	const within = { kind: 'targetWithin', tag: 'player', px: 100 };
	const beyond = { kind: 'targetBeyond', tag: 'player', px: 100 };
	const spec = {
		initial: 'idle',
		states: [S('idle'), S('in'), S('out')],
		transitions: [T('in', 'idle', 'in', [within]), T('out', 'idle', 'out', [beyond])],
	};
	const self = box('s', 0, 0, 10, 10);
	const at = (x) => worldFor(self, [box('p', x, 0, 50, 50, { tags: ['player'] })]);
	assert.equal(stepBrain(brainOf(spec), at(100), DT)?.to, 'in');
	assert.equal(stepBrain(brainOf(spec), at(100.001), DT)?.to, 'out');
	assert.equal(stepBrain(brainOf(spec), worldFor(self, []), DT)?.to, 'out');
	const n = worldFor(self, [
		box('far', 90, 0, 5, 5, { tags: ['player'] }),
		box('near', 0, -30, 5, 5, { tags: ['player'] }),
		box('nearer-untagged', 1, 0, 5, 5),
	]).nearest(self, 'player');
	assert.equal(n?.body.id, 'near');
	assert.equal(n?.distance, 30);
});

check('brain: touching (by tag, never itself) and hitSolid', () => {
	const spec = {
		initial: 'a',
		states: [S('a'), S('t'), S('h')],
		transitions: [
			T('t', 'a', 't', [{ kind: 'touching', tag: 'spike' }]),
			T('h', 'a', 'h', [{ kind: 'hitSolid' }]),
		],
	};
	const self = box('s', 0, 0, 10, 10, { tags: ['spike'] });
	assert.equal(stepBrain(brainOf(spec), worldFor(self, []), DT), undefined);
	const spike = box('k', 10, 0, 10, 10, { tags: ['spike'] });
	assert.equal(stepBrain(brainOf(spec), worldFor(self, [spike]), DT)?.to, 't');
	assert.equal(stepBrain(brainOf(spec), worldFor(self, [], { hitSolid: true }), DT)?.to, 'h');
});

check('brain: variable conditions compare a Flow variable', () => {
	const table = [
		['==', 3, 3, true],
		['==', 3, '3', false],
		['!=', true, false, true],
		['<', 2, 3, true],
		['<=', 3, 3, true],
		['>', 'b', 'a', false],
		['>=', 4, 3, true],
		['>', undefined, 0, false],
		['==', 'run', 'run', true],
	];
	for (const [op, left, right, expected] of table) {
		const brain = brainOf({
			initial: 'a',
			states: [S('a'), S('b')],
			transitions: [T('v', 'a', 'b', [{ kind: 'variable', id: 'x', op, value: right }])],
		});
		const world = worldFor(box('s', 0, 0, 1, 1), [], { variable: (id) => (id === 'x' ? left : 0) });
		assert.equal(stepBrain(brain, world, DT) !== undefined, expected, `${left} ${op} ${right}`);
	}
});

check('brain: every condition must hold; [] fires at once', () => {
	const spec = {
		initial: 'a',
		states: [S('a'), S('b')],
		transitions: [
			T('ab', 'a', 'b', [
				{ kind: 'timer', ms: 100 },
				{ kind: 'variable', id: 'go', op: '==', value: true },
			]),
		],
	};
	let go = false;
	const brain = brainOf(spec);
	const world = worldFor(box('s', 0, 0, 1, 1), [], { variable: () => go });
	for (let i = 0; i < 20; i++) assert.equal(stepBrain(brain, world, DT), undefined);
	go = true;
	assert.equal(stepBrain(brain, world, DT)?.to, 'b');
	const now = brainOf({ initial: 'a', states: [S('a'), S('b')], transitions: [T('x', 'a', 'b')] });
	assert.equal(stepBrain(now, world, DT)?.to, 'b');
});

/** The step (1-based) a `random` transition fires on, under a seed. */
function randomFire(seed, chance, every) {
	const brain = brainOf(
		{
			initial: 'a',
			states: [S('a'), S('b')],
			transitions: [T('r', 'a', 'b', [{ kind: 'random', chance, ...(every ? { every } : {}) }])],
		},
		seed,
	);
	const world = worldFor(box('s', 0, 0, 1, 1), []);
	for (let i = 1; i <= 6000; i++) if (stepBrain(brain, world, DT)) return i;
	return -1;
}

check('brain: random rolls once per beat, seeded — the same seed fires on the same step', () => {
	const fires = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((seed) => randomFire(seed, 0.3, 250));
	assert.deepEqual(
		fires,
		['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((seed) => randomFire(seed, 0.3, 250)),
	);
	for (const step of fires) assert.equal(step % 15, 0, 'only on a 250 ms beat');
	assert.ok(new Set(fires).size > 1, 'seeds differ');
	assert.equal(randomFire('x', 1), 60, 'default beat is 1000 ms; chance 1 fires on the first');
	assert.equal(randomFire('x', 0, 100), -1, 'chance 0 never fires');
});

check('brain: a random roll is not skipped when a sibling condition fails', () => {
	const brain = brainOf(
		{
			initial: 'a',
			states: [S('a'), S('b')],
			transitions: [
				T('r', 'a', 'b', [
					{ kind: 'variable', id: 'go', op: '==', value: true },
					{ kind: 'random', chance: 1, every: 100 },
				]),
			],
		},
		'sib',
	);
	const world = worldFor(box('s', 0, 0, 1, 1), [], { variable: () => false });
	for (let i = 0; i < 30; i++) stepBrain(brain, world, DT);
	assert.equal(brain.rolls['0:1'], 5);
});

check('brain: setBrainState overrides (Flow), re-entering; unknown ⇒ undefined', () => {
	const brain = brainOf({ initial: 'a', states: [S('a'), S('b')], transitions: [] });
	const world = worldFor(box('s', 0, 0, 1, 1), []);
	stepBrain(brain, world, DT);
	assert.deepEqual(setBrainState(brain, 'b'), { from: 'a', to: 'b' });
	assert.equal(brain.time, 0);
	stepBrain(brain, world, DT);
	assert.deepEqual(setBrainState(brain, 'b'), { from: 'b', to: 'b' });
	assert.equal(brain.time, 0);
	assert.equal(setBrainState(brain, 'nope'), undefined);
	assert.equal(brain.state, 'b');
});

// --- behaviours -------------------------------------------------------------------------------

/** Run one character on a single-state brain; returns the body and its velocities. */
function runBehaviour(
	state,
	{ self, others = [], steps = 120, seed = 'b', paths = {}, solids = [] },
) {
	const brain = brainOf({ initial: state.id, states: [state], transitions: [] }, seed, self);
	const vs = [];
	const spawns = [];
	let hitSolid = false;
	for (let i = 0; i < steps; i++) {
		const world = createBrainWorld({ self, bodies: [self, ...others], hitSolid, paths });
		stepBrain(brain, world, DT);
		const v = brainVelocity(brain, self, world, DT);
		if (v.spawn) spawns.push({ step: i + 1, ...v.spawn });
		vs.push(v);
		self.vx = v.vx;
		self.vy = v.vy;
		const hit = stepSolid(self, DT, solids, FIELD);
		hitSolid = hit.hitX || hit.hitY;
	}
	return { self, vs, spawns, brain };
}

check('behaviour idle: still', () => {
	const { vs, self } = runBehaviour(S('i', 'idle'), { self: box('s', 50, 50, 10, 10) });
	assert.ok(vs.every((v) => v.vx === 0 && v.vy === 0));
	assert.deepEqual([self.x, self.y], [50, 50]);
});

check('behaviour wander: its speed, a new heading each turnEvery and on hitting a solid', () => {
	const { vs } = runBehaviour(S('w', 'wander', { speed: 90, turnEvery: 500 }), {
		self: box('s', 400, 300, 10, 10),
		steps: 120,
	});
	for (const v of vs) assert.ok(near(speedOf(v), 90, 1e-9));
	const changes = vs.filter((v, i) => i > 0 && (v.vx !== vs[i - 1].vx || v.vy !== vs[i - 1].vy));
	assert.equal(changes.length, 4, 'turns at 500, 1000, 1500 and 2000 ms');
	const walled = runBehaviour(S('w', 'wander', { speed: 90, turnEvery: 1e9 }), {
		self: box('s', 400, 300, 10, 10),
		solids: [
			wall('l', 380, 300, 10, 200),
			wall('r', 420, 300, 10, 200),
			wall('t', 400, 270, 200, 10),
			wall('b', 400, 330, 200, 10),
		],
		steps: 240,
	});
	const turns = walled.vs.filter(
		(v, i) => i > 0 && (v.vx !== walled.vs[i - 1].vx || v.vy !== walled.vs[i - 1].vy),
	);
	assert.ok(turns.length >= 2, 'boxed in, it turns at the walls');
});

check('behaviour patrol: no path ⇒ spawn ↔ spawn+{dx,dy}, ping-pong at speed', () => {
	const { self, vs } = runBehaviour(S('p', 'patrol', { speed: 120, dx: 0, dy: 60 }), {
		self: box('s', 100, 100, 10, 10),
		steps: 240,
	});
	for (const v of vs) assert.ok(speedOf(v) <= 120 + 1e-9);
	let lo = Infinity;
	let hi = -Infinity;
	const ys = [];
	const probe = box('s', 100, 100, 10, 10);
	const brain = brainOf(
		{ initial: 'p', states: [S('p', 'patrol', { speed: 120, dx: 0, dy: 60 })], transitions: [] },
		'p',
		probe,
	);
	for (let i = 0; i < 240; i++) {
		const world = createBrainWorld({ self: probe, bodies: [probe] });
		stepBrain(brain, world, DT);
		const v = brainVelocity(brain, probe, world, DT);
		probe.vx = v.vx;
		probe.vy = v.vy;
		stepBody(probe, DT, FIELD);
		lo = Math.min(lo, probe.y);
		hi = Math.max(hi, probe.y);
		ys.push(probe.y);
	}
	assert.ok(lo >= 100 - 1e-9 && hi <= 160 + 1e-9);
	assert.ok(hi > 159 && ys.at(-1) < 160, 'reaches the far end and turns back');
	assert.equal(self.x, 100);
});

check('behaviour patrol: joins a path at its nearest point; closed loops; open ping-pongs', () => {
	const square = samplePath({
		points: [
			{ x: 100, y: 100 },
			{ x: 300, y: 100 },
			{ x: 300, y: 300 },
			{ x: 100, y: 300 },
		],
		closed: true,
	});
	const loop = runBehaviour(S('p', 'patrol', { path: 'sq', speed: 200 }), {
		self: box('s', 200, 90, 10, 10),
		paths: { sq: square },
		steps: 1,
	});
	assert.equal(nearestDistance(square, 200, 90), 100);
	assert.equal(
		loop.brain.memory.d,
		100 + (PATH_LEAD - 10),
		'joins at the nearest point, a lead on',
	);
	assert.ok(loop.vs[0].vy > 0 && loop.vs[0].vx > 0 && loop.vs[0].vx < loop.vs[0].vy);
	const walker = box('s', 100, 100, 10, 10);
	const lapBrain = brainOf(
		{ initial: 'p', states: [S('p', 'patrol', { path: 'sq', speed: 200 })], transitions: [] },
		'lap',
		walker,
	);
	const corners = new Set();
	for (let i = 0; i < 480; i++) {
		const world = createBrainWorld({ self: walker, bodies: [walker], paths: { sq: square } });
		stepBrain(lapBrain, world, DT);
		const v = brainVelocity(lapBrain, walker, world, DT);
		assert.ok(speedOf(v) <= 200 + 1e-9);
		walker.vx = v.vx;
		walker.vy = v.vy;
		stepBody(walker, DT, FIELD);
		const onPath = pointAt(square, nearestDistance(square, walker.x, walker.y));
		assert.ok(Math.hypot(onPath.x - walker.x, onPath.y - walker.y) <= PATH_LEAD, 'keeps to it');
		for (const [k, c] of square.points.entries())
			if (Math.hypot(c.x - walker.x, c.y - walker.y) <= PATH_LEAD) corners.add(k);
	}
	assert.equal(corners.size, 4, 'loops round every corner');
	assert.equal(lapBrain.memory.dir, 1);
	const open = samplePath({
		points: [
			{ x: 100, y: 100 },
			{ x: 300, y: 100 },
		],
	});
	const pp = runBehaviour(S('p', 'patrol', { path: 'o', speed: 200 }), {
		self: box('s', 100, 100, 10, 10),
		paths: { o: open },
		steps: 120,
	});
	assert.ok(near(pp.self.x, 100, 1e-6), 'there and back in 2 s');
	const oneWay = runBehaviour(S('p', 'patrol', { path: 'o', speed: 200, pingPong: false }), {
		self: box('s', 100, 100, 10, 10),
		paths: { o: open },
		steps: 90,
	});
	assert.equal(oneWay.brain.memory.mode, 'loop');
	assert.ok(oneWay.self.x < 300 && oneWay.brain.memory.dir === 1, 'walks back as a loop');
	const lost = runBehaviour(S('p', 'patrol', { path: 'missing' }), {
		self: box('s', 100, 100, 10, 10),
		steps: 5,
	});
	assert.deepEqual([lost.self.x, lost.self.y], [100, 100], 'a missing path stands still');
});

check('behaviour followPath: from the start, once to the end and stops; closed runs on', () => {
	const open = samplePath({ points: L_PATH.map((p) => ({ x: p.x + 200, y: p.y + 200 })) });
	const run = runBehaviour(S('f', 'followPath', { path: 'o', speed: 150 }), {
		self: box('s', 150, 150, 10, 10),
		paths: { o: open },
		steps: 180,
	});
	assert.deepEqual(
		[run.self.x, run.self.y].map((n) => Math.round(n * 1e6) / 1e6),
		[300, 250],
	);
	assert.equal(run.brain.memory.done, true);
	assert.ok(run.vs.at(-1).vx === 0 && run.vs.at(-1).vy === 0);
	for (const v of run.vs) assert.ok(speedOf(v) <= 150 + 1e-9);
	const loop = samplePath({ points: L_PATH, closed: true });
	const round = runBehaviour(S('f', 'followPath', { path: 'l', speed: 150 }), {
		self: box('s', 0, 0, 10, 10),
		paths: { l: loop },
		steps: 600,
	});
	assert.notEqual(round.brain.memory.done, true);
	assert.ok(speedOf(round.vs.at(-1)) > 149);
});

check(
	'behaviour chase: towards the nearest tagged body in range, arriving, not overshooting',
	() => {
		const prey = box('p', 300, 100, 10, 10, { tags: ['player'] });
		const run = runBehaviour(S('c', 'chase', { range: 250, speed: 240 }), {
			self: box('s', 100, 100, 10, 10),
			others: [prey],
			steps: 60,
		});
		assert.deepEqual([run.self.x, run.self.y], [300, 100]);
		for (const v of run.vs) assert.ok(speedOf(v) <= 240 + 1e-9);
		const far = runBehaviour(S('c', 'chase', { range: 150 }), {
			self: box('s', 100, 100, 10, 10),
			others: [box('p', 300, 100, 10, 10, { tags: ['player'] })],
			steps: 10,
		});
		assert.equal(far.self.x, 100, 'out of range: still');
	},
);

check('behaviour flee: away from the nearest tagged body in range, until out of range', () => {
	const run = runBehaviour(S('f', 'flee', { range: 150, speed: 180 }), {
		self: box('s', 400, 300, 10, 10),
		others: [box('p', 300, 300, 10, 10, { tags: ['player'] })],
		steps: 60,
	});
	assert.ok(run.self.x > 450 && run.self.x <= 450 + 180 * DT + 1e-9);
	assert.equal(run.self.y, 300);
	assert.ok(near(run.vs[0].vx, 180) && run.vs.at(-1).vx === 0);
});

check('behaviour keepDistance: closes in, backs off, settles at the distance', () => {
	for (const start of [700, 320]) {
		const run = runBehaviour(S('k', 'keepDistance', { distance: 200, speed: 300 }), {
			self: box('s', start, 300, 10, 10),
			others: [box('p', 100, 300, 10, 10, { tags: ['player'] })],
			steps: 120,
		});
		assert.ok(near(run.self.x, 300, 1e-6), `from ${start}`);
		assert.ok(run.vs[0].vx * (300 - start) > 0, 'the right way');
	}
});

check('behaviour hover: a sine bob round where it entered, on its axis', () => {
	const run = runBehaviour(S('h', 'hover', { amplitude: 20, period: 1000 }), {
		self: box('s', 200, 200, 10, 10),
		steps: 60,
	});
	assert.equal(run.self.x, 200);
	assert.ok(near(run.self.y, 200, 1e-6), 'a whole period ends where it began');
	const quarter = runBehaviour(S('h', 'hover', { amplitude: 20, period: 1000, axis: 'x' }), {
		self: box('s', 200, 200, 10, 10),
		steps: 15,
	});
	assert.ok(near(quarter.self.x, 220, 1e-6) && quarter.self.y === 200);
});

check('behaviour shootAt: still; a shot every `every` ms at a target in range', () => {
	const params = { component: 'bullet', layer: 'shots', every: 500, speed: 400, range: 300 };
	const target = box('p', 300, 200, 10, 10, { tags: ['player'] });
	const run = runBehaviour(S('s', 'shootAt', params), {
		self: box('s', 100, 200, 10, 10),
		others: [target],
		steps: 90,
	});
	assert.ok(run.vs.every((v) => v.vx === 0 && v.vy === 0));
	assert.deepEqual(
		run.spawns.map((s) => s.step),
		[1, 31, 61],
	);
	assert.deepEqual(run.spawns[0], {
		step: 1,
		component: 'bullet',
		layer: 'shots',
		x: 100,
		y: 200,
		vx: 400,
		vy: 0,
	});
	const outOfRange = runBehaviour(S('s', 'shootAt', { ...params, range: 100 }), {
		self: box('s', 100, 200, 10, 10),
		others: [target],
		steps: 60,
	});
	assert.equal(outOfRange.spawns.length, 0);
	const unarmed = runBehaviour(S('s', 'shootAt', { every: 100 }), {
		self: box('s', 100, 200, 10, 10),
		others: [target],
		steps: 60,
	});
	assert.equal(unarmed.spawns.length, 0, 'no component / layer: no shot');
});

check('behaviours never move the body themselves', () => {
	for (const behaviour of BEHAVIOURS) {
		const self = box('s', 150, 150, 10, 10);
		const brain = brainOf(
			{
				initial: 'x',
				states: [S('x', behaviour, { path: 'p', component: 'c', layer: 'l' })],
				transitions: [],
			},
			'still',
			self,
		);
		const world = createBrainWorld({
			self,
			bodies: [self, box('p', 200, 150, 10, 10, { tags: ['player'] })],
			paths: { p: samplePath({ points: L_PATH }) },
		});
		for (let i = 0; i < 10; i++) {
			stepBrain(brain, world, DT);
			brainVelocity(brain, self, world, DT);
		}
		assert.deepEqual([self.x, self.y, self.vx, self.vy], [150, 150, 0, 0], behaviour);
	}
});

// --- the replay -------------------------------------------------------------------------------

const PATROL_PATH = {
	points: [
		{ x: 80, y: 80 },
		{ x: 380, y: 60 },
		{ x: 420, y: 220 },
		{ x: 120, y: 260 },
	],
	closed: true,
	smoothing: 0.6,
};

/** Every behaviour and condition kind at work: a scripted player among six characters. */
function scene(seed, steps = 900) {
	const rng = createRng(seed);
	const paths = {
		ring: samplePath(PATROL_PATH),
		run: samplePath({
			points: [
				{ x: 600, y: 80 },
				{ x: 760, y: 200 },
				{ x: 600, y: 360 },
			],
		}),
	};
	const solids = [
		box('wallA', 520, 300, 20, 260, { solid: true, tags: ['wall'] }),
		box('wallB', 300, 470, 300, 20, { solid: true, tags: ['wall'] }),
	];
	const player = box('player', 400, 400, 24, 24, { tags: ['player'] });
	const characters = [
		{
			body: box('guard', 120, 260, 20, 20, { tags: ['enemy'] }),
			movement: { accel: 900, decel: 1400, maxSpeed: 220, turnRate: 540 },
			spec: {
				initial: 'patrol',
				states: [
					S('patrol', 'patrol', { path: 'ring', speed: 110 }),
					S('chase', 'chase', { range: 260, speed: 200 }),
					S('rest', 'idle'),
				],
				transitions: [
					T('spot', 'patrol', 'chase', [{ kind: 'targetWithin', tag: 'player', px: 160 }]),
					T('lose', 'chase', 'patrol', [{ kind: 'targetBeyond', tag: 'player', px: 260 }]),
					T('caught', 'chase', 'rest', [{ kind: 'touching', tag: 'player' }]),
					T('bump', 'chase', 'rest', [{ kind: 'hitSolid' }]),
					T('wake', 'rest', 'patrol', [{ kind: 'timer', ms: 700 }]),
				],
			},
		},
		{
			body: box('fish', 650, 520, 16, 16, { tags: ['fish'] }),
			movement: { accel: 600 },
			spec: {
				initial: 'wander',
				states: [
					S('wander', 'wander', { speed: 120, turnEvery: 400 }),
					S('flee', 'flee', { range: 180, speed: 240 }),
				],
				transitions: [
					T('scared', 'wander', 'flee', [{ kind: 'targetWithin', tag: 'player', px: 120 }]),
					T('calm', 'flee', 'wander', [
						{ kind: 'targetBeyond', tag: 'player', px: 180 },
						{ kind: 'random', chance: 0.5, every: 300 },
					]),
				],
			},
		},
		{
			body: box('turret', 700, 450, 30, 30, { tags: ['enemy'] }),
			spec: {
				initial: 'aim',
				states: [
					S('aim', 'shootAt', {
						component: 'bolt',
						layer: 'shots',
						every: 600,
						speed: 350,
						range: 500,
					}),
					S('cool', 'hover', { amplitude: 6, period: 400, axis: 'x' }),
				],
				transitions: [
					T('overheat', 'aim', 'cool', [{ kind: 'timer', ms: 2000 }]),
					T('ready', 'cool', 'aim', [{ kind: 'variable', id: 'heat', op: '<', value: 3 }]),
				],
			},
		},
		{
			body: box('drone', 600, 80, 14, 14, { tags: ['enemy'] }),
			movement: { maxSpeed: 180 },
			spec: {
				initial: 'run',
				states: [
					S('run', 'followPath', { path: 'run', speed: 160 }),
					S('hold', 'keepDistance', { distance: 150, speed: 140 }),
				],
				transitions: [
					T('done', 'run', 'hold', [{ kind: 'timer', ms: 2600 }]),
					T('reset', '*', 'run', [{ kind: 'variable', id: 'alarm', op: '==', value: true }]),
				],
			},
		},
		{
			body: box('sentry', 250, 150, 18, 18, { tags: ['enemy'] }),
			spec: {
				initial: 'walk',
				states: [
					S('walk', 'patrol', { dx: 140, dy: 40, speed: 90 }),
					S('bob', 'hover', { amplitude: 10, period: 900 }),
				],
				transitions: [
					T('rnd', 'walk', 'bob', [{ kind: 'random', chance: 0.25 }]),
					T('back', 'bob', 'walk', [{ kind: 'random', chance: 0.4, every: 500 }]),
				],
			},
		},
	];
	const brains = characters.map((c, i) =>
		createBrain(c.spec, { rng: createRng(`${seed}:${i}`), at: c.body }),
	);
	const bodies = [player, ...solids, ...characters.map((c) => c.body)];
	const hits = characters.map(() => false);
	const vars = { heat: 0, alarm: false };
	const trace = [];
	const input = { held: () => false, pointer: () => undefined };
	const controller = { kind: 'topDown', speed: 170 };
	let heldNow = [];
	input.held = (action) => heldNow.includes(action);
	for (let n = 1; n <= steps; n++) {
		if (n % 45 === 1) {
			const dirs = [[], ['left'], ['right'], ['up'], ['down'], ['left', 'up'], ['right', 'down']];
			heldNow = dirs[Math.floor(rng() * dirs.length)];
		}
		vars.alarm = n >= 700 && n < 705;
		vars.heat = (Math.floor(n / 100) * 7) % 5;
		steer(player, controllerVelocity(controller, input, player, undefined, DT), undefined, DT);
		stepSolid(player, DT, bodies, FIELD);
		characters.forEach((c, i) => {
			const world = createBrainWorld({
				self: c.body,
				bodies,
				hitSolid: hits[i],
				paths,
				variable: (id) => vars[id],
			});
			const change = stepBrain(brains[i], world, DT);
			if (change) trace.push({ step: n, id: c.body.id, ...change });
			const v = brainVelocity(brains[i], c.body, world, DT);
			if (v.spawn) trace.push({ step: n, id: c.body.id, spawn: v.spawn });
			steer(c.body, v, c.movement, DT);
			const hit = stepSolid(c.body, DT, bodies, FIELD);
			hits[i] = hit.hitX || hit.hitY;
		});
		if (n % 60 === 0)
			trace.push({
				step: n,
				at: bodies
					.filter((b) => !b.solid)
					.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy })),
			});
	}
	return { steps, states: brains.map((b) => b.state), trace };
}

check('replay: the scene is bit-identical run to run, and differs under another seed', () => {
	const a = scene('characters');
	assert.deepEqual(scene('characters'), a);
	assert.notDeepEqual(scene('other-seed').trace, a.trace);
});

check('replay: the scene matches the committed fixture and covers every kind', () => {
	const run = scene('characters');
	if (UPDATE) {
		writeFileSync(REPLAY_FIXTURE, `${JSON.stringify(run, null, '\t')}\n`);
		console.log(`wrote ${REPLAY_FIXTURE}`);
	} else assert.deepEqual(run, JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8')));
	const fired = new Set(run.trace.filter((t) => t.to).map((t) => `${t.id}:${t.from}>${t.to}`));
	for (const edge of [
		'guard:patrol>chase',
		'guard:rest>patrol',
		'fish:wander>flee',
		'fish:flee>wander',
		'turret:aim>cool',
		'turret:cool>aim',
		'drone:run>hold',
		'drone:hold>run',
		'sentry:walk>bob',
		'sentry:bob>walk',
	])
		assert.ok(fired.has(edge), `the replay fires ${edge}`);
	assert.ok(
		fired.has('guard:chase>patrol') || fired.has('guard:chase>rest'),
		'the guard leaves the chase',
	);
	assert.ok(
		run.trace.some((t) => t.spawn?.component === 'bolt'),
		'the turret shoots',
	);
});

console.log(`check:arcade-characters — ${passed} checks passed`);
