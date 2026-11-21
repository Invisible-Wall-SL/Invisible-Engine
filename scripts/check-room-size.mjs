// A ROOM'S SIZE AND ITS BOTS BY SHARES (owner, 2026-11-20: "60% salmons, 25% fisherman 15% bear, when
// the room is empty"; "a setting to decide a room size… max of 100 Players per room, but I want to be
// able to quickly test that (so the amount of bot also scale)").
//
// 1. The fill (services/game-server roomSim.ts, "BOTS BY SHARES"): a room whose bots have shares is
//    exactly full while a person is in it, each class at its places less its people, at every size
//    from 3 to 100; a person takes the newest bot of its class, a class with no bot left refuses,
//    a leave or a respawn as another class lets a bot back, a dropped person keeps its place; a bot
//    starts at its class's place. A room whose bots are by count is filled as it always was.
// 2. The test room (server.ts ROOM_NAME_TEST, arcadeRoom.ts, configSource.ts), on a real Colyseus
//    0.18 server and its matchmaker: `{ game, size }` plays the game at that size, bots and all; a
//    size outside the game's range is refused, not clamped; a public join and a test join never
//    match each other's rooms; the process holds at most `maxTestRooms` of them.
//
//   pnpm check:room-size

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { STATUS } from '../packages/engine-mechanics/src/abilities.js';
import { clampInput } from '../packages/engine-mechanics/src/online.js';
import { createRng } from '../packages/engine-mechanics/src/board.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	botShareCounts,
	normalizeGameConfigDoc,
	onlineGameOf,
	onlineTestSizeRange,
} from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createConfigSource, SizeRefusal } from '../services/game-server/src/configSource.ts';
import { createRoomSim, RoomRefusal } from '../services/game-server/src/roomSim.ts';
import {
	MAX_TEST_ROOMS,
	ROOM_NAME,
	ROOM_NAME_TEST,
	createGameServer,
	listRooms,
} from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);

let passed = 0;
const check = async (name, fn) => {
	try {
		await fn();
		passed += 1;
		console.log(`  ok  ${name}`);
	} catch (e) {
		console.error(`✗ ${name}`);
		throw e;
	}
};

// --- the games -------------------------------------------------------------------------------------

const STILL = { initial: 'rest', states: [{ id: 'rest', behaviour: 'idle' }], transitions: [] };
const SHARES = [
	{ character: 'salmon', share: 60 },
	{ character: 'fisherman', share: 25 },
	{ character: 'bear', share: 15 },
];
const CLASSES = SHARES.map((s) => s.character);
const SALMON_SPAWNS = [
	{ x: 300, y: 1000 },
	{ x: 500, y: 1000 },
	{ x: 700, y: 1000 },
];
const BEAR_SPAWNS = [
	{ x: 200, y: 300 },
	{ x: 1400, y: 300 },
];
const BOT_SPAWNS = [
	{ x: 100, y: 600 },
	{ x: 1500, y: 600 },
];
const ROOM_SPAWN = { x: 800, y: 900 };

/** A plain game of three classes whose bots have the owner's shares: salmon start at their own
 *  spawns in turn, bears at theirs at random, fishermen have none (the bots' spawns). */
const mixDoc = (size, { online = {}, bots = {} } = {}) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Room size',
	arcade: {
		field: { w: 1600, h: 1200 },
		bodies: {
			salmonLook: { shape: 'circle', r: 12, tags: ['salmon'] },
			fishermanLook: { shape: 'circle', r: 12, tags: ['fisherman'] },
			bearLook: { shape: 'circle', r: 12, tags: ['bear'] },
		},
		characters: CLASSES.map((id) => ({ id: `${id}Bot`, component: `${id}Look`, brain: STILL })),
		online: {
			maxPlayers: size,
			// Not the shares' order: a join that names no class goes by this one.
			characters: [
				{ id: 'salmon', body: 'salmonLook', speed: 200, spawns: SALMON_SPAWNS },
				{ id: 'bear', body: 'bearLook', speed: 150, spawns: BEAR_SPAWNS, randomSpawn: true },
				{ id: 'fisherman', body: 'fishermanLook', speed: 100 },
			],
			spawn: ROOM_SPAWN,
			rules: { respawn: 'manual' },
			bots: {
				characters: SHARES.map((s) => ({ ...s, brain: `${s.character}Bot` })),
				spawns: BOT_SPAWNS,
				...bots,
			},
			...online,
		},
	},
});
const gameOf = (doc, options) => {
	const game = onlineGameOf(normalizeGameConfigDoc(doc), options);
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};
const mixRoom = (size, seed = 7, extra) => createRoomSim(gameOf(mixDoc(size, extra)), { seed });

