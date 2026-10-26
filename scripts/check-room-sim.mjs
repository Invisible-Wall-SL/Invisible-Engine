// Online arcade rooms (services/game-server; docs/design/realtime-multiplayer.md §6, §11, §12;
// P10.14): the room's step and the device's step agree to the bit over 10 000 steps, inputs apply
// in `seq` order, repeated and stale inputs are dropped, the server takes inputs only, and players
// join, leave and rejoin — first headless over the room's own code, then over a real Colyseus 0.18
// server on localhost with real `@colyseus/sdk` clients.
//
// Run: pnpm check:room-sim

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	MOVE_SCALE,
	characterBody,
	clampInput,
	sanitizeInput,
	stepContext,
	stepPlayer,
} from '../packages/engine-mechanics/src/online.js';
import {
	ARCADE_ONLINE_MECHANIC,
	ARCADE_RULES_MECHANIC,
	MATCH3_RGS_MECHANIC,
	MATCH3_RULES_MECHANIC,
	REELS_MECHANIC,
	mechanicFor,
} from '../packages/engine-game/src/game/mechanic.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim, RoomRefusal } from '../services/game-server/src/roomSim.ts';
import { messagesPerSecond } from '../services/game-server/src/arcadeRoom.ts';
import { ROOM_NAME, createGameServer } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);
const { matchMaker } = await import(
	pathToFileURL(gameServerRequire.resolve('@colyseus/core')).href
);

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

const FIELD = { w: 800, h: 600 };
const configOf = (online, bodies = {}) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Room sim',
	arcade: {
		field: FIELD,
		bodies: {
			salmon: { shape: 'circle', r: 20, tags: ['player'] },
			bear: { shape: 'box', w: 60, h: 40, tags: ['player'], edges: 'wrap' },
			fish: { shape: 'circle', r: 8, edges: 'pass' },
			...bodies,
		},
		online,
	},
});
const gameOf = (online) => {
	const game = onlineGameOf(normalizeGameConfigDoc(configOf(online)));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};
const CHARACTERS = [
	{ id: 'salmon', body: 'salmon', speed: 240 },
	{ id: 'bear', body: 'bear', speed: 180, max: 2 },
	{ id: 'fish', body: 'fish', speed: 420 },
];

/** A random raw input, sometimes hostile: off-scale moves, extra fields claiming a place or a score. */
const randomInput = (rng, seq) => {
	const raw = {
		seq,
		moveX: Math.round((rng() * 2 - 1) * 200),
		moveY: Math.round((rng() * 2 - 1) * 200),
		buttons: Math.floor(rng() * 256),
		aimX: (rng() * 2 - 0.5) * FIELD.w,
		aimY: (rng() * 2 - 0.5) * FIELD.h,
	};
	if (rng() < 0.05) Object.assign(raw, { x: 9999, y: -9999, score: 1e6, character: 'bear' });
	if (rng() < 0.03) raw.moveX = Number.NaN;
	return raw;
};

const bodyKey = (b) => [b.x, b.y, b.vx, b.vy];

// --- 1. headless: the room's step against the device's step -------------------------------------

/**
 * What the transport does before the room sees an input: the schema keeps only its own fields,
 * `sanitizeInput` clamps them, and a `seq` no newer than the last accepted is dropped. (Colyseus
 * does this in the server; the live half below runs the real thing.)
 */
const receiver = (field) => {
	let last = 0;
	const queue = [];
	return {
		queue,
		receive(raw) {
			const decoded = sanitizeInput(
				{
					seq: raw.seq,
					moveX: raw.moveX,
					moveY: raw.moveY,
					buttons: raw.buttons,
					aimX: raw.aimX,
					aimY: raw.aimY,
				},
				field,
			);
			if (decoded.seq <= last) return false;
			last = decoded.seq;
			queue.push(decoded);
			return true;
		},
	};
};

