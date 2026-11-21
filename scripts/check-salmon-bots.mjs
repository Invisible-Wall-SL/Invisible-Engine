// SALMONS' BOT SALMON (docs/status/salmons.md; docs/design/realtime-multiplayer.md §7): a bot that
// plays a salmon through a person's controls and with a person's limits (`engine-mechanics`
// `salmonsRules.js` `BOT_SWIM`, the rules' `botPlay`), and what becomes of one at the source
// (`botGoal`). Headless over the room's own code (`services/game-server` `createRoomSim`) on the
// config as it ships. Its inputs are legal (a move and jump, clamped, its class's speed); it minds
// a bear or a line only after its reaction time and only one it is sent and sees; it reaches the
// source and does not stall; a room of them replays from its seed and leaves the other bots' draws
// alone; a bot at the source ends nothing and is back in the sea, where a person wins the game;
// and a bear bot swipes at a bot it chases.
//
// Run: pnpm check:salmon-bots

import assert from 'node:assert/strict';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { botInput, createBot } from '../packages/engine-mechanics/src/onlineBots.js';
import { generatedOnlineGame } from '../packages/engine-mechanics/src/onlineGenerators.js';
import { STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import { BOT_SWIM } from '../packages/engine-mechanics/src/salmonsRules.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

let passed = 0;
const check = async (name, fn) => {
	try {
		await fn();
		passed += 1;
	} catch (e) {
		console.error(`✗ ${name}`);
		throw e;
	}
};

const doc = normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)));
const shipped = onlineGameOf(doc);
assert.ok(shipped && !('refused' in shipped), JSON.stringify(shipped));
const tickHz = shipped.online.tickHz;
const stepsOf = (ms) => Math.round((ms / 1000) * tickHz);
const brainOf = (id) => doc.arcade.characters.find((c) => c.id === id)?.brain;
const BOTS = {
	salmon: { character: 'salmon', brain: 'salmonBot' },
	bear: { character: 'bear', brain: 'bearBot' },
	fisherman: { character: 'fisherman', brain: 'fishermanBot' },
};

/** The game as it ships with exactly these bots, in this order (by count, not by its shares),
 *  beside the people who join. */
const gameWith = (order, people = 1) => ({
	...shipped,
	brains: Object.fromEntries(Object.values(BOTS).map((b) => [b.brain, brainOf(b.brain)])),
	online: {
		...shipped.online,
		bots: {
			...shipped.online.bots,
			counts: undefined,
			characters: order,
			fillTo: order.length + people,
		},
	},
});
const of = (counts) =>
	Object.entries(counts).flatMap(([character, n]) =>
		Array.from({ length: n }, () => BOTS[character]),
	);
const botsOf = (sim, character) =>
	[...sim.players.values()].filter((p) => p.bot && (!character || p.character.id === character));
const rest = (sim) => () => [clampInput({ seq: sim.steps + 1 }, sim.game.field)];

/** A person's salmon at a bot salmon's controls, its brain never resting: what it would send. */
const AWAKE = { initial: 'swim', states: [{ id: 'swim', behaviour: 'idle' }], transitions: [] };
const pilotOf = (sim, me, seed, overrides = {}) => {
	const pilot = createBot({ brain: AWAKE, seed, at: me.body, character: me.character.id });
	return () =>
		botInput(pilot, me, sim.players.values(), {
			dt: sim.ctx.dt,
			speed: me.character.speed,
			field: sim.game.field,
			view: sim.steps,
			sees: sim.rules.sees,
			nearby: sim.game.online.nearby,
			play: sim.rules.botPlay,
			...overrides,
		});
};

/** A room's water at `y`. */
const waterAt = (sim, y) => {
	const waters = sim.game.zones.filter((z) => /^band\d+Water$/.test(z.id));
	return waters.find((z) => y >= z.y && y < z.y + z.h);
};