const salmonsDoc = normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)));

const botsIn = (sim) => [...sim.players.values()].filter((p) => p.bot);
const peopleIn = (sim) => [...sim.players.values()].filter((p) => !p.bot);
/** How many of `players` each class has, every class named. */
const census = (players) =>
	Object.fromEntries(
		CLASSES.map((id) => [id, players.filter((p) => p.character.id === id).length]),
	);
const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const refusal = (fn) => {
	try {
		fn();
	} catch (error) {
		assert.ok(error instanceof RoomRefusal, String(error));
		return error.message;
	}
	return undefined;
};
/** The room as the rules say it must be: full while a person is in it, each class at its places
 *  less its people; empty of bots with nobody. */
const assertFilled = (sim, note) => {
	const counts = sim.game.online.bots.counts;
	const size = sim.game.online.maxPlayers;
	const people = census(peopleIn(sim));
	const bots = census(botsIn(sim));
	assert.ok(sim.players.size <= size, `${note}: ${sim.players.size} in a room of ${size}`);
	if (!peopleIn(sim).length) {
		assert.equal(botsIn(sim).length, 0, `${note}: nobody in the room, no bots`);
		return;
	}
	assert.equal(sim.players.size, size, `${note}: the room is exactly full`);
	for (const id of CLASSES) {
		assert.ok(people[id] <= counts[id], `${note}: ${people[id]} people of ${id}`);
		assert.equal(bots[id], counts[id] - people[id], `${note}: bots of ${id}`);
	}
};
const rest = (sim) => () => [clampInput({ seq: sim.steps + 1 }, sim.game.field)];

/** What the room of `a room whose bots are by count` did before bots had shares (recorded on
 *  81e3245f's `roomSim.ts`): who is in it after each join and leave, and where. */
const BY_COUNT_LOG = [
	'+a: a=salmon@300,1000 bot:1=bear@100,600 bot:2=fisherman@1500,600 bot:3=bear@100,600 bot:4=fisherman@1500,600 bot:5=bear@100,600',
	'+b: a=salmon@300,1000 bot:1=bear@100,600 bot:2=fisherman@1500,600 bot:3=bear@100,600 bot:4=fisherman@1500,600 b=bear@800,900',
	'+c: a=salmon@300,1000 bot:1=bear@100,600 bot:2=fisherman@1500,600 bot:3=bear@100,600 b=bear@800,900 c=salmon@500,1000',
	'+d: a=salmon@300,1000 bot:1=bear@100,600 bot:2=fisherman@1500,600 b=bear@800,900 c=salmon@500,1000 d=fisherman@800,900',
	'+e: a=salmon@300,1000 bot:1=bear@100,600 b=bear@800,900 c=salmon@500,1000 d=fisherman@800,900 e=fisherman@800,900',
	'+f: no place left for fisherman',
	'+g: a=salmon@300,1000 b=bear@800,900 c=salmon@500,1000 d=fisherman@800,900 e=fisherman@800,900 g=bear@800,900',
	'+h: a=salmon@300,1000 b=bear@800,900 c=salmon@500,1000 d=fisherman@800,900 e=fisherman@800,900 g=bear@800,900 h=bear@800,900',
	'+i: no place left for bear',
	'+j: a=salmon@300,1000 b=bear@800,900 c=salmon@500,1000 d=fisherman@800,900 e=fisherman@800,900 g=bear@800,900 h=bear@800,900 j=salmon@700,1000',
	'+k: the room is full',
	'-b: a=salmon@300,1000 c=salmon@500,1000 d=fisherman@800,900 e=fisherman@800,900 g=bear@800,900 h=bear@800,900 j=salmon@700,1000',
	'-d: a=salmon@300,1000 c=salmon@500,1000 e=fisherman@800,900 g=bear@800,900 h=bear@800,900 j=salmon@700,1000',
	'empty: ',
];

