// The fisherman's catch in his hands, and his throw (`engine-mechanics` `salmonsRules.js`
// `fishingLine`, a `hook` ability's `carry`; owner, 2026-11-24), run in the room the game server
// runs (`services/game-server` `roomSim.ts`):
// - a catch leaves no blood and puts nobody out: the salmon is `held` in his hands, on his place,
//   and nobody else can hook or claw it;
// - only the holder's press throws it, only while he holds it, and no further than `throwPx` nor off
//   the field; it flies, lands, is out THERE, and its bloodstain is there;
// - held too long, or its holder caught, dropped or gone, it is dropped where it is and is out the
//   same way; a round that ends lets it go; nothing stays held;
// - a round's scores are what they were before the hold: one catch, one score, at the death;
// - a config from before `carry` plays as it always did, and an input with no aim still throws;
// - bots: a fisherman bot throws what it holds, and a room of bots leaves nobody stuck;
// - the config: `carry` and `rules.stains` are normalized, resolved, held to their limits and
//   validated; the events reach Flow.
// How the pools and the trail are drawn (over the water, see-through) is `check:salmons-art`'s.
//
// Run: pnpm check:salmons-throw

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STATUS } from '../packages/engine-mechanics/src/abilities.js';
import { BUTTONS, clampInput } from '../packages/engine-mechanics/src/online.js';
import { ONLINE_FLOW_EVENTS, flowSignalsOf } from '../packages/engine-mechanics/src/onlineFlow.js';
import { isBotId } from '../packages/engine-mechanics/src/onlineBots.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { CELL } from '../packages/engine-mechanics/src/salmonsMap.js';
import { BOT_THROW, CARRY, throwTarget } from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	ARCADE_ONLINE_CARRY_DEFAULTS,
	ARCADE_ONLINE_CARRY_LIMITS,
	ARCADE_ONLINE_STAIN_DEFAULTS,
	normalizeGameConfigDoc,
	onlineGameOf,
	onlineGameWithCarry,
	onlineStainsOf,
	validateOnlineCarry,
	withOnlineCarry,
} from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (error) {
		console.error(`✗ ${name}\n${error.stack ?? error.message}`);
		process.exitCode = 1;
	}
};

/** Salmons with no bots; `edit(doc)` changes the config first. */
const gameOf = (edit = () => {}, bots = false) => {
	const doc = salmonsConfig();
	if (!bots) delete doc.arcade.online.bots;
	edit(doc);
	// As the game server plays it (`configSource.ts`): the hook's `carry` off the raw doc.
	return onlineGameWithCarry(onlineGameOf(normalizeGameConfigDoc(doc)), doc);
};
const hookOf = (doc) => doc.arcade.online.rules.abilities.find((a) => a.effect === 'hook');
const SALMONS = gameOf();
const HZ = SALMONS.online.tickHz;
const CARRIED = SALMONS.online.rules.abilities.find((a) => a.effect === 'hook').carry;
const steps = (ms) => Math.round((ms * HZ) / 1000);

/** The water `rows` cells along the river from `from`, two cells in from the bank nearest it. */
const waterAlong = (sim, from, rows) => {
	const y = from.y + rows * CELL;
	const water = sim.game.zones.find(
		(z) => /^band\d+Water$/.test(z.id) && y >= z.y && y < z.y + z.h,
	);
	const right = water.x + water.w;
	return { x: from.x > right ? right - 2 * CELL : water.x + 2 * CELL, y };
};

/**
 * A room with the fisherman `me` and the salmon `fish` (and whoever `others` names: id →
 * character), every event it raised, and `run(n, inputs)` for `n` steps (`inputs(id, seq)` an
 * input's fields, none: at rest). `me` is kept on his place unless `free` names him.
 */
