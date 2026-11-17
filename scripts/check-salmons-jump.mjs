// The salmon's leap against the original game (`GuiltyForever/Salmon-` 41811c2; docs/status/salmons.md):
// - the room (`engine-mechanics` `salmonsRules` `salmonJump`): a tap of jump by a free salmon on the
//   water launches it at 11 cells/s and it falls back under 20 cells/s², step for step the old
//   server's `z += vz·dt; vz -= 20·dt` (about 1.1 s up, its top about 3 cells); no second leap in
//   the air, none on a tap that climbs, none while held; a tap off a sandbank leaps, announced once;
//   in the air it is not grounded on sand (above 0.05 cells) nor hooked (above 0.1);
// - the look (`engine-layout` `salmonsArt/leap.ts`): the old client's jump factor, tilt, swell, curl,
//   arch and tail envelope, and the lift of 16 old px a cell, scaled by K.
//
// Run: pnpm check:salmons-jump

import assert from 'node:assert/strict';

import { aabbOf } from '../packages/engine-mechanics/src/motion.js';
import { BUTTONS } from '../packages/engine-mechanics/src/online.js';
import { STATUS } from '../packages/engine-mechanics/src/abilities.js';
import { CELL } from '../packages/engine-mechanics/src/salmonsMap.js';
import { JUMP, SALMONS_RULES, salmonJump } from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	LEAP,
	airborne,
	archAt,
	cellsOf,
	curlTarget,
	envelope,
	jumpFactor,
	liftOf,
} from '../packages/engine-layout/src/lib/salmonsArt/leap.ts';
import { CELL as DRAWN_CELL, K } from '../packages/engine-layout/src/lib/salmonsArt/scale.ts';

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (error) {
		console.error(`✗ ${name}\n${error.message}`);
		process.exitCode = 1;
	}
};
const near = (a, b, eps, what) =>
	assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not within ${eps} of ${b}`);

/** The old server's leap: `vz = 11`, then each tick `z += vz·dt; vz -= 20·dt`, landing at 0. */
function original(tickHz) {
	const dt = 1 / tickHz;
	let z = 0;
	let vz = 11;
	const heights = [];
	do {
		z += vz * dt;
		vz -= 20 * dt;
		if (z <= 0) z = 0;
		heights.push(z);
	} while (z > 0);
	return heights;
}

const api = {
	STATUS,
	free: (p) => {
		p.status = STATUS.free;
	},
	release: (p) => {
		p.status = STATUS.free;
		p.until = 0;
	},
	score: () => {},
	worth: (_p, points) => points,
};

/** A salmon in a room of `module`, with the events it emits. */
function room(module, { tickHz = 30, zones = [], rules = [] } = {}) {
	const game = { zones, online: { tickHz, rules: { zones: rules } } };
	const made = module.create(game, api);
	const salmon = {
		id: 'a',
		character: { id: 'salmon' },
		body: { x: 100, y: 100, w: 90, h: 44 },
		connected: true,
		status: STATUS.free,
		until: 0,
		mark: false,
		memo: {},
		cooldowns: {},
	};
	const events = [];
	const world = (stamp) => ({
		players: [salmon],
		stamp,
		tickHz,
		round: 1,
		seed: 1,
		emit: (e) => events.push(e),
	});
	let stamp = 0;
	const press = (down) =>
		made.input?.(salmon, { buttons: down ? BUTTONS.jump : 0, moveX: 0, moveY: 0 }, world(stamp));
	const step = () => {
		stamp += 1;
		made.step?.(world(stamp));
	};
	const hook = (user, target, ability) => made.hook?.(user, target, ability, world(stamp));
	return { salmon, events, press, step, hook };
}

/** Tap jump, then step until it lands; the heights (cells) after each step. */
function leap(r) {
	r.press(true);
	r.press(false);
	const heights = [];
	do {
		r.step();
		heights.push((r.salmon.z ?? 0) / CELL);
	} while (r.salmon.z > 0 && heights.length < 1000);
	return heights;
}

check("the leap's numbers are the old server's: 11 cells/s up, 20 cells/s² down", () => {
	assert.deepEqual({ ...JUMP }, { launch: 11, gravity: 20 });
	assert.equal(CELL, 48);
	assert.equal(DRAWN_CELL, CELL, 'the look and the room agree on a cell');
});

for (const tickHz of [30, 60]) {
	check(`at ${tickHz} Hz the height follows the old server's, step for step`, () => {
		const ours = leap(room(salmonJump, { tickHz }));
		const theirs = original(tickHz);
		assert.equal(ours.length, theirs.length, 'the steps in the air');
		ours.forEach((z, i) => near(z, theirs[i], 1e-9, `step ${i + 1}`));
	});
	// The old server's own stepping overshoots the smooth arc by up to two steps at 30 Hz.
	check(`at ${tickHz} Hz it is up about 1.1 s and tops out about 3 cells`, () => {
		const heights = leap(room(salmonJump, { tickHz }));
		near(heights.length / tickHz, 1.1, 2 / tickHz, 'time in the air (s)');
		near(Math.max(...heights), (11 * 11) / (2 * 20), 11 / tickHz, 'top (cells)');
	});
}

