// Measures a SALMONS room of bots (docs/status/salmons.md, "Bots"): what becomes of a person's
// salmon in it, and how its bots fare. Headless on the game server's own room
// (`services/game-server` `createRoomSim`) and the config as it ships (`engine-mechanics`
// `salmonsConfig` with its levels, no lobby), one room per seed 1..`--rooms`. A room's
// seed makes its level as well as its bots (as a live room's does: the export pins no level), so
// these are `--rooms` levels, not one. Deterministic: the same arguments print the same tables.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/salmons/measure-room.mjs [--size 10] [--bots bear=10,fisherman=9] [--rooms 24] \
//     [--seconds 600] [--span 300] [--salmon straight,weaving,steering] [--label after-10] \
//     [--original]
//
// The levels are Salmons' own (`SALMONS_LEVELS`: the winding river, the tall waterfalls);
// `--original` measures the original's levels, as a config from before them plays.
// Without `--bots` the room is the config's own, filled by the room as it fills a live one: its
// bots by their shares (60 / 25 / 15 of salmon, fishermen and bears), the one person (a salmon)
// in a salmon bot's place. `--size`: a test room of that size instead of the config's 100
// (`game-config` `onlineGameOf(doc, { size })`, as the game server's test rooms play it).
// `--bots`: exactly these bots by count beside the person instead, whatever the shares say (the
// room before the shares was `bear=10,fisherman=9`). A count past a class's places in the config
// is let in here (the config is not changed).
//
// THE PERSON is one of three scripts, each sending only inputs (a move and the jump button):
//   straight   steers for the middle of the water two cells ahead; taps jump when it makes no way.
//   weaving    the same, swinging 3 cells to either side over 4 s.
//   steering   swims as a bot salmon does (`salmonsRules.js` `swim`, with a bot's reaction times
//              and steering, never resting): round the bears and away from the lines it is sent
//              and sees, climbing and leaping. A person to the room: bears swipe at it, it waits
//              for its Respawn, and at the source it wins the game.
// A GAME is played to its end: the first salmon at the source, bot or person, wins it (Salmons'
// `bots.canWin`, owner 2026-11-21). The person presses Respawn (as a salmon) 3 s after each catch.
// Per script: how often the person wins, a bot wins, or nobody has by `--seconds`; how long the
// games lasted (median, shortest, longest); and how the person's first life ended.
//
// THE BOTS are measured in rooms of their own, `--span` seconds each or until a bot salmon wins,
// the person resting where it joined (a room has bots only while a person is in it): how often a
// bot salmon won within the span, how long a bot salmon lives (from its start to its catch; a life
// still swimming when the game ends, the winner's too, is not counted), how
// much of its time on the water it is stalled (it moved less than half a cell in the last second,
// free, not leaping or climbing: pressed against something, or held by a whirlpool; one resting
// drifts 1.5 cells), how many are on the river at a time, and the bears' and the fishermen's
// catches a minute.

import { parseArgs } from 'node:util';

import { BUTTONS, MOVE_SCALE, clampInput } from '../../packages/engine-mechanics/src/online.js';
import { botInput, createBot } from '../../packages/engine-mechanics/src/onlineBots.js';
import { STATUS } from '../../packages/engine-mechanics/src/onlineRules.js';
import { SALMONS_LEVELS, salmonsConfig } from '../../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../../packages/engine-mechanics/src/salmonsMap.js';
import {
	onlineGameWithCarry,
	playedOnlineGame,
	shapedOnlineGame,
} from '../../packages/game-config/index.ts';
import { createRoomSim } from '../../services/game-server/src/roomSim.ts';

const { values: opt } = parseArgs({
	options: {
		bots: { type: 'string' },
		size: { type: 'string' },
		rooms: { type: 'string', default: '24' },
		seconds: { type: 'string', default: '600' },
		span: { type: 'string', default: '300' },
		salmon: { type: 'string', default: 'straight,weaving,steering' },
		label: { type: 'string' },
		original: { type: 'boolean', default: false },
	},
});

/** The brain each class of bot plays with (`salmons.js` `arcade.characters`). */
const BRAINS = { salmon: 'salmonBot', fisherman: 'fishermanBot', bear: 'bearBot' };