function scene(game = SALMONS, others = {}) {
	const sim = createRoomSim(game, { seed: 5 });
	const me = sim.join('me', { character: 'fisherman' });
	const fish = sim.join('fish', { character: 'salmon' });
	const more = Object.fromEntries(
		Object.entries(others).map(([id, character]) => [id, sim.join(id, { character })]),
	);
	const from = { x: me.body.x, y: me.body.y };
	const at = waterAlong(sim, from, -3);
	const events = [];
	const pinned = new Map([[me, from]]);
	let seq = 0;
	const run = (n, inputs = () => undefined) => {
		for (let i = 0; i < n; i++) {
			seq += 1;
			for (const [player, place] of pinned) Object.assign(player.body, place);
			events.push(...sim.step((id) => [clampInput({ seq, ...inputs(id, seq) }, sim.game.field)]));
		}
	};
	const press = (id, aim) => (who) =>
		who === id ? { buttons: BUTTONS.ability1, aimX: aim.x, aimY: aim.y } : undefined;
	/** `me` casts at the salmon and reels it home: until it is in his hands, or out. */
	const land = () => {
		pinned.set(fish, at);
		run(2 * HZ);
		run(1, press('me', at));
		pinned.delete(fish);
		for (let i = 0; i < 10 * HZ && fish.status === STATUS.hooked; i++) run(1);
	};
	return { sim, me, fish, more, from, at, events, run, press, land, pinned };
}
const types = (events, ...of) => events.filter((e) => of.includes(e.type)).map((e) => e.type);
const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// --- The catch ----------------------------------------------------------------------------------

check('a catch puts nobody out and leaves no blood: the salmon is in his hands', () => {
	const s = scene();
	s.land();
	assert.equal(s.fish.status, STATUS.held, 'held, not out');
	assert.equal(s.fish.heldBy, 'me', 'the room says by whom');
	assert.deepEqual(types(s.events, 'hooked', 'held', 'caught', 'landed'), ['hooked', 'held']);
	assert.equal(s.sim.rules.stains.made, 0, 'no bloodstain at the catch');
	assert.equal(s.me.score, 0, 'no score before it dies');
	assert.deepEqual({ x: s.fish.body.x, y: s.fish.body.y }, s.from, 'on his place');
	s.run(HZ);
	assert.equal(s.sim.rules.stains.made, 0, 'nor while he holds it');
	assert.equal(s.me.lineActive, 0, 'his line is home');
});

check('held, it cannot move or act, and nobody else can hook or claw it', () => {
	// A bear that claws salmon alone here: one that took the fisherman would drop the fish.
	const game = gameOf((doc) => {
		doc.arcade.online.rules.abilities.find((a) => a.character === 'bear').targets = ['salmon'];
	});
	const s = scene(game, { rival: 'fisherman', bear: 'bear' });
	s.land();
	s.pinned.set(s.more.rival, { x: s.from.x, y: s.from.y + CELL });
	s.pinned.set(s.more.bear, { x: s.from.x + CELL / 2, y: s.from.y });
	// It steers and taps jump; the rival casts at it; the bear swipes at it, the fish in its reach.
	s.run(steps(CARRY.gripMs), (id) =>
		id === 'fish'
			? { moveX: 127, moveY: 127, buttons: BUTTONS.jump }
			: id === 'rival'
				? { buttons: BUTTONS.ability1, aimX: s.fish.body.x, aimY: s.fish.body.y }
				: id === 'bear'
					? { buttons: BUTTONS.ability1, moveX: -127 }
					: undefined,
	);
	assert.equal(s.fish.status, STATUS.held, 'still in his hands');
	assert.equal(s.fish.heldBy, 'me');
	assert.deepEqual({ x: s.fish.body.x, y: s.fish.body.y }, s.from, 'where he is');
	assert.equal(s.fish.z ?? 0, s.me.z ?? 0, 'it did not leap');
	assert.deepEqual(types(s.events, 'caught', 'hit', 'jumped'), [], 'nobody took it');
	assert.equal(s.more.bear.score + s.more.rival.score, 0);
	// He walks: it goes with him.
	const to = { x: s.from.x, y: s.from.y - 2 * CELL };
	s.pinned.set(s.me, to);
	s.run(2);
	assert.deepEqual({ x: s.fish.body.x, y: s.fish.body.y }, to, 'carried with him');
});

// --- The throw ----------------------------------------------------------------------------------