const runHeadless = (online, steps, seed) => {
	const game = gameOf({ characters: CHARACTERS, maxPlayers: 8, ...online });
	const sim = createRoomSim(game);
	const rng = createRng(seed);
	const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
	const characters = ['salmon', 'bear', 'fish', 'salmon', 'bear', 'fish'];
	const devices = new Map();
	for (const [i, id] of ids.entries()) {
		const player = sim.join(id, { name: `P${i}`, character: characters[i] });
		devices.set(id, {
			nextSeq: 1,
			rx: receiver(game.field),
			// The device: its own copy of its body, stepped with the very same function.
			body: characterBody(id, game.bodies[player.character.body], { ...player.body }),
			speed: player.character.speed,
			predicted: [],
		});
		Object.assign(devices.get(id).body, { x: player.body.x, y: player.body.y });
	}
	let repeats = 0;
	let gaps = 0;
	let starved = 0;
	for (let s = 0; s < steps; s++) {
		for (const id of ids) {
			const device = devices.get(id);
			const roll = rng();
			if (roll < 0.04) continue; // the device sent nothing this step (a starved step)
			if (roll < 0.07) device.nextSeq += 1 + Math.floor(rng() * 3); // a gap in seq
			const raw = randomInput(rng, device.nextSeq);
			device.nextSeq += 1;
			if (device.rx.receive(raw)) device.predicted.push(clampInput(raw, game.field));
			// The network delivers a copy again, or one from the past: both are dropped.
			if (rng() < 0.05) (assert.equal(device.rx.receive(raw), false), (repeats += 1));
			if (rng() < 0.02) assert.equal(device.rx.receive({ ...raw, seq: raw.seq - 5 }), false);
			if (roll >= 0.04 && roll < 0.07) gaps += 1;
		}
		sim.step((id) => devices.get(id).rx.queue.shift());
		for (const id of ids) {
			const device = devices.get(id);
			const server = sim.players.get(id);
			const input = device.predicted.find((i) => i.seq === server.ack && !i.done);
			if (input) input.done = true;
			else starved += 1;
			stepPlayer(
				device.body,
				input,
				device.speed,
				stepContext(online.tickHz ?? 30, online.subSteps ?? 2),
				game.field,
			);
			assert.deepEqual(bodyKey(server.body), bodyKey(device.body), `step ${s}, player ${id}`);
		}
	}
	return { sim, repeats, gaps, starved };
};

const RATES = [
	{ tickHz: 30, subSteps: 2 },
	{ tickHz: 60, subSteps: 1 },
	{ tickHz: 20, subSteps: 4 },
];

for (const rates of RATES) {
	await check(`10 000 steps at ${rates.tickHz} Hz × ${rates.subSteps}: room === device`, () => {
		const { repeats, gaps, starved } = runHeadless(rates, 10_000, `room-sim-${rates.tickHz}`);
		assert.ok(
			repeats > 1000 && gaps > 1000 && starved > 1000,
			JSON.stringify({ repeats, gaps, starved }),
		);
	});
}

await check('the same inputs replay to the same room', () => {
	const a = runHeadless(RATES[0], 2000, 'replay').sim;
	const b = runHeadless(RATES[0], 2000, 'replay').sim;
	assert.deepEqual(
		[...a.players.values()].map((p) => [...bodyKey(p.body), p.ack, p.facing]),
		[...b.players.values()].map((p) => [...bodyKey(p.body), p.ack, p.facing]),
	);
});