// --- 1. the fill -----------------------------------------------------------------------------------

await check('60 / 25 / 15 at every size from 3 to 100: the room is full, to the bot', () => {
	for (const [size, mix] of [
		[10, { salmon: 6, fisherman: 3, bear: 1 }],
		[30, { salmon: 18, fisherman: 8, bear: 4 }],
		[100, { salmon: 60, fisherman: 25, bear: 15 }],
	])
		assert.deepEqual(botShareCounts(size, SHARES), mix, `a room of ${size}`);
	for (let size = 3; size <= 100; size++) {
		const counts = botShareCounts(size, SHARES);
		assert.equal(sum(counts), size, `size ${size}: the counts sum to it`);
		assert.ok(
			Object.values(counts).every((n) => n >= 1),
			`size ${size}: no class is empty`,
		);
		for (const mine of CLASSES) {
			const sim = mixRoom(size);
			assert.deepEqual(sim.game.online.bots.counts, counts, `size ${size}: the room's places`);
			assert.equal(sim.players.size, 0, 'nobody in the room: no bots');
			sim.join('me', { character: mine });
			// With the one person a bot again, the mix is exactly the counts.
			assert.deepEqual(
				census(botsIn(sim)),
				{ ...counts, [mine]: counts[mine] - 1 },
				`size ${size}, a person's ${mine}: the bots`,
			);
			assert.equal(sim.players.size, size, `size ${size}: full`);
			sim.leave('me');
			assert.equal(sim.players.size, 0, 'the person left: the bots too');
		}
	}
});

await check('Salmons as it ships: 100 by its config, and every test size its range allows', () => {
	assert.deepEqual(validateFamily(normalizeGameConfigDoc(salmonsConfig())), []);
	const range = onlineTestSizeRange(salmonsDoc.arcade.online);
	assert.deepEqual(range, { min: 3, max: 100 });
	const shipped = gameOf(salmonsDoc);
	assert.equal(shipped.online.maxPlayers, 100);
	assert.deepEqual(shipped.online.bots.counts, { salmon: 60, fisherman: 25, bear: 15 });
	for (let size = range.min; size <= range.max; size++) {
		const game = gameOf(salmonsDoc, { size });
		const counts = botShareCounts(size, SHARES);
		assert.equal(game.online.maxPlayers, size);
		assert.deepEqual(game.online.bots.counts, counts);
		// Every size's room on a few sizes' worth of levels: a room makes its own river.
		if (size % 7 !== 3 && size !== 100) continue;
		const sim = createRoomSim(game, { seed: size });
		sim.join('me', { character: 'salmon' });
		assert.deepEqual(census(botsIn(sim)), { ...counts, salmon: counts.salmon - 1 }, `${size}`);
		assert.equal(sim.players.size, size);
	}
});

await check('a person takes the newest bot of its class; a class with no bot left refuses', () => {
	const sim = mixRoom(10);
	sim.join('p1', { character: 'bear' });
	assertFilled(sim, 'one bear');
	assert.equal(census(botsIn(sim)).bear, 0, 'the one bear is the person');
	const before = [...sim.players.keys()];
	assert.equal(
		refusal(() => sim.join('p2', { character: 'bear' })),
		'no place left for bear',
	);
	assert.deepEqual([...sim.players.keys()], before, 'a refused join changes nothing');
	assert.equal(
		refusal(() => sim.join('p2', { character: 'otter' })),
		'unknown character',
	);
	// Fishermen: three places, so three people and then no more.
	for (let n = 0; n < 3; n++) {
		const newest = botsIn(sim)
			.filter((p) => p.character.id === 'fisherman')
			.at(-1).id;
		const others = botsIn(sim)
			.map((p) => p.id)
			.filter((id) => id !== newest);
		sim.join(`f${n}`, { character: 'fisherman' });
		assert.ok(!sim.players.has(newest), 'the newest fisherman bot gave its place');
		assert.deepEqual(
			botsIn(sim).map((p) => p.id),
			others,
			'and no other bot moved',
		);
		assertFilled(sim, `fisherman ${n}`);
	}
	assert.equal(
		refusal(() => sim.join('f3', { character: 'fisherman' })),
		'no place left for fisherman',
	);
	assertFilled(sim, 'after the refusals');
});

