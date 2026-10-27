// Online rooms at 100 players (services/game-server; docs/design/realtime-multiplayer.md §5, §7,
// §12; P10.16): bots that fill a room's empty places with the P10.11 brains, a person taking a
// bot's place, bots that cannot win, the nearby-only state (each device sent only the players near
// its own, and its own `ack` only), per-character spawns, and Salmons as data (its river, its
// config, a salmon that can swim it and a bear bot that catches one) — headless over the room's own
// code, then over a real Colyseus 0.18 server on localhost with real `@colyseus/sdk` clients.
// The 100-device load test is `scripts/room-load.mjs` (not a gate: it takes a minute and a core).
//
// Run: pnpm check:room-bots

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { BOT_PREFIX, isBotId } from '../packages/engine-mechanics/src/onlineBots.js';
import { ONLINE_EVENT, STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import {
	SALMONS_SEED,
	salmonsConfig,
	salmonsRiver,
} from '../packages/engine-mechanics/src/salmons.js';
import {
	ARCADE_ONLINE_BOT_DEFAULTS,
	normalizeGameConfigDoc,
	onlineGameOf,
	resolveArcadeOnline,
} from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim, RoomRefusal } from '../services/game-server/src/roomSim.ts';
import { ROOM_NAME, createGameServer } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);

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

const FIELD = { w: 1600, h: 1200 };
const CHASE = {
	initial: 'hunt',
	states: [{ id: 'hunt', behaviour: 'chase', params: { tag: 'fish', range: 5000, speed: 400 } }],
	transitions: [],
};
const STILL = { initial: 'rest', states: [{ id: 'rest', behaviour: 'idle' }], transitions: [] };
const configOf = (online, extra = {}) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Room bots',
	arcade: {
		field: FIELD,
		bodies: {
			fishLook: { shape: 'circle', r: 20, tags: ['fish'] },
			bearLook: { shape: 'circle', r: 40, tags: ['bear'] },
		},
		characters: [
			{ id: 'bearBrain', component: 'bearLook', brain: CHASE },
			{ id: 'fishBrain', component: 'fishLook', brain: STILL },
		],
		...extra,
		online,
	},
});
const CHARACTERS = [
	{ id: 'fish', body: 'fishLook', speed: 200 },
	{ id: 'bear', body: 'bearLook', speed: 150, max: 3 },
];
const BOTS = { characters: [{ character: 'bear', brain: 'bearBrain' }], fillTo: 5 };
const gameOf = (doc) => {
	const game = onlineGameOf(normalizeGameConfigDoc(doc));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};
const roomOf = (online, seed = 7, extra) =>
	createRoomSim(gameOf(configOf(online, extra)), { seed });
const bots = (sim) => [...sim.players.values()].filter((p) => p.bot);
const people = (sim) => [...sim.players.values()].filter((p) => !p.bot);
/** Step a room `n` times; each person sends `inputOf(person, step)` (default: rest). */
const run = (sim, n, inputOf = () => ({})) => {
	const events = [];
	const seqs = new Map();
	for (let i = 0; i < n; i++) {
		events.push(
			...sim.step((id) => {
				const seq = (seqs.get(id) ?? 0) + 1;
				seqs.set(id, seq);
				const player = sim.players.get(id);
				return [clampInput({ ...inputOf(player, i), seq }, sim.game.field)];
			}),
		);
	}
	return events;
};

// --- 1. the config ---------------------------------------------------------------------------------