await check('the config carries a bot salmon’s brain, and the rules play and send it home', () => {
	assert.deepEqual(
		validateFamily(doc).filter((issue) => issue.severity === 'error'),
		[],
	);
	const brain = brainOf('salmonBot');
	assert.ok(brain, 'arcade.characters has salmonBot');
	assert.deepEqual(
		brain.states.map((s) => [s.id, s.behaviour]),
		[
			['swim', 'idle'],
			['rest', 'idle'],
		],
		'its brain says when it swims and rests; the rules swim it',
	);
	const sim = createRoomSim(shipped, { seed: 1 });
	assert.equal(typeof sim.rules.botPlay, 'function', 'Salmons’ rules play a bot');
	for (const limit of ['reactMs', 'lookMs', 'tapMs', 'stuckMs'])
		assert.ok(BOT_SWIM[limit].min > 0 && BOT_SWIM[limit].max >= BOT_SWIM[limit].min, limit);
	// A person's tap: no faster than every other input, so each is a press after a release.
	assert.ok(stepsOf(BOT_SWIM.tapMs.min) >= 2, 'BOT_SWIM.tapMs.min is at least two inputs');
	// The rules play only the salmon: a bear's and a fisherman's bots are their brains'.
	const me = sim.join('me', { character: 'salmon' });
	const play = { seq: 1, dt: sim.ctx.dt, state: 'swim', notes: {}, stream: () => createRng(1) };
	const land = botsOf(sim).filter((bot) => bot.character.id !== 'salmon');
	assert.ok(land.length > 0, 'the room has bears and fishermen');
	for (const bot of land) assert.equal(sim.rules.botPlay(bot, [], play), undefined);
	assert.ok(sim.rules.botPlay(me, [], play), 'a salmon is played');
});

await check('a room of bots replays exactly from its seed, salmon and all', () => {
	const play = (seed) => {
		const sim = createRoomSim(gameWith(of({ salmon: 6, fisherman: 3, bear: 2 })), { seed });
		sim.join('me', { character: 'salmon' });
		const events = [];
		for (let i = 0; i < 60 * tickHz; i++) events.push(...sim.step(rest(sim)));
		return JSON.stringify({
			events,
			players: [...sim.players.values()].map((p) => [p.id, p.body.x, p.body.y, p.status, p.score]),
		});
	};
	const once = play(7);
	assert.ok(once.includes('"jumped"'), 'the salmon played');
	assert.equal(play(7), once, 'the same seed: the same room, to the px');
	assert.notEqual(play(8), once, 'another seed: another room');
});

await check(
	'what the rules play is an input like any: clamped, and only for a bot they play',
	() => {
		const sim = createRoomSim(shipped, { seed: 2 });
		const me = sim.join('me', { character: 'salmon' });
		const options = { dt: sim.ctx.dt, speed: me.character.speed, field: sim.game.field, view: 0 };
		const wild = createBot({ brain: AWAKE, seed: 1, at: me.body, character: 'salmon' });
		const input = botInput(wild, me, sim.players.values(), {
			...options,
			play: () => ({ moveX: 9e9, moveY: -Infinity, buttons: 0xffff }),
		});
		assert.ok(Math.hypot(input.moveX, input.moveY) <= MOVE_SCALE, 'no faster than its class');
		assert.ok(Number.isInteger(input.moveX) && Number.isInteger(input.moveY));
		assert.equal(input.buttons & ~(BUTTONS.jump | BUTTONS.ability1 | BUTTONS.ability2), 0);
		assert.equal(input.respawn, undefined, 'a bot presses no Respawn');
		// Nothing played: the brain's move, as with no `play` at all.
		const brain = { initial: 'go', states: [{ id: 'go', behaviour: 'wander' }], transitions: [] };
		const inputs = (play) => {
			const bot = createBot({ brain, seed: 9, at: me.body, character: 'salmon' });
			return Array.from({ length: 50 }, () => ({
				...botInput(bot, me, sim.players.values(), { ...options, play }),
			}));
		};
		assert.deepEqual(
			inputs(() => undefined),
			inputs(undefined),
		);
	},
);