/** `salmon=6,fisherman=3,bear=1` → the counts by class. */
const countsOf = (text) => {
	const counts = {};
	for (const part of text.split(',')) {
		const [character, n] = part.split('=');
		if (!(character in BRAINS) || !Number.isInteger(Number(n)) || Number(n) < 0)
			throw new Error(`--bots: "${part}" is not <salmon|fisherman|bear>=<count>`);
		counts[character] = Number(n);
	}
	return counts;
};

/** The game as it ships (at `size`, when one is named), or with exactly `counts` bots by count:
 *  the classes spread evenly through the room's order of joining, each class let in past its
 *  `max`. */
const gameOf = (counts, size) => {
	const doc = salmonsConfig(
		salmonsMapRiver(SALMONS_MAP_SEED),
		opt.original ? {} : { levels: SALMONS_LEVELS },
	);
	// The levels' shape and the fisherman's hold and throw (`carry`) are read off the raw config
	// too, as the game server reads them.
	const played = playedOnlineGame(doc, size === undefined ? {} : { size });
	const game =
		played && !('refused' in played)
			? onlineGameWithCarry(shapedOnlineGame(played, doc), doc)
			: played;
	if (!game || 'refused' in game) throw new Error(`no online game: ${JSON.stringify(game)}`);
	if (size !== undefined && game.online.maxPlayers !== size)
		throw new Error(`--size: the game cannot be played at ${size}`);
	if (!counts) return game;
	// A game carries only the brains its own bots name: the others are the config's characters'.
	const brains = Object.fromEntries(
		Object.values(BRAINS).map((id) => [id, doc.arcade.characters.find((c) => c.id === id).brain]),
	);
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const made = {};
	const order = [];
	while (order.length < total) {
		let next;
		let behind = -Infinity;
		for (const [character, n] of Object.entries(counts)) {
			const lag = (n * (order.length + 1)) / total - (made[character] ?? 0);
			if (lag > behind && (made[character] ?? 0) < n) {
				behind = lag;
				next = character;
			}
		}
		made[next] = (made[next] ?? 0) + 1;
		order.push({ character: next, brain: BRAINS[next] });
	}
	return {
		...game,
		brains,
		online: {
			...game.online,
			maxPlayers: Math.max(game.online.maxPlayers, total + 1),
			characters: game.online.characters.map((c) =>
				c.max === undefined ? c : { ...c, max: Math.max(c.max, (counts[c.id] ?? 0) + 1) },
			),
			// No `counts`: by count, whatever the config's shares say.
			bots: { ...game.online.bots, counts: undefined, characters: order, fillTo: total + 1 },
		},
	};
};

const counts = opt.bots ? countsOf(opt.bots) : undefined;
if (counts && opt.size) throw new Error('--bots and --size: name one of them');
const game = gameOf(counts, opt.size ? Number(opt.size) : undefined);
const tickHz = game.online.tickHz;
const rooms = Number(opt.rooms);
const limit = Number(opt.seconds) * tickHz;
const span = Number(opt.span) * tickHz;

/** The middle of a room's water `cells` up the river from `y`. */
const middleOf = (sim) => {
	const waters = sim.game.zones.filter((z) => /^band\d+Water$/.test(z.id));
	return (y) => {
		const water =
			waters.find((z) => y >= z.y && y < z.y + z.h) ??
			(y < waters[0].y ? waters[0] : waters[waters.length - 1]);
		return water.x + water.w / 2;
	};
};

/** A swimmer that steers for the middle of the water two cells ahead, `swing(step)` px to a side,
 *  and taps jump (every other input) while it has made less than a tenth of a cell in half a
 *  second. */
const swimmerOf = (sim, me, swing = () => 0) => {
	const middle = middleOf(sim);
	const trail = [];
	return (step) => {
		const { x, y } = me.body;
		trail.push({ x, y });
		if (trail.length > tickHz / 2) trail.shift();
		const stuck =
			trail.length === Math.floor(tickHz / 2) &&
			Math.hypot(x - trail[0].x, y - trail[0].y) < CELL / 10;
		const dx = middle(y - 2 * CELL) + swing(step) - x;
		return clampInput(
			{
				seq: step + 1,
				moveX: Math.max(-1, Math.min(1, dx / CELL)) * MOVE_SCALE,
				moveY: -MOVE_SCALE,
				buttons: stuck && step % 2 ? BUTTONS.jump : 0,
				view: sim.steps,
			},
			sim.game.field,
		);
	};
};