await check('bots, nearby and spawns: normalized sparse, resolved with defaults and limits', () => {
	const doc = normalizeGameConfigDoc(
		configOf({
			characters: [{ ...CHARACTERS[0], spawns: [{ x: 1, y: 2 }, { x: 'no' }] }],
			bots: {
				characters: [{ character: 'fish', brain: 'fishBrain' }, { character: 'fish' }],
				fillTo: ARCADE_ONLINE_BOT_DEFAULTS.fillTo,
				canWin: false,
				spawns: [{ x: 5, y: 6 }],
			},
			nearby: { w: 900, h: 0 },
		}),
	);
	const online = doc.arcade.online;
	assert.deepEqual(online.characters[0].spawns, [{ x: 1, y: 2 }]);
	assert.deepEqual(online.bots, {
		characters: [{ character: 'fish', brain: 'fishBrain' }],
		spawns: [{ x: 5, y: 6 }],
	});
	assert.equal(online.nearby, undefined, 'a box with no height is no box');
	const resolved = resolveArcadeOnline(doc, FIELD);
	assert.equal(resolved.bots.fillTo, 16, 'fillTo is held to maxPlayers (16 by default)');
	assert.equal(resolved.bots.canWin, false);
	const none = resolveArcadeOnline(
		normalizeGameConfigDoc(configOf({ characters: CHARACTERS })),
		FIELD,
	);
	assert.deepEqual(none.bots, { fillTo: 0, characters: [], canWin: false, spawns: [] });
	assert.equal(none.nearby, undefined);
	const near = resolveArcadeOnline(
		normalizeGameConfigDoc(configOf({ characters: CHARACTERS, nearby: { w: 10, h: 1e6 } })),
		FIELD,
	);
	assert.deepEqual(near.nearby, { w: 200, h: 20_000 });
});

await check('the validator: a bot needs an online character and a character with a brain', () => {
	const issues = validateFamily(
		normalizeGameConfigDoc(
			configOf({
				characters: CHARACTERS,
				maxPlayers: 4,
				bots: {
					characters: [
						{ character: 'shark', brain: 'bearBrain' },
						{ character: 'bear', brain: 'nobody' },
					],
					fillTo: 8,
				},
				nearby: { w: 50, h: 300 },
			}),
		),
	);
	const offField = validateFamily(
		normalizeGameConfigDoc(
			configOf({
				characters: [{ ...CHARACTERS[0], spawns: [{ x: -5, y: 10 }] }],
				bots: { ...BOTS, spawns: [{ x: 10, y: 99_999 }] },
			}),
		),
	);
	assert.ok(offField.some((i) => i.path === 'arcade.online.characters[0].spawns'));
	assert.ok(offField.some((i) => i.path === 'arcade.online.bots.spawns'));
	const at = (path) => issues.find((i) => i.path === path);
	assert.equal(at('arcade.online.bots.characters[0].character')?.severity, 'error');
	assert.equal(at('arcade.online.bots.characters[1].brain')?.severity, 'error');
	assert.equal(at('arcade.online.bots.fillTo')?.severity, 'warning');
	assert.equal(at('arcade.online.nearby')?.severity, 'warning');
	// A character a bot plays runs in the room: only the others are inert online.
	const played = validateFamily(
		normalizeGameConfigDoc(
			configOf({
				characters: CHARACTERS,
				bots: {
					characters: [
						{ character: 'bear', brain: 'bearBrain' },
						{ character: 'fish', brain: 'fishBrain' },
					],
				},
			}),
		),
	);
	assert.equal(
		played.find((i) => i.path === 'arcade.characters'),
		undefined,
	);
	assert.equal(played.filter((i) => i.severity === 'error').length, 0, JSON.stringify(played));
});

// --- 2. bots in the room ---------------------------------------------------------------------------

await check('a room with someone in it is kept at fillTo with bots; with nobody, none', () => {
	const sim = roomOf({ characters: CHARACTERS, bots: BOTS });
	assert.equal(sim.players.size, 0);
	sim.join('a', { character: 'fish' });
	assert.equal(sim.players.size, 4, 'bears hold at most 3 places, so 1 + 3');
	assert.ok(bots(sim).every((b) => isBotId(b.id) && b.id.startsWith(BOT_PREFIX)));
	assert.ok(bots(sim).every((b) => b.character.id === 'bear' && b.bot === true));
	sim.leave('a');
	assert.equal(sim.players.size, 0);
	const events = sim.events();
	assert.equal(events.filter((e) => e.type === 'joined').length, 4);
	assert.equal(events.filter((e) => e.type === 'left').length, 4);
});

await check('a person takes a bot’s place; a leave lets a bot back in', () => {
	const fill = {
		...BOTS,
		characters: [...BOTS.characters, { character: 'fish', brain: 'fishBrain' }],
	};
	const sim = roomOf({ characters: CHARACTERS, bots: fill, maxPlayers: 5 });
	sim.join('a', { character: 'fish' });
	assert.equal(sim.players.size, 5);
	sim.join('b', { character: 'fish' });
	sim.join('c', { character: 'fish' });
	assert.equal(sim.players.size, 5);
	assert.equal(people(sim).length, 3);
	sim.join('d', { character: 'fish' });
	sim.join('e', { character: 'fish' });
	assert.equal(bots(sim).length, 0, 'five people, no bot');
	assert.throws(() => sim.join('f', { character: 'fish' }), RoomRefusal, 'full of people');
	sim.leave('e');
	assert.equal(sim.players.size, 5);
	assert.equal(bots(sim).length, 1);
	sim.leave(`${BOT_PREFIX}1`);
	assert.equal(sim.players.size, 5, 'a bot cannot be sent away by a leave');
});