await check('salmon bots leave the other bots’ draws as they were', () => {
	// A bot's streams: the rules' play draws from streams of its own, not the brain's or the aim's.
	const draws = (use) => {
		const bot = createBot({
			brain: brainOf('bearBot'),
			seed: 77,
			at: { x: 0, y: 0 },
			abilities: shipped.online.rules.abilities,
			character: 'bear',
		});
		const out = [];
		for (let i = 0; i < 20; i++) {
			if (use) bot.stream('swim')();
			if (use) bot.stream('eye')();
			out.push(bot.brain.rng(), bot.aimRng());
		}
		return out;
	};
	assert.deepEqual(draws(true), draws(false));
	const bot = createBot({ brain: AWAKE, seed: 77, at: { x: 0, y: 0 }, character: 'salmon' });
	assert.equal(bot.stream('swim'), bot.stream('swim'), 'one stream a name');
	assert.notEqual(bot.stream('swim')(), bot.stream('eye')(), 'each its own');
	// A room: the bears and fishermen of a by-count list, with salmon bots let in after them, are
	// where they were, to the px, while no salmon is near one (the sea is 20 cells from any).
	const order = of({ bear: 1, fisherman: 1 }).concat(of({ bear: 1, fisherman: 1 }));
	const places = (salmon) => {
		const sim = createRoomSim(gameWith(order.concat(of({ salmon }))), { seed: 3 });
		sim.join('me', { character: 'bear' });
		assert.equal(botsOf(sim, 'salmon').length, salmon);
		const out = [];
		for (let i = 0; i < 4 * tickHz; i++) {
			sim.step(rest(sim));
			out.push(
				botsOf(sim)
					.filter((p) => p.character.id !== 'salmon')
					.map((p) => [p.id, p.body.x, p.body.y]),
			);
		}
		return out;
	};
	assert.deepEqual(places(5), places(0));
});

await check('a bot salmon sends a move and the jump button, tapped, and nothing else', () => {
	for (const seed of [1, 2, 3]) {
		const sim = createRoomSim(gameWith(of({ bear: 2, fisherman: 2 })), { seed });
		const me = sim.join('me', { character: 'salmon' });
		const next = pilotOf(sim, me, `legal:${seed}`);
		let taps = 0;
		let moved = 0;
		let last = { buttons: 0, seq: 0 };
		for (let i = 0; i < 100 * tickHz && sim.rules.phase === 'running'; i++) {
			const input = next();
			assert.equal(input.buttons & ~BUTTONS.jump, 0, 'only the jump button');
			assert.ok(Number.isInteger(input.moveX) && Number.isInteger(input.moveY));
			assert.ok(Math.hypot(input.moveX, input.moveY) <= MOVE_SCALE, 'its class’s speed at most');
			assert.equal(input.seq, last.seq + 1);
			assert.equal(input.respawn, undefined);
			assert.deepEqual([input.aimX, input.aimY], [Math.fround(me.body.x), Math.fround(me.body.y)]);
			assert.ok(!(input.buttons && last.buttons), 'a tap is let go before the next');
			if (input.buttons) taps += 1;
			if (input.moveX || input.moveY) moved += 1;
			last = input;
			sim.step(() => [input]);
		}
		assert.ok(moved > 20 * tickHz, `room ${seed}: it swam`);
		assert.ok(taps >= 6, `room ${seed}: it tapped jump ${taps} times (six waterfalls)`);
		assert.ok(taps < (100 * tickHz) / stepsOf(BOT_SWIM.tapMs.min), 'no faster than a person taps');
	}
});

/** The river of a seed with its rocks and whirlpools taken out, as a game with a field of its
 *  own: open water, where a salmon turns only for who is on it. */