await check('a join that names no class gets the first, in the room’s order, with a place', () => {
	const sim = mixRoom(10);
	const got = [];
	for (let n = 0; n < 10; n++) got.push(sim.join(`p${n}`, {}).character.id);
	// `online.characters` is salmon, bear, fisherman: six salmon, the one bear, three fishermen.
	assert.deepEqual(got, [
		...Array(6).fill('salmon'),
		'bear',
		'fisherman',
		'fisherman',
		'fisherman',
	]);
	assert.equal(botsIn(sim).length, 0, 'a room full of people has no bot');
	assert.equal(
		refusal(() => sim.join('late', {})),
		'the room is full',
	);
	assert.equal(
		refusal(() => sim.join('late', { character: 'salmon' })),
		'the room is full',
	);
	assert.equal(sim.players.size, 10);
});

await check('a leave lets a bot of that class back; the last person takes the bots along', () => {
	const sim = mixRoom(10);
	for (const [id, character] of [
		['a', 'salmon'],
		['b', 'bear'],
		['c', 'fisherman'],
	])
		sim.join(id, { character });
	assert.deepEqual(census(botsIn(sim)), { salmon: 5, fisherman: 2, bear: 0 });
	sim.leave('b');
	assert.deepEqual(census(botsIn(sim)), { salmon: 5, fisherman: 2, bear: 1 }, 'a bear bot is back');
	assertFilled(sim, 'b left');
	sim.leave('a');
	assert.deepEqual(census(botsIn(sim)), { salmon: 6, fisherman: 2, bear: 1 });
	sim.leave('c');
	assert.equal(sim.players.size, 0, 'nobody in the room: no bots');
});

await check('a dropped person’s place is held: no bot takes it, and nobody else', () => {
	const sim = mixRoom(10);
	sim.join('a', { character: 'bear' });
	sim.drop('a');
	for (let i = 0; i < 30; i++) sim.step(rest(sim));
	assertFilled(sim, 'a dropped');
	assert.equal(census(botsIn(sim)).bear, 0, 'no bear bot while its place is held');
	assert.equal(
		refusal(() => sim.join('b', { character: 'bear' })),
		'no place left for bear',
	);
	sim.rejoin('a');
	assertFilled(sim, 'a back');
	sim.leave('a');
	assert.equal(sim.players.size, 0);
});

/** Put a person out as a catch does, then press Respawn as `online.characters[pick - 1]`. */
const respawnAs = (sim, id, pick) => {
	const player = sim.players.get(id);
	player.status = STATUS.out;
	player.until = Infinity;
	assert.ok(sim.rules.awaitsRespawn(player), 'it waits for its Respawn');
	sim.step((who) => [
		clampInput({ seq: sim.steps + 1, ...(who === id ? { respawn: pick } : {}) }, sim.game.field),
	]);
	return player;
};
const PICK = { salmon: 1, bear: 2, fisherman: 3 };

await check('a respawn as another class swaps the bots: one out there, one back here', () => {
	const sim = mixRoom(10);
	sim.join('a', { character: 'salmon' });
	sim.join('b', { character: 'salmon' });
	assert.deepEqual(census(botsIn(sim)), { salmon: 4, fisherman: 3, bear: 1 });
	const bearBot = botsIn(sim).find((p) => p.character.id === 'bear').id;
	const a = respawnAs(sim, 'a', PICK.bear);
	assert.equal(a.character.id, 'bear');
	assert.equal(a.status, STATUS.free);
	assert.ok(!sim.players.has(bearBot), 'the bear bot gave its place');
	assert.deepEqual(census(botsIn(sim)), { salmon: 5, fisherman: 3, bear: 0 }, 'a salmon bot back');
	assertFilled(sim, 'a is a bear');
	// The bears' one place is a's: b's Respawn as a bear is refused, and b stays out as it was.
	const b = respawnAs(sim, 'b', PICK.bear);
	assert.equal(b.character.id, 'salmon');
	assert.equal(b.status, STATUS.out, 'refused: it still waits');
	assertFilled(sim, 'b refused');
	// Two in one step, each into the class the other leaves: both are let in.
	const sim2 = mixRoom(10);
	sim2.join('a', { character: 'salmon' });
	sim2.join('b', { character: 'bear' });
	for (const id of ['a', 'b'])
		Object.assign(sim2.players.get(id), { status: STATUS.out, until: Infinity });
	sim2.step((who) => [
		clampInput(
			{ seq: sim2.steps + 1, respawn: who === 'a' ? PICK.bear : PICK.salmon },
			sim2.game.field,
		),
	]);
	assert.deepEqual(
		['a', 'b'].map((id) => sim2.players.get(id).character.id),
		['salmon', 'salmon'],
		'the bears’ place was b’s when a asked: a is refused, b becomes a salmon',
	);
	assertFilled(sim2, 'after the pair');
	assert.equal(census(botsIn(sim2)).bear, 1, 'and a bear bot has b’s old place');
});