check('a throw is the holder’s alone: refused from anyone else, with no fish, or too soon', () => {
	const s = scene(SALMONS, { rival: 'fisherman' });
	const land = { x: s.from.x, y: s.from.y + 2 * CELL };
	// No fish in his hands: a press at the bank casts nothing and throws nothing.
	s.run(2 * HZ);
	s.run(1, s.press('me', land));
	assert.deepEqual(types(s.events, 'thrown', 'ability'), []);
	s.land();
	assert.equal(s.fish.status, STATUS.held);
	// The same step it came into his hands, and the steps after: not yet (the grip).
	s.run(1, s.press('me', land));
	assert.equal(s.fish.status, STATUS.held, 'a press as it lands throws nothing');
	// The rival's press is his own cast, never a throw of another's fish.
	s.run(steps(CARRY.gripMs));
	s.run(1, s.press('rival', land));
	s.run(1);
	s.run(1, s.press('fish', land));
	assert.equal(s.fish.status, STATUS.held, 'nobody else throws it');
	assert.deepEqual(types(s.events, 'thrown'), []);
	s.run(1);
	s.run(1, s.press('me', land));
	assert.equal(s.fish.status, STATUS.thrown, 'his own press does');
	assert.equal(s.fish.heldBy, '');
	assert.deepEqual(
		s.events.filter((e) => e.type === 'thrown').map((e) => [e.by, e.target]),
		[['me', 'fish']],
	);
	// In the air he has none: his next press is a cast again (on the bank: refused).
	s.run(1);
	s.run(1, s.press('me', land));
	assert.equal(types(s.events, 'thrown').length, 1, 'one fish, one throw');
});

check('the target is held to the throw’s reach and to the field', () => {
	for (const [name, aimOf, expect] of [
		['near', (s) => ({ x: s.from.x + 2 * CELL, y: s.from.y - CELL }), (s, aim) => aim],
		[
			'far',
			(s) => ({ x: s.from.x, y: s.from.y - 40 * CELL }),
			(s) => ({ x: s.from.x, y: s.from.y - CARRIED.throwPx }),
		],
	]) {
		const s = scene();
		s.land();
		s.run(steps(CARRY.gripMs) + 1);
		const aim = aimOf(s);
		s.run(1, s.press('me', aim));
		const thrown = s.events.find((e) => e.type === 'thrown');
		const want = expect(s, aim);
		assert.ok(far(thrown, want) < 1e-6, `${name}: thrown at ${thrown.x}, ${thrown.y}`);
		assert.ok(far(thrown, s.from) <= CARRIED.throwPx + 1e-6, `${name}: within the reach`);
	}
	// The rule itself, whatever a device sends: the reach, the field's four edges, and no aim.
	const field = { w: 1000, h: 2000 };
	const ahead = { x: 0, y: -1 };
	assert.deepEqual(throwTarget({ x: 500, y: 500 }, { x: 500, y: 100 }, 300, ahead, field), {
		x: 500,
		y: 200,
	});
	assert.deepEqual(throwTarget({ x: 50, y: 50 }, { x: -200, y: 50 }, 300, ahead, field), {
		x: 0,
		y: 50,
	});
	assert.deepEqual(throwTarget({ x: 50, y: 50 }, { x: 50, y: -200 }, 300, ahead, field).y, 0);
	assert.deepEqual(
		throwTarget({ x: 950, y: 1950 }, { x: 1200, y: 1950 }, 300, ahead, field).x,
		1000,
	);
	assert.deepEqual(
		throwTarget({ x: 950, y: 1950 }, { x: 950, y: 2200 }, 300, ahead, field).y,
		2000,
	);
	assert.deepEqual(throwTarget({ x: 500, y: 500 }, { x: 0, y: 0 }, 300, ahead, field), {
		x: 500,
		y: 200,
	});
	// Off the field: from its edge, the aim outside it.
	const s = scene();
	s.land();
	const edge = { x: 10, y: s.from.y };
	s.pinned.set(s.me, edge);
	s.run(steps(CARRY.gripMs) + 1);
	// A device cannot aim off the field (the room clamps an input's aim); the rule holds it too.
	s.run(1, s.press('me', { x: -500, y: s.from.y }));
	const thrown = s.events.find((e) => e.type === 'thrown');
	assert.ok(thrown.x >= 0 && thrown.x <= s.sim.game.field.w, 'on the field');
});