/** A person's brain at a bot salmon's controls: it never rests. */
const AWAKE = { initial: 'swim', states: [{ id: 'swim', behaviour: 'idle' }], transitions: [] };

const SALMON = {
	straight: (sim, me) => swimmerOf(sim, me),
	weaving: (sim, me) =>
		swimmerOf(sim, me, (step) => Math.sin((step / tickHz / 4) * 2 * Math.PI) * 3 * CELL),
	steering: (sim, me) => {
		const pilot = createBot({
			brain: AWAKE,
			seed: `person:${sim.seed}`,
			at: me.body,
			character: me.character.id,
		});
		return () =>
			botInput(pilot, me, sim.players.values(), {
				dt: sim.ctx.dt,
				speed: me.character.speed,
				field: sim.game.field,
				view: sim.steps,
				sees: sim.rules.sees,
				nearby: sim.game.online.nearby,
				play: sim.rules.botPlay,
			});
	},
};

const median = (list) => {
	if (!list.length) return NaN;
	const sorted = [...list].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN);
const show = (value, digits = 1, unit = '') =>
	Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '–';

/** How long a caught person looks at the death screen before it presses Respawn, s. */
const RESPAWN_AFTER = 3;

/** One game in one room, played to its end: the first salmon at the source, bot or person, wins
 *  it (`bots.canWin`). The person respawns as a salmon {@link RESPAWN_AFTER} s after each catch.
 *  `fate`: how its first life ended (`source`, `hooked`, `swiped`, or `none` when the game ended
 *  first); `winner`: `me`, `bot` or `none` (nobody by `--seconds`); `at`: when it ended (s). */
const gameFor = (seed, script) => {
	const sim = createRoomSim(game, { seed });
	const me = sim.join('me', { character: 'salmon' });
	const input = script(sim, me);
	const pick = 1 + game.online.characters.findIndex((c) => c.id === 'salmon');
	let fate = 'none';
	let caughtAt = -1;
	for (let step = 0; step < limit; step++) {
		const sent = input(step);
		if (me.status === STATUS.out && caughtAt >= 0 && step - caughtAt >= RESPAWN_AFTER * tickHz)
			sent.respawn = pick;
		const events = sim.step(() => [sent]);
		for (const event of events) {
			if (event.type === 'caught' && event.target === 'me') {
				caughtAt = step;
				if (fate === 'none') fate = event.effect === 'hook' ? 'hooked' : 'swiped';
			}
			if (event.type === 'gameWon') {
				const winner = event.winner === 'me' ? 'me' : 'bot';
				if (winner === 'me' && fate === 'none') fate = 'source';
				return { fate, winner, at: (step + 1) / tickHz };
			}
		}
	}
	return { fate, winner: 'none', at: limit / tickHz };
};

/** How a room's bots fare over the span, the person resting where it joined, or until a bot
 *  salmon wins the game (`played`, steps). */
const fareOf = (seed) => {
	const sim = createRoomSim(game, { seed });
	sim.join('me', { character: 'salmon' });
	const classOf = (id) => sim.players.get(id)?.character.id;
	const salmon = () =>
		[...sim.players.values()].filter((p) => p.bot && p.character.id === 'salmon');
	const born = new Map(salmon().map((p) => [p.id, 0]));
	const trails = new Map();
	const fare = {
		played: 0,
		won: false,
		lives: [],
		swims: 0,
		stalls: 0,
		onRiver: 0,
		bear: 0,
		fisherman: 0,
	};
	fare.bots = salmon().length;
	for (let step = 0; step < span; step++) {
		const events = sim.step(() => []);
		fare.played = step + 1;
		fare.won = events.some((e) => e.type === 'gameWon');
		if (fare.won) break;
		for (const event of events) {
			const id = event.type === 'caught' ? event.target : '';
			if (event.type === 'caught' && classOf(event.by) in fare) fare[classOf(event.by)] += 1;
			if (born.has(id)) {
				fare.lives.push((step + 1 - born.get(id)) / tickHz);
				born.delete(id);
			}
		}
		for (const p of salmon()) {
			if (p.status === STATUS.out) {
				trails.delete(p.id);
				continue;
			}
			if (!born.has(p.id)) born.set(p.id, step + 1);
			fare.onRiver += 1;
			let trail = trails.get(p.id);
			if (!trail) trails.set(p.id, (trail = { x: p.body.x, y: p.body.y, moves: [] }));
			trail.moves.push(Math.hypot(p.body.x - trail.x, p.body.y - trail.y));
			if (trail.moves.length > tickHz) trail.moves.shift();
			Object.assign(trail, { x: p.body.x, y: p.body.y });
			if (p.status !== STATUS.free || p.z || p.memo.climbing === 1) {
				trail.moves.length = 0;
				continue;
			}
			fare.swims += 1;
			if (trail.moves.length === tickHz && trail.moves.reduce((a, b) => a + b, 0) < CELL / 2)
				fare.stalls += 1;
		}
	}
	return fare;
};