await check('asking for a character only bots hold sends one of those bots away', () => {
	const sim = roomOf({ characters: CHARACTERS, bots: { ...BOTS, fillTo: 6 } });
	sim.join('a', { character: 'fish' });
	assert.equal(bots(sim).length, 3, 'the bears’ max holds the bots too');
	const d = sim.join('d', { character: 'bear' });
	assert.equal(d.character.id, 'bear');
	assert.equal(bots(sim).length, 2);
	sim.join('e', { character: 'bear' });
	sim.join('f', { character: 'bear' });
	assert.equal(bots(sim).length, 0);
	assert.throws(() => sim.join('g', { character: 'bear' }), RoomRefusal, 'three people are bears');
});

await check('a refused join changes nothing; a join takes exactly one bot’s place', () => {
	const sim = roomOf({ characters: CHARACTERS, bots: BOTS, maxPlayers: 4 });
	sim.join('a', { character: 'fish' });
	const ids = () => [...sim.players.keys()].join(',');
	const before = ids();
	sim.events();
	assert.throws(() => sim.join('b', { character: 'shark' }), RoomRefusal);
	assert.equal(ids(), before, 'no bot was sent away or remade');
	assert.deepEqual(sim.events(), [], 'nobody was told of a join or a leave');
	// Full room (4), bears full of bots (3): a bear join sends exactly one bear bot away.
	sim.join('c', { character: 'bear' });
	const events = sim.events();
	assert.equal(events.filter((e) => e.type === 'left').length, 1);
	assert.equal(events.filter((e) => e.type === 'joined').length, 1);
	assert.equal(sim.players.size, 4);
});

await check('a bot is stepped like a person: a clamped input, its speed, its brain', () => {
	const sim = roomOf({ characters: CHARACTERS, bots: { ...BOTS, fillTo: 2 } });
	const a = sim.join('a', { character: 'fish' });
	a.body.x = 1500;
	a.body.y = 1100;
	const bot = bots(sim)[0];
	const step = sim.ctx.dt * bot.character.speed + 1e-9;
	let before = { x: bot.body.x, y: bot.body.y };
	const startGap = Math.hypot(a.body.x - bot.body.x, a.body.y - bot.body.y);
	for (let i = 0; i < 120; i++) {
		run(sim, 1);
		const moved = Math.hypot(bot.body.x - before.x, bot.body.y - before.y);
		assert.ok(moved <= step, `a bot moves no faster than its character (${moved} > ${step})`);
		assert.ok(Math.abs(bot.body.vx) <= bot.character.speed + 1e-9);
		before = { x: bot.body.x, y: bot.body.y };
	}
	const gap = Math.hypot(a.body.x - bot.body.x, a.body.y - bot.body.y);
	assert.ok(gap < startGap - 400, `the chasing brain closed in (${startGap} → ${gap})`);
	assert.ok(bot.ack > 100, 'its inputs carry their own seq');
});

const CATCH = {
	character: 'bear',
	button: 'ability1',
	reach: 120,
	targets: ['fish'],
	effect: 'catch',
	ms: 2000,
	score: 3,
};
const GOAL = { id: 'goal', x: 0, y: 0, w: 1600, h: 200 };

await check('a bot uses its abilities when a target is within reach', () => {
	const sim = roomOf({
		characters: CHARACTERS,
		bots: { ...BOTS, fillTo: 2 },
		rules: { abilities: [CATCH] },
	});
	sim.join('a', { character: 'fish' });
	const events = run(sim, 300);
	const caught = events.find((e) => e.type === 'caught');
	assert.ok(caught, 'the bear bot caught the still fish');
	assert.ok(isBotId(caught.by));
	assert.equal(caught.target, 'a');
	const catches = events.filter((e) => e.type === 'caught').length;
	assert.equal(sim.players.get(caught.by).score, CATCH.score * catches);
});