check('it flies in an arc, lands, dies THERE, and the blood is there and nowhere else', () => {
	for (const where of ['water', 'land']) {
		const s = scene();
		s.land();
		s.run(steps(CARRY.gripMs) + 1);
		const aim =
			where === 'water'
				? { x: s.at.x, y: s.at.y - 2 * CELL }
				: { x: s.from.x, y: s.from.y + 3 * CELL };
		s.run(1, s.press('me', aim));
		const flight = steps(CARRIED.flightMs);
		let top = 0;
		for (let i = 1; i < flight; i++) {
			s.run(1, (id) => (id === 'fish' ? { moveX: 127, buttons: BUTTONS.jump } : undefined));
			assert.equal(s.fish.status, STATUS.thrown, `${where}: in the air at step ${i}`);
			top = Math.max(top, s.fish.z);
		}
		assert.ok(top > CELL, `${where}: an arc, ${top} px at its top`);
		assert.equal(s.sim.rules.stains.made, 0, `${where}: no blood before it lands`);
		assert.equal(s.me.score, 0, `${where}: no score before it lands`);
		s.run(1);
		assert.equal(s.fish.status, STATUS.out, `${where}: out when it lands`);
		assert.ok(far(s.fish.body, aim) < 1e-6, `${where}: at the place thrown to`);
		assert.equal(s.fish.z, 0);
		assert.deepEqual(types(s.events, 'held', 'thrown', 'landed', 'caught'), [
			'held',
			'thrown',
			'landed',
			'caught',
		]);
		const caught = s.events.find((e) => e.type === 'caught');
		assert.deepEqual([caught.by, caught.target, caught.effect], ['me', 'fish', 'hook']);
		const landed = s.events.find((e) => e.type === 'landed');
		assert.ok(far(landed, aim) < 1e-6 && !landed.dropped);
		assert.equal(s.me.score, 1, `${where}: the catch scores at the death`);
		s.run(2);
		const { list, made } = s.sim.rules.stains;
		assert.equal(made, 1, `${where}: one pool`);
		assert.ok(far(list[0], aim) < 1e-6, `${where}: the pool is where it landed`);
		assert.ok(far(list[0], s.at) > CELL && far(list[0], s.from) > CELL, 'not at the catch');
	}
});

// --- Never stuck --------------------------------------------------------------------------------

/** What every drop must be: out, at `place`, one pool there, the catch scored, told as dropped. */
const dropped = (s, place, what, scored = 1) => {
	assert.equal(s.fish.status, STATUS.out, `${what}: it is out`);
	assert.equal(s.fish.heldBy, '', `${what}: in nobody's hands`);
	const landed = s.events.find((e) => e.type === 'landed');
	assert.ok(landed?.dropped, `${what}: told as dropped`);
	assert.deepEqual(types(s.events, 'thrown', 'caught'), ['caught'], `${what}: its catch is told`);
	s.run(2);
	const { list, made } = s.sim.rules.stains;
	assert.equal(made, 1, `${what}: one pool`);
	assert.ok(far(list[0], place) < 1e-6, `${what}: at his feet`);
	assert.equal(s.me.score, scored, `${what}: the score`);
};

check('never thrown, it is dropped at his feet when the hold runs out, and dies there', () => {
	const s = scene();
	s.land();
	const hold = steps(CARRIED.holdMs);
	s.run(hold - 1);
	assert.equal(s.fish.status, STATUS.held, 'held to the last step');
	s.run(1);
	dropped(s, s.from, 'the time-out');
	assert.equal(ARCADE_ONLINE_CARRY_DEFAULTS.holdMs, CARRIED.holdMs);
});

check('its holder leaving, dropping or being caught drops it the same way', () => {
	const left = scene();
	left.land();
	left.run(5);
	left.sim.leave('me');
	left.pinned.clear();
	left.run(1);
	dropped(left, left.from, 'he left', 0);

	const drop = scene();
	drop.land();
	drop.run(5);
	drop.sim.drop('me');
	drop.run(1);
	dropped(drop, drop.from, 'his connection dropped');

	const clawed = scene(SALMONS, { bear: 'bear' });
	clawed.land();
	clawed.pinned.set(clawed.more.bear, { x: clawed.from.x + CELL / 2, y: clawed.from.y });
	// The bear's swipe takes the fisherman (a target of its), never the fish in his hands.
	for (let i = 0; i < 2 * HZ && clawed.me.status === STATUS.free; i++)
		clawed.run(1, (id) => (id === 'bear' ? { buttons: i % 2 ? 0 : BUTTONS.ability1 } : undefined));
	assert.equal(clawed.me.status, STATUS.out, 'the bear caught the fisherman');
	clawed.pinned.delete(clawed.me);
	clawed.run(1);
	const events = clawed.events.filter((e) => e.type === 'caught');
	assert.deepEqual(
		events.map((e) => [e.by, e.target]),
		[
			['bear', 'me'],
			['me', 'fish'],
		],
		'the bear’s catch, then the fish’s death, his',
	);
	assert.equal(clawed.fish.status, STATUS.out);
	assert.equal(clawed.me.score, 1, 'the fish still scores for him');
});