await check('never over its size: a seeded run of joins, leaves, drops and respawns', () => {
	for (const [size, seed] of [
		[3, 1],
		[10, 2],
		[30, 3],
		[100, 4],
	]) {
		const sim = mixRoom(size, seed);
		const rng = createRng(`room-size:${seed}`);
		const inside = [];
		let made = 0;
		let most = 0;
		let refused = 0;
		for (let turn = 0; turn < 600; turn++) {
			const roll = rng();
			const who = inside[Math.floor(rng() * inside.length)];
			if (roll < 0.45 || !inside.length) {
				const id = `p${made++}`;
				const asked = rng() < 0.2 ? undefined : CLASSES[Math.floor(rng() * CLASSES.length)];
				if (refusal(() => sim.join(id, { character: asked })) === undefined) inside.push(id);
				else refused += 1;
			} else if (roll < 0.7) {
				sim.leave(who);
				inside.splice(inside.indexOf(who), 1);
			} else if (roll < 0.8) sim.drop(who);
			else if (roll < 0.85) sim.rejoin(who);
			else {
				const player = sim.players.get(who);
				if (player.connected) respawnAs(sim, who, 1 + Math.floor(rng() * 3));
			}
			assertFilled(sim, `size ${size}, turn ${turn}`);
			assert.equal(peopleIn(sim).length, inside.length);
			most = Math.max(most, inside.length);
		}
		assert.ok(refused > 0, `size ${size}: some joins were refused (${refused})`);
		assert.ok(most >= Math.min(size, 20), `size ${size}: up to ${most} people at once`);
	}
});

await check('a bot starts at a place of its class', () => {
	const near = (p, at) => Math.hypot(p.body.x - at.x, p.body.y - at.y) < 1e-6;
	const sim = mixRoom(30);
	sim.join('me', { character: 'salmon' });
	const of = (id) => botsIn(sim).filter((p) => p.character.id === id);
	// Its class's spawns, in turn.
	of('salmon').forEach((bot, i) => {
		assert.deepEqual(bot.home, SALMON_SPAWNS[i % SALMON_SPAWNS.length], `salmon bot ${i}`);
		assert.ok(near(bot, bot.home));
	});
	// At random among them, for a class that spawns so: every one of them used.
	const bearsAt = new Set();
	for (let seed = 1; seed <= 20; seed++) {
		const room = mixRoom(30, seed);
		room.join('me', { character: 'salmon' });
		for (const bot of botsIn(room).filter((p) => p.character.id === 'bear')) {
			const at = BEAR_SPAWNS.findIndex((s) => near(bot, s));
			assert.ok(at >= 0, 'a bear bot starts on a bear spawn');
			bearsAt.add(at);
		}
	}
	assert.equal(bearsAt.size, BEAR_SPAWNS.length);
	// A class with no spawns: the bots' spawns; with none of those either, the room's spawn.
	for (const bot of of('fisherman'))
		assert.ok(
			BOT_SPAWNS.some((s) => near(bot, s)),
			'a fisherman bot on a bots’ spawn',
		);
	assert.equal(new Set(of('fisherman').map((p) => p.body.x)).size, BOT_SPAWNS.length);
	const bare = mixRoom(30, 7, { bots: { spawns: undefined } });
	bare.join('me', { character: 'salmon' });
	for (const bot of botsIn(bare).filter((p) => p.character.id === 'fisherman'))
		assert.ok(near(bot, ROOM_SPAWN), 'a fisherman bot on the room’s spawn');
	// Salmons: a bot salmon starts where salmon start, never on a bank.
	const river = createRoomSim(gameOf(salmonsDoc, { size: 30 }), { seed: 3 });
	river.join('me', { character: 'bear' });
	const salmon = river.game.online.characters.find((c) => c.id === 'salmon');
	const starts = botsIn(river).filter((p) => p.character.id === 'salmon');
	assert.equal(starts.length, 18);
	for (const bot of starts)
		assert.ok(
			salmon.spawns.some((s) => Math.hypot(bot.body.x - s.x, bot.body.y - s.y) < 1),
			`${bot.id} starts on a salmon's place`,
		);
});