await check('the clamp is exact and idempotent: a clamped input clamps to itself', () => {
	const rng = createRng('clamp');
	for (let i = 0; i < 20_000; i++) {
		const once = clampInput(randomInput(rng, i), FIELD);
		assert.ok(once.moveX * once.moveX + once.moveY * once.moveY <= MOVE_SCALE * MOVE_SCALE);
		assert.ok(Number.isInteger(once.moveX) && Number.isInteger(once.moveY));
		assert.ok(once.buttons >= 0 && once.buttons <= 7);
		assert.ok(once.aimX >= 0 && once.aimX <= FIELD.w && once.aimY >= 0 && once.aimY <= FIELD.h);
		assert.deepEqual(clampInput(once, FIELD), once);
	}
	assert.deepEqual(Object.keys(clampInput({ x: 1, y: 2, score: 3 }, FIELD)).sort(), [
		'aimX',
		'aimY',
		'buttons',
		'moveX',
		'moveY',
		'seq',
	]);
});

await check('an input that claims a place, a score or a character changes nothing', () => {
	const run = (hostile) => {
		const sim = createRoomSim(gameOf({ characters: CHARACTERS }));
		sim.join('a', { character: 'salmon' });
		const input = { seq: 1, moveX: 50, moveY: -20, buttons: 0, aimX: 0, aimY: 0 };
		const raw = hostile ? { ...input, x: 0, y: 0, vx: 1e6, score: 99, character: 'bear' } : input;
		sim.step(() => clampInput(raw, FIELD));
		const p = sim.players.get('a');
		return [...bodyKey(p.body), p.character.id];
	};
	assert.deepEqual(run(true), run(false));
});

await check('inputs apply in seq order, one per step', () => {
	const sim = createRoomSim(gameOf({ characters: CHARACTERS }));
	sim.join('a', { character: 'salmon' });
	const rx = receiver(FIELD);
	for (const seq of [1, 2, 3, 2, 1, 7, 5, 8]) rx.receive({ seq, moveX: 127, moveY: 0 });
	const acks = [];
	for (let i = 0; i < 6; i++) {
		sim.step(() => rx.queue.shift());
		acks.push(sim.players.get('a').ack);
	}
	assert.deepEqual(acks, [1, 2, 3, 7, 8, 8]);
	assert.equal(sim.players.get('a').moving, false, 'a step with no input stands still');
});

await check(
	'join: the room size, each character’s max, unknown and default characters, names',
	() => {
		const sim = createRoomSim(gameOf({ characters: CHARACTERS, maxPlayers: 4 }));
		assert.equal(sim.join('a', { character: 'bear', name: '  Bob\u0007\u0000 ' }).name, 'Bob');
		sim.join('b', { character: 'bear', name: 'x'.repeat(80) });
		assert.equal(sim.players.get('b').name.length, 24);
		assert.throws(() => sim.join('c', { character: 'bear' }), RoomRefusal);
		assert.throws(() => sim.join('c', { character: 'shark' }), RoomRefusal);
		assert.throws(() => sim.join('a', { character: 'salmon' }), RoomRefusal);
		assert.equal(sim.join('c', {}).character.id, 'salmon');
		assert.equal(sim.join('d', { name: 42 }).name, 'Player');
		assert.throws(() => sim.join('e', {}), /full/);
		sim.leave('a');
		assert.equal(sim.join('e', { character: 'bear' }).character.id, 'bear');
	},
);

await check('a dropped player stands still until it rejoins; its place is kept', () => {
	const sim = createRoomSim(gameOf({ characters: CHARACTERS }));
	sim.join('a', { character: 'salmon' });
	const move = (seq) => ({ seq, moveX: 127, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });
	sim.step(() => move(1));
	const at = sim.players.get('a').body.x;
	sim.drop('a');
	let asked = 0;
	for (let i = 0; i < 10; i++) sim.step(() => ((asked += 1), move(2 + i)));
	assert.equal(asked, 0, 'a dropped player is never given an input');
	assert.equal(sim.players.get('a').body.x, at);
	sim.rejoin('a');
	sim.step(() => move(20));
	assert.ok(sim.players.get('a').body.x > at);
	assert.equal(sim.players.get('a').ack, 20);
});