check('a holder caught and back in one step is its holder no more: it is dropped', () => {
	// A device may send its Respawn with every input, so a catch and the respawn can be one step:
	// he is free again, somewhere else, perhaps as another class, before the hold looks at him.
	const s = scene();
	s.land();
	s.run(5);
	s.pinned.clear();
	s.sim.rules.respawned(s.me, s.sim.steps);
	s.run(1);
	assert.equal(s.fish.status, STATUS.out, 'dropped, not carried off to his spawn');
	assert.equal(s.fish.heldBy, '');
	assert.ok(far(s.fish.body, s.from) < 1e-6, 'where he held it');
	assert.ok(s.events.find((e) => e.type === 'landed')?.dropped);
	s.run(steps(CARRIED.holdMs) + 5, s.press('me', s.at));
	assert.deepEqual(types(s.events, 'thrown'), [], 'and his press throws nothing');
});

check('a carry the room was not given resolved is no carry: the catch is out when landed', () => {
	// `onlineGameOf` of a doc that was never normalized passes the raw `carry: {}` through.
	const doc = salmonsConfig();
	delete doc.arcade.online.bots;
	const raw = onlineGameOf(doc);
	assert.deepEqual(raw.online.rules.abilities.find((a) => a.effect === 'hook').carry, {});
	const s = scene(raw);
	s.land();
	assert.equal(s.fish.status, STATUS.out);
	assert.deepEqual(types(s.events, 'held', 'thrown', 'landed', 'caught'), ['caught']);
	assert.ok(Number.isFinite(s.fish.body.x) && Number.isFinite(s.fish.body.y));
});

check('the held salmon leaving empties his hands: he casts again', () => {
	const s = scene();
	s.land();
	s.sim.leave('fish');
	s.run(steps(CARRY.gripMs) + 2);
	s.run(1, s.press('me', s.at));
	assert.equal(s.me.lineActive, 1, 'a cast, not a throw');
	assert.deepEqual(types(s.events, 'thrown', 'landed', 'caught'), []);
});

check('a round that ends lets a held or thrown salmon go: nobody is left in hands', () => {
	for (const phase of ['held', 'thrown']) {
		const game = gameOf((doc) => {
			doc.arcade.online.rules.round = { seconds: 5, nextRoundSeconds: 5 };
			hookOf(doc).carry = { holdMs: 60_000, flightMs: 5000 };
		});
		const s = scene(game);
		s.land();
		if (phase === 'thrown') {
			s.run(steps(CARRY.gripMs) + 1);
			s.run(1, s.press('me', s.at));
		}
		assert.equal(s.fish.status, STATUS[phase]);
		for (let i = 0; i < 6 * HZ && s.sim.rules.phase === 'running'; i++) s.run(1);
		assert.equal(s.sim.rules.phase, 'ended');
		assert.equal(s.fish.status, STATUS.free, `${phase}: let go`);
		assert.equal(s.fish.heldBy, '');
		assert.equal(s.fish.z ?? 0, 0, `${phase}: on the ground`);
		for (let i = 0; i < 6 * HZ && s.sim.rules.phase !== 'running'; i++) s.run(1);
		s.run(3 * HZ);
		assert.deepEqual(types(s.events, 'landed', 'caught'), [], `${phase}: no death after the round`);
		assert.equal(s.fish.status, STATUS.free, `${phase}: free in the next round`);
	}
});

// --- Scores and old configs ---------------------------------------------------------------------

check('a round’s scores are what they were: one catch, one score, with the hold or without', () => {
	const tally = (game) => {
		const s = scene(game);
		for (let n = 0; n < 3; n++) {
			s.land();
			// Thrown, or (the last) left to drop.
			if (s.fish.status === STATUS.held && n < 2) {
				s.run(steps(CARRY.gripMs) + 1);
				s.run(1, s.press('me', s.at));
			}
			for (let i = 0; i < 10 * HZ && s.fish.status !== STATUS.out; i++) s.run(1);
			assert.equal(s.fish.status, STATUS.out);
			s.run(2);
			// A bot's catch ends on its own; a person's on its Respawn.
			s.fish.bot = true;
			s.fish.until = s.sim.steps;
			s.run(2);
			s.fish.bot = false;
			assert.equal(s.fish.status, STATUS.free, 'back for the next catch');
		}
		return {
			score: s.me.score,
			fish: s.fish.score,
			caught: types(s.events, 'caught').length,
			stains: s.sim.rules.stains.made,
		};
	};
	const before = tally(gameOf((doc) => delete hookOf(doc).carry));
	const now = tally(SALMONS);
	assert.deepEqual(now, before);
	assert.deepEqual(now, { score: 3, fish: 0, caught: 3, stains: 3 });
});

