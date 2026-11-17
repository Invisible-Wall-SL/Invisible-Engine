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
	createBody3d,
	createLevel3d,
	hashBodies3d,
	MOTION3D_DEFAULTS,
	MOVE_SCALE,
	stepBody3d,
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
check('the hash sees one bit of one field', () => {
	const a = createBody3d({ x: 1 });
	const b = createBody3d({ x: 1 });
	assert.equal(hashBodies3d([a]), hashBodies3d([b]));
	b.vz = 5e-324;
	assert.notEqual(hashBodies3d([a]), hashBodies3d([b]));
});

console.log('4. the scenario replays');
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