const openGame = (seed) => {
	const { game } = generatedOnlineGame(gameWith([], 2), seed);
	const piece = (id) => /^(rock|whirlpool)\d+$/.test(id);
	return {
		...game,
		zones: game.zones.filter((z) => !piece(z.id)),
		online: {
			...game.online,
			generator: undefined,
			rules: { ...game.online.rules, zones: game.online.rules.zones.filter((r) => !piece(r.zone)) },
		},
	};
};

/**
 * A person's salmon at a bot's controls on open water, 35 cells below a waterfall, and, from step
 * `at`, a person standing by it (`threat`: a bear 5 cells up the river from where the salmon is
 * then, or a fisherman whose bobber lies beyond the salmon, his line's way home across it); until
 * then, and with no threat, 40 cells behind it. Each input the salmon sends, for `seconds`. A
 * bear that `keeps` its distance stays 5 cells up the river from the salmon as it swims.
 */
const inputsBy = (seed, { threat, at, seconds = 4, overrides, keeps = false }) => {
	const sim = createRoomSim(openGame(seed), { seed });
	const me = sim.join('me', { character: 'salmon' });
	const other = sim.join('other', { character: threat === 'line' ? 'fisherman' : 'bear' });
	const water = waterAt(sim, (5 + 195) * CELL);
	Object.assign(me.body, { x: water.x + water.w / 2, y: water.y + CELL / 2 });
	const far = { x: me.body.x, y: me.body.y + 40 * CELL };
	const next = pilotOf(sim, me, `eye:${seed}`, overrides);
	const inputs = [];
	let place;
	for (let i = 0; i < seconds * tickHz; i++) {
		if (threat && (i === at || (keeps && i > at)))
			place =
				threat === 'line'
					? { x: me.body.x + 6 * CELL, y: me.body.y - 3 * CELL }
					: { x: me.body.x, y: me.body.y - 5 * CELL };
		Object.assign(other.body, place ?? far);
		if (place && threat === 'line')
			Object.assign(other, {
				lineActive: 1,
				lineX: me.body.x - 6 * CELL,
				lineY: me.body.y + 3 * CELL,
			});
		const input = next();
		inputs.push([input.moveX, input.moveY, input.buttons]);
		sim.step((id) => (id === 'me' ? [input] : rest(sim)()));
		assert.equal(me.status, STATUS.free, 'nothing takes it here');
	}
	return inputs;
};
const firstDifference = (a, b) => a.findIndex((input, i) => String(input) !== String(b[i]));

await check('a bot salmon minds a bear only after its reaction time, and then steers', () => {
	const least = stepsOf(BOT_SWIM.reactMs.min);
	const most = stepsOf(BOT_SWIM.reactMs.max) + stepsOf(BOT_SWIM.lookMs.max) + 1;
	const after = [];
	for (let seed = 1; seed <= 12; seed++) {
		const at = tickHz + seed * 3;
		const alone = inputsBy(seed, {});
		const met = inputsBy(seed, { threat: 'bear', at });
		const first = firstDifference(alone, met);
		assert.ok(first >= 0, `room ${seed}: it never turned for a bear 5 cells ahead of it`);
		assert.ok(
			first - at >= least,
			`room ${seed}: it turned ${first - at} inputs after the bear came, sooner than ${least}`,
		);
		assert.ok(first - at <= most, `room ${seed}: it turned only after ${first - at} inputs`);
		after.push(first - at);
	}
	assert.ok(new Set(after).size >= 4, `its reaction time is drawn (${after})`);
});