await check('a bot cannot win a round unless the game says so', () => {
	for (const canWin of [false, true]) {
		const sim = roomOf(
			{
				characters: CHARACTERS,
				bots: {
					characters: [{ character: 'fish', brain: 'fishBrain' }],
					fillTo: 2,
					canWin,
					spawns: [{ x: 800, y: 100 }],
				},
				spawn: { x: 800, y: 1000 },
				rules: { zones: [{ zone: 'goal', goal: true }] },
			},
			3,
			{ zones: [GOAL] },
		);
		sim.join('a', { character: 'bear' });
		const bot = bots(sim)[0];
		const end = run(sim, 3).find((e) => e.type === 'roundEnd');
		if (canWin) assert.equal(end?.winner, bot.id, 'a bot that may win wins at the goal');
		else assert.equal(end, undefined, 'a bot in the goal ends nothing');
	}
	// On the clock: a bot's score never makes it the winner.
	const sim = roomOf({
		characters: CHARACTERS,
		bots: { ...BOTS, fillTo: 2 },
		rules: { abilities: [CATCH], round: { seconds: 5, nextRoundSeconds: 1 } },
	});
	sim.join('a', { character: 'fish' });
	const events = run(sim, 5 * 30 + 2);
	const end = events.find((e) => e.type === 'roundEnd');
	assert.ok(end);
	assert.ok(bots(sim)[0].score > 0, 'the bot scored');
	assert.equal(end.winner, 'a', 'the top person wins, not the bot');
});

await check('a seeded room replays exactly: bots, their brains, scores and events', () => {
	const online = {
		characters: CHARACTERS,
		bots: {
			characters: [
				{ character: 'bear', brain: 'bearBrain' },
				{ character: 'fish', brain: 'fishBrain' },
			],
			fillTo: 6,
		},
		rules: { abilities: [CATCH] },
	};
	const play = () => {
		const sim = roomOf(online, 99);
		sim.join('a', { character: 'fish' });
		sim.join('b', { character: 'fish' });
		const events = run(sim, 600, (p, i) => ({ moveX: Math.round(Math.sin(i / 20) * MOVE_SCALE) }));
		return JSON.stringify({
			events,
			players: [...sim.players.values()].map((p) => [p.id, p.body.x, p.body.y, p.score, p.status]),
		});
	};
	assert.equal(play(), play());
});

await check('people start at their character’s spawns in turn; bots at the bots’ spawns', () => {
	const sim = roomOf({
		characters: [
			{
				...CHARACTERS[0],
				spawns: [
					{ x: 100, y: 100 },
					{ x: 200, y: 100 },
				],
			},
			CHARACTERS[1],
		],
		spawn: { x: 800, y: 600 },
		bots: { ...BOTS, fillTo: 4, spawns: [{ x: 1500, y: 1000 }] },
	});
	const a = sim.join('a', { character: 'fish' });
	const b = sim.join('b', { character: 'fish' });
	const c = sim.join('c', { character: 'fish' });
	const d = sim.join('d', { character: 'bear' });
	assert.deepEqual([a.body.x, b.body.x, c.body.x], [100, 200, 100]);
	assert.deepEqual([d.body.x, d.body.y], [800, 600], 'no spawns: the room’s');
	const e = roomOf({ characters: CHARACTERS, bots: { ...BOTS, spawns: [{ x: 1500, y: 1000 }] } });
	e.join('a', { character: 'fish' });
	assert.ok(bots(e).every((p) => p.body.x === 1500 && p.body.y === 1000));
});

// --- 3. Salmons as data ----------------------------------------------------------------------------

const salmons = gameOf(salmonsConfig());

await check('Salmons: the river is the seed’s, and its config is a valid online game', () => {
	assert.deepEqual(salmonsRiver(SALMONS_SEED), salmonsRiver(SALMONS_SEED));
	assert.notDeepEqual(salmonsRiver('another').bands, salmonsRiver(SALMONS_SEED).bands);
	const issues = validateFamily(normalizeGameConfigDoc(salmonsConfig()));
	assert.deepEqual(issues, []);
	assert.equal(salmons.online.maxPlayers, 100);
	assert.deepEqual(salmons.online.bots.fillTo, 20);
	assert.equal(salmons.online.bots.canWin, false);
	assert.deepEqual(
		salmons.online.bots.characters.map((b) => b.character),
		['bear', 'fisherman'],
		'§14 #5: bears and fishermen',
	);
	assert.ok(salmons.online.rules.zones.length <= 64);
	assert.equal(salmons.online.rules.round.nextRoundSeconds, 15, '§14 #6');
	assert.ok(salmons.online.nearby);
});

