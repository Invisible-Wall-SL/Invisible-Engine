// The 3D determinism scenario (docs/design/3d-games.md Phase 0b): six bodies driven by a seeded
// script for 12 000 steps over a level with a raised tier, four ramps, an overhead slab, steps, a
// pit and two trampolines, hashed every 500 steps. The same file runs in Node (check:arcade-3d),
// in Chrome and on iOS Safari (the page scripts/arcade-3d-page.mjs builds), so the script itself
// may use only the IEEE-exact operations motion3d.js does — integer PRNG, + − × ÷, Math.sqrt,
// Math.round. No trig, here either.

import {
	BUTTON_JUMP,
	BUTTON_SPRINT,
	createBody3d,
	createLevel3d,
	hashBodies3d,
	HASH3D_SEED,
	MOVE_SCALE,
	stepBody3d,
} from '../packages/engine-mechanics/src/motion3d.js';

export const SCENARIO3D = { seed: 0x3d0b, bodies: 6, steps: 12000, every: 500 };

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
	kind: 'box',
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});
const ramp = (facing, minX, minY, minZ, maxX, maxY, maxZ) => ({
	kind: 'ramp',
	facing,
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});

export function scenarioLevel3d() {
	return createLevel3d({
		cellSize: 4,
		killY: -10,
		colliders: [
			// The floor, around a 4 × 4 m pit at x 8..12, z −12..−8.
			box(-20, -1, -20, 20, 0, -12),
			box(-20, -1, -8, 20, 0, 20),
			box(-20, -1, -12, 8, 0, -8),
			box(12, -1, -12, 20, 0, -8),
			// The border walls.
			box(-21, -1, -21, 21, 3, -20),
			box(-21, -1, 20, 21, 3, 21),
			box(-21, -1, -20, -20, 3, 20),
			box(20, -1, -20, 21, 3, 20),
			// The tier, 3 m up, and a ramp up each side.
			box(-6, 0, -6, 6, 3, 6),
			ramp('+x', -14, 0, -2, -6, 3, 2),
			ramp('-x', 6, 0, -2, 14, 3, 2),
			ramp('+z', -2, 0, -14, 2, 3, -6),
			ramp('-z', -2, 0, 6, 2, 3, 14),
			// An overhead slab (a ceiling to jump into, a floor to bounce onto).
			box(10, 2.2, 10, 18, 2.6, 18),
			// A stair: 0.3 m steps climb, the 0.5 m block does not.
			box(-18, 0, -18, -16, 0.3, -14),
			box(-16, 0, -18, -14, 0.6, -14),
			box(-14, 0, -18, -12, 0.9, -14),
			box(-11, 0, -18, -10, 1.4, -14),
			// Pillars.
			box(13, 0, -4, 14, 4, -3),
			box(-14, 0, 6, -13, 4, 7),
		],
		zones: [
			{
				kind: 'trampoline',
				minX: -17,
				minY: -0.1,
				minZ: 13,
				maxX: -13,
				maxY: 0.1,
				maxZ: 17,
				height: 6,
			},
			{
				kind: 'trampoline',
				minX: 13,
				minY: -0.1,
				minZ: 11,
				maxX: 15,
				maxY: 0.1,
				maxZ: 13,
				height: 4.5,
			},
			{ kind: 'trampoline', minX: -1, minY: 2.9, minZ: -1, maxX: 1, maxY: 3.1, maxZ: 1, height: 3 },
		],
	});
}

/** Where the script sends bodies: ramp feet and heads, the tier, trampolines, the slab, the pit. */
const TARGETS = [
	[-15, -1],
	[-6, 0],
	[15, 1],
	[6, 0],
	[0, -15],
	[0, -6],
	[0, 15],
	[0, 6],
	[0, 0],
	[-15, 15],
	[14, 12],
	[14, 14],
	[-17, -16],
	[-11, -16],
	[10, -10],
	[19, 0],
	[-19, 5],
	[3, -19],
];

const SPAWNS = [
	[-10, 0, 10],
	[10, 0, -16],
	[-16, 0, -6],
	[16, 0, 6],
	[0, 3, 0],
	[5, 0, 17],
];

/** mulberry32: integer-only, the same stream on every engine. */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (t ^ (t >>> 14)) >>> 0;
	};
}

const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');

/**
 * Run the scenario. Returns the hash at every checkpoint, the final `code` (the checkpoints'
 * hashes hashed together), the last body's state and how often each case happened.
 */
