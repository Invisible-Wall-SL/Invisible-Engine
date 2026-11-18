// Arcade 3D motion (packages/engine-mechanics/src/motion3d.js; docs/design/3d-games.md Phase 0b,
// docs/design/3d/gameplay-evaluation.md §2): a jump reaches its height, the double jump only near
// the apex, a trampoline launches to its height, ramps are climbed and walked down, a 0.3 m step
// climbs and a 0.5 m one blocks, walls stop one axis and the other slides, ceilings stop a jump, a
// fall at maxFall never passes through a thin slab, a full stick is no faster on a diagonal, and the
// step uses no implementation-defined Math function (the cross-engine rule). Then the six-body,
// 12 000-step scenario (scripts/arcade-3d-scenario.mjs) replays bit-identically against
// packages/engine-mechanics/fixtures/arcade-3d-replay.json — the same hashes Chrome and iOS Safari
// must produce in the page `node scripts/arcade-3d-page.mjs` builds into the launcher's static files,
// which must be current.
//
// Run: pnpm check:arcade-3d            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	BUTTON_JUMP,
	collidersNear,
	createBody3d,
	createLevel3d,
	createTracker3d,
	hashBodies3d,
	MAX_CELL_COLLIDERS_3D,
	MAX_LEVEL_CELLS_3D,
	MAX_STEP_DT_3D,
	MAX_ZONES_3D,
	MIN_CELL_SIZE_3D,
	MOTION3D_DEFAULTS,
	MOVE_SCALE,
	stepBody3d,
	sweepFits3d,
	trackStep3d,
	zonesAt3d,
} from '../packages/engine-mechanics/src/motion3d.js';
import { ARCADE3D_PAGE, buildArcade3dPage } from './arcade-3d-page.mjs';
import { runScenario3d, SCENARIO3D } from './arcade-3d-scenario.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_FIXTURE = join(ROOT, 'packages/engine-mechanics/fixtures/arcade-3d-replay.json');
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

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
	kind: 'box',
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});
const FLOOR = box(-50, -1, -50, 50, 0, 50);
const idle = { mx: 0, mz: 0, yaw: 0, buttons: 0 };
const run = (body, level, steps, input = idle) => {
	const results = [];
	for (let i = 0; i < steps; i++)
		results.push(stepBody3d(body, typeof input === 'function' ? input(i) : input, level));
	return results;
};
const settle = (body, level) => run(body, level, 3);

console.log('1. the cross-engine rule');
check('motion3d.js and the scenario use no implementation-defined Math function', () => {
	for (const file of [
		'packages/engine-mechanics/src/motion3d.js',
		'scripts/arcade-3d-scenario.mjs',
	]) {
		const code = readFileSync(join(ROOT, file), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
		const found = code.match(
			/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt|random|fround)\b|\*\*/g,
		);
		assert.equal(found, null, `${file}: ${found}`);
	}
});