await check('a bot salmon never minds a bear it is not sent, or does not see', () => {
	for (let seed = 1; seed <= 6; seed++) {
		const at = tickHz;
		const alone = inputsBy(seed, {});
		const unseen = inputsBy(seed, { threat: 'bear', at, overrides: { sees: () => false } });
		assert.deepEqual(unseen, alone, `room ${seed}: a bear the rules say it does not see`);
		const unsent = inputsBy(seed, {
			threat: 'bear',
			at,
			keeps: true,
			overrides: { nearby: { w: 8 * CELL, h: 8 * CELL } },
		});
		assert.deepEqual(unsent, alone, `room ${seed}: a bear outside what its device is sent`);
		const seen = inputsBy(seed, {
			threat: 'bear',
			at,
			keeps: true,
			overrides: { nearby: { w: 12 * CELL, h: 12 * CELL } },
		});
		assert.notDeepEqual(seen, alone, `room ${seed}: the same bear inside it`);
	}
});

await check('a bot salmon leaps a line that would reel through it, after its reaction time', () => {
	const least = stepsOf(BOT_SWIM.reactMs.min);
	for (let seed = 1; seed <= 8; seed++) {
		const at = tickHz + seed * 2;
		const alone = inputsBy(seed, {});
		const met = inputsBy(seed, { threat: 'line', at });
		const first = firstDifference(alone, met);
		assert.ok(first - at >= least, `room ${seed}: ${first - at} inputs after the line went out`);
		const leapt = met.findIndex(([, , buttons], i) => i >= at && buttons === BUTTONS.jump);
		assert.ok(leapt >= at + least, `room ${seed}: it tapped jump at ${leapt - at}`);
		assert.ok(
			leapt - at <= stepsOf(BOT_SWIM.reactMs.max) + stepsOf(BOT_SWIM.tapMs.max) + 1,
			`room ${seed}: it leapt only ${leapt - at} inputs after the line went out`,
		);
		assert.ok(
			alone.slice(at, leapt + 1).every(([, , buttons]) => buttons === 0),
			'on open water with no line it does not leap',
		);
	}
});

await check('a bot salmon at the source ends nothing: it is counted and starts again', () => {
	const sim = createRoomSim(gameWith(of({ salmon: 3 })), { seed: 4 });
	const me = sim.join('me', { character: 'salmon' });
	const [bot, other] = botsOf(sim, 'salmon');
	const source = sim.game.zones.find((z) => z.id === 'source');
	for (let i = 0; i < 2 * tickHz; i++) sim.step(rest(sim));
	Object.assign(bot.body, { x: source.x + source.w / 2, y: source.y + source.h / 2 });
	const stains = sim.rules.stains.made;
	const events = sim.step(rest(sim));
	assert.deepEqual(
		events.filter((e) => e.id === bot.id || e.target === bot.id || !('id' in e || 'by' in e)),
		[{ type: 'home', id: bot.id }],
		'the room says it is home, and nothing else of it or of the round',
	);
	assert.equal(bot.status, STATUS.out, 'off the river, as a caught one is');
	assert.equal(bot.score, 0);
	assert.equal(sim.rules.phase, 'running');
	assert.equal(sim.rules.winner, '');
	const spawns = sim.game.online.characters.find((c) => c.id === 'salmon').spawns;
	const pause = stepsOf(BOT_SWIM.homeMs);
	let back;
	for (let i = 0; i < pause + 2 && back === undefined; i++) {
		const more = sim.step(rest(sim));
		assert.ok(
			!more.some((e) => e.type === 'gameWon' || e.type === 'roundEnd' || e.type === 'caught'),
		);
		if (bot.status === STATUS.free) back = i;
	}
	assert.ok(back >= pause - 2, `it is back after its pause (${back} steps)`);
	assert.ok(
		spawns.some((at) => Math.hypot(at.x - bot.body.x, at.y - bot.body.y) < CELL),
		'at a salmon’s start, by the sea',
	);
	assert.equal(sim.rules.stains.made, stains, 'it leaves no stain: it was not caught');
	assert.equal(other.status, STATUS.free, 'the others swim on');
	// A person at the source wins the game, as before.
	Object.assign(me.body, { x: source.x + source.w / 2, y: source.y + source.h / 2 });
	const won = sim.step(rest(sim));
	assert.deepEqual(
		won.filter((e) => e.type === 'gameWon'),
		[{ type: 'gameWon', winner: 'me', winnerName: me.name }],
	);
	assert.equal(sim.rules.phase, 'ended');
});