await check('the classes are spread through the room’s order, not one after another', () => {
	const sim = mixRoom(100);
	sim.join('me', { character: 'salmon' });
	const order = botsIn(sim).map((p) => p.character.id);
	// Any twenty bots in a row hold some of every class.
	for (let i = 0; i + 20 <= order.length; i++)
		assert.equal(new Set(order.slice(i, i + 20)).size, 3, `bots ${i + 1}–${i + 20}`);
});

await check('a room whose bots are by count is filled as before', () => {
	const doc = mixDoc(8, {
		online: {
			characters: [
				{ id: 'salmon', body: 'salmonLook', speed: 200, spawns: SALMON_SPAWNS },
				{ id: 'bear', body: 'bearLook', speed: 150, max: 3 },
				{ id: 'fisherman', body: 'fishermanLook', speed: 100, max: 2 },
			],
		},
		bots: {
			characters: [
				{ character: 'bear', brain: 'bearBot' },
				{ character: 'fisherman', brain: 'fishermanBot' },
			],
			fillTo: 6,
		},
	});
	const game = gameOf(doc);
	assert.equal(game.online.bots.counts, undefined, 'no shares: by count');
	const sim = createRoomSim(game, { seed: 7 });
	const log = [];
	const note = (what) =>
		log.push(
			`${what}: ${[...sim.players.values()]
				.map((p) => `${p.id}=${p.character.id}@${p.body.x},${p.body.y}`)
				.join(' ')}`,
		);
	const join = (id, character) => {
		const refused = refusal(() => sim.join(id, { character }));
		if (refused === undefined) note(`+${id}`);
		else log.push(`+${id}: ${refused}`);
	};
	join('a', 'salmon');
	join('b', 'bear');
	join('c', undefined);
	join('d', 'fisherman');
	join('e', 'fisherman');
	join('f', 'fisherman');
	join('g', 'bear');
	join('h', 'bear');
	join('i', 'bear');
	join('j', 'salmon');
	join('k', 'salmon');
	sim.leave('b');
	note('-b');
	sim.leave('d');
	note('-d');
	for (const id of [...sim.players.keys()]) sim.leave(id);
	note('empty');
	assert.deepEqual(log, BY_COUNT_LOG);
});

// --- 2. the test room ------------------------------------------------------------------------------