const started = Date.now();
const room = counts
	? Object.entries(counts)
			.map(([character, n]) => `${n} ${character}`)
			.join(', ')
	: `as shipped, a room of ${game.online.maxPlayers}`;
const made = createRoomSim(game, { seed: 1 });
made.join('me', { character: 'salmon' });
const census = {};
for (const p of made.players.values())
	if (p.bot) census[p.character.id] = (census[p.character.id] ?? 0) + 1;
console.log(
	`## ${opt.label ?? room}\n\nBots: ${room} (a room of ${made.players.size}: one person's salmon and ${Object.entries(
		census,
	)
		.map(([character, n]) => `${n} ${character}`)
		.join(', ')} bots). ${rooms} rooms, seeds 1 to ${rooms}.\n`,
);

console.log(
	`One game a room until the first salmon, bot or person, reaches the source; the person respawns as a salmon ${RESPAWN_AFTER} s after a catch.\n`,
);
console.log(
	`| Person's salmon | Person wins | A bot wins | Nobody by ${opt.seconds} s | Game length, median | Shortest | Longest | First life: hooked / swiped / game over first |`,
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const name of opt.salmon.split(',').filter(Boolean)) {
	const script = SALMON[name];
	if (!script) throw new Error(`--salmon: "${name}" is not one of ${Object.keys(SALMON)}`);
	const games = [];
	for (let seed = 1; seed <= rooms; seed++) games.push(gameFor(seed, script));
	const n = (key, value) => games.filter((g) => g[key] === value).length;
	const ended = games.filter((g) => g.winner !== 'none').map((g) => g.at);
	console.log(
		`| ${name} | ${n('winner', 'me')} | ${n('winner', 'bot')} | ${n('winner', 'none')} | ${show(median(ended), 0, ' s')} | ${show(Math.min(...ended), 0, ' s')} | ${show(Math.max(...ended), 0, ' s')} | ${n('fate', 'hooked')} / ${n('fate', 'swiped')} / ${n('fate', 'none')} |`,
	);
}

if (span > 0) {
	const fares = [];
	for (let seed = 1; seed <= rooms; seed++) fares.push(fareOf(seed));
	const sum = (key) => fares.reduce((a, f) => a + f[key], 0);
	const played = sum('played');
	const minutes = played / tickHz / 60;
	const lives = fares.flatMap((f) => f.lives);
	const bots = fares[0].bots;
	console.log(
		`\nThe bots over ${opt.span} s a room, or until a bot salmon wins the game (the person resting; ${show(minutes, 1)} minutes played):\n`,
	);
	console.log('| Measure | Value |');
	console.log('| --- | --- |');
	console.log(`| Bot salmon in the room | ${bots} |`);
	console.log(
		`| Rooms a bot salmon won within ${opt.span} s | ${fares.filter((f) => f.won).length} of ${rooms} |`,
	);
	console.log(
		`| A bot salmon's life, median / mean (${lives.length} ended) | ${show(median(lives), 0, ' s')} / ${show(mean(lives), 0, ' s')} |`,
	);
	console.log(
		`| Bot salmon on the river at a time, mean | ${show(sum('onRiver') / played, 1)} of ${bots} |`,
	);
	console.log(
		`| Share of its time on the water a bot salmon is stalled | ${show((100 * sum('stalls')) / sum('swims'), 1, ' %')} |`,
	);
	console.log(`| Bears' catches, a minute a room | ${show(sum('bear') / minutes, 2)} |`);
	console.log(`| Fishermen's catches, a minute a room | ${show(sum('fisherman') / minutes, 2)} |`);
}
console.log(`\n(${((Date.now() - started) / 1000).toFixed(0)} s to run)`);