console.log('2. jumps');
check('a jump from the floor peaks at jumpHeight', () => {
	const level = createLevel3d({ colliders: [FLOOR] });
	const body = createBody3d();
	settle(body, level);
	let peak = 0;
	run(body, level, 120, (i) => {
		peak = Math.max(peak, body.y);
		return { ...idle, buttons: i === 0 ? BUTTON_JUMP : 0 };
	});
	assert.ok(Math.abs(peak - MOTION3D_DEFAULTS.jumpHeight) < 0.1, `peak ${peak}`);
	assert.equal(body.y, 0);
	assert.ok(body.grounded);
});
check('the double jump fires only within the apex window, once', () => {
	const level = createLevel3d({ colliders: [FLOOR] });
	const body = createBody3d();
	settle(body, level);
	const [launch] = run(body, level, 1, { ...idle, buttons: BUTTON_JUMP });
	assert.ok(launch.jumped);
	run(body, level, 1);
	assert.ok(body.vy >= MOTION3D_DEFAULTS.apexWindow);
	const [early] = run(body, level, 1, { ...idle, buttons: BUTTON_JUMP });
	assert.ok(!early.doubleJumped, 'too fast to double');
	while (body.vy >= MOTION3D_DEFAULTS.apexWindow - 0.5) run(body, level, 1);
	run(body, level, 1);
	const [apex] = run(body, level, 1, { ...idle, buttons: BUTTON_JUMP });
	assert.ok(apex.doubleJumped);
	run(body, level, 10);
	const [again] = run(body, level, 1, { ...idle, buttons: BUTTON_JUMP });
	assert.ok(!again.doubleJumped, 'one double jump per air time');
});
check('a press just before landing is buffered', () => {
	const level = createLevel3d({ colliders: [FLOOR] });
	const body = createBody3d({ y: 0.3 });
	body.vy = -MOTION3D_DEFAULTS.apexWindow - 1;
	const results = run(body, level, 10, (i) => ({ ...idle, buttons: i < 2 ? BUTTON_JUMP : 0 }));
	assert.ok(
		!results[0].grounded && !results[0].doubleJumped,
		'pressed in the air, outside the window',
	);
	assert.ok(results.some((r) => r.jumped));
});
check('a trampoline launches a standing body to its height', () => {
	const level = createLevel3d({
		colliders: [FLOOR],
		zones: [
			{
				kind: 'trampoline',
				minX: -1,
				minY: -0.1,
				minZ: -1,
				maxX: 1,
				maxY: 0.1,
				maxZ: 1,
				height: 5,
			},
		],
	});
	const body = createBody3d({ y: 0.5 });
	let peak = 0;
	const results = run(body, level, 30, () => {
		peak = Math.max(peak, body.y);
		return idle;
	});
	assert.ok(results.some((r) => r.bounced));
	run(body, level, 60, () => {
		peak = Math.max(peak, body.y);
		return idle;
	});
	assert.ok(Math.abs(peak - 5) < 0.15, `peak ${peak}`);
});