check(
	'a config from before the hold plays as it did: out when landed, the stain at the hook',
	() => {
		const s = scene(gameOf((doc) => delete hookOf(doc).carry));
		s.land();
		assert.equal(s.fish.status, STATUS.out, 'out as it is landed');
		assert.deepEqual(types(s.events, 'hooked', 'held', 'thrown', 'landed', 'caught'), [
			'hooked',
			'caught',
		]);
		s.run(2);
		const { list, made } = s.sim.rules.stains;
		assert.equal(made, 1);
		assert.ok(far(list[0], s.at) < CELL, 'where it was hooked');
		assert.equal(s.me.score, 1);
	},
);

check('an old device’s messages still play: a press with no aim throws ahead of him', () => {
	const s = scene();
	s.land();
	s.run(steps(CARRY.gripMs) + 1);
	// What a runtime from before the throw sends for a key's press: the button, no aim, no view.
	s.run(1, (id) => (id === 'me' ? { buttons: BUTTONS.ability1 } : undefined));
	const thrown = s.events.find((e) => e.type === 'thrown');
	assert.ok(thrown, 'thrown');
	assert.ok(Math.abs(far(thrown, s.from) - CARRIED.throwPx) < 1e-6, 'the whole reach, ahead');
	// And its cast, as it has always sent it, is the throw: nothing new is asked of it.
	const t = scene();
	t.land();
	t.run(steps(CARRY.gripMs) + 1);
	t.run(1, t.press('me', t.at));
	assert.equal(t.fish.status, STATUS.thrown);
});

check('walk: false holds him still while he holds; the default lets him walk', () => {
	const still = scene(gameOf((doc) => (hookOf(doc).carry = { walk: false })));
	assert.equal(still.sim.rules.holds(still.me), false, 'free before the catch');
	still.land();
	assert.equal(still.sim.rules.holds(still.me), true, 'held still with it');
	still.run(steps(CARRY.gripMs) + 1);
	still.run(1, still.press('me', still.at));
	assert.equal(still.sim.rules.holds(still.me), false, 'free once it is thrown');
	const walks = scene();
	walks.land();
	assert.equal(walks.sim.rules.holds(walks.me), false);
});

// --- Bots ---------------------------------------------------------------------------------------

check('a bot fisherman throws what it holds, after a person’s pause, within its reach', () => {
	const sim = createRoomSim(
		gameOf(() => {}, true),
		{ seed: 9 },
	);
	const fish = sim.join('fish', { character: 'salmon' });
	const bot = [...sim.players.values()].find((p) => p.bot && p.character.id === 'fisherman');
	for (const other of [...sim.players.values()])
		if (other.bot && other !== bot) sim.players.delete(other.id);
	const events = [];
	let heldAt;
	let thrownAt;
	let seq = 0;
	for (let i = 0; i < 90 * HZ && fish.status !== STATUS.out; i++) {
		seq += 1;
		// The salmon keeps still in the water beside him until it is hooked.
		if (fish.status === STATUS.free) Object.assign(fish.body, waterAlong(sim, bot.body, 0));
		for (const e of sim.step((id) => (isBotId(id) ? [] : [clampInput({ seq }, sim.game.field)]))) {
			events.push(e);
			if (e.type === 'held') heldAt = sim.steps;
			if (e.type === 'thrown') thrownAt = sim.steps;
		}
	}
	assert.ok(heldAt, 'it caught the salmon into its hands');
	assert.ok(thrownAt, 'and threw it');
	const waited = ((thrownAt - heldAt) * 1000) / HZ;
	assert.ok(
		waited >= BOT_THROW.ms.min - 1000 / HZ && waited <= BOT_THROW.ms.max + 2000 / HZ,
		`it waited ${waited} ms`,
	);
	const thrown = events.find((e) => e.type === 'thrown');
	assert.ok(far(thrown, bot.body) <= CARRIED.throwPx + 2 * CELL, 'within its reach');
	assert.equal(fish.status, STATUS.out);
	assert.equal(bot.score, 1);
});

/** A room of bots for `seconds`: what was held, thrown and landed, and the longest anyone stayed
 *  held or in the air (steps). Every step, whoever is held is in the hands of a fisherman who is
 *  there and free, on his place. */