await check('a config the room cannot play is refused, with the reason', () => {
	const refusedOf = (doc) => onlineGameOf(normalizeGameConfigDoc(doc));
	assert.equal(refusedOf({ family: 'arcade', outcome: 'rules', arcade: {} }), undefined);
	assert.match(refusedOf({ ...configOf({ characters: [] }) }).refused, /characters/);
	const noField = configOf({ characters: CHARACTERS });
	delete noField.arcade.field;
	assert.match(refusedOf(noField).refused, /field/);
	assert.match(
		refusedOf({ ...configOf({ characters: CHARACTERS }), outcome: undefined }).refused,
		/free play|outcome/,
	);
});

// --- 1b. the runtime: only an online config takes the online branch ------------------------------

await check('the mechanic: an online arcade config plays in a room; nothing else does', () => {
	assert.equal(
		mechanicFor(normalizeGameConfigDoc(configOf({ characters: CHARACTERS }))),
		ARCADE_ONLINE_MECHANIC,
	);
	const offline = configOf({ characters: CHARACTERS });
	delete offline.arcade.online;
	assert.equal(mechanicFor(normalizeGameConfigDoc(offline)), ARCADE_RULES_MECHANIC);
	assert.ok(ARCADE_ONLINE_MECHANIC.room && ARCADE_ONLINE_MECHANIC.playField);
	assert.ok(
		!ARCADE_ONLINE_MECHANIC.rgsSession &&
			!ARCADE_ONLINE_MECHANIC.wallet &&
			!ARCADE_ONLINE_MECHANIC.bets,
	);
	for (const m of [
		REELS_MECHANIC,
		MATCH3_RULES_MECHANIC,
		MATCH3_RGS_MECHANIC,
		ARCADE_RULES_MECHANIC,
		mechanicFor(null),
	])
		assert.equal(m.room, false, m.id);
	const rgsOnline = { ...configOf({ characters: CHARACTERS }), outcome: undefined };
	assert.ok(
		mechanicFor(normalizeGameConfigDoc(rgsOnline)).unplayable,
		'an RGS arcade game stays unplayable',
	);
	assert.equal(mechanicFor(normalizeGameConfigDoc(rgsOnline)).room, false);
});

await check('the runtime: the SDK is reached only through the online branch, and lazily', () => {
	const src = join(ROOT, 'apps/lines/src');
	const files = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|svelte)$/.test(name)) files.push(path);
		}
	};
	walk(src);
	const importers = files.filter((f) => readFileSync(f, 'utf8').includes('@colyseus/'));
	assert.deepEqual(
		importers.map((f) => f.slice(src.length + 1)),
		['game/online.ts'],
	);
	const online = readFileSync(join(src, 'game/online.ts'), 'utf8');
	assert.match(online, /import type \{ Room \} from '@colyseus\/sdk'/);
	assert.match(online, /await import\('@colyseus\/sdk'\)/);
	assert.doesNotMatch(online.replace(/import type[^;]+;/g, ''), /^import [^;]*'@colyseus\/sdk'/m);
	const layout = readFileSync(join(src, 'routes/+layout.ts'), 'utf8');
	assert.match(layout, /if \(gameMechanic\(\)\.room\) await joinOnlineRoom\(\);/);
	const stage = readFileSync(join(src, 'components/ArcadeStage.svelte'), 'utf8');
	assert.match(stage, /const online = gameMechanic\(\)\.room;/);
	assert.match(stage, /online \? undefined : startArcade\(/);
});

// --- 2. live: a real Colyseus 0.18 server, real SDK clients -------------------------------------

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

const dir = mkdtempSync(join(tmpdir(), 'room-sim-'));
writeFileSync(
	join(dir, 'river.json'),
	JSON.stringify(configOf({ characters: CHARACTERS, maxPlayers: 4 })),
);
writeFileSync(
	join(dir, 'brief.json'),
	JSON.stringify(configOf({ characters: CHARACTERS, rejoinSeconds: 1 })),
);
writeFileSync(join(dir, 'third.json'), JSON.stringify(configOf({ characters: CHARACTERS })));
writeFileSync(join(dir, 'slot.json'), JSON.stringify({ gameName: 'A slot' }));