console.log('3. ramps, steps, walls, ceilings');
check('a ramp is climbed to its top and walked down again', () => {
	const level = createLevel3d({
		colliders: [
			FLOOR,
			{ kind: 'ramp', facing: '+x', minX: 0, minY: 0, minZ: -2, maxX: 8, maxY: 3, maxZ: 2 },
			box(8, 0, -2, 12, 3, 2),
		],
	});
	const body = createBody3d({ x: -2 });
	settle(body, level);
	const up = run(body, level, 150, { ...idle, mx: MOVE_SCALE });
	assert.equal(body.y, 3);
	assert.ok(up.some((r) => r.onRamp) && up.every((r) => !r.onWall));
	const down = run(body, level, 150, { ...idle, mx: -MOVE_SCALE });
	assert.equal(body.y, 0);
	assert.ok(down.filter((r) => r.grounded).length > 140, 'stays on the ramp going down');
});
check('a ramp side taller than stepUp is a wall', () => {
	const level = createLevel3d({
		colliders: [
			FLOOR,
			{ kind: 'ramp', facing: '+x', minX: 0, minY: 0, minZ: 0, maxX: 8, maxY: 3, maxZ: 4 },
		],
	});
	const body = createBody3d({ x: 6, z: -2 });
	settle(body, level);
	const results = run(body, level, 60, { ...idle, mz: MOVE_SCALE });
	assert.ok(results.some((r) => r.onWall));
	assert.ok(body.z < -0.4 + 1e-9 && body.z > -0.6);
});
check('a 0.3 m step climbs, a 0.5 m step blocks', () => {
	const level = createLevel3d({
		colliders: [FLOOR, box(2, 0, -5, 4, 0.3, 5), box(4, 0, -5, 6, 0.8, 5)],
	});
	const body = createBody3d();
	settle(body, level);
	const results = run(body, level, 120, { ...idle, mx: MOVE_SCALE });
	assert.ok(results.some((r) => r.steppedUp));
	assert.ok(body.x <= 4 - 0.4 && body.x > 3.4, `stopped at ${body.x}`);
	assert.equal(body.y, 0.3);
});
check('a wall stops one axis and the other slides', () => {
	const level = createLevel3d({ colliders: [FLOOR, box(2, 0, -50, 3, 4, 50)] });
	const body = createBody3d();
	settle(body, level);
	run(body, level, 120, { ...idle, mx: MOVE_SCALE, mz: MOVE_SCALE });
	assert.ok(body.x <= 2 - 0.4 && body.x > 1.4, `x ${body.x}`);
	assert.ok(body.z > 5, `slid to z ${body.z}`);
});
check('a ceiling stops a jump', () => {
	const level = createLevel3d({ colliders: [FLOOR, box(-2, 2.5, -2, 2, 3, 2)] });
	const body = createBody3d();
	settle(body, level);
	const results = run(body, level, 60, (i) => ({ ...idle, buttons: i === 0 ? BUTTON_JUMP : 0 }));
	assert.ok(results.some((r) => r.hitCeiling));
	assert.equal(body.y, 0);
});
check('a fall at maxFall lands on a 5 cm slab', () => {
	const level = createLevel3d({ colliders: [box(-2, 0, -2, 2, 0.05, 2)] });
	const body = createBody3d({ y: 60 });
	body.vy = -MOTION3D_DEFAULTS.maxFall;
	run(body, level, 200);
	assert.equal(body.y, 0.05);
});
check('a full diagonal stick is no faster than a full straight one', () => {
	const level = createLevel3d({ colliders: [FLOOR] });
	const body = createBody3d();
	settle(body, level);
	run(body, level, 60, { ...idle, mx: MOVE_SCALE, mz: MOVE_SCALE });
	const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
	assert.ok(Math.abs(speed - MOTION3D_DEFAULTS.speed) < 1e-9, `speed ${speed}`);
});
check('the death plane is reported, not handled', () => {
	const level = createLevel3d({ colliders: [], killY: -5 });
	const body = createBody3d();
	const results = run(body, level, 120);
	assert.ok(results.some((r) => r.fell));
});
check('zones and the death plane raise edge signals, once each way', () => {
	const pit = { kind: 'pit', minX: 4, minY: -1, minZ: -2, maxX: 6, maxY: 1, maxZ: 2 };
	const level = createLevel3d({ colliders: [FLOOR], zones: [pit], killY: -5 });
	const body = createBody3d();
	const tracker = createTracker3d();
	const signals = [];
	const step = (input) => {
		const result = stepBody3d(body, input, level);
		for (const s of trackStep3d(tracker, body, result, level))
			signals.push(s.type + (s.kind ?? ''));
	};
	for (let i = 0; i < 3; i++) step(idle);
	assert.deepEqual(signals, ['landed']);
	for (let i = 0; i < 150; i++) step({ ...idle, mx: MOVE_SCALE });
	assert.deepEqual(signals, ['landed', 'enterZonepit', 'leaveZonepit']);
	assert.deepEqual(zonesAt3d(createBody3d({ x: 5 }), level), [0]);
	assert.deepEqual(zonesAt3d(createBody3d({ x: 5, y: 1.01 }), level), []);
	assert.deepEqual(zonesAt3d(createBody3d({ x: 5, y: -2.8 }), level), [0], 'the head is in it');
	signals.length = 0;
	const faller = createBody3d({ x: 200 });
	const fallTracker = createTracker3d();
	let fell = 0;
	for (let i = 0; i < 200; i++) {
		const result = stepBody3d(faller, idle, level);
		for (const s of trackStep3d(fallTracker, faller, result, level))
			if (s.type === 'fell') fell += 1;
	}
	assert.equal(fell, 1, 'fell is an edge');
	Object.assign(faller, createBody3d({ x: 200 }));
	for (let i = 0; i < 200; i++) {
		const result = stepBody3d(faller, idle, level);
		for (const s of trackStep3d(fallTracker, faller, result, level))
			if (s.type === 'fell') fell += 1;
	}
	assert.equal(fell, 2, 'again after a respawn above the plane');
});
check('the hash sees one bit of one field', () => {
	const a = createBody3d({ x: 1 });
	const b = createBody3d({ x: 1 });
	assert.equal(hashBodies3d([a]), hashBodies3d([b]));
	b.vz = 5e-324;
	assert.notEqual(hashBodies3d([a]), hashBodies3d([b]));
});