const botRoom = (size, seconds, seed) => {
	const sim = createRoomSim(resolveSized(size), { seed });
	const person = sim.join('watcher', { character: 'salmon' });
	const count = { held: 0, thrown: 0, landed: 0, dropped: 0, caught: 0 };
	const since = new Map();
	let longest = 0;
	let inHands = 0;
	let seq = 0;
	for (let i = 0; i < seconds * HZ; i++) {
		seq += 1;
		for (const e of sim.step((id) => (isBotId(id) ? [] : [clampInput({ seq }, sim.game.field)]))) {
			if (e.type in count) count[e.type] += 1;
			if (e.type === 'landed' && e.dropped) count.dropped += 1;
		}
		// The game won (a bot salmon at the source): whoever was carried is let go, not out.
		if (sim.rules.phase !== 'running') break;
		inHands = 0;
		for (const p of sim.players.values()) {
			const carried = p.status === STATUS.held || p.status === STATUS.thrown;
			if (!carried) {
				since.delete(p.id);
				assert.ok(!p.heldBy, `${p.id} is in nobody's hands`);
				continue;
			}
			inHands += 1;
			if (!since.has(p.id)) since.set(p.id, sim.steps);
			longest = Math.max(longest, sim.steps - since.get(p.id));
			if (p.status !== STATUS.held) continue;
			const holder = sim.players.get(p.heldBy);
			assert.ok(holder?.connected && holder.status === STATUS.free, `${p.id}'s holder is there`);
			assert.equal(holder.character.id, 'fisherman');
			assert.ok(far(p.body, holder.body) < 1e-6, `${p.id} is on its holder's place`);
		}
	}
	void person;
	assert.ok(
		[...sim.players.values()].every((p) => sim.rules.phase === 'running' || !p.heldBy),
		'a game that ended left nobody in hands',
	);
	const carried = inHands;
	return { ...count, carried, longest };
};
const SIZED = new Map();
const resolveSized = (size) => {
	if (!SIZED.has(size)) {
		const doc = salmonsConfig();
		SIZED.set(size, onlineGameWithCarry(onlineGameOf(normalizeGameConfigDoc(doc), { size }), doc));
	}
	return SIZED.get(size);
};

for (const [size, seconds] of [
	[10, 120],
	[30, 90],
	[100, 60],
]) {
	check(`a room of ${size} with bots: fishermen hold and throw, and nobody stays held`, () => {
		const most = steps(CARRIED.holdMs) + steps(CARRIED.flightMs) + 1;
		let held = 0;
		let thrown = 0;
		for (const seed of [3, 11]) {
			const room = botRoom(size, seconds, seed);
			held += room.held;
			thrown += room.thrown;
			assert.equal(
				room.landed + room.carried,
				room.held,
				`seed ${seed}: every one of ${room.held} held came down, or is in hands as the run ends`,
			);
			assert.ok(room.caught >= room.landed);
			assert.ok(
				room.longest <= most,
				`seed ${seed}: ${room.longest} steps carried, at most ${most}`,
			);
		}
		assert.ok(held > 0, 'salmon were caught into hands');
		assert.ok(thrown >= held * 0.8, `${thrown} of ${held} were thrown, the rest dropped`);
	});
}

// --- The config ---------------------------------------------------------------------------------

