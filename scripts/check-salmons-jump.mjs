// The salmon's leap against the original game (`GuiltyForever/Salmon-` 41811c2; docs/status/salmons.md):
// - the room (`engine-mechanics` `salmonsRules` `salmonJump`): a tap of jump by a free salmon on the
//   water launches it at 11 cells/s and it falls back under 20 cells/s², step for step the old
//   server's `z += vz·dt; vz -= 20·dt` (about 1.1 s up, its top about 3 cells); no second leap in
//   the air, none on a tap that climbs, none while held; a tap off a sandbank leaps, announced once;
//   in the air it is not grounded on sand (above 0.05 cells) nor hooked (above 0.1);
// - the look (`engine-layout` `salmonsArt/leap.ts`): the old client's jump factor, tilt, swell, curl,
//   arch and tail envelope, and the lift of 16 old px a cell, scaled by K;
// - the leap's direction (`leapMove`): to the tapped point beyond half a cell, else the last move,
//   else the original's (0.7, −0.7), ×1.0 along the river and ×0.9 across, carried while the stick
//   rests until it steers or is back on the water, in the room and in both device predictors;
// - over the low pieces: a rock stops it, and a whirlpool pulls it (14·(1 − d/4) cells/s within 4
//   cells), only below half a cell; the line passes over a salmon in the air for the next;
// - the look's surface: under the water's tint (with its glint) on open water at most 0.1 cells up.
//
// Run: pnpm check:salmons-jump

import assert from 'node:assert/strict';