check('one leap is announced and a tap in the air does not leap again', () => {
	const r = room(salmonJump);
	r.press(true);
	r.press(false);
	r.step();
	const up = r.salmon.z;
	assert.ok(up > 0);
	r.press(true);
	r.press(false);
	r.step();
	assert.ok(r.salmon.z > up, 'still rising on the first launch');
	assert.deepEqual(r.events, [{ type: 'jumped', id: 'a' }]);
});

check('two taps in one step leap once', () => {
	const r = room(salmonJump);
	r.press(true);
	r.press(false);
	r.press(true);
	r.step();
	assert.equal(r.events.length, 1);
	near(r.salmon.z / CELL, original(30)[0], 1e-9, 'one launch');
});

check('a held press leaps once', () => {
	const r = room(salmonJump);
	r.press(true);
	let steps = 0;
	do {
		r.step();
		r.press(true);
		steps += 1;
	} while (r.salmon.z > 0 && steps < 1000);
	r.press(true);
	r.step();
	assert.equal(r.salmon.z ?? 0, 0, 'held down since its tap: no new leap');
	assert.equal(r.events.length, 1);
});

check('no leap while held (grounded, hooked, out) or for another character', () => {
	for (const status of [STATUS.grounded, STATUS.hooked, STATUS.out, STATUS.stunned]) {
		const r = room(salmonJump);
		r.salmon.status = status;
		leap(r);
		assert.equal(r.salmon.z ?? 0, 0, `status ${status}`);
		assert.equal(r.events.length, 0);
	}
	const r = room(salmonJump);
	r.salmon.character = { id: 'bear' };
	leap(r);
	assert.equal(r.salmon.z ?? 0, 0);
});

check('a catch mid-leap puts it back on the water', () => {
	const r = room(salmonJump);
	r.press(true);
	r.step();
	r.step();
	r.salmon.status = STATUS.out;
	r.step();
	assert.equal(r.salmon.z, 0);
	assert.equal(r.salmon.memo.vz, 0);
});

check('a tap off a sandbank leaps, announced once', () => {
	const sand = { id: 'sand', x: 0, y: 0, w: 400, h: 400 };
	const r = room(SALMONS_RULES.salmons, {
		zones: [sand],
		rules: [{ kind: 'sandbank', zone: 'sand' }],
	});
	r.step();
	assert.equal(r.salmon.status, STATUS.grounded);
	r.press(true);
	r.step();
	assert.equal(r.salmon.status, STATUS.free);
	assert.ok(r.salmon.z > 0, 'it leaps off the sand');
	assert.deepEqual(
		r.events.filter((e) => e.type === 'jumped'),
		[{ type: 'jumped', id: 'a' }],
	);
});