/** A salmon that steers for the middle of the water a little upstream of it. */
const swimmer = (river) => (player) => {
	const ahead = player.body.y - 120;
	const band =
		river.bands.find((b) => ahead >= b.y && ahead < b.y + b.h) ??
		(ahead < river.bands[0].y ? river.bands[0] : river.bands.at(-1));
	const mid = (band.left + band.right) / 2;
	const dx = mid - player.body.x;
	return { moveX: Math.max(-1, Math.min(1, dx / 60)) * 90, moveY: -MOVE_SCALE };
};

await check('Salmons: a salmon that swims the river reaches the source and wins the round', () => {
	const river = salmonsRiver();
	const sim = createRoomSim(salmons, { seed: 1 });
	const me = sim.join('me', { character: 'salmon' });
	for (const bot of bots(sim)) bot.body.x = bot.body.x < 900 ? 0 : 1800;
	const swim = swimmer(river);
	let end;
	const steps = 120 * salmons.online.tickHz;
	for (let i = 0; i < steps && !end; i++) {
		const events = sim.step((id) => [clampInput({ ...swim(sim.players.get(id)), seq: i + 1 })]);
		// Keep the bots off it: this checks the river, not the hunt.
		for (const bot of bots(sim)) bot.status = STATUS.stunned;
		end = events.find((e) => e.type === 'roundEnd');
	}
	assert.ok(end, `the salmon reached the source (it got to y = ${Math.round(me.body.y)})`);
	assert.equal(end.winner, 'me');
	assert.equal(me.score, salmons.online.rules.round.goalScore);
});

await check(
	'Salmons: the current carries a resting salmon downstream; a bank pushes it back',
	() => {
		const river = salmonsRiver();
		const band = river.bands[5];
		const sim = createRoomSim(salmons, { seed: 1 });
		const me = sim.join('me', { character: 'salmon' });
		for (const bot of bots(sim)) sim.players.delete(bot.id);
		me.body.x = (band.left + band.right) / 2;
		me.body.y = band.y + 20;
		// A move along x only, inside the water: the current pushes it down.
		const y0 = me.body.y;
		sim.step(() => [clampInput({ seq: 1, moveX: 1 })]);
		assert.ok(me.body.y > y0, 'downstream');
		me.body.x = band.left - 60;
		const x0 = me.body.x;
		sim.step(() => [clampInput({ seq: 2, moveX: -1 })]);
		assert.ok(me.body.x > x0, 'the left bank pushes it back to the water');
	},
);

await check('Salmons: a bear bot catches a salmon that swims into it', () => {
	const sim = createRoomSim(salmons, { seed: 5 });
	const me = sim.join('me', { character: 'salmon' });
	const bear = bots(sim).find((b) => b.character.id === 'bear');
	me.body.x = bear.body.x + 300;
	me.body.y = bear.body.y;
	let caught;
	for (let i = 0; i < 300 && !caught; i++) {
		const events = sim.step(() => [clampInput({ seq: i + 1 })]);
		caught = events.find((e) => e.type === 'caught' && e.target === 'me');
	}
	assert.ok(caught, 'the bear bot chased the salmon and swiped');
	assert.equal(sim.players.get(caught.by).character.id, 'bear');
	assert.equal(me.status, STATUS.out);
});

// --- 4. live: a real server ------------------------------------------------------------------------