check('carry and stains: carried past the normalizer, resolved, held to limits, validated', () => {
	const doc = salmonsConfig();
	assert.deepEqual(hookOf(doc).carry, {}, 'Salmons turns the hold on, at the defaults');
	// The normalizer drops both (the other runtimes' bytes); the launcher's save, the exporter and
	// the game server read them off the raw doc.
	const normalized = normalizeGameConfigDoc(doc);
	assert.equal(hookOf(normalized).carry, undefined, 'the normalizer drops a carry');
	const stored = withOnlineCarry(normalized, doc);
	assert.deepEqual(hookOf(stored).carry, {}, 'the carry puts it back');
	assert.deepEqual(hookOf(withOnlineCarry(normalizeGameConfigDoc(stored), stored)).carry, {});
	assert.equal(withOnlineCarry(normalized, normalized), normalized, 'none: the doc itself');
	const plain = onlineGameOf(normalized);
	assert.equal(onlineGameWithCarry(plain, normalized), plain, 'none: the game itself');
	assert.deepEqual(CARRIED, ARCADE_ONLINE_CARRY_DEFAULTS);
	assert.deepEqual(ARCADE_ONLINE_CARRY_DEFAULTS, {
		holdMs: 4000,
		throwPx: 8 * CELL,
		flightMs: 600,
		walk: true,
	});
	assert.deepEqual(onlineStainsOf(doc), ARCADE_ONLINE_STAIN_DEFAULTS);
	assert.deepEqual(ARCADE_ONLINE_STAIN_DEFAULTS, { opacity: 0.3, trailOpacity: 0.3 });

	const L = ARCADE_ONLINE_CARRY_LIMITS;
	const wild = salmonsConfig();
	delete wild.arcade.online.bots;
	hookOf(wild).carry = { holdMs: 1, throwPx: 1e6, flightMs: 1e6, walk: false, junk: 1 };
	wild.arcade.online.rules.stains = { opacity: 7, trailOpacity: 0 };
	const played = onlineGameWithCarry(onlineGameOf(normalizeGameConfigDoc(wild)), wild);
	assert.deepEqual(played.online.rules.abilities.find((a) => a.effect === 'hook').carry, {
		holdMs: L.holdMs.min,
		throwPx: L.throwPx.max,
		flightMs: L.flightMs.max,
		walk: false,
	});
	assert.deepEqual(onlineStainsOf(wild), { opacity: 1, trailOpacity: 0 });
	const kept = withOnlineCarry(normalizeGameConfigDoc(wild), wild);
	assert.deepEqual(hookOf(kept).carry, { holdMs: 1, throwPx: 1e6, flightMs: 1e6, walk: false });
	assert.deepEqual(kept.arcade.online.rules.stains, { opacity: 1, trailOpacity: 0 });

	// A carry on anything but a hook is not carried; junk is not a carry.
	const odd = salmonsConfig();
	odd.arcade.online.rules.abilities[0].carry = { holdMs: 2000 };
	hookOf(odd).carry = 'yes';
	const oddStored = withOnlineCarry(normalizeGameConfigDoc(odd), odd);
	assert.ok(oddStored.arcade.online.rules.abilities.every((a) => a.carry === undefined));

	assert.deepEqual(validateOnlineCarry(doc), [], 'Salmons as shipped: nothing to say');
	hookOf(odd).carry = { holdMs: 1, throwPx: 1e6, flightMs: 1 };
	odd.arcade.online.rules.stains = { opacity: 2, trailOpacity: -1 };
	const paths = validateOnlineCarry(odd).map((i) => i.path.replace(/^.*abilities\[\d\]\./, ''));
	assert.deepEqual(paths.sort(), [
		'arcade.online.rules.stains.opacity',
		'arcade.online.rules.stains.trailOpacity',
		'carry',
		'carry.flightMs',
		'carry.holdMs',
		'carry.throwPx',
	]);
	assert.ok(validateOnlineCarry(odd).every((i) => i.severity === 'warning'));
	// The export that is published, and the game server that plays it, both carry it.
	const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
	assert.match(read('./salmons/export.mjs'), /withOnlineCarry\(/, 'the export ships the carry');
	assert.match(
		read('../services/game-server/src/configSource.ts'),
		/onlineGameWithCarry\(resolvedGame, docRaw\)/,
		'the game server plays it',
	);
});

check('the hold, the throw and the landing reach Flow and the sheets, with who and where', () => {
	// (That Flow's own vocabulary lists them is `check:flow-variables`'.)
	for (const name of ['held', 'thrown', 'landed']) assert.equal(ONLINE_FLOW_EVENTS[name], name);
	const signals = flowSignalsOf(
		[
			{ type: 'held', by: 'f', target: 's' },
			{ type: 'thrown', by: 'f', target: 's', x: 10, y: 20 },
			{ type: 'landed', by: 'f', target: 's', x: 10, y: 20, dropped: true },
		],
		's',
		(id) => (id === 'f' ? { x: 1, y: 2, character: 'fisherman' } : undefined),
	);
	assert.deepEqual(signals, [
		{ name: 'held', payload: { by: 'f', target: 's', x: 1, y: 2, mine: false, me: true } },
		{ name: 'thrown', payload: { by: 'f', target: 's', x: 10, y: 20, mine: false, me: true } },
		{
			name: 'landed',
			payload: { by: 'f', target: 's', x: 10, y: 20, dropped: true, mine: false, me: true },
		},
	]);
});

if (!process.exitCode) console.log(`check:salmons-throw: ${passed} checks passed`);