await check(
	'a game whose rules say nothing of a bot in its goal leaves it there, as before',
	() => {
		const game = onlineGameOf(
			normalizeGameConfigDoc({
				family: 'arcade',
				outcome: 'rules',
				gameName: 'Goal',
				arcade: {
					field: { w: 1600, h: 1200 },
					bodies: { look: { shape: 'circle', r: 20, tags: ['fish'] } },
					characters: [
						{
							id: 'still',
							component: 'look',
							brain: {
								initial: 'rest',
								states: [{ id: 'rest', behaviour: 'idle' }],
								transitions: [],
							},
						},
					],
					zones: [{ id: 'goal', x: 0, y: 0, w: 1600, h: 200 }],
					online: {
						characters: [{ id: 'fish', body: 'look', speed: 200 }],
						spawn: { x: 800, y: 1000 },
						bots: {
							characters: [{ character: 'fish', brain: 'still' }],
							fillTo: 2,
							spawns: [{ x: 800, y: 100 }],
						},
						rules: { zones: [{ zone: 'goal', goal: true }] },
					},
				},
			}),
		);
		assert.ok(game && !('refused' in game), JSON.stringify(game));
		const sim = createRoomSim(game, { seed: 3 });
		sim.join('a', {});
		const [bot] = botsOf(sim);
		assert.equal(sim.rules.botPlay, undefined);
		sim.events();
		const events = [];
		for (let i = 0; i < 90; i++) events.push(...sim.step(rest(sim)));
		assert.deepEqual(events, [], 'a bot in the goal: no event');
		assert.equal(bot.status, STATUS.free);
		assert.deepEqual([bot.body.x, bot.body.y], [800, 100]);
	},
);

/** A room of `n` bot salmon and no hunter, for `seconds`: how many times each got home, and the
 *  longest any was stalled: on the water, free, having moved less than half a cell in the last
 *  second (one that rests drifts three times that). */
const alone = (seed, n, seconds) => {
	const sim = createRoomSim(gameWith(of({ salmon: n })), { seed });
	sim.join('me', { character: 'salmon' });
	const homes = new Map(botsOf(sim, 'salmon').map((p) => [p.id, 0]));
	const trails = new Map();
	let stall = 0;
	for (let i = 0; i < seconds * tickHz; i++) {
		for (const event of sim.step(rest(sim)))
			if (event.type === 'home') homes.set(event.id, homes.get(event.id) + 1);
		for (const p of botsOf(sim, 'salmon')) {
			let trail = trails.get(p.id);
			if (!trail) trails.set(p.id, (trail = { x: p.body.x, y: p.body.y, moves: [], still: 0 }));
			trail.moves.push(Math.hypot(p.body.x - trail.x, p.body.y - trail.y));
			if (trail.moves.length > tickHz) trail.moves.shift();
			Object.assign(trail, { x: p.body.x, y: p.body.y });
			if (p.status !== STATUS.free || p.z || p.memo.climbing === 1) {
				trail.moves.length = 0;
				trail.still = 0;
				continue;
			}
			const still =
				trail.moves.length === tickHz && trail.moves.reduce((a, b) => a + b, 0) < CELL / 2;
			trail.still = still ? trail.still + 1 : 0;
			stall = Math.max(stall, still ? 1 + trail.still / tickHz : 0);
		}
	}
	return { homes: [...homes.values()], stall, sim };
};

