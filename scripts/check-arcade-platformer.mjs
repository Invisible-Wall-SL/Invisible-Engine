// Arcade gravity, jumps and levels, the mechanics half (packages/engine-mechanics/src/jumps.js and
// the P10.13 additions to motion.js; docs/design/game-families.md §4.4): a jump's height and time to
// the apex match its settings at every fixed rate; hold to jump higher; coyote time and the jump
// buffer, each just inside and just outside its window; one-way platforms (from above only, while
// falling); no tunnelling at maxFall through a thin tile or platform; tile solidity (none / solid /
// oneWay); grounded and onWall; the hop and the flap; with no gravity and nothing one-way the
// platform step lands where the P10.11 solid step does; and a scripted run replays bit-identically
// against packages/engine-mechanics/fixtures/arcade-platformer-replay.json. The launcher half (the
// loop, the tilemap node, the sample, shipping) is apps/launcher-api's check:arcade-platformer.
//
// Run: pnpm check:arcade-platformer            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { controllerVelocity, JUMP_ACTION } from '../packages/engine-mechanics/src/behaviours.js';
import {
	createJumpState,
	DEFAULT_BUFFER_MS,
	DEFAULT_COYOTE_MS,
	jumpProfile,
	stepFlap,
	stepHop,
	stepJump,
} from '../packages/engine-mechanics/src/jumps.js';
import {
	MAX_SUB_STEPS,
	stepPlatform,
	stepSolid,
	TILE_NONE,
	TILE_ONE_WAY,
	TILE_SOLID,
	TILE_SOLIDITY,
	tilesIn,
} from '../packages/engine-mechanics/src/motion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_FIXTURE = join(
	ROOT,
	'packages/engine-mechanics/fixtures/arcade-platformer-replay.json',
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
	x,
	y,
	w,
	h,
	vx: 0,
	vy: 0,
	tags: [],
	...extra,
});

/** A grid of `cols × rows` tiles of `size` px from (0, 0), every cell `none` but those listed. */
const grid = (cols, rows, size, set = {}) => {
	const cells = new Uint8Array(cols * rows);
	for (const [key, code] of Object.entries(set)) {
		const [c, r] = key.split(',').map(Number);
		cells[r * cols + c] = code;
	}
	return { x: 0, y: 0, tileW: size, tileH: size, cols, rows, cells };
};

/** A floor row of solid tiles at `row`. */
const floor = (cols, rows, size, row, code = TILE_SOLID) => {
	const set = {};
	for (let c = 0; c < cols; c++) set[`${c},${row}`] = code;
	return grid(cols, rows, size, set);
};