check('in the air it is neither grounded on sand nor hooked', () => {
	const sand = { id: 'sand', x: 0, y: 0, w: 400, h: 400 };
	const r = room(SALMONS_RULES.salmons, {
		zones: [sand],
		rules: [{ kind: 'sandbank', zone: 'sand' }],
	});
	r.salmon.z = 0.06 * CELL;
	r.salmon.memo.vz = JUMP.launch * CELL;
	r.step();
	assert.equal(r.salmon.status, STATUS.free, 'above 0.05 cells: not grounded');
	const line = room(SALMONS_RULES.fishingLine);
	const fisher = { id: 'f', memo: {} };
	line.salmon.z = 0.11 * CELL;
	assert.equal(line.hook(fisher, line.salmon, { score: 1, hold: 1 }), false, 'above 0.1 cells');
	line.salmon.z = 0;
	assert.equal(line.hook(fisher, line.salmon, { score: 1, hold: 1 }), true, 'on the water');
});

check('a tap at the foot of a waterfall climbs and does not leap', () => {
	const top = aabbOf({ x: 100, y: 100, w: 90, h: 44 }).y0;
	const fall = { id: 'fall', x: 0, y: top - 70, w: 400, h: 70 };
	const r = room(SALMONS_RULES.salmons, {
		zones: [fall],
		rules: [{ kind: 'waterfall', zone: 'fall' }],
	});
	r.press(true);
	r.press(false);
	r.step();
	assert.equal(r.salmon.z ?? 0, 0);
	assert.ok(r.salmon.memo.climb > 0, 'the tap climbed');
	assert.equal(r.events.filter((e) => e.type === 'jumped').length, 0);
});

check("the pose's numbers are the old client's", () => {
	assert.deepEqual(
		{ ...LEAP },
		{
			airborneCells: 0.1,
			factorPerCell: 0.5,
			maxFactor: 1.5,
			tilt: 0.4,
			tiltEase: 0.15,
			swell: 0.12,
			curlEase: 0.15,
			flickHz: 2,
			arch: 36,
			envelopePower: 2.5,
			heightUnit: 16,
		},
	);
});

check('the jump factor: 0 on the water, z / 2 in the air, at most 1.5', () => {
	assert.equal(airborne(0.1), false);
	assert.equal(airborne(0.11), true);
	assert.equal(jumpFactor(0.05), 0);
	assert.equal(jumpFactor(1), 0.5);
	assert.equal(jumpFactor(2), 1);
	assert.equal(jumpFactor(3.025), 1.5);
	assert.equal(curlTarget(1), 0.5);
	assert.equal(curlTarget(3), 1);
	assert.equal(curlTarget(0), 0);
});

check('the curl: a 2 Hz flick of 36 old px, the tail whipping and the head rigid', () => {
	near(archAt(1, 125), -36, 1e-9, 'a quarter period');
	near(archAt(1, 375), 36, 1e-9, 'three quarters');
	near(archAt(0.5, 125), -18, 1e-9, 'half curled');
	near(archAt(1, 500), 0, 1e-9, 'one period');
	assert.equal(envelope(0, 12), 1);
	assert.equal(envelope(11, 12), 0);
	near(envelope(3, 12), Math.pow(8 / 11, 2.5), 1e-12, 'point 3');
	for (let i = 1; i < 12; i += 1) assert.ok(envelope(i, 12) < envelope(i - 1, 12));
});

check('the lift: 16 old px a cell, scaled to the 96 × 48 diamond', () => {
	assert.equal(K, 1.5);
	assert.equal(cellsOf(CELL), 1);
	assert.equal(liftOf(1), 24);
	near(liftOf((11 * 11) / (2 * 20)), 72.6, 1e-9, 'the top of a leap, px');
});

console.log(`${passed} salmon leap checks passed`);