await check(
	'a config resolves at a test size inside its range, and refuses any other',
	async () => {
		const dir = mkdtempSync(join(tmpdir(), 'room-size-source-'));
		try {
			writeFileSync(join(dir, 'mix.json'), JSON.stringify(mixDoc(30)));
			let now = 0;
			const load = createConfigSource({ dir, now: () => now });
			assert.equal((await load('mix')).online.maxPlayers, 30);
			const ten = await load('mix', 10);
			assert.equal(ten.online.maxPlayers, 10);
			assert.deepEqual(ten.online.bots.counts, { salmon: 6, fisherman: 3, bear: 1 });
			assert.equal(await load('mix', 10), ten, 'a size is resolved once for a config');
			assert.equal((await load('mix')).online.maxPlayers, 30, 'the game itself is not touched');
			for (const size of [2, 31, 0, -5, 10.5, NaN, Infinity, 1e9])
				await assert.rejects(load('mix', size), SizeRefusal, `size ${size}`);
			await assert.rejects(load('mix', 31), /holds 3 to 30 players/);
			// A new publish with a smaller room: its sizes follow the new config, not the old one's.
			writeFileSync(join(dir, 'mix.json'), JSON.stringify(mixDoc(8)));
			now += 61_000;
			assert.equal((await load('mix')).online.maxPlayers, 8);
			await assert.rejects(load('mix', 10), /holds 3 to 8 players/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

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
/** Why the server did not let a join in. */
const refusedWith = async (join) => {
	try {
		const room = await join;
		await room.leave();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return undefined;
};

const dir = mkdtempSync(join(tmpdir(), 'room-size-'));
writeFileSync(join(dir, 'mix.json'), JSON.stringify(mixDoc(30)));
writeFileSync(join(dir, 'other.json'), JSON.stringify(mixDoc(30)));
const TEST_ROOMS = 2;
const port = await freePort();
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 6,
	maxTestRooms: TEST_ROOMS,
	commit: 'roomsize0000',
	gracefullyShutdown: false,
	matchmakePerWindow: 1000,
	perAddress: { sockets: 100, upgrades: 1000 },
});
await server.listen(port);
const clientOf = () => new Client(`ws://127.0.0.1:${port}`);
const sent = (room) => [...(room.state.players?.values() ?? [])];
const mixOf = (room) => census(sent(room).map((p) => ({ character: { id: p.character } })));

try {
	await check(
		'live: a test size outside the game’s range is refused, and makes no room',
		async () => {
			assert.equal(MAX_TEST_ROOMS, 4, 'a process holds four test rooms unless told otherwise');
			const join = (options) => clientOf().joinOrCreate(ROOM_NAME_TEST, options);
			const RANGE = /a test room of this game holds 3 to 30 players/;
			const WHOLE = /a test room needs a whole number of players/;
			for (const [size, why] of [
				[2, RANGE],
				[31, RANGE],
				[100, RANGE],
				[0, RANGE],
				[-10, RANGE],
				[10.5, WHOLE],
				['10', WHOLE],
				[null, WHOLE],
				[true, WHOLE],
				[[10], WHOLE],
			]) {
				const message = await refusedWith(join({ game: 'mix', character: 'salmon', size }));
				assert.match(String(message), why, `size ${JSON.stringify(size)}: ${message}`);
			}
			assert.match(String(await refusedWith(join({ game: 'mix', character: 'salmon' }))), WHOLE);
			assert.match(
				String(await refusedWith(join({ game: 'nosuchgame', size: 10 }))),
				/not available/,
			);
			assert.match(String(await refusedWith(join({ size: 10 }))), /not available/);
			assert.equal(server.rooms.count, 0, 'no room was made');
			assert.equal(server.testRooms.count, 0);
		},
	);

	await check(
		'live: a test room is its size, its bots scaled; it never meets a public join',
		async () => {
			const pub = await clientOf().joinOrCreate(ROOM_NAME, { game: 'mix', character: 'salmon' });
			await until('the public room’s bots', () => sent(pub).length === 30);
			assert.deepEqual(mixOf(pub), { salmon: 18, fisherman: 8, bear: 4 }, 'the config’s size');
			const test = await clientOf().joinOrCreate(ROOM_NAME_TEST, {
				game: 'mix',
				character: 'salmon',
				size: 10,
			});
			assert.notEqual(test.roomId, pub.roomId, 'a test join made a room of its own');
			await until('the test room’s bots', () => sent(test).length === 10);
			await wait(200);
			assert.deepEqual(mixOf(test), { salmon: 6, fisherman: 3, bear: 1 }, 'ten: 6 / 3 / 1');
			assert.equal(sent(test).filter((p) => p.bot).length, 9);
			assert.equal(sent(pub).length, 30, 'the public room is as it was');
			assert.deepEqual([server.rooms.count, server.testRooms.count], [2, 1]);

			// A second test join of the same size shares the room; another size gets its own.
			const test2 = await clientOf().joinOrCreate(ROOM_NAME_TEST, {
				game: 'mix',
				character: 'bear',
				size: 10,
			});
			assert.equal(test2.roomId, test.roomId);
			await until('a bear bot to give way', () => sent(test2).filter((p) => p.bot).length === 8);
			assert.equal(sent(test2).length, 10, 'still ten');
			const twelve = await clientOf().joinOrCreate(ROOM_NAME_TEST, {
				game: 'mix',
				character: 'salmon',
				size: 12,
			});
			assert.notEqual(twelve.roomId, test.roomId);
			await until('twelve', () => sent(twelve).length === 12);
			assert.deepEqual(mixOf(twelve), botShareCounts(12, SHARES));
			assert.deepEqual([server.rooms.count, server.testRooms.count], [3, 2]);

			// Public joins: always the public room, though test rooms of the game have space.
			for (let n = 0; n < 4; n++) {
				const again = await clientOf().joinOrCreate(ROOM_NAME, {
					game: 'mix',
					character: 'salmon',
				});
				assert.equal(again.roomId, pub.roomId, 'a public join lands in the public room');
				await again.leave();
			}
			assert.deepEqual(
				(await listRooms('mix')).map((room) => room.roomId),
				[pub.roomId],
				'the listing names the public room only',
			);
			// And with the public room gone, a public join makes a public room: never a test one.
			await pub.leave();
			await until('the public room to close', () => server.rooms.count === 2);
			const fresh = await clientOf().joinOrCreate(ROOM_NAME, { game: 'mix', character: 'salmon' });
			assert.ok(![test.roomId, twelve.roomId].includes(fresh.roomId));
			await until('a room of the config’s size', () => sent(fresh).length === 30);
			assert.deepEqual([server.rooms.count, server.testRooms.count], [3, 2]);
			await fresh.leave();

			// Test joins: only the room of their own game and size.
			const join = (options) => clientOf().joinOrCreate(ROOM_NAME_TEST, options);
			const ANOTHER = /test room of another game or size/;
			assert.match(String(await refusedWith(join({ character: 'salmon' }))), ANOTHER);
			assert.match(String(await refusedWith(join({ game: 'mix' }))), ANOTHER);
			assert.match(String(await refusedWith(join({ size: 10 }))), ANOTHER);
			assert.match(
				String(await refusedWith(clientOf().joinById(test.roomId, { character: 'salmon' }))),
				ANOTHER,
			);
			assert.match(
				String(await refusedWith(clientOf().joinById(test.roomId, { game: 'mix', size: 12 }))),
				ANOTHER,
			);
			await wait(100);
			assert.equal(sent(test).length, 10, 'the refused joins changed nothing');
			assert.equal(sent(test).filter((p) => !p.bot).length, 2);

			// The cap: a third test room is refused while two are alive, whatever the game or size.
			assert.match(
				String(await refusedWith(join({ game: 'mix', character: 'salmon', size: 14 }))),
				/holds no more test rooms/,
			);
			assert.match(
				String(await refusedWith(join({ game: 'other', character: 'salmon', size: 10 }))),
				/holds no more test rooms/,
			);
			assert.equal(server.testRooms.count, TEST_ROOMS);
			// A public room is not a test room: the cap does not refuse it.
			const other = await clientOf().joinOrCreate(ROOM_NAME, { game: 'other', character: 'bear' });
			await other.leave();
			// A test room that closes gives its place back.
			await twelve.leave();
			await until('the room of twelve to close', () => server.testRooms.count === 1);
			const otherTest = await join({ game: 'other', character: 'salmon', size: 10 });
			assert.notEqual(otherTest.roomId, test.roomId, 'another game’s room of ten is its own');
			await until('its ten', () => sent(otherTest).length === 10);
			await Promise.all([test.leave(), test2.leave(), otherTest.leave()]);
			await until('every room to close', () => server.rooms.count === 0);
			assert.equal(server.testRooms.count, 0);
		},
	);
} finally {
	await server.close();
}

// A server told to hold no test rooms: the room type answers, and makes none.
const offPort = await freePort();
const off = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 6,
	maxTestRooms: 0,
	commit: 'roomsize0000',
	gracefullyShutdown: false,
});
await off.listen(offPort);
try {
	await check(
		'live: with no test rooms allowed, a test join is refused and a public one is not',
		async () => {
			const client = () => new Client(`ws://127.0.0.1:${offPort}`);
			const options = { game: 'mix', character: 'salmon' };
			assert.match(
				String(await refusedWith(client().joinOrCreate(ROOM_NAME_TEST, { ...options, size: 10 }))),
				/holds no test rooms/,
			);
			assert.deepEqual([off.rooms.count, off.testRooms.count], [0, 0]);
			const pub = await client().joinOrCreate(ROOM_NAME, options);
			await until('the public room', () => sent(pub).length === 30);
			await pub.leave();
		},
	);
} finally {
	await off.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-size — ${passed} checks passed`);
process.exit(0);