console.log('4. a level that would freeze the room is refused');
const fast = (fn) => {
	const started = performance.now();
	fn();
	assert.ok(performance.now() - started < 100, `took ${performance.now() - started} ms`);
};
check('a collider spanning too many columns, or lying too far out, throws at once', () => {
	fast(() =>
		assert.throws(
			() => createLevel3d({ colliders: [box(-2e5, -1, -2e5, 2e5, 0, 2e5)] }),
			/collider 0 takes the level past/,
		),
	);
	for (const far of [
		box(-1e9, -1, -1e9, 1e9, 0, 1e9),
		box(0, 0, 0, Infinity, 1, 1),
		box(2 ** 56, 0, 0, 2 ** 56 + 64, 1, 1),
	])
		fast(() =>
			assert.throws(() => createLevel3d({ colliders: [far] }), /collider 0 lies past 1000000 m/),
		);
	fast(() =>
		assert.throws(
			() => createLevel3d({ zones: [{ kind: 'pad', ...box(2 ** 56, 0, 0, 2 ** 57, 1, 1) }] }),
			/zone 0 lies past/,
		),
	);
	for (const killY of [-1e9, Number.NaN, -Infinity])
		assert.throws(() => createLevel3d({ killY }), /killY/, `${killY}`);
	const side = Math.floor(Math.sqrt(MAX_LEVEL_CELLS_3D)) - 1;
	const level = createLevel3d({ colliders: [box(0, -1, 0, side * 4 - 0.5, 0, side * 4 - 0.5)] });
	assert.equal(level.cells.size, side * side, 'just under the cap is built');
});
check('a column holds at most MAX_CELL_COLLIDERS_3D colliders', () => {
	const stack = (n) => Array.from({ length: n }, (_, i) => box(0, i, 0, 1, i + 0.5, 1));
	assert.equal(MAX_CELL_COLLIDERS_3D, 64);
	assert.equal(createLevel3d({ colliders: stack(64) }).cells.get('0,0').length, 64);
	assert.throws(
		() => createLevel3d({ colliders: stack(65) }),
		/collider 64 puts more than 64 colliders in one cell/,
	);
});
check('one step in the worst level the caps allow stays well under a millisecond', () => {
	const size = 4;
	const colliders = [];
	for (let cx = -1; cx <= 1; cx++)
		for (let cz = -1; cz <= 1; cz++)
			for (let i = 0; i < MAX_CELL_COLLIDERS_3D; i++)
				colliders.push({
					kind: i % 2 ? 'box' : 'ramp',
					facing: '+x',
					minX: cx * size + 0.001,
					minY: 10 + i,
					minZ: cz * size + 0.001,
					maxX: (cx + 1) * size - 0.001,
					maxY: 10.5 + i,
					maxZ: (cz + 1) * size - 0.001,
				});
	const level = createLevel3d({ colliders, cellSize: size });
	const spec = {
		...MOTION3D_DEFAULTS,
		speed: 17.4,
		sprint: 4,
		maxFall: 100,
		subMove: 0.01,
		groundAccel: 1000,
		airAccel: 1000,
	};
	assert.ok(sweepFits3d(spec, size), 'the fastest body the sweep allows at this cell size');
	assert.equal(collidersNear(level, -4, -4, 4, 4).length, 9 * MAX_CELL_COLLIDERS_3D);
	const input = { mx: MOVE_SCALE, mz: MOVE_SCALE, yaw: 0, buttons: 2 };
	const N = 2000;
	let total = 0;
	for (let k = 0; k < N; k++) {
		const body = createBody3d({ x: -3.5, y: 5, z: -3.5 });
		body.vx = 12;
		body.vz = 12;
		body.vy = -100;
		const started = performance.now();
		stepBody3d(body, input, level, spec, MAX_STEP_DT_3D);
		total += performance.now() - started;
	}
	assert.ok(total / N < 1, `${(total / N).toFixed(3)} ms per body-step`);
	console.log(
		`   worst level: ${(total / N).toFixed(3)} ms per body-step (64 sub-steps, 576 colliders)`,
	);
});
check('a cellSize under the floor, or not a number, throws', () => {
	for (const cellSize of [1e-6, 0, -4, MIN_CELL_SIZE_3D / 2, Number.NaN, Infinity])
		fast(() =>
			assert.throws(
				() => createLevel3d({ colliders: [FLOOR], cellSize }),
				/cellSize/,
				`${cellSize}`,
			),
		);
	assert.equal(createLevel3d({ cellSize: MIN_CELL_SIZE_3D }).cellSize, MIN_CELL_SIZE_3D);
});
check('more than MAX_ZONES_3D zones throws', () => {
	const pad = (i) => ({ kind: 'pad', minX: i, minY: 0, minZ: 0, maxX: i + 1, maxY: 1, maxZ: 1 });
	assert.equal(MAX_ZONES_3D, 256);
	assert.equal(
		createLevel3d({ zones: Array.from({ length: 256 }, (_, i) => pad(i)) }).zones.length,
		256,
	);
	assert.throws(
		() => createLevel3d({ zones: Array.from({ length: 257 }, (_, i) => pad(i)) }),
		/more than 256 zones/,
	);
});
check('a trampoline with no height above 0 does not launch, and never makes a NaN', () => {
	for (const height of [-5, 0, Number.NaN, undefined, -Infinity, Infinity, 1000]) {
		const level = createLevel3d({
			colliders: [FLOOR],
			zones: [
				{ kind: 'trampoline', minX: -1, minY: -0.1, minZ: -1, maxX: 1, maxY: 0.1, maxZ: 1, height },
			],
		});
		assert.equal(level.zones[0].height, 0, `${height}`);
		const body = createBody3d({ y: 0.5 });
		const results = run(body, level, 60);
		assert.ok(
			results.every((r) => !r.bounced),
			`${height} bounced`,
		);
		for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz'])
			assert.ok(Number.isFinite(body[key]), `${height}: ${key} ${body[key]}`);
		assert.equal(body.y, 0);
	}
});
check('a level shared for days keeps its query stamps apart', () => {
	const level = createLevel3d({ colliders: [FLOOR, box(2, 0, -1, 3, 1, 1)] });
	level.query = 0x7fffffff - 1;
	for (let i = 0; i < 4; i++)
		assert.deepEqual(
			collidersNear(level, 1, -1, 4, 1).map((c) => c.id),
			[0, 1],
		);
	assert.ok(level.query > 0 && level.query < 8, `stamp ${level.query}`);
});

console.log('5. the scenario replays');
check('the same script twice gives the same hashes', () => {
	assert.deepEqual(runScenario3d(), runScenario3d());
});
check('it matches the committed replay, and covers every case', () => {
	const result = runScenario3d();
	assert.equal(result.checkpoints.length, SCENARIO3D.steps / SCENARIO3D.every);
	if (UPDATE) writeFileSync(REPLAY_FIXTURE, JSON.stringify(result, null, '\t') + '\n');
	const fixture = JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8'));
	assert.deepEqual(result, fixture);
	for (const [name, count] of Object.entries(result.coverage))
		assert.ok(count > 0, `never: ${name}`);
});

check('the browser page is built from this motion3d.js, scenario and replay', () => {
	if (UPDATE) writeFileSync(ARCADE3D_PAGE, buildArcade3dPage());
	assert.equal(
		readFileSync(ARCADE3D_PAGE, 'utf8').replace(/\r\n/g, '\n'),
		buildArcade3dPage(),
		'stale: run node scripts/arcade-3d-page.mjs',
	);
});

console.log(`check:arcade-3d — ${passed} checks passed`);