export function runScenario3d({ steps = SCENARIO3D.steps, every = SCENARIO3D.every } = {}) {
	const level = scenarioLevel3d();
	const bodies = [];
	const bots = [];
	for (let i = 0; i < SCENARIO3D.bodies; i++) {
		const [x, y, z] = SPAWNS[i];
		bodies.push(createBody3d({ x, y, z }));
		bots.push({
			next: rng(SCENARIO3D.seed * 31 + i),
			left: 0,
			mode: 0,
			mx: 0,
			mz: 0,
			tx: 0,
			tz: 0,
			yaw: 0,
			sprint: 0,
			hop: 0,
			held: 0,
		});
	}
	const coverage = {
		jumps: 0,
		doubleJumps: 0,
		bounces: 0,
		rampSteps: 0,
		stepUps: 0,
		wallSteps: 0,
		ceilings: 0,
		landings: 0,
		falls: 0,
		airSteps: 0,
	};
	const checkpoints = [];
	const input = { mx: 0, mz: 0, yaw: 0, buttons: 0 };
	for (let s = 1; s <= steps; s++) {
		for (let i = 0; i < bodies.length; i++) {
			const body = bodies[i];
			const bot = bots[i];
			if (bot.left <= 0) {
				const r = bot.next();
				bot.left = 20 + (r % 140);
				bot.mode = (r >>> 8) % 5;
				const t = TARGETS[(r >>> 12) % TARGETS.length];
				bot.tx = t[0];
				bot.tz = t[1];
				bot.mx = ((bot.next() % 255) | 0) - 127;
				bot.mz = ((bot.next() % 255) | 0) - 127;
				bot.yaw = bot.next() & 0xffff;
				bot.sprint = (r >>> 20) % 3 === 0 ? BUTTON_SPRINT : 0;
				bot.hop = (r >>> 4) % 3 === 0 ? 0 : 40 + ((r >>> 24) % 100);
			}
			bot.left -= 1;
			if (bot.mode <= 1) {
				// Walk to the target: the device's quantisation, a world direction to int8.
				const dx = bot.tx - body.x;
				const dz = bot.tz - body.z;
				const len = Math.sqrt(dx * dx + dz * dz);
				input.mx = len > 0.05 ? Math.round((dx / len) * MOVE_SCALE) : 0;
				input.mz = len > 0.05 ? Math.round((dz / len) * MOVE_SCALE) : 0;
			} else if (bot.mode === 4) {
				input.mx = 0;
				input.mz = 0;
			} else {
				input.mx = bot.mx;
				input.mz = bot.mz;
			}
			input.yaw = (bot.yaw + s * 37) & 0xffff;
			let jump = 0;
			if (bot.held > 0) {
				bot.held -= 1;
				jump = BUTTON_JUMP;
			} else if (bot.hop > 0 && bot.left % bot.hop === 0) {
				bot.held = 1 + (bot.next() % 12);
				jump = BUTTON_JUMP;
			} else if (
				bot.hop > 0 &&
				!body.grounded &&
				!body.doubleUsed &&
				body.vy < 1 &&
				body.vy > -1 &&
				(bot.next() & 3) === 0
			) {
				bot.held = 2;
				jump = BUTTON_JUMP;
			}
			input.buttons = jump | bot.sprint;
			const r = stepBody3d(body, input, level);
			if (r.jumped) coverage.jumps += 1;
			if (r.doubleJumped) coverage.doubleJumps += 1;
			if (r.bounced) coverage.bounces += 1;
			if (r.onRamp) coverage.rampSteps += 1;
			if (r.steppedUp) coverage.stepUps += 1;
			if (r.onWall) coverage.wallSteps += 1;
			if (r.hitCeiling) coverage.ceilings += 1;
			if (r.landed) coverage.landings += 1;
			if (!r.grounded) coverage.airSteps += 1;
			if (r.fell) {
				coverage.falls += 1;
				const [x, y, z] = SPAWNS[i];
				bodies[i] = createBody3d({ x, y, z, yaw: body.yaw });
			}
		}
		if (s % every === 0) checkpoints.push(hex(hashBodies3d(bodies)));
	}
	let h = HASH3D_SEED;
	for (const c of checkpoints) h = Math.imul(h ^ parseInt(c, 16), 0x01000193) >>> 0;
	const last = bodies[bodies.length - 1];
	return {
		steps,
		every,
		checkpoints,
		code: hex(h),
		last: { x: last.x, y: last.y, z: last.z, vx: last.vx, vy: last.vy, vz: last.vz },
		coverage,
	};
}