const freePort = () =>
	new Promise((resolve) => {
		const probe = createServer();
		probe.listen(0, () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, test, ms = 5000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (test()) return;
		await wait(10);
	}
	throw new Error(`timed out waiting for ${what}`);
};

const WIDE = { w: 4000, h: 600 };
const dir = mkdtempSync(join(tmpdir(), 'room-bots-'));
writeFileSync(
	join(dir, 'near.json'),
	JSON.stringify(
		configOf(
			{
				characters: [
					{ id: 'west', body: 'fishLook', speed: 3000, spawns: [{ x: 100, y: 300 }] },
					{ id: 'east', body: 'bearLook', speed: 3000, spawns: [{ x: 3900, y: 300 }] },
				],
				nearby: { w: 800, h: 600 },
			},
			{ field: WIDE },
		),
	),
);
writeFileSync(
	join(dir, 'bots.json'),
	JSON.stringify(configOf({ characters: CHARACTERS, bots: { ...BOTS, fillTo: 4 } })),
);
const port = await freePort();
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 2,
	commit: 'roombots0000',
	gracefullyShutdown: false,
	trustProxy: true,
	matchmakePerWindow: 120,
});
await server.listen(port);
const clientOf = () => new Client(`ws://127.0.0.1:${port}`);

try {
	await check(
		'live: bots fill the room, are marked, and give their place to a person',
		async () => {
			const a = await clientOf().joinOrCreate(ROOM_NAME, { game: 'bots', character: 'fish' });
			await until('the bots', () => a.state.players?.size === 4);
			const marked = [...a.state.players.entries()].filter(([, p]) => p.bot);
			assert.equal(marked.length, 3);
			assert.ok(marked.every(([id]) => isBotId(id)));
			assert.equal(a.state.players.get(a.sessionId).bot, false);
			const b = await clientOf().joinById(a.roomId, { character: 'fish' });
			await until(
				'a bot to give way',
				() => [...(b.state.players?.values() ?? [])].filter((p) => p.bot).length === 2,
			);
			assert.equal(b.state.players.size, 4);
			await b.leave();
			await until(
				'a bot back',
				() => [...a.state.players.values()].filter((p) => p.bot).length === 3,
			);
			await a.leave();
		},
	);

	await check(
		'live: nearby — a device is sent only the players near its own, their events, and only its own ack',
		async () => {
			const west = await clientOf().joinOrCreate(ROOM_NAME, { game: 'near', character: 'west' });
			const heard = [];
			west.onMessage(ONLINE_EVENT, (events) => heard.push(...events));
			const west2 = await clientOf().joinById(west.roomId, { character: 'west' });
			const east = await clientOf().joinById(west.roomId, { character: 'east' });
			await until('the west pair', () => west.state.players?.size === 2);
			await wait(300);
			assert.equal(west.state.players.has(east.sessionId), false, 'east is far: not sent');
			assert.equal(east.state.players.size, 1, 'east sees only itself');
			// Inputs move nobody (move 0) but are acknowledged: the own ack arrives, the other's not.
			const input = west.input();
			for (let seq = 1; seq <= 10; seq++) {
				Object.assign(input.data, { seq, moveX: 0, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });
				input.send();
				await wait(35);
			}
			const input2 = west2.input();
			for (let seq = 1; seq <= 10; seq++) {
				Object.assign(input2.data, { seq, moveX: 0, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });
				input2.send();
				await wait(35);
			}
			await until('the own ack', () => west.state.players.get(west.sessionId).ack === 10);
			await until('the other’s ack', () => west2.state.players.get(west2.sessionId).ack === 10);
			assert.equal(
				west.state.players.get(west2.sessionId).ack,
				undefined,
				'another’s ack is not sent',
			);
			// East swims west: it is sent to the west pair once inside their box, and back out.
			const go = east.input();
			let seq = 0;
			const swim = (moveX) =>
				setInterval(() => {
					Object.assign(go.data, { seq: ++seq, moveX, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });
					go.send();
				}, 1000 / 30);
			let timer = swim(-MOVE_SCALE);
			await until('east to arrive', () => west.state.players.has(east.sessionId), 5000);
			assert.ok(east.state.players.has(west.sessionId), 'and east is sent the west pair');
			clearInterval(timer);
			timer = swim(MOVE_SCALE);
			await until('east to leave', () => !west.state.players.has(east.sessionId), 5000);
			clearInterval(timer);
			// Events too: west is told when west2 leaves, not when far-away east does.
			await east.leave();
			await west2.leave();
			await until('west2’s leave', () =>
				heard.some((e) => e.type === 'left' && e.id === west2.sessionId),
			);
			assert.ok(!heard.some((e) => e.id === east.sessionId), 'nothing about far-away east');
			await west.leave();
		},
	);
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-bots — ${passed} checks passed`);
process.exit(0);