const near = (a, b, tol, label) =>
	assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} is not within ${tol} of ${b}`);

/**
 * Run a side-view character the way the loop does: the jump decides (with the last move's grounded),
 * then the platform step falls by the pull it returned. `press(step)` says whether jump is held.
 */
function runJump({ jump, hz = 60, steps, press, body, tiles, fallGravity, maxFall, vx = 0 }) {
	const dt = 1 / hz;
	const state = createJumpState();
	let grounded = false;
	const trace = [];
	for (let i = 0; i < steps; i++) {
		body.vx = vx;
		const { gravity, jumped } = stepJump(jump, state, body, {
			pressed: press(i),
			grounded,
			dt,
			fallGravity,
		});
		const hit = stepPlatform(body, dt, { tiles, gravity, maxFall });
		grounded = hit.grounded;
		trace.push({ i, t: (i + 1) * dt, x: body.x, y: body.y, vy: body.vy, grounded, jumped });
	}
	return trace;
}

/** A body 32 × 32 resting on a floor whose top is at y = 320 (tile row 5 of 64 px). */
const standing = (x = 96) => box('hero', x, 320 - 16, 32, 32);
const FLOOR = floor(20, 8, 64, 5);

console.log('1. a jump is set by its height and its time');
check('the profile: launch 2h/t, pull 2h/t², the tap cut from minHeight', () => {
	const p = jumpProfile({ height: 128, time: 0.4, minHeight: 32 });
	near(p.launch, 640, 1e-9, 'launch');
	near(p.gravity, 1600, 1e-9, 'pull');
	near(p.cut, Math.sqrt(2 * 1600 * 32), 1e-9, 'cut');
	assert.deepEqual(jumpProfile({ height: 0, time: 0.4 }), { launch: 0, gravity: 0, cut: 0 });
});
for (const hz of [30, 60, 120, 144]) {
	check(`a held jump tops out at its height, at its time (${hz} Hz)`, () => {
		const jump = { kind: 'gravity', height: 128, time: 0.4 };
		const body = standing();
		const ground = body.y;
		const trace = runJump({ jump, hz, steps: hz, press: (i) => i >= 2, body, tiles: [FLOOR] });
		const launch = trace.findIndex((s) => s.jumped);
		assert.ok(launch >= 0, 'it jumped');
		const apex = trace.reduce((best, s) => (s.y < best.y ? s : best));
		const rise = ground - apex.y;
		near(rise, 128, 0.5, 'height');
		near(apex.t - trace[launch].t + 1 / hz, 0.4, 1 / hz, 'time to the apex');
		const landed = trace.findIndex((s, k) => k > launch && s.grounded);
		assert.ok(landed > launch, 'it lands');
		near(trace[landed].y, ground, 1e-9, 'it lands where it left');
		near(trace[landed].t - trace[launch].t, 0.8, 2 / hz, 'up and down in twice the time');
	});
}
check('hold to jump higher: a tap reaches about minHeight, a hold the full height', () => {
	const jump = { kind: 'gravity', height: 128, time: 0.4, minHeight: 32 };
	const tap = standing();
	const ground = tap.y;
	const tapped = runJump({ jump, steps: 60, press: (i) => i === 2, body: tap, tiles: [FLOOR] });
	const tapRise = ground - Math.min(...tapped.map((s) => s.y));
	near(tapRise, 32, 640 / 60 + 1, 'a tap');
	const hold = standing();
	const held = runJump({ jump, steps: 60, press: (i) => i >= 2, body: hold, tiles: [FLOOR] });
	near(ground - Math.min(...held.map((s) => s.y)), 128, 0.5, 'a hold');
	const mid = standing();
	const half = runJump({
		jump,
		steps: 60,
		press: (i) => i >= 2 && i < 10,
		body: mid,
		tiles: [FLOOR],
	});
	const midRise = ground - Math.min(...half.map((s) => s.y));
	assert.ok(midRise > tapRise + 8 && midRise < 128 - 8, `a part hold goes between (${midRise})`);
});
check('the fall pull: movement.gravity pulls a falling jumper down faster than it rose', () => {
	const jump = { kind: 'gravity', height: 128, time: 0.4 };
	const body = standing();
	const trace = runJump({
		jump,
		steps: 60,
		press: (i) => i >= 2,
		body,
		tiles: [FLOOR],
		fallGravity: 3200,
	});
	const launch = trace.findIndex((s) => s.jumped);
	const landed = trace.findIndex((s, k) => k > launch && s.grounded);
	near(Math.min(...trace.map((s) => s.y)), body.y - 128, 0.5, 'the rise is the jump’s');
	assert.ok(trace[landed].t - trace[launch].t < 0.4 + 0.4 / Math.SQRT2 + 2 / 60, 'falls faster');
});
check('no ground, no jump: a press in mid-air (beyond coyote time) does nothing', () => {
	const body = box('hero', 96, 40, 32, 32);
	const trace = runJump({
		jump: { kind: 'gravity', height: 128, time: 0.4 },
		steps: 20,
		press: (i) => i >= 12,
		body,
		tiles: [FLOOR],
		fallGravity: 1600,
	});
	assert.ok(!trace.some((s) => s.jumped));
});

console.log('2. coyote time and the jump buffer');
/** Run off a ledge at x = 128 and press `afterMs` after the first step with no ground below. */
function coyote(afterMs, coyoteMs) {
	const ledge = grid(20, 8, 64, { '0,5': TILE_SOLID, '1,5': TILE_SOLID });
	const jump = {
		kind: 'gravity',
		height: 128,
		time: 0.4,
		...(coyoteMs === undefined ? {} : { coyoteMs }),
	};
	const body = standing(96);
	const state = createJumpState();
	const dt = 1 / 60;
	let grounded = false;
	let leftAt = -1;
	let pressAt = Infinity;
	for (let i = 0; i < 90; i++) {
		body.vx = 240;
		const pressed = i >= pressAt && i < pressAt + 4;
		const { gravity, jumped } = stepJump(jump, state, body, { pressed, grounded, dt });
		if (jumped) return { jumped: true, at: (i - leftAt) * dt * 1000 };
		const hit = stepPlatform(body, dt, { tiles: [ledge], gravity });
		if (grounded && !hit.grounded && leftAt < 0) {
			leftAt = i;
			pressAt = i + Math.round(afterMs / (dt * 1000));
		}
		grounded = hit.grounded;
	}
	return { jumped: false };
}
check(
	`a press ${Math.round(DEFAULT_COYOTE_MS * 0.8)} ms after the ledge still jumps (default ${DEFAULT_COYOTE_MS} ms)`,
	() => {
		assert.ok(coyote(DEFAULT_COYOTE_MS * 0.8).jumped);
	},
);
check(`a press ${Math.round(DEFAULT_COYOTE_MS * 1.5)} ms after the ledge does not`, () => {
	assert.ok(!coyote(DEFAULT_COYOTE_MS * 1.5).jumped);
});
check('coyoteMs is the window: 200 ms lets 150 ms through; 0 refuses the first step off', () => {
	assert.ok(coyote(150, 200).jumped);
	assert.ok(!coyote(0, 0).jumped);
});
/** Drop onto the floor and press `beforeMs` before the step it lands on. */
function buffered(beforeMs, bufferMs) {
	const jump = {
		kind: 'gravity',
		height: 128,
		time: 0.4,
		...(bufferMs === undefined ? {} : { bufferMs }),
	};
	const dt = 1 / 60;
	const probe = box('hero', 96, 100, 32, 32);
	const probeTrace = runJump({
		jump,
		steps: 90,
		press: () => false,
		body: probe,
		tiles: [FLOOR],
		fallGravity: 1600,
	});
	const land = probeTrace.findIndex((s) => s.grounded);
	const pressAt = land - Math.round(beforeMs / (dt * 1000));
	const body = box('hero', 96, 100, 32, 32);
	const trace = runJump({
		jump,
		steps: 90,
		press: (i) => i >= pressAt && i < pressAt + 2,
		body,
		tiles: [FLOOR],
		fallGravity: 1600,
	});
	const jumpedAt = trace.findIndex((s) => s.jumped);
	return { jumped: jumpedAt >= 0, onLanding: jumpedAt === land + 1 };
}
check(
	`a press ${Math.round(DEFAULT_BUFFER_MS * 0.8)} ms before landing jumps on landing (default ${DEFAULT_BUFFER_MS} ms)`,
	() => {
		const r = buffered(DEFAULT_BUFFER_MS * 0.8);
		assert.ok(r.jumped && r.onLanding, JSON.stringify(r));
	},
);
check(`a press ${Math.round(DEFAULT_BUFFER_MS * 1.5)} ms before landing is forgotten`, () => {
	assert.ok(!buffered(DEFAULT_BUFFER_MS * 1.5).jumped);
});
check('bufferMs is the window: 250 ms keeps a 200 ms early press', () => {
	assert.ok(buffered(200, 250).jumped);
});
check('a held press jumps once; it must be let go and pressed again', () => {
	const body = standing();
	const trace = runJump({
		jump: { kind: 'gravity', height: 64, time: 0.25 },
		steps: 120,
		press: () => true,
		body,
		tiles: [FLOOR],
	});
	assert.equal(trace.filter((s) => s.jumped).length, 1);
});

console.log('3. one-way platforms');
const PLATFORM = grid(20, 8, 64, { '1,3': TILE_ONE_WAY, '2,3': TILE_ONE_WAY });
check('a jump from below passes up through a one-way tile and lands on it', () => {
	const body = standing(128 + 16);
	const trace = runJump({
		jump: { kind: 'gravity', height: 160, time: 0.45 },
		steps: 90,
		press: (i) => i >= 1,
		body,
		tiles: [FLOOR, PLATFORM],
	});
	const top = 3 * 64;
	assert.ok(Math.min(...trace.map((s) => s.y)) < top - 16, 'it rose above the platform');
	const last = trace[trace.length - 1];
	near(last.y, top - 16, 1e-9, 'it stands on the platform');
	assert.ok(last.grounded);
});
check('falling onto a one-way tile from above stops; walking across it does not stop', () => {
	const fallBody = box('a', 160, 64, 32, 32);
	const hit = Array.from({ length: 40 }, () =>
		stepPlatform(fallBody, 1 / 60, { tiles: [PLATFORM], gravity: 2000 }),
	);
	near(fallBody.y, 3 * 64 - 16, 1e-9, 'lands');
	assert.ok(hit.at(-1).grounded);
	const walker = box('b', 40, 3 * 64 + 16, 32, 32, { vx: 600 });
	for (let i = 0; i < 20; i++) stepPlatform(walker, 1 / 60, { tiles: [PLATFORM] });
	assert.ok(walker.x > 3 * 64 + 16, 'walked through it sideways');
});
check('a body already below a platform’s top is not snapped up onto it', () => {
	const body = box('c', 160, 3 * 64 + 10, 32, 32, { vy: 200 });
	const hit = stepPlatform(body, 1 / 60, { tiles: [PLATFORM], gravity: 2000 });
	assert.ok(!hit.grounded && body.y > 3 * 64 + 10);
});
check('a one-way BODY works as a one-way tile does; a solid body wins over its oneWay flag', () => {
	const ledge = box('ledge', 200, 300, 200, 8, { oneWay: true });
	const faller = box('f', 200, 200, 20, 20);
	for (let i = 0; i < 60; i++) stepPlatform(faller, 1 / 60, { solids: [ledge], gravity: 2000 });
	near(faller.y, 296 - 10, 1e-9, 'lands on the body');
	const riser = box('r', 200, 340, 20, 20, { vy: -600 });
	for (let i = 0; i < 8; i++) stepPlatform(riser, 1 / 60, { solids: [ledge] });
	assert.ok(riser.y < 280, 'rises through it');
	const both = box('both', 200, 300, 200, 8, { oneWay: true, solid: true });
	const bumped = box('b', 200, 340, 20, 20, { vy: -600 });
	for (let i = 0; i < 8; i++) stepPlatform(bumped, 1 / 60, { solids: [both] });
	near(bumped.y, 314, 1e-9, 'a solid one stops it from below');
});

console.log('4. no tunnelling at maxFall');
for (const [label, tiles, solids, top] of [
	['a 64 px solid tile', [floor(8, 40, 64, 30)], [], 30 * 64],
	[
		'an 8 px tile row',
		[
			{
				x: 0,
				y: 0,
				tileW: 64,
				tileH: 8,
				cols: 8,
				rows: 400,
				cells: (() => {
					const c = new Uint8Array(8 * 400);
					c.fill(TILE_SOLID, 300 * 8, 301 * 8);
					return c;
				})(),
			},
		],
		[],
		300 * 8,
	],
	['a 4 px one-way body', [], [box('thin', 256, 2002, 512, 4, { oneWay: true })], 2000],
	['a 2 px solid body', [], [box('wire', 256, 2001, 512, 2, { solid: true })], 2000],
]) {
	for (const size of [32, 6]) {
		check(`a ${size} px body falling at maxFall 6000 px/s lands on ${label}`, () => {
			const body = box('fast', 128, 40, size, size, { vy: 6000 });
			let grounded = false;
			for (let i = 0; i < 120 && !grounded; i++)
				grounded = stepPlatform(body, 1 / 60, {
					tiles,
					solids,
					gravity: 4000,
					maxFall: 6000,
				}).grounded;
			assert.ok(grounded, 'it landed');
			near(body.y, top - size / 2, 1e-9, 'on top');
			assert.equal(body.vy, 0);
		});
	}
}
check('maxFall caps the fall; the cap is reached exactly (no overshoot)', () => {
	const body = box('cap', 0, 0, 10, 10);
	for (let i = 0; i < 120; i++) stepPlatform(body, 1 / 60, { gravity: 2000, maxFall: 900 });
	assert.equal(body.vy, 900);
});
check(`sub-steps are bounded (${MAX_SUB_STEPS})`, () => {
	assert.equal(MAX_SUB_STEPS, 64);
});

console.log('5. tile solidity, grounded and onWall');
check('the codes and their names', () => {
	assert.deepEqual([TILE_NONE, TILE_SOLID, TILE_ONE_WAY], [0, 1, 2]);
	assert.deepEqual(TILE_SOLIDITY, ['none', 'solid', 'oneWay']);
});
check('tilesIn returns the colliding tiles a box touches, row-major, and skips none', () => {
	const g = grid(4, 4, 10, {
		'1,1': TILE_SOLID,
		'2,1': TILE_ONE_WAY,
		'1,2': TILE_NONE,
		'3,3': TILE_SOLID,
	});
	const found = tilesIn(g, { x0: 5, y0: 5, x1: 25, y1: 25 });
	assert.deepEqual(
		found.map((t) => [t.id, t.solid === true, t.oneWay === true]),
		[
			['tile:1,1', true, false],
			['tile:2,1', false, true],
		],
	);
	assert.deepEqual(tilesIn(g, { x0: -100, y0: -100, x1: -50, y1: -50 }), []);
});
check('a `none` tile is passed through', () => {
	const g = grid(4, 10, 64, { '1,5': TILE_NONE });
	const body = box('p', 96, 200, 32, 32);
	for (let i = 0; i < 30; i++) stepPlatform(body, 1 / 60, { tiles: [g], gravity: 2000 });
	assert.ok(body.y > 6 * 64);
});
check('a solid tile wall stops a runner (onWall) and a ceiling stops a jump (vy 0)', () => {
	const g = grid(10, 10, 64, { '4,4': TILE_SOLID, '2,1': TILE_SOLID });
	const runner = box('r', 160, 4 * 64 + 32, 32, 32, { vx: 400 });
	let wall = false;
	for (let i = 0; i < 30; i++) wall = stepPlatform(runner, 1 / 60, { tiles: [g] }).onWall || wall;
	assert.ok(wall, 'onWall');
	near(runner.x, 4 * 64 - 16, 1e-9, 'stopped at the wall');
	const jumper = box('j', 2 * 64 + 32, 2 * 64 + 40, 32, 32, { vy: -600 });
	let top = Infinity;
	let bumped = false;
	for (let i = 0; i < 8; i++) {
		const hit = stepPlatform(jumper, 1 / 60, { tiles: [g], gravity: 1000 });
		top = Math.min(top, jumper.y);
		if (hit.hitY && !hit.grounded) bumped = jumper.vy === 0;
	}
	near(top, 2 * 64 + 16, 1e-9, 'stopped under the ceiling');
	assert.ok(bumped, 'the bump zeroes vy');
});
check('grounded: on every step while resting; not while rising or falling', () => {
	const body = standing();
	const rest = Array.from({ length: 5 }, () =>
		stepPlatform(body, 1 / 60, { tiles: [FLOOR], gravity: 1600 }),
	);
	assert.ok(rest.every((h) => h.grounded));
	body.vy = -500;
	assert.ok(!stepPlatform(body, 1 / 60, { tiles: [FLOOR], gravity: 1600 }).grounded);
});
check('the field: its floor grounds a clamped body; a pass body falls out', () => {
	const body = box('c', 50, 50, 20, 20);
	let grounded = false;
	for (let i = 0; i < 60; i++)
		grounded = stepPlatform(body, 1 / 60, { gravity: 2000, field: { w: 100, h: 100 } }).grounded;
	assert.ok(grounded);
	near(body.y, 90, 1e-9, 'held on the floor');
	const gone = box('p', 50, 50, 20, 20, { edges: 'pass' });
	for (let i = 0; i < 60; i++)
		stepPlatform(gone, 1 / 60, { gravity: 2000, field: { w: 100, h: 100 } });
	assert.ok(gone.y > 100);
});
check('with no gravity and nothing one-way it lands where stepSolid does', () => {
	const walls = [
		box('w1', 200, 100, 40, 200, { solid: true }),
		box('w2', 100, 260, 300, 20, { solid: true }),
	];
	for (const [vx, vy] of [
		[300, 0],
		[300, 300],
		[-120, 500],
		[60, -40],
		[900, 900],
	]) {
		const a = box('a', 120, 120, 24, 24, { vx, vy });
		const b = box('b', 120, 120, 24, 24, { vx, vy });
		for (let i = 0; i < 40; i++) {
			stepSolid(a, 1 / 60, walls, { w: 400, h: 400 });
			stepPlatform(b, 1 / 60, { solids: walls, field: { w: 400, h: 400 } });
		}
		near(b.x, a.x, 1e-6, `x for (${vx}, ${vy})`);
		near(b.y, a.y, 1e-6, `y for (${vx}, ${vy})`);
	}
});

check(
	'a body spawned inside a block of solid tiles is moved out the shortest way, and stays out',
	() => {
		const block = grid(
			10,
			10,
			32,
			Object.fromEntries([1, 2, 3].flatMap((c) => [1, 2, 3].map((r) => [`${c},${r}`, TILE_SOLID]))),
		);
		const body = box('trapped', 80, 80, 20, 20);
		const first = stepPlatform(body, 1 / 60, { tiles: [block], gravity: 1000 });
		const inside = () =>
			tilesIn(block, {
				x0: body.x - 9.999,
				y0: body.y - 9.999,
				x1: body.x + 9.999,
				y1: body.y + 9.999,
			}).length;
		assert.equal(inside(), 0, `out of the block (${body.x}, ${body.y})`);
		assert.ok(first.hitX || first.hitY);
		for (let i = 0; i < 120; i++)
			stepPlatform(body, 1 / 60, { tiles: [block], gravity: 1000, field: { w: 320, h: 320 } });
		assert.equal(inside(), 0, `still out (${body.x}, ${body.y})`);
		const top = box('top', 80, 40, 20, 20);
		stepPlatform(top, 1 / 60, { tiles: [block] });
		near(top.y, 22, 1e-9, 'one just inside the top is lifted onto it');
	},
);

console.log('6. the hop and the flap');
check('a hop tops out at its height at its time, and lands back at z 0', () => {
	const hop = { kind: 'hop', height: 48, time: 0.3 };
	const state = createJumpState();
	const zs = [];
	let landedAt = -1;
	for (let i = 0; i < 60; i++) {
		const r = stepHop(hop, state, { pressed: i >= 1 && i < 30, dt: 1 / 60 });
		zs.push(state.z);
		if (r.landed && landedAt < 0) landedAt = i;
	}
	const top = Math.max(...zs);
	near(top, 48, 0.5, 'height');
	near((zs.indexOf(top) - 1 + 1) / 60, 0.3, 1 / 60, 'time');
	near((landedAt - 1 + 1) / 60, 0.6, 2 / 60, 'lands in twice the time');
	assert.equal(state.z, 0);
});
check('a hop is buffered, cut by an early release, and needs a fresh press', () => {
	const hop = { kind: 'hop', height: 48, time: 0.3, minHeight: 12 };
	const tap = createJumpState();
	const taps = [];
	for (let i = 0; i < 60; i++) {
		stepHop(hop, tap, { pressed: i === 1, dt: 1 / 60 });
		taps.push(tap.z);
	}
	near(Math.max(...taps), 12, 320 / 60 + 1, 'a tap');
	const held = createJumpState();
	let hops = 0;
	for (let i = 0; i < 120; i++)
		if (stepHop(hop, held, { pressed: true, dt: 1 / 60 }).jumped) hops += 1;
	assert.equal(hops, 1);
	const early = createJumpState();
	let again = 0;
	for (let i = 0; i < 60; i++) {
		if (stepHop(hop, early, { pressed: i === 1 || i === 33, dt: 1 / 60 }).jumped) again += 1;
	}
	assert.equal(again, 2, 'a press just before landing hops again on landing');
});
check('a flap kicks on each press, never while held', () => {
	const state = createJumpState();
	const body = box('bird', 0, 0, 10, 10, { vy: 300 });
	const kicks = [true, true, false, true].map((p) => stepFlap({ kick: 420 }, state, body, p));
	assert.deepEqual(kicks, [true, false, false, true]);
	assert.equal(body.vy, -420);
});
check('the flap controller runs across at its speed; the jump action is `jump`', () => {
	const input = { held: (a) => a === 'right', pointer: () => undefined };
	assert.deepEqual(
		controllerVelocity(
			{ kind: 'flap', kick: 400, speed: 150 },
			input,
			box('b', 0, 0, 1, 1),
			undefined,
			1 / 60,
		),
		{ vx: 150, vy: 0 },
	);
	assert.deepEqual(
		controllerVelocity({ kind: 'flap', kick: 400 }, input, box('b', 0, 0, 1, 1), undefined, 1 / 60),
		{ vx: 0, vy: 0 },
	);
	assert.equal(JUMP_ACTION, 'jump');
});

console.log('7. a scripted run replays');
function scripted() {
	const level = grid(24, 10, 32, {
		...Object.fromEntries(Array.from({ length: 24 }, (_, c) => [`${c},9`, TILE_SOLID])),
		'6,6': TILE_ONE_WAY,
		'7,6': TILE_ONE_WAY,
		'8,6': TILE_ONE_WAY,
		'12,8': TILE_SOLID,
		'12,7': TILE_SOLID,
		'16,5': TILE_ONE_WAY,
		'17,5': TILE_ONE_WAY,
	});
	const jump = { kind: 'gravity', height: 100, time: 0.35, minHeight: 30 };
	const body = box('hero', 40, 9 * 32 - 14, 20, 28);
	const state = createJumpState();
	let grounded = false;
	const trace = [];
	for (let i = 0; i < 600; i++) {
		const phase = Math.floor(i / 40) % 6;
		body.vx = phase === 3 ? -160 : 200;
		const pressed = i % 53 < (i % 3 === 0 ? 3 : 14);
		const { gravity } = stepJump(jump, state, body, {
			pressed,
			grounded,
			dt: 1 / 60,
			fallGravity: 2400,
		});
		const hit = stepPlatform(body, 1 / 60, {
			tiles: [level],
			gravity,
			maxFall: 1100,
			field: { w: 768, h: 320 },
		});
		grounded = hit.grounded;
		if (i % 10 === 0)
			trace.push([
				i,
				+body.x.toFixed(6),
				+body.y.toFixed(6),
				+body.vy.toFixed(6),
				grounded,
				hit.onWall,
			]);
	}
	return trace;
}
check('the same script twice gives the same numbers', () => {
	assert.deepEqual(scripted(), scripted());
});
check('it matches the committed trace', () => {
	const trace = scripted();
	if (UPDATE) writeFileSync(REPLAY_FIXTURE, JSON.stringify({ trace }, null, '\t') + '\n');
	const fixture = JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8'));
	assert.deepEqual(trace, fixture.trace);
	assert.ok(trace.some((s) => s[4]) && trace.some((s) => !s[4]), 'it both stood and flew');
	assert.ok(
		trace.some((s) => s[5]),
		'it ran into the wall',
	);
});

console.log(`check:arcade-platformer — ${passed} checks passed`);