import { aabbOf } from '../packages/engine-mechanics/src/motion.js';
import {
	BUTTONS,
	MOVE_SCALE,
	carriedInput,
	characterBody,
	clampInput,
	onlineLevel,
	stepContext,
	stepPlayer,
} from '../packages/engine-mechanics/src/online.js';
import {
	STATUS,
	abilitySpecs,
	addZoneForces,
	useAbilities,
	zoneForces,
} from '../packages/engine-mechanics/src/abilities.js';
import { createPredictor, reconcilerStep } from '../packages/engine-mechanics/src/netcode.js';
import { CELL, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import { WHIRLPOOL_PULL, salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import {
	CLEAR,
	JUMP,
	LEAP_AIM,
	LINE,
	OVER,
	SALMONS_RULES,
	leapMove,
	salmonJump,
	stepsAloft,
} from '../packages/engine-mechanics/src/salmonsRules.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
import {
	LEAP,
	airborne,
	archAt,
	cellsOf,
	curlTarget,
	envelope,
	jumpFactor,
	liftOf,
	underTint,
	underwater,
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
	out: (p) => {
		p.status = STATUS.out;
	},
	stain: () => {},
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
		safeUntil: 0,
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
	return { salmon, events, press, step, world, hooks: made };
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
	for (const [z, status, said] of [
		[0.11 * CELL, STATUS.free, 'above 0.1 cells: passed over'],
		[0, STATUS.hooked, 'on the water'],
	]) {
		const water = { id: 'band0Water', x: 0, y: 0, w: 400, h: 400 };
		const line = room(SALMONS_RULES.fishingLine, { zones: [water] });
		const fisher = {
			...line.salmon,
			id: 'f',
			character: { id: 'fisherman' },
			body: { x: 300, y: 100 },
		};
		line.salmon.z = z;
		const ability = { score: 1, hold: 1, reach: 1.5 * CELL, targets: ['salmon'] };
		assert.equal(line.hooks.cast(fisher, ability, { x: 100, y: 100 }), true);
		line.hooks.step({ ...line.world(1), players: [fisher, line.salmon] });
		assert.equal(line.salmon.status, status, said);
	}
});

check('a tap at the foot of a waterfall climbs and does not leap', () => {
	const top = aabbOf({ x: 100, y: 100, w: 90, h: 44 }).y0;
	const fall = { id: 'fall', x: 0, y: top - 70, w: 400, h: 70, height: 3 };
	const r = room(SALMONS_RULES.salmons, {
		zones: [fall],
		rules: [{ kind: 'waterfall', zone: 'fall' }],
	});
	r.press(true);
	r.press(false);
	r.step();
	near(r.salmon.z / CELL, 2.4 - 0.8 / 30, 1e-9, 'one climb step, one step of slide');
	assert.equal(r.salmon.memo.climbing, 1, 'the tap climbed');
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

// --- The leap's direction and its carry --------------------------------------------------------

const at0 = { x: 1000, y: 1000 };
const aimFrom = (body, dx, dy) => ({ aimX: body.x + dx * CELL, aimY: body.y + dy * CELL });
const aimAt = (dx, dy) => aimFrom(at0, dx, dy);

check('the leap heads for the tapped point, ×0.9 across the river and ×1.0 along it', () => {
	assert.deepEqual(
		{ ...LEAP_AIM, fallback: { ...LEAP_AIM.fallback } },
		{
			deadZone: 0.5,
			along: 1,
			across: 0.9,
			fallback: { x: -0.7, y: 0.7 },
			minMove: 0.01,
		},
	);
	assert.deepEqual(leapMove(at0, aimAt(3, 0), null), {
		moveX: Math.round(0.9 * MOVE_SCALE),
		moveY: 0,
	});
	assert.deepEqual(leapMove(at0, aimAt(0, -5), null), { moveX: 0, moveY: -MOVE_SCALE });
	const d = Math.SQRT1_2 * MOVE_SCALE;
	assert.deepEqual(leapMove(at0, aimAt(2, -2), { x: 0, y: 127 }), {
		moveX: Math.round(0.9 * d),
		moveY: Math.round(-d),
	});
	// The aim wins over the last move; the length is held to a full move.
	const m = leapMove(at0, aimAt(-7, 1), { x: 127, y: 0 });
	assert.ok(m.moveX < 0 && m.moveY > 0);
	assert.ok(m.moveX * m.moveX + m.moveY * m.moveY <= MOVE_SCALE * MOVE_SCALE);
});

check('within half a cell of the salmon the tap is no aim: the last move leads', () => {
	const last = { x: 0, y: -32 };
	assert.deepEqual(leapMove(at0, aimAt(0.5, 0), last), { moveX: 0, moveY: -MOVE_SCALE });
	assert.deepEqual(leapMove(at0, aimAt(0, -0.3), last), { moveX: 0, moveY: -MOVE_SCALE });
	assert.deepEqual(leapMove(at0, aimAt(0.51, 0), last), {
		moveX: Math.round(0.9 * MOVE_SCALE),
		moveY: 0,
	});
	// A key's jump has no aim (aimX = aimY = 0, as `online.ts` `keyInput` sends).
	assert.deepEqual(leapMove(at0, { aimX: 0, aimY: 0 }, last), { moveX: 0, moveY: -MOVE_SCALE });
	assert.deepEqual(leapMove(at0, {}, { x: 89, y: 89 }), {
		moveX: Math.round(0.9 * Math.SQRT1_2 * MOVE_SCALE),
		moveY: Math.round(Math.SQRT1_2 * MOVE_SCALE),
	});
});

check("before any move it leaps the original's way, (0.7, −0.7) normalised", () => {
	const d = Math.SQRT1_2 * MOVE_SCALE;
	// The original's vx (along its river, here y) 0.7 and vy (across, here x) −0.7.
	assert.deepEqual(leapMove(at0, {}, null), { moveX: Math.round(-0.9 * d), moveY: Math.round(d) });
});

/** A salmon in a room of `module` stepped as the room steps it: its input steered by the module
 *  and moved by it (no level), then the rules' input and step. */
function flight(module = salmonJump, tickHz = 30, zones = {}) {
	const r = room(module, { tickHz, ...zones });
	const ctx = stepContext(tickHz);
	const speed = 240;
	const send = (moveX, moveY, buttons = 0, aim = {}) => {
		const input = { moveX, moveY, buttons, aimX: 0, aimY: 0, ...aim };
		const before = { x: r.salmon.body.x, y: r.salmon.body.y };
		const moved = r.salmon.status === STATUS.free ? r.hooks.steer(r.salmon, input) : undefined;
		stepPlayer(r.salmon.body, moved, speed, ctx);
		r.hooks.input(r.salmon, input, { stamp: 0, tickHz, round: 1, seed: 1, emit: () => {} });
		r.step();
		return { dx: r.salmon.body.x - before.x, dy: r.salmon.body.y - before.y };
	};
	return { ...r, send, speed, tickHz };
}

check('the leap carries its move while the stick rests, until it steers or lands', () => {
	const f = flight();
	f.send(0, -MOVE_SCALE);
	const tap = f.send(0, 0, BUTTONS.jump, aimFrom(f.salmon.body, 4, 0));
	assert.equal(tap.dx, 0, 'the tap itself is stepped as sent');
	const aloft = stepsAloft(f.salmon.z, f.salmon.memo.vz, 30);
	assert.equal(f.salmon.air, aloft, 'carried for as many inputs as it is above 0.05 cells');
	assert.deepEqual([f.salmon.carryX, f.salmon.carryY], [Math.round(0.9 * MOVE_SCALE), 0]);
	const v = (0.9 * f.speed) / f.tickHz;
	let moved = 0;
	let carried = 0;
	while (f.salmon.air > 0) {
		const m = f.send(0, 0);
		moved += m.dx;
		carried += 1;
		near(m.dx, (Math.round(0.9 * MOVE_SCALE) / MOVE_SCALE) * (f.speed / f.tickHz), 1e-9, 'a step');
	}
	assert.ok(Math.abs(moved - carried * v) < carried * 0.5, `towards the tap: ${moved} px`);
	assert.ok(f.salmon.z <= CLEAR.steer * CELL, 'carried until it is back on the water');
	assert.deepEqual(f.send(0, 0), { dx: 0, dy: 0 }, 'on the water a resting stick rests');
});

check('a move in the air steers it, and is carried in turn; 0 does not cancel it', () => {
	const f = flight();
	f.send(MOVE_SCALE, 0);
	f.send(0, 0, BUTTONS.jump);
	assert.deepEqual([f.salmon.carryX, f.salmon.carryY], [Math.round(0.9 * MOVE_SCALE), 0]);
	f.send(0, 0);
	const steer = f.send(0, -MOVE_SCALE);
	assert.ok(steer.dy < 0 && steer.dx === 0, 'steered');
	const after = f.send(0, 0);
	assert.ok(after.dy < 0 && after.dx === 0, 'the steer is carried, not the leap');
	// The original's last direction (`playerLastDir`) is the steer now; a next leap takes it.
	while (f.salmon.z > 0) f.send(0, 0);
	f.send(0, 0, BUTTONS.jump);
	assert.deepEqual([f.salmon.carryX, f.salmon.carryY], [0, -MOVE_SCALE]);
});

check('let go at a waterfall’s top, it carries the move it last had until it lands', () => {
	const top = aabbOf({ x: 100, y: 100, w: 90, h: 44 }).y0;
	const fall = { id: 'fall', x: 0, y: top - 70, w: 400, h: 70, height: 1 };
	const f = flight(SALMONS_RULES.salmons, 30, {
		zones: [fall],
		rules: [{ kind: 'waterfall', zone: 'fall' }],
	});
	f.send(0, -MOVE_SCALE);
	f.send(0, -MOVE_SCALE, BUTTONS.jump);
	assert.ok(
		f.events.some((e) => e.type === 'climbed'),
		'one tap tops a fall of height 1',
	);
	assert.equal(f.salmon.air, stepsAloft(f.salmon.z, f.salmon.memo.vz, 30));
	assert.deepEqual([f.salmon.carryX, f.salmon.carryY], [0, -MOVE_SCALE]);
	const on = f.send(0, 0);
	assert.ok(on.dy < 0, 'the stick at rest, it swims on up over the fall');
});

check(
	'a move under 0.01 of a full one is not a direction (the original records |v| > 0.01)',
	() => {
		const f = flight();
		f.send(0, -MOVE_SCALE);
		f.send(1, 0);
		f.send(0, 0, BUTTONS.jump);
		assert.deepEqual([f.salmon.carryX, f.salmon.carryY], [0, -MOVE_SCALE]);
	},
);

check('caught, hooked or grounded mid-leap it carries nothing; a round ends it', () => {
	for (const status of [STATUS.out, STATUS.hooked, STATUS.grounded]) {
		const f = flight();
		f.send(0, 0, BUTTONS.jump, aimFrom(f.salmon.body, 4, 0));
		f.send(0, 0);
		assert.ok(f.salmon.air > 0);
		f.salmon.status = status;
		f.step();
		assert.equal(f.salmon.air, 0, `status ${status}`);
		assert.deepEqual([f.salmon.carryX, f.salmon.carryY], [0, 0]);
	}
	const carry = { air: 2, carryX: 5, carryY: -7 };
	assert.deepEqual(carriedInput(carry, { moveX: 0, moveY: 0 }), { moveX: 5, moveY: -7 });
	assert.deepEqual(carriedInput(carry, { moveX: 0, moveY: 0 }), { moveX: 5, moveY: -7 });
	assert.deepEqual(carry, { air: 0, carryX: 0, carryY: 0 }, 'spent: nothing carried');
	const rest = { moveX: 0, moveY: 0 };
	assert.equal(carriedInput(carry, rest), rest);
});

/** Open water on an original level, clear of every piece within `px`. */
function openWater(river, px = 400) {
	const pieces = [...river.rocks, ...river.sandbanks, ...river.waterfalls].map((r) => ({
		x0: r.x - px,
		y0: r.y - px,
		x1: r.x + r.w + px,
		y1: r.y + r.h + px,
	}));
	for (const p of river.whirlpools)
		pieces.push({
			x0: p.x - 4 * CELL - px,
			y0: p.y - 4 * CELL - px,
			x1: p.x + 4 * CELL + px,
			y1: p.y + 4 * CELL + px,
		});
	for (const band of river.bands.slice(20)) {
		if (band.right - band.left < 1200) continue;
		const at = { x: (band.left + band.right) / 2, y: band.y + band.h / 2 };
		if (!pieces.some((b) => at.x > b.x0 && at.x < b.x1 && at.y > b.y0 && at.y < b.y1)) return at;
	}
	throw new Error('no open water');
}

check(
	'in a room the leap travels towards the tap, and both device predictors fold it exactly',
	() => {
		const seed = 2024;
		const river = salmonsMapRiver(seed);
		const doc = salmonsConfig(river);
		doc.arcade.online.bots.fillTo = 0;
		const { game } = createRoomSim(onlineGameOf(normalizeGameConfigDoc(doc)), { seed });
		const spot = openWater(river);
		const level = onlineLevel(game.zones, game.online.rules.zones, 'salmon', game.field);
		const character = game.online.characters.find((c) => c.id === 'salmon');
		const ctx = stepContext(game.online.tickHz, game.online.subSteps);
		const tap = aimFrom(spot, 6, -3);
		const inputs = [];
		for (let seq = 1; seq <= 60; seq++)
			inputs.push(
				clampInput(
					{
						seq,
						view: seq - 1,
						moveX: 0,
						moveY: seq <= 5 ? -MOVE_SCALE : 0,
						buttons: seq === 8 ? BUTTONS.jump : 0,
						...(seq === 8 ? tap : {}),
					},
					game.field,
				),
			);
		for (const LAG of [0, 4]) {
			const room = createRoomSim(onlineGameOf(normalizeGameConfigDoc(doc)), { seed });
			const me = room.join('s', { character: 'salmon' });
			Object.assign(me.body, spot);
			const start = { x: me.body.x, y: me.body.y };
			const device = createPredictor({
				body: characterBody('s', game.bodies[character.body], start),
				speed: character.speed,
				ctx,
				field: game.field,
				level,
			});
			const sdk = { x: start.x, y: start.y, status: 0, held: false, air: 0, carryX: 0, carryY: 0 };
			const sdkStep = reconcilerStep({
				body: characterBody('s', game.bodies[character.body], start),
				speed: character.speed,
				ctx,
				field: game.field,
				level,
			});
			const states = [];
			let launchAt;
			let path = [];
			for (let i = 0; i < inputs.length + LAG; i++) {
				if (i < inputs.length) device.input(inputs[i]);
				const k = i - LAG;
				if (k < 0) continue;
				room.step(() => [inputs[k]]);
				const truth = {
					x: me.body.x,
					y: me.body.y,
					ack: inputs[k].seq,
					step: room.steps,
					still: false,
					air: me.air ?? 0,
					carryX: me.carryX ?? 0,
					carryY: me.carryY ?? 0,
				};
				states.push(truth);
				if (launchAt === undefined && truth.air) launchAt = k;
				if (launchAt !== undefined) path.push({ x: me.body.x, y: me.body.y });
				const verdict = device.reconcile(truth);
				if (k !== launchAt)
					assert.equal(verdict, 'match', `lag ${LAG}, input ${k + 1}: ${verdict}`);
				// The SDK's step from the room's state before this input gives the room's after it.
				if (k > 0 && k !== launchAt) {
					Object.assign(sdk, states[k - 1]);
					sdkStep(undefined, sdk, inputs[k]);
					assert.ok(
						Math.abs(sdk.x - truth.x) < 1e-9 && Math.abs(sdk.y - truth.y) < 1e-9,
						`the SDK's step at input ${k + 1}`,
					);
					assert.deepEqual(
						[sdk.air, sdk.carryX, sdk.carryY],
						[truth.air, truth.carryX, truth.carryY],
					);
				}
			}
			assert.equal(launchAt, 7, 'the tap launched it');
			assert.equal(
				device.corrections,
				1,
				`lag ${LAG}: one correction, the launch the device cannot see`,
			);
			const launch = states[launchAt];
			assert.ok(launch.carryX > 0 && launch.carryY < 0, 'it leaps the way of the tap');
			const across = (launch.carryX / MOVE_SCALE) * (character.speed / game.online.tickHz);
			const dx = path.at(-1).x - path[0].x;
			near(dx, launch.air * across, 1e-6, `lag ${LAG}: across the river, towards the tap (px)`);
			assert.ok(dx > 4 * CELL, `lag ${LAG}: ${dx.toFixed(1)} px`);
			near(device.body.x, me.body.x, 1e-9, `lag ${LAG}: the device ends where the room does`);
			near(device.body.y, me.body.y, 1e-9, `lag ${LAG}: the device ends where the room does`);
		}
	},
);

check(
	'a stall pauses the carry with the body: the leap covers its ground, the device exact',
	() => {
		const seed = 2024;
		const river = salmonsMapRiver(seed);
		const doc = salmonsConfig(river);
		doc.arcade.online.bots.fillTo = 0;
		const room = createRoomSim(onlineGameOf(normalizeGameConfigDoc(doc)), { seed });
		const { game } = room;
		const me = room.join('s', { character: 'salmon' });
		Object.assign(me.body, openWater(river));
		const character = game.online.characters.find((c) => c.id === 'salmon');
		const device = createPredictor({
			body: characterBody('s', game.bodies[character.body], { x: me.body.x, y: me.body.y }),
			speed: character.speed,
			ctx: stepContext(game.online.tickHz, game.online.subSteps),
			field: game.field,
			level: onlineLevel(game.zones, game.online.rules.zones, 'salmon', game.field),
		});
		const tap = aimFrom(me.body, 0, -6);
		const queue = [];
		for (let seq = 1; seq <= 60; seq++) {
			const input = clampInput(
				{
					seq,
					view: seq - 1,
					moveX: 0,
					moveY: 0,
					buttons: seq === 3 ? BUTTONS.jump : 0,
					...(seq === 3 ? tap : {}),
				},
				game.field,
			);
			device.input(input);
			queue.push(input);
		}
		let launched;
		let carried = 0;
		let from;
		let to;
		// Ten steps with no input mid-leap, then the backlog drains two a step.
		for (let step = 1; room.steps < 200 && (queue.length || me.air); step++) {
			const stall = step >= 8 && step < 18;
			const before = me.air ?? 0;
			const y = me.body.y;
			room.step((_id, credit) =>
				stall ? [] : queue.splice(0, Math.min(queue.length, credit > 0 ? 2 : 1)),
			);
			if (me.air && !launched) {
				launched = room.steps;
				from = me.body.y;
			} else if (launched && before) {
				carried += before - (me.air ?? 0);
				if (!me.air) to ??= me.body.y;
			}
			if (stall) {
				assert.equal(me.air, before, `a stalled step spends no carry (${room.steps})`);
				assert.equal(me.body.y, y, 'nor moves');
			}
			const verdict = device.reconcile({
				x: me.body.x,
				y: me.body.y,
				ack: me.ack,
				step: room.steps,
				air: me.air ?? 0,
				carryX: me.carryX ?? 0,
				carryY: me.carryY ?? 0,
			});
			if (room.steps !== launched) assert.notEqual(verdict, 'corrected', `step ${room.steps}`);
		}
		assert.equal(device.corrections, 1, 'one correction: the launch');
		const hz = game.online.tickHz;
		const launch = JUMP.launch * CELL;
		const aloft = stepsAloft(launch / hz, launch - (JUMP.gravity * CELL) / hz, hz);
		assert.equal(carried, aloft, 'carried for every input of the leap, stall or not');
		const current = Math.round(1.5 * CELL);
		near(from - to, carried * ((character.speed - current) / hz), 1e-6, 'its ground, upstream');
	},
);

check('a tap mid-batch (two inputs a step) carries exactly the leap’s inputs, then none', () => {
	const seed = 2024;
	const river = salmonsMapRiver(seed);
	const doc = salmonsConfig(river);
	doc.arcade.online.bots.fillTo = 0;
	const room = createRoomSim(onlineGameOf(normalizeGameConfigDoc(doc)), { seed });
	const me = room.join('s', { character: 'salmon' });
	Object.assign(me.body, openWater(river));
	const hz = room.game.online.tickHz;
	const launch = JUMP.launch * CELL;
	const leapAir = stepsAloft(launch / hz, launch - (JUMP.gravity * CELL) / hz, hz);
	const tap = aimFrom(me.body, 6, 0);
	const queue = [];
	for (let seq = 1; seq <= 120; seq++)
		queue.push(
			clampInput(
				{
					seq,
					view: seq - 1,
					moveX: 0,
					moveY: 0,
					buttons: seq === 3 ? BUTTONS.jump : 0,
					...(seq === 3 ? tap : {}),
				},
				room.game.field,
			),
		);
	let most = 0;
	let carried = 0;
	let landedX;
	while (queue.length) {
		const before = me.air ?? 0;
		const x = me.body.x;
		room.step(() => queue.splice(0, 2));
		most = Math.max(most, me.air ?? 0);
		if (before) carried += before - (me.air ?? 0);
		if (most && !me.air && !(me.z > 0)) {
			landedX ??= me.body.x;
			assert.equal(me.body.x, x, `landed, no carry left (step ${room.steps})`);
		}
	}
	assert.ok(most <= leapAir, `at most the leap's inputs (${most})`);
	// The tap's own step spends one: the tap was first of its two.
	assert.equal(carried + (leapAir - most), leapAir, 'carried for exactly the leap’s inputs');
	assert.equal(me.air ?? 0, 0);
	assert.ok(landedX !== undefined, 'it landed');
});

// --- Over the low pieces ------------------------------------------------------------------------

check('a rock stops a salmon below half a cell and lets one at half a cell over it', () => {
	assert.deepEqual({ ...OVER }, { rock: 0.5, whirlpool: 0.5 });
	const zones = [{ id: 'rock0', x: 400, y: 200, w: 72, h: 72 }];
	const rules = [{ zone: 'rock0', solid: true }];
	const field = { w: 2000, h: 2000 };
	const game = { zones, online: { tickHz: 30, rules: { zones: rules } } };
	const hooks = salmonJump.create(game, api);
	const level = onlineLevel(zones, rules, 'salmon', field);
	const ctx = stepContext(30);
	const swim = (z) => {
		const salmon = { character: { id: 'salmon' }, z, memo: {} };
		const body = { x: 300, y: 236, w: 90, h: 44, vx: 0, vy: 0, shape: 'box' };
		const lvl = hooks.level(salmon, level);
		for (let i = 0; i < 30; i++) stepPlayer(body, { moveX: 127, moveY: 0 }, 240, ctx, field, lvl);
		return body.x;
	};
	assert.ok(swim(0) < 400 - 44, 'on the water: stopped at the rock');
	assert.ok(swim(0.49 * CELL) < 400 - 44, 'just under half a cell: stopped');
	assert.ok(swim(0.5 * CELL) > 472, 'half a cell up: over it');
	assert.ok(swim(3 * CELL) > 472, 'at the top of a leap: over it');
	const salmon = { character: { id: 'salmon' }, z: 0.5 * CELL, memo: {} };
	assert.equal(hooks.level(salmon, level), hooks.level(salmon, level), 'one level a height');
});

check(
	'a whirlpool pulls 14·(1 − d/4) cells/s towards its centre within 4 cells, below half a cell',
	() => {
		assert.deepEqual({ ...WHIRLPOOL_PULL }, { radius: 4 * CELL, strength: 14 * CELL });
		const river = salmonsMapRiver(2024);
		const doc = salmonsConfig(river);
		const pool = river.whirlpools[0];
		const geometry = onlineGameOf(normalizeGameConfigDoc(doc));
		const sim = createRoomSim(geometry, { seed: 2024 });
		const rule = sim.game.online.rules.zones.find((r) => r.zone === 'whirlpool0');
		assert.deepEqual(rule.pull, { radius: 4 * CELL, strength: 14 * CELL });
		assert.equal(rule.force, undefined, "the original's pull, not the band river's spin");
		const forces = zoneForces(sim.game.zones, [rule], { character: 'salmon' });
		for (const d of [0.5, 1, 2, 3, 3.9]) {
			const body = { x: pool.x + d * CELL, y: pool.y, w: 10, h: 10, vx: 0, vy: 0 };
			addZoneForces(body, forces, 'salmon');
			near(body.vx, -14 * (1 - d / 4) * CELL, 1e-9, `at ${d} cells`);
			near(body.vy, 0, 1e-9, `at ${d} cells, towards the centre`);
		}
		const diagonal = { x: pool.x + 2 * CELL, y: pool.y - 2 * CELL, w: 10, h: 10, vx: 0, vy: 0 };
		addZoneForces(diagonal, forces, 'salmon');
		const d = 2 * Math.SQRT2;
		near(Math.hypot(diagonal.vx, diagonal.vy), 14 * (1 - d / 4) * CELL, 1e-9, 'diagonal');
		// Held at the centre: a step of `dt` ends on it, never past (no jitter about it).
		for (const px of [0.5, 2, 6]) {
			const near0 = { x: pool.x + px, y: pool.y, w: 10, h: 10, vx: 0, vy: 0 };
			addZoneForces(near0, forces, 'salmon', 1 / 30);
			near(near0.vx / 30, -px, 1e-9, `${px} px from the centre: onto it`);
		}
		const off = { x: pool.x + 2 * CELL, y: pool.y, w: 10, h: 10, vx: 0, vy: 0 };
		addZoneForces(off, forces, 'salmon', 1 / 30);
		near(off.vx, -7 * CELL, 1e-9, 'farther out the clamp does not bite');
		for (const d of [4, 5]) {
			const body = { x: pool.x, y: pool.y + d * CELL, w: 10, h: 10, vx: 0, vy: 0 };
			addZoneForces(body, forces, 'salmon');
			assert.deepEqual([body.vx, body.vy], [0, 0], `at ${d} cells: none`);
		}
		const hooks = SALMONS_RULES.salmons.create(sim.game, api);
		const level = onlineLevel(
			sim.game.zones,
			sim.game.online.rules.zones,
			'salmon',
			sim.game.field,
		);
		const has = (z) =>
			hooks
				.level({ character: { id: 'salmon' }, z, memo: {} }, level)
				.currents.shapes.some((s) => s.id === 'whirlpool0');
		assert.equal(has(0), true);
		assert.equal(has(0.49 * CELL), true);
		assert.equal(has(0.5 * CELL), false, 'half a cell up: no pull');
		const band = salmonsConfig().arcade.online.rules.zones.find((r) => r.zone === 'whirlpool0');
		assert.ok(band?.force && !band.pull, "P10.16's band river keeps its spinning current");
		// …on the water: a leap clears it, as the original's whirlpool does not act in the air.
		const bandGame = onlineGameOf(normalizeGameConfigDoc(salmonsConfig()));
		const bandHooks = SALMONS_RULES.salmons.create(bandGame, api);
		const bandLevel = onlineLevel(
			bandGame.zones,
			bandGame.online.rules.zones,
			'salmon',
			bandGame.field,
		);
		const spins = (z) =>
			bandHooks
				.level({ character: { id: 'salmon' }, z, memo: {} }, bandLevel)
				.currents.shapes.some((s) => s.id === 'whirlpool0');
		assert.equal(spins(0), true, 'the band river: spinning on the water');
		assert.equal(spins(0.5 * CELL), false, 'the band river: a leap clears its current');
	},
);

// --- The line travels: cast at the water, reeled home, hooking by the bobber ------------------

check(
	'the line lands where it is cast (water only), reels home at 8 tiles/s and hooks the first salmon by it',
	() => {
		const tickHz = 30;
		const water = { id: 'band0Water', x: 0, y: 0, w: 1000, h: 400 };
		const game = { zones: [water], online: { tickHz, rules: { zones: [] } } };
		const player = (id, character, x, z = 0) => ({
			id,
			character: { id: character },
			body: { x, y: 100 },
			connected: true,
			status: STATUS.free,
			until: 0,
			safeUntil: 0,
			z,
			memo: {},
			cooldowns: {},
		});
		const ability = { score: 1, hold: 30, reach: 1.5 * CELL, targets: ['salmon'] };
		const events = [];
		const worldOf = (players, stamp) => ({
			players,
			stamp,
			tickHz,
			round: 1,
			seed: 1,
			emit: (e) => events.push(e),
		});
		const line = SALMONS_RULES.fishingLine.create(game, api);
		const f = player('f', 'fisherman', 1100);
		assert.equal(line.cast(f, ability, { x: 1050, y: 100 }), false, 'not onto the bank');
		assert.equal(line.cast(f, ability, { x: 400, y: 100 }), true, 'into the water, any range');
		assert.deepEqual([f.lineActive, f.lineX, f.lineY], [1, 400, 100]);
		assert.equal(line.cast(f, ability, { x: 800, y: 100 }), false, 'one line at a time');
		const aloft = player('aloft', 'salmon', 430, (CLEAR.hook + 0.01) * CELL);
		const next = player('next', 'salmon', 700);
		const far = player('far', 'salmon', 690);
		const players = [f, aloft, far, next];
		line.step(worldOf(players, 1));
		near(f.lineX, 400 + (LINE.reelCellsPerSecond * CELL) / tickHz, 1e-9, 'reeled home one step');
		assert.equal(aloft.status, STATUS.free, 'a salmon in the air is passed over');
		let stamp = 1;
		while (f.lineActive && stamp < 200) line.step(worldOf(players, ++stamp));
		const hooked = events.find((e) => e.type === 'hooked');
		assert.equal(hooked.target, 'far', 'the first in player order within 1.5 tiles of the bobber');
		assert.equal(far.status, STATUS.out, 'landed at the fisherman');
		assert.equal(next.status, STATUS.free, 'one fish a line');
		assert.deepEqual(
			events.map((e) => e.type),
			['hooked', 'caught'],
		);
	},
);

// --- Under the water, or through its surface ---------------------------------------------------

check("the look is under the water's tint on open water up to 0.1 cells, else above it", () => {
	assert.equal(underwater(0, true, false), true, 'swimming in open water');
	assert.equal(underwater(0.1, true, false), true, 'at 0.1 cells: still under');
	assert.equal(underwater(0.11, true, false), false, 'above 0.1 cells: through the surface');
	assert.equal(underwater(0, false, false), false, 'on a bank, a sandbank or a rock');
	assert.equal(underwater(0, true, true), false, 'climbing a waterfall');
	const m = underTint(0x0ea5e9, 0.75);
	assert.equal(m.length, 20);
	const apply = (rgb) => [0, 1, 2].map((i) => m[i * 5 + i] * rgb[i] + m[i * 5 + 4]);
	const T = [0x0e / 255, 0xa5 / 255, 0xe9 / 255];
	apply([1, 0.5, 0.2]).forEach((v, i) =>
		near(v, 0.25 * [1, 0.5, 0.2][i] + 0.75 * T[i], 1e-12, `channel ${i}: a tint square over it`),
	);
	assert.deepEqual(m.slice(15), [0, 0, 0, 1, 0], 'its alpha kept');
});

console.log(`${passed} salmon leap checks passed`);