await check('bot salmon reach the source with no hunter about, and none stalls for long', () => {
	let rooms = 0;
	let worst = 0;
	for (let seed = 1; seed <= 6; seed++) {
		const { homes, stall } = alone(seed, 6, 240);
		const home = homes.filter((n) => n > 0).length;
		if (home === homes.length) rooms += 1;
		assert.ok(home >= 5, `room ${seed}: ${home} of 6 bot salmon reached the source in 240 s`);
		worst = Math.max(worst, stall);
	}
	assert.ok(rooms >= 5, `every bot salmon got home in only ${rooms} of 6 rooms`);
	console.log(`  the longest stall of a bot salmon: ${worst.toFixed(1)} s`);
	assert.ok(worst <= 3, `a bot salmon was stalled for ${worst.toFixed(1)} s`);
});

await check('a bot salmon stopped by what it is told nothing of knows it by making no way', () => {
	// A bot's brain is never told it hit a solid. A wall its rules know nothing of (not a rock of
	// the river's), 6 cells wide, 3 cells up the open river from it: it swims into it, makes no
	// way, and leaps aside.
	const least = stepsOf(BOT_SWIM.stuckMs.min);
	for (let seed = 1; seed <= 6; seed++) {
		const open = openGame(seed);
		const water = open.zones.find(
			(z) => /^band\d+Water$/.test(z.id) && (5 + 195) * CELL >= z.y && (5 + 195) * CELL < z.y + z.h,
		);
		const at = { x: water.x + water.w / 2, y: water.y + CELL / 2 };
		const wall = { id: 'wall', x: at.x - 3 * CELL, y: at.y - 4 * CELL, w: 6 * CELL, h: CELL };
		const sim = createRoomSim(
			{
				...open,
				zones: [...open.zones, wall],
				online: {
					...open.online,
					rules: {
						...open.online.rules,
						zones: [...open.online.rules.zones, { zone: wall.id, solid: true }],
					},
				},
			},
			{ seed },
		);
		const me = sim.join('me', { character: 'salmon' });
		Object.assign(me.body, at);
		const next = pilotOf(sim, me, `wall:${seed}`);
		let stopped = 0;
		let past;
		for (let i = 0; i < 20 * tickHz && past === undefined; i++) {
			const y = me.body.y;
			const input = next();
			sim.step(() => [input]);
			if (input.moveY < -MOVE_SCALE / 2 && me.body.y > y - 1) stopped += 1;
			if (me.body.y < wall.y - CELL) past = i;
		}
		assert.ok(stopped >= least, `room ${seed}: the wall stopped it (${stopped} inputs)`);
		assert.ok(past !== undefined, `room ${seed}: it did not get round the wall in 20 s`);
	}
});

await check('a bear bot swipes at a bot salmon it chases, and still at no other bot', () => {
	const sim = createRoomSim(gameWith(of({ salmon: 1, fisherman: 1, bear: 2 })), { seed: 6 });
	sim.join('me', { character: 'bear' });
	const [fish] = botsOf(sim, 'salmon');
	const [fisher] = botsOf(sim, 'fisherman');
	const [bear, mate] = botsOf(sim, 'bear');
	const water = waterAt(sim, 200 * CELL);
	const at = { x: water.x + water.w / 2, y: water.y + water.h / 2 };
	const hold = (near) => {
		Object.assign(bear.body, at);
		for (const p of [fish, fisher, mate])
			Object.assign(
				p.body,
				p === near ? { x: at.x + CELL, y: at.y } : { x: at.x, y: at.y + 40 * CELL },
			);
	};
	const caught = (near) => {
		const events = [];
		for (let i = 0; i < 3 * tickHz; i++) {
			hold(near);
			events.push(...sim.step(rest(sim)));
		}
		return events.filter((e) => e.type === 'caught' && e.by === bear.id).map((e) => e.target);
	};
	assert.deepEqual(caught(mate), [], 'not at a bear bot beside him');
	assert.deepEqual(caught(fisher), [], 'nor at a bot fisherman');
	assert.deepEqual(caught(fish), [fish.id], 'at the bot salmon his brain chases');
});

console.log(`check:salmon-bots — ${passed} checks passed`);