const port = await freePort();
const game = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 2,
	commit: 'roomsim00000',
	gracefullyShutdown: false,
});
await game.listen(port);
const endpoint = `ws://127.0.0.1:${port}`;
const clientOf = () => new Client(endpoint);
const serverRoom = (room) => matchMaker.getLocalRoomById(room.roomId);
const noAutoReconnect = (room) => {
	room.reconnection.enabled = false;
	return room;
};

try {
	await check('live: /healthz reports the commit and the rooms', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/healthz`);
		assert.deepEqual(await res.json(), { ok: true, commit: 'roomsim00000', rooms: 0 });
	});

	await check('live: a game that is not a key, not there or not online makes no room', async () => {
		for (const name of ['../etc/passwd', 'nope', 'slot', '']) {
			await assert.rejects(clientOf().joinOrCreate(ROOM_NAME, { game: name }), name);
		}
		assert.equal(game.rooms.count, 0);
	});

	const a = noAutoReconnect(
		await clientOf().joinOrCreate(ROOM_NAME, {
			game: 'river',
			name: ' Ann\u0001',
			character: 'salmon',
		}),
	);
	await until('the first state', () => a.state.players?.get(a.sessionId));

	await check(
		'live: join puts the player in the state, named and as the character it chose',
		() => {
			const me = a.state.players.get(a.sessionId);
			assert.equal(me.name, 'Ann');
			assert.equal(me.character, 'salmon');
			assert.equal(me.connected, true);
			assert.equal(a.state.phase, 'running');
			assert.deepEqual([me.x, me.y], [FIELD.w / 2, FIELD.h / 2]);
		},
	);

	await check(
		'live: the server steps the inputs it is sent exactly as the device does',
		async () => {
			const room = serverRoom(a);
			const sim = room.sim;
			const server = sim.players.get(a.sessionId);
			const device = characterBody('me', sim.game.bodies.salmon, {
				x: server.body.x,
				y: server.body.y,
			});
			const input = a.input();
			const rng = createRng('live');
			let seq = 0;
			for (let i = 0; i < 90; i++) {
				const raw = randomInput(rng, ++seq);
				// The runtime clamps before it sends (`online.ts`); the server clamps again, to the same.
				Object.assign(input.data, clampInput(raw, sim.game.field));
				input.send();
				stepPlayer(device, clampInput(raw, sim.game.field), 240, sim.ctx, sim.game.field);
				await wait(1000 / 30);
			}
			await until('every input applied', () => server.ack === seq);
			assert.deepEqual(
				bodyKey({ ...server.body, vx: 0, vy: 0 }),
				bodyKey({ ...device, vx: 0, vy: 0 }),
			);
			await until('the patch', () => a.state.players.get(a.sessionId).ack === seq);
			const drawn = a.state.players.get(a.sessionId);
			assert.deepEqual([drawn.x, drawn.y], [Math.fround(device.x), Math.fround(device.y)]);
		},
	);

	await check(
		'live: a message carrying a position, or any message at all, changes nothing',
		async () => {
			const server = serverRoom(a).sim.players.get(a.sessionId);
			await wait(100);
			const before = bodyKey(server.body);
			a.send('move', { x: 1, y: 1 });
			a.send('teleport', { x: 700, y: 10 });
			a.send(7, { score: 1e9 });
			await wait(200);
			assert.deepEqual(bodyKey(server.body), before);
			assert.equal(server.connected, true);
		},
	);

	await check('live: an off-scale move is clamped by the server', async () => {
		const server = serverRoom(a).sim.players.get(a.sessionId);
		const input = a.input();
		const seq = server.ack + 1;
		Object.assign(input.data, { seq, moveX: 127, moveY: 127, buttons: 255, aimX: 0, aimY: 0 });
		input.send();
		await until('the input', () => server.ack === seq);
		const speed = Math.hypot(server.body.vx, server.body.vy);
		assert.ok(speed <= 240 + 1e-9, `speed ${speed}`);
		assert.ok(speed > 230, `speed ${speed}`);
	});

	await check('live: the room holds its size and each character’s max', async () => {
		const b = await clientOf().joinOrCreate(ROOM_NAME, { game: 'river', character: 'bear' });
		assert.equal(b.roomId, a.roomId, JSON.stringify(await matchMaker.query({})));
		const c = await clientOf().joinById(a.roomId, { character: 'bear' });
		await assert.rejects(clientOf().joinById(a.roomId, { character: 'bear' }), 'a third bear');
		await assert.rejects(clientOf().joinById(a.roomId, { character: 'shark' }), 'no shark');
		const d = await clientOf().joinById(a.roomId, { character: 'salmon' });
		await assert.rejects(clientOf().joinById(a.roomId, { character: 'salmon' }), 'full');
		for (const r of [b, c, d]) await r.leave();
		await until('three left', () => serverRoom(a).sim.players.size === 1);
	});

	await check('live: a dropped player keeps its place and rejoins as itself', async () => {
		const room = serverRoom(a);
		const server = room.sim.players.get(a.sessionId);
		const token = a.reconnectionToken;
		const at = bodyKey(server.body);
		a.connection.close(4100, 'network gone');
		await until('the drop', () => server.connected === false);
		await wait(150);
		assert.deepEqual(bodyKey({ ...server.body, vx: 0, vy: 0 }).slice(0, 2), at.slice(0, 2));
		const back = noAutoReconnect(await clientOf().reconnect(token));
		assert.equal(back.sessionId, a.sessionId);
		await until('the rejoin', () => server.connected === true);
		const input = back.input();
		const seq = server.ack + 1;
		Object.assign(input.data, { seq, moveX: -127, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });
		input.send();
		await until('an input after the rejoin', () => server.ack === seq);
		await back.leave();
		await until('the room to close', () => game.rooms.count === 0);
	});

	await check('live: a place not reclaimed within rejoinSeconds is let go', async () => {
		const r = noAutoReconnect(await clientOf().joinOrCreate(ROOM_NAME, { game: 'brief' }));
		const stay = await clientOf().joinById(r.roomId, {});
		const room = serverRoom(r);
		await until('both joined', () => room.sim.players.size === 2);
		r.connection.close(4100, 'gone');
		await until('the drop', () => room.sim.players.get(r.sessionId)?.connected === false);
		await until('the grace to run out', () => !room.sim.players.has(r.sessionId), 4000);
		assert.equal(room.state.players.has(r.sessionId), false);
		await stay.leave();
	});

	await check('live: a device that floods is disconnected', async () => {
		const f = noAutoReconnect(await clientOf().joinOrCreate(ROOM_NAME, { game: 'third' }));
		let left = false;
		f.onLeave(() => (left = true));
		for (let i = 0; i < messagesPerSecond(30) + 20; i++) f.send('spam', i);
		await until('the flood limit', () => left, 3000);
		await until('the room to close', () => game.rooms.count === 0);
	});

	await check('live: the process holds at most maxRooms rooms', async () => {
		const r1 = await clientOf().joinOrCreate(ROOM_NAME, { game: 'river' });
		const r2 = await clientOf().joinOrCreate(ROOM_NAME, { game: 'third' });
		await assert.rejects(clientOf().joinOrCreate(ROOM_NAME, { game: 'brief' }));
		assert.equal(game.rooms.count, 2);
		await r1.leave();
		await r2.leave();
		await until('the rooms to close', () => game.rooms.count === 0);
	});
} finally {
	await game.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-sim — ${passed} checks passed`);
process.exit(0);
