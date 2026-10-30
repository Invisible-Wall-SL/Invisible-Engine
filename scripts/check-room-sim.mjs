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
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect, createServer } from 'node:net';
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
import { reconcilerOptions } from '../packages/engine-mechanics/src/netcode.js';
import { flowSignalsOf, serverValuesOf } from '../packages/engine-mechanics/src/onlineFlow.js';
import { ONLINE_EVENT } from '../packages/engine-mechanics/src/onlineRules.js';
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
import { createRoomSim, inputsThisStep, RoomRefusal } from '../services/game-server/src/roomSim.ts';
import { messagesPerSecond } from '../services/game-server/src/arcadeRoom.ts';
import { addressKey, heldBy } from '../services/game-server/src/addresses.ts';
import { ROOM_NAME, createGameServer } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client, Predict } = await import(
	pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href
);
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
		/** What the room takes for a step, by the room's own rule. */
		take(credit) {
			return queue.splice(0, inputsThisStep(queue.length, credit));
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
			wire: [],
			stall: 0,
		});
		Object.assign(devices.get(id).body, { x: player.body.x, y: player.body.y });
	}
	let repeats = 0;
	let gaps = 0;
	let starved = 0;
	let bursts = 0;
	let deepest = 0;
	let waitingSum = 0;
	const ctx = stepContext(online.tickHz ?? 30, online.subSteps ?? 2);
	for (let s = 0; s < steps; s++) {
		for (const id of ids) {
			const device = devices.get(id);
			const roll = rng();
			// The network stalls now and then, holding what the device sends, then delivers it at
			// once: the room is starved for those steps and then gets a burst.
			if (!device.stall && rng() < 0.01) {
				device.stall = 2 + Math.floor(rng() * 8);
				bursts += 1;
			}
			if (roll >= 0.04) {
				if (roll < 0.07) {
					device.nextSeq += 1 + Math.floor(rng() * 3); // a gap in seq
					gaps += 1;
				}
				device.wire.push(randomInput(rng, device.nextSeq));
				device.nextSeq += 1;
			} // else the device sent nothing this step (a lost input)
			if (device.stall) {
				device.stall -= 1;
				continue;
			}
			for (const raw of device.wire.splice(0)) {
				if (device.rx.receive(raw)) device.predicted.push(clampInput(raw, game.field));
				// The network delivers a copy again, or one from the past: both are dropped.
				if (rng() < 0.05) (assert.equal(device.rx.receive(raw), false), (repeats += 1));
				if (rng() < 0.02) assert.equal(device.rx.receive({ ...raw, seq: raw.seq - 5 }), false);
			}
		}
		sim.step((id, credit) => devices.get(id).rx.take(credit));
		for (const id of ids) {
			const device = devices.get(id);
			const server = sim.players.get(id);
			deepest = Math.max(deepest, device.rx.queue.length);
			waitingSum += device.rx.queue.length;
			// The device replays, in order, every input of its own the room has now applied.
			const applied = device.predicted.filter((i) => !i.done && i.seq <= server.ack);
			if (!applied.length) {
				starved += 1;
				stepPlayer(device.body, undefined, device.speed, ctx, game.field);
			}
			for (const input of applied) {
				input.done = true;
				stepPlayer(device.body, input, device.speed, ctx, game.field);
			}
			assert.deepEqual(bodyKey(server.body), bodyKey(device.body), `step ${s}, player ${id}`);
		}
	}
	return {
		sim,
		repeats,
		gaps,
		starved,
		bursts,
		deepest,
		waiting: waitingSum / (steps * ids.length),
	};
};

const RATES = [
	{ tickHz: 30, subSteps: 2 },
	{ tickHz: 60, subSteps: 1 },
	{ tickHz: 20, subSteps: 4 },
];

for (const rates of RATES) {
	await check(`10 000 steps at ${rates.tickHz} Hz × ${rates.subSteps}: room === device`, () => {
		const { repeats, gaps, starved, bursts, deepest, waiting } = runHeadless(
			rates,
			10_000,
			`room-sim-${rates.tickHz}`,
		);
		assert.ok(bursts > 300, `bursts ${bursts}`);
		// Stalls of up to nine steps, sometimes back to back: the backlog stays bounded and drains.
		assert.ok(deepest <= 24, `a backlog of ${deepest}`);
		assert.ok(waiting < 1, `on average ${waiting} inputs waited`);
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

// A tripwire: it fails only if the server starts reading `netcode`, which it must not.
await check('the room plays the same under either netcode: the server never reads it', () => {
	const engine = runHeadless(RATES[0], 2000, 'netcode').sim;
	const colyseus = runHeadless({ ...RATES[0], netcode: 'colyseus' }, 2000, 'netcode').sim;
	assert.equal(colyseus.game.online.netcode, 'colyseus');
	assert.deepEqual(
		[...colyseus.players.values()].map((p) => [...bodyKey(p.body), p.ack, p.facing]),
		[...engine.players.values()].map((p) => [...bodyKey(p.body), p.ack, p.facing]),
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
		'view',
	]);
});

await check('an input that claims a place, a score or a character changes nothing', () => {
	const run = (hostile) => {
		const sim = createRoomSim(gameOf({ characters: CHARACTERS }));
		sim.join('a', { character: 'salmon' });
		const input = { seq: 1, moveX: 50, moveY: -20, buttons: 0, aimX: 0, aimY: 0 };
		const raw = hostile ? { ...input, x: 0, y: 0, vx: 1e6, score: 99, character: 'bear' } : input;
		sim.step(() => [clampInput(raw, FIELD)]);
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
		sim.step(() => (rx.queue.length ? [rx.queue.shift()] : []));
		acks.push(sim.players.get('a').ack);
	}
	assert.deepEqual(acks, [1, 2, 3, 7, 8, 8]);
	assert.equal(sim.players.get('a').moving, false, 'a step with no input stands still');
});

await check('a stall’s burst drains; sending more never moves a player faster', () => {
	assert.deepEqual(
		[
			[0, 0],
			[1, 9],
			[2, 9],
			[6, 0],
			[6, 2],
			[6, 9],
			[60, 9],
		].map(([waiting, credit]) => inputsThisStep(waiting, credit)),
		[1, 1, 1, 1, 2, 2, 2],
	);
	const game = gameOf({ characters: CHARACTERS });
	const step = (sim, rx) => sim.step((_, credit) => rx.take(credit));
	const full = (seq) => ({ seq, moveX: 127, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });

	// An honest stall: six steps with nothing, then the six inputs at once, then one a step.
	const honest = createRoomSim(game);
	honest.join('a', { character: 'fish' });
	const rx = receiver(FIELD);
	for (let i = 0; i < 6; i++) step(honest, rx);
	let seq = 0;
	for (let i = 0; i < 6; i++) rx.receive(full(++seq));
	let steps = 0;
	while (rx.queue.length > 1 && steps < 20) {
		rx.receive(full(++seq));
		step(honest, rx);
		steps += 1;
	}
	assert.ok(steps <= 6, `the burst drained in ${steps} steps`);

	// A cheat: three inputs every step for 600 steps, never starved. It applies one a step.
	const cheat = createRoomSim(game);
	cheat.join('a', { character: 'fish' });
	cheat.players.get('a').body.edges = undefined;
	const crx = receiver(FIELD);
	let cseq = 0;
	let applied = 0;
	for (let i = 0; i < 600; i++) {
		for (let n = 0; n < 3; n++) crx.receive({ ...full(++cseq), moveX: i % 2 ? 127 : -127 });
		const before = cheat.players.get('a').ack;
		step(cheat, crx);
		applied += cheat.players.get('a').ack > before ? 1 : 0;
	}
	assert.equal(cheat.players.get('a').ack, 600, 'one input a step, however many are sent');
	assert.equal(applied, 600);
});

await check('over any run of steps a player applies no more inputs than steps passed', () => {
	const rng = createRng('credit');
	const sim = createRoomSim(gameOf({ characters: CHARACTERS }));
	sim.join('a', { character: 'salmon' });
	const rx = receiver(FIELD);
	let seq = 0;
	let applied = 0;
	const perStep = [];
	for (let s = 1; s <= 5000; s++) {
		const roll = rng();
		const count = roll < 0.2 ? 0 : roll < 0.9 ? 1 : 1 + Math.floor(rng() * 10);
		for (let n = 0; n < count; n++) rx.receive({ seq: ++seq, moveX: 127, moveY: 0 });
		sim.step((_, credit) => {
			const taken = rx.take(credit);
			applied += taken.length;
			return taken;
		});
		assert.ok(applied <= s, `step ${s}: ${applied} inputs applied`);
		perStep.push(applied);
	}
	// Over any 30 steps a player applies at most 30 plus its half-second bank (15 at 30 Hz): a dash
	// of saved-up steps is short and at most twice the speed.
	for (let s = 30; s < perStep.length; s++) {
		assert.ok(perStep[s] - perStep[s - 30] <= 45, `steps ${s - 30}–${s}`);
	}
	assert.ok(Math.max(...perStep.map((n, i) => n - (perStep[i - 1] ?? 0))) <= 2);
});

await check(
	'join: the room size, each character’s max, unknown and default characters, names',
	() => {
		const sim = createRoomSim(gameOf({ characters: CHARACTERS, maxPlayers: 4 }));
		assert.equal(
			sim.join('a', { character: 'bear', name: '  B\u202eo\u200bb\u0007\u0000 ' }).name,
			'Bob',
		);
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
	sim.step(() => [move(1)]);
	const at = sim.players.get('a').body.x;
	sim.drop('a');
	let asked = 0;
	for (let i = 0; i < 10; i++) sim.step(() => ((asked += 1), [move(2 + i)]));
	assert.equal(asked, 0, 'a dropped player is never given an input');
	assert.equal(sim.players.get('a').body.x, at);
	sim.rejoin('a');
	sim.step(() => [move(20)]);
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

await check(
	'the config source: last good through a failed read; gone or refused forgets it',
	async () => {
		const answers = new Map();
		const source = createHttpServer((req, res) => {
			const [status, body] = answers.get(req.url) ?? [404, ''];
			res.writeHead(status, { 'content-type': 'application/json' }).end(body);
		});
		await new Promise((ok) => source.listen(0, '127.0.0.1', ok));
		let clock = 0;
		const load = createConfigSource({
			url: `http://127.0.0.1:${source.address().port}/{game}`,
			now: () => clock,
		});
		const good = JSON.stringify({ doc: configOf({ characters: CHARACTERS }) });
		answers.set('/pond', [200, good]);
		const first = await load('pond');
		answers.set('/pond', [503, '']);
		clock += 61_000;
		assert.equal(await load('pond'), first, 'a 5xx serves the last good config');
		answers.set('/pond', [404, '']);
		clock += 61_000;
		await assert.rejects(load('pond'), 'a game the source says is gone is gone');
		answers.set('/pond', [503, '']);
		clock += 61_000;
		await assert.rejects(load('pond'), '…and stays gone through a later failed read');
		answers.set('/pond', [200, good]);
		clock += 61_000;
		await load('pond');
		answers.set('/pond', [200, JSON.stringify({ gameName: 'now a slot' })]);
		clock += 61_000;
		await assert.rejects(load('pond'), 'a config that is refused is not covered up');
		answers.set('/pond', [503, '']);
		clock += 61_000;
		await assert.rejects(load('pond'), '…nor brought back by a failed read');
		await assert.rejects(load('never'), 'a game never loaded is refused');
		await assert.rejects(load('Not A Key'));
		await new Promise((ok) => source.close(ok));
	},
);

await check('per-address limits count an IPv6 /64 as one address', () => {
	assert.deepEqual(
		[
			'1.2.3.4',
			'::ffff:1.2.3.4',
			'2001:db8::1',
			'2001:db8:0:0:5::9',
			'2001:0db8:00aa:0001:ffff::1',
		].map(addressKey),
		['1.2.3.4', '1.2.3.4', '2001:db8:0:0::/64', '2001:db8:0:0::/64', '2001:db8:aa:1::/64'],
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
	// The SDK is reached only through `engine-rooms` (a game repo cannot install a third-party
	// package `apps/lines` declares: `scripts/check-game-app-deps.mjs`), and only from online.ts.
	const importing = (spec) => {
		const re = new RegExp(`(?:\\bfrom|\\bimport\\()\\s*['"\`]${spec}`);
		return files
			.filter((f) => re.test(readFileSync(f, 'utf8')))
			.map((f) => f.slice(src.length + 1));
	};
	assert.deepEqual(importing('@colyseus/'), []);
	assert.deepEqual(importing(`engine-rooms['"\`]`), ['game/online.ts']);
	const online = readFileSync(join(src, 'game/online.ts'), 'utf8');
	assert.match(online, /import type \{[^}]*\bRoom\b[^}]*\} from 'engine-rooms'/);
	assert.match(online, /await import\('engine-rooms'\)/);
	assert.doesNotMatch(online.replace(/import type[^;]+;/g, ''), /^import [^;]*'engine-rooms'/m);
	// The SDK's prediction is its own entry, imported and called only for `netcode: 'colyseus'`.
	assert.deepEqual(importing(`engine-rooms/predict['"\`]`), ['game/online.ts']);
	assert.match(online, /netcode === 'colyseus' \? await import\('engine-rooms\/predict'\)/);
	assert.doesNotMatch(
		online.replace(/import type[^;]+;/g, ''),
		/^import [^;]*'engine-rooms\/predict'/m,
	);
	const layout = readFileSync(join(src, 'routes/+layout.ts'), 'utf8');
	assert.match(layout, /if \(gameMechanic\(\)\.room\) await joinOnlineRoom\(\);/);
	const stage = readFileSync(join(src, 'components/ArcadeStage.svelte'), 'utf8');
	assert.match(stage, /const online = gameMechanic\(\)\.room;/);
	assert.match(stage, /online \? undefined : startArcade\(/);
	// The characters (P10.11) belong to the local loop: an online game attaches none, nor their
	// key and pointer listener. Its world camera (P10.12) follows the own player instead (P10.16).
	assert.match(stage, /online\s+\? useOnlineCamera\(scenes,[\s\S]*?: useWorldCamera\(scenes\)/);
	assert.match(stage, /online \? undefined : useArcadePaths\(/);
	assert.match(stage, /if \(online \|\| !pixi\) return;\s+return useArcadeInput\(/);
	// A field per room (P11.2 (e)): only a game that names a generator waits for the room's seed,
	// makes the room's field with the server's own function and has the loaded doc draw it; every
	// other game's doc loads as it always did.
	assert.match(online, /const seed = generator \? await roomSeed\(room\) : undefined;/);
	assert.match(online, /: generatedOnlineGame\(resolved, seed\);/);
	assert.match(online, /if \(current\.field\) setRoomDocChange\(withRoomField\);/);
	assert.match(online, /const field = current\?\.field;\s+if \(!current \|\| !field\) return doc;/);
	// A layout with no node to draw the field in stops the game rather than draw the authored one:
	// in the join, before the game mounts, leaving the room first (salmons-play page D plays it),
	// and for a layout fetched at mount, leaving the room as it refuses.
	assert.match(
		online,
		/if \(field && prepared && !holdsNode\(prepared, field\.id\)\) \{\s+room\.leave\(\)[^;]*;\s+return refuseOnlineBoot\(missingFieldNode\(field\.id\)\);/,
	);
	assert.match(
		online,
		/if \(!current\.fieldDrawn\) \{\s+current\.room\.leave\(\)[^;]*;\s+void refuseOnlineBoot\(/,
	);
	const scenes = readFileSync(join(src, 'editor-scenes.ts'), 'utf8');
	assert.match(scenes, /return roomDocChange \? roomDocChange\(scenes\) : scenes;/);
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
writeFileSync(
	join(dir, 'sdk.json'),
	JSON.stringify(configOf({ characters: CHARACTERS, netcode: 'colyseus' })),
);
writeFileSync(
	join(dir, 'wide.json'),
	JSON.stringify(configOf({ characters: CHARACTERS, maxPlayers: 40, rejoinSeconds: 3 })),
);
writeFileSync(join(dir, 'slot.json'), JSON.stringify({ gameName: 'A slot' }));

// High enough for the gate's own joins in one window; the limit's own check counts to it.
const MATCHMAKE_LIMIT = 120;
const port = await freePort();
const game = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 2,
	commit: 'roomsim00000',
	gracefullyShutdown: false,
	trustProxy: true,
	matchmakePerWindow: MATCHMAKE_LIMIT,
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

	await check(
		'live: a refused room names no reason; a key that is not a string is refused',
		async () => {
			const refusal = await clientOf()
				.joinOrCreate(ROOM_NAME, { game: 'nope' })
				.then(
					() => null,
					(e) => e,
				);
			assert.equal(refusal?.message, 'this game is not available');
			await assert.rejects(clientOf().joinOrCreate(ROOM_NAME, { game: ['river'] }));
			await assert.rejects(clientOf().joinOrCreate(ROOM_NAME, { game: { toString: 1 } }));
			assert.equal(game.rooms.count, 0);
		},
	);

	await check('live: a device cannot `create` rooms, nor send a large body', async () => {
		await assert.rejects(clientOf().create(ROOM_NAME, { game: 'river' }));
		assert.equal(game.rooms.count, 0);
		const big = await fetch(`http://127.0.0.1:${port}/matchmake/joinOrCreate/${ROOM_NAME}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ game: 'river', pad: 'x'.repeat(10_000) }),
		});
		assert.equal(big.status, 413);
		// A chunked body declares no length: it is read only up to the same limit, then refused.
		const chunked = await new Promise((resolve, reject) => {
			const req = httpRequest(
				{
					port,
					host: '127.0.0.1',
					method: 'POST',
					path: `/matchmake/joinOrCreate/${ROOM_NAME}`,
					headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
				},
				(res) => resolve(res.statusCode),
			);
			req.on('error', (e) =>
				e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve(0) : reject(e),
			);
			req.write('{"game":"river","pad":"');
			req.write('x'.repeat(64_000));
		});
		assert.equal(chunked, 413);
		assert.equal(game.rooms.count, 0);
	});

	await check(
		'live: a page on another origin gets CORS on the preflight, a refusal, the matchmaker’s answer and a chunked join',
		async () => {
			const origin = 'https://games.example';
			const url = `http://127.0.0.1:${port}/matchmake/joinOrCreate/${ROOM_NAME}`;
			// The SDK fetches with credentials, so `*` would not do: the page's own origin, and
			// credentials allowed, on every answer it can get.
			const lets = (res, what) => {
				assert.equal(res.headers.get('access-control-allow-origin'), origin, what);
				assert.equal(res.headers.get('access-control-allow-credentials'), 'true', what);
			};
			const preflight = await fetch(url, {
				method: 'OPTIONS',
				headers: {
					origin,
					'access-control-request-method': 'POST',
					'access-control-request-headers': 'content-type',
				},
			});
			assert.ok(preflight.status < 300, `preflight ${preflight.status}`);
			lets(preflight, 'preflight');
			assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);
			assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-type/i);
			const refused = await fetch(url, {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: JSON.stringify({ game: 'river', pad: 'x'.repeat(10_000) }),
			});
			assert.equal(refused.status, 413);
			lets(refused, 'a refusal');
			const answered = await fetch(url, {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: JSON.stringify({ game: 'nope' }),
			});
			lets(answered, 'the matchmaker’s answer');
			// A proxy may forward a device's body chunked: under the limit, it is served.
			const chunked = await new Promise((resolve, reject) => {
				const req = httpRequest(
					{
						port,
						host: '127.0.0.1',
						method: 'POST',
						path: `/matchmake/joinOrCreate/${ROOM_NAME}`,
						headers: { origin, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
					},
					(res) => {
						let text = '';
						res.on('data', (c) => (text += c));
						res.on('end', () => resolve({ res, text }));
					},
				);
				req.on('error', reject);
				req.write('{"game":"no');
				req.end('pe"}');
			});
			assert.equal(chunked.res.headers['access-control-allow-origin'], origin);
			assert.equal(chunked.res.headers['access-control-allow-credentials'], 'true');
			assert.match(chunked.text, /this game is not available/);
			assert.equal(game.rooms.count, 0);
		},
	);

	await check(
		'live: a request the router could not parse is refused, and the server lives',
		async () => {
			const raw = (text) =>
				new Promise((resolve) => {
					const socket = connect(port, '127.0.0.1', () => socket.end(text));
					let answer = '';
					socket.on('data', (c) => (answer += c));
					socket.on('close', () => resolve(answer.split('\r\n')[0]));
					socket.on('error', () => resolve(''));
				});
			const health = () => fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.status);
			for (const request of [
				'GET /healthz HTTP/1.1\r\nHost: x\r\nX-Forwarded-Proto: https,evil\r\n\r\n',
				'GET http://h/healthz HTTP/1.1\r\nHost: x\r\n\r\n',
				'GET /healthz HTTP/1.1\r\nHost: a:b:c\r\n\r\n',
				'TRACE /healthz HTTP/1.1\r\nHost: a\r\nContent-Length: 0\r\n\r\n',
				'TRACE /matchmake/joinOrCreate/arcade HTTP/1.1\r\nHost: a\r\nContent-Length: 0\r\n\r\n',
				'PROPFIND /healthz HTTP/1.1\r\nHost: a\r\nContent-Length: 0\r\n\r\n',
				'GET /matchmake HTTP/1.1\r\nHost: a b\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
			]) {
				const status = await raw(request);
				assert.ok(!status.includes(' 200 '), `${JSON.stringify(request)} → ${status}`);
				assert.equal(await health(), 200, `the server survived ${JSON.stringify(request)}`);
			}
		},
	);

	await check(
		'live: one address’s matchmaking is limited per window; another’s is not',
		async () => {
			const ask = (address) =>
				fetch(`http://127.0.0.1:${port}/matchmake/joinOrCreate/${ROOM_NAME}`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'x-forwarded-for': `10.0.0.1, ${address}`,
					},
					body: JSON.stringify({ game: 'nope' }),
				}).then((r) => r.status);
			// The window is fixed: start early in one, so the count is not cut in two.
			const into = Date.now() % 10_000;
			if (into > 7000) await wait(10_050 - into);
			const statuses = [];
			for (let i = 0; i < MATCHMAKE_LIMIT + 1; i++) statuses.push(await ask('203.0.113.7'));
			assert.equal(statuses.filter((s) => s === 429).length, 1, JSON.stringify(statuses.slice(-3)));
			// No spelling of the path escapes the count: it is by method, not by path.
			for (const path of ['/./matchmake/joinOrCreate/', '/x/../matchmake/joinOrCreate/']) {
				const status = await fetch(`http://127.0.0.1:${port}${path}${ROOM_NAME}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
					body: '{}',
				}).then((r) => r.status);
				assert.equal(status, 429, path);
			}
			assert.notEqual(await ask('203.0.113.8'), 429);
		},
	);

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
		'live: a message carrying a position, or any frame but the four the runtime sends, closes its socket, holds no seat and moves nothing',
		async () => {
			const room = serverRoom(a);
			const server = room.sim.players.get(a.sessionId);
			await wait(100);
			const before = bodyKey(server.body);
			const sends = [
				(r) => r.send('move', { x: 1, y: 1 }),
				(r) => r.send(7, { score: 1e9 }),
				(r) => void r.request('teleport', { x: 700, y: 10 }).catch(() => {}),
				(r) => r.connection.transport.ws.send(Uint8Array.of(0x15, 0x01, 0xa1, 0x78)),
				(r) => r.connection.transport.ws.send(Uint8Array.of(0x11, 0x00)),
			];
			for (const send of sends) {
				const m = noAutoReconnect(await clientOf().joinById(a.roomId, {}));
				let left = false;
				m.onLeave(() => (left = true));
				send(m);
				await until('the socket closed', () => left, 3000);
				await until('no seat held', () => !room.sim.players.has(m.sessionId), 1000);
			}
			assert.deepEqual(bodyKey(server.body), before);
			assert.equal(server.connected, true);
		},
	);

	await check(
		'live: a socket that never acknowledges its join is closed, and its seat freed',
		async () => {
			const seat = await fetch(`http://127.0.0.1:${port}/matchmake/joinById/${a.roomId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			}).then((r) => r.json());
			const url = `ws://127.0.0.1:${port}/${seat.processId ?? seat.room?.processId}/${a.roomId}?sessionId=${seat.sessionId}`;
			const ws = new WebSocket(url);
			ws.binaryType = 'arraybuffer';
			const opened = Date.now();
			const closedAt = await new Promise((resolve) =>
				ws.addEventListener('close', () => resolve(Date.now())),
			);
			// Open (so the URL and seat were good) until the deadline, then closed.
			assert.ok(
				closedAt - opened > 4000 && closedAt - opened < 8000,
				`closed after ${closedAt - opened} ms`,
			);
			await until('no seat held', () => !serverRoom(a).sim.players.has(seat.sessionId), 2000);
		},
	);

	await check('live: an off-scale move is clamped by the server', async () => {
		const sim = serverRoom(a).sim;
		const server = sim.players.get(a.sessionId);
		const input = a.input();
		const seq = server.ack + 1;
		const raw = { seq, moveX: 127, moveY: 127, buttons: 255, aimX: 0, aimY: 0 };
		// Read where the step after the input put the player, not its velocity: the next step, with no
		// input, rests it, and on a busy machine that step can come before the read.
		await wait(100);
		const expected = stepPlayer(
			{ ...server.body },
			clampInput(raw, sim.game.field),
			240,
			sim.ctx,
			sim.game.field,
		);
		Object.assign(input.data, raw);
		input.send();
		await until('the input', () => server.ack === seq);
		await wait(100);
		assert.deepEqual([server.body.x, server.body.y], [expected.x, expected.y]);
		const clamped = clampInput(raw, sim.game.field);
		assert.ok(
			Math.hypot(clamped.moveX, clamped.moveY) <= MOVE_SCALE,
			'the move is held to length 1',
		);
	});

	await check('live: a burst of inputs drains within a few steps', async () => {
		const server = serverRoom(a).sim.players.get(a.sessionId);
		const input = a.input();
		const first = server.ack + 1;
		// A stall: nothing for 0.7 s (the player banks its half-second of credit), then 20 at once.
		await wait(700);
		for (let seq = first; seq < first + 20; seq++) {
			Object.assign(input.data, { seq, moveX: 0, moveY: 127, buttons: 0, aimX: 0, aimY: 0 });
			input.send();
		}
		// Counted in the room's steps, not wall time, which a busy machine stretches: one a step would
		// take 19 steps from the first applied to the last; the drain, two a step, about half that.
		const sim = serverRoom(a).sim;
		await until('the burst begins', () => server.ack >= first, 3000);
		const began = sim.steps;
		await until('the burst applied', () => server.ack === first + 19, 3000);
		assert.ok(sim.steps - began <= 15, `${sim.steps - began} steps`);
	});

	await check(
		'live: an unreliable input frame closes its socket; the process steps on',
		async () => {
			const health = () =>
				fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) }).then(
					(r) => r.status,
				);
			for (const first of [0x14, 0x34, 0xf4]) {
				const r = noAutoReconnect(await clientOf().joinOrCreate(ROOM_NAME, { game: 'river' }));
				let left = false;
				r.onLeave(() => (left = true));
				const room = serverRoom(r);
				r.connection.transport.ws.send(Uint8Array.of(first, 0x00, 0xff));
				await until('the socket closed', () => left, 3000);
				const steps = room.sim.steps;
				assert.equal(await health(), 200, `after 0x${first.toString(16)}`);
				await until('the room stepping', () => room.sim.steps > steps + 3, 2000);
			}
		},
	);

	await check(
		'live: sockets are served only for a seat; one address holds 16 and opens 60 a window; a flood of frames ends its socket',
		async () => {
			const upgrade = (path, address) =>
				new Promise((resolve) => {
					const socket = connect(port, '127.0.0.1', () =>
						socket.write(
							`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
								'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
								`X-Forwarded-For: ${address}\r\n\r\n`,
						),
					);
					socket.once('data', (c) => resolve({ socket, status: String(c).split('\r\n')[0] }));
					socket.once('close', () => resolve({ socket, status: '' }));
					socket.on('error', () => {});
				});
			const seat = async () => {
				const r = await fetch(`http://127.0.0.1:${port}/matchmake/joinOrCreate/${ROOM_NAME}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.200' },
					body: JSON.stringify({ game: 'wide' }),
				}).then((res) => res.json());
				return `/${r.processId ?? r.room?.processId}/${r.roomId ?? r.room?.roomId}?sessionId=${r.sessionId}`;
			};
			// Colyseus' latency utility (any path but a seat's) is not served.
			assert.equal((await upgrade('/', '198.51.100.20')).status, '', 'the latency utility');
			assert.equal((await upgrade('/a/b', '198.51.100.20')).status, '', 'a seat with no session');
			const paths = [];
			for (let i = 0; i < 19; i++) paths.push(await seat());
			const held = await Promise.all(paths.slice(0, 16).map((p) => upgrade(p, '198.51.100.9')));
			assert.ok(
				held.every((h) => h.status.includes(' 101 ')),
				JSON.stringify(held.map((h) => h.status)),
			);
			assert.equal((await upgrade(paths[16], '198.51.100.9')).status, '', 'the 17th is dropped');
			const other = await upgrade(paths[17], '198.51.100.10');
			assert.ok(other.status.includes(' 101 '), 'another address is not');
			held[0].socket.destroy();
			await wait(100);
			const again = await upgrade(paths[18], '198.51.100.9');
			assert.ok(again.status.includes(' 101 '), `a freed place: ${again.status}`);
			for (const h of [...held, other, again]) h.socket.destroy();
			// Opening and dropping: past 60 upgrades a window, one address is refused.
			const into = Date.now() % 10_000;
			if (into > 7000) await wait(10_050 - into);
			let refused = 0;
			for (let i = 0; i < 70; i++) {
				const h = await upgrade('/', '198.51.100.30');
				if (h.status === '') refused += 1;
				h.socket.destroy();
			}
			assert.equal(refused, 70);
			assert.equal(
				(await upgrade(await seat(), '198.51.100.30')).status,
				'',
				'the window is spent',
			);
			// A seat's socket that acknowledged its join and then dropped holds its seat for the rejoin,
			// and that seat counts against its address: 16 dropped seats leave it no room for a 17th.
			const joinAck = Buffer.from([0x82, 0x81, 0, 0, 0, 0, 10]);
			const joined = async (address) => {
				const h = await upgrade(await seat(), address);
				assert.ok(h.status.includes(' 101 '), h.status);
				await wait(50);
				h.socket.write(joinAck);
				await wait(50);
				return h.socket;
			};
			const into2 = Date.now() % 10_000;
			if (into2 > 4000) await wait(10_050 - into2);
			for (let i = 0; i < 16; i++) (await joined('198.51.100.40')).destroy();
			await wait(200);
			assert.equal((await upgrade(await seat(), '198.51.100.40')).status, '', 'seats held count');
			// WebSocket ping control frames count against the budget like messages.
			const pinger = await joined('198.51.100.41');
			let pingerClosed = false;
			pinger.once('close', () => (pingerClosed = true));
			pinger.write(Buffer.concat(Array(400).fill(Buffer.from([0x89, 0x80, 0, 0, 0, 0]))));
			await until('the ping flood ended its socket', () => pingerClosed, 2000);
			const ponger = await joined('198.51.100.42');
			let pongerClosed = false;
			ponger.once('close', () => (pongerClosed = true));
			ponger.write(Buffer.concat(Array(400).fill(Buffer.from([0x8a, 0x80, 0, 0, 0, 0]))));
			await until('the pong flood ended its socket', () => pongerClosed, 2000);
			// A joined device sending frames past the budget (150 a second) is ended at once.
			const f = noAutoReconnect(await clientOf().joinOrCreate(ROOM_NAME, { game: 'wide' }));
			let left = false;
			f.onLeave(() => (left = true));
			for (let i = 0; i < 200; i++) f.connection.transport.ws.send(Uint8Array.of(18));
			await until('the budget', () => left, 2000);
			await until('the wide room to close', () => game.rooms.count === 1, 8000);
		},
	);

	await check('live: an address at its cap still reconnects its own dropped player', async () => {
		// The gate's own clients come from 127.0.0.1: fill that address to its 16.
		const fill = [];
		while (heldBy('127.0.0.1') < 16) {
			fill.push(noAutoReconnect(await clientOf().joinOrCreate(ROOM_NAME, { game: 'wide' })));
		}
		const dropper = fill[fill.length - 1];
		const room = serverRoom(dropper);
		const token = dropper.reconnectionToken;
		dropper.connection.close(4100, 'a blip');
		await until('the drop', () => room.sim.players.get(dropper.sessionId)?.connected === false);
		assert.equal(heldBy('127.0.0.1'), 16, 'the held seat still counts');
		await assert.rejects(clientOf().joinById(room.roomId, {}), 'a new join is refused at the cap');
		// A fresh seat claimed with a reconnection token no held seat waits for gets no allowance.
		const fresh = await fetch(`http://127.0.0.1:${port}/matchmake/joinById/${room.roomId}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		}).then((r) => r.json());
		await assert.rejects(
			clientOf().consumeSeatReservation({ ...fresh, reconnectionToken: 'bogus' }),
			'a bogus token does not lift the cap',
		);
		// …nor does the held seat's own token on another seat: only its own session reclaims it.
		const other = await fetch(`http://127.0.0.1:${port}/matchmake/joinById/${room.roomId}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		}).then((r) => r.json());
		await assert.rejects(
			clientOf().consumeSeatReservation({ ...other, reconnectionToken: token.split(':')[1] }),
			'a real token on a fresh seat does not lift the cap',
		);
		assert.equal(heldBy('127.0.0.1'), 16);
		const back = noAutoReconnect(await clientOf().reconnect(token));
		assert.equal(back.sessionId, dropper.sessionId);
		await until('the rejoin', () => room.sim.players.get(dropper.sessionId)?.connected === true);
		await until('one count for the rejoined player', () => heldBy('127.0.0.1') <= 16);
		for (const r of [...fill.slice(0, -1), back]) await r.leave();
		await until('the wide room to close', () => game.rooms.count === 1, 8000);
	});

	await check(
		'live: a device’s Flow hears the room’s joins and leaves and reads its values off the state',
		async () => {
			const heard = [];
			const off = a.onMessage(ONLINE_EVENT, (events) => heard.push(...events));
			const b = await clientOf().joinById(a.roomId, { character: 'bear' });
			await until('the join told', () => heard.some((e) => e.type === 'joined'));
			await b.leave();
			await until('the leave told', () => heard.some((e) => e.type === 'left'));
			off();
			assert.deepEqual(flowSignalsOf(heard, a.sessionId), [
				{ name: 'playerJoined', payload: { player: b.sessionId, me: false } },
				{ name: 'playerLeft', payload: { player: b.sessionId, me: false } },
			]);
			const values = serverValuesOf(a.state, a.sessionId, 30);
			assert.deepEqual(
				[values.phase, values.round, values.score, values.status, values.secondsLeft],
				['running', 1, 0, 'free', 0],
			);
		},
	);

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
		const input = f.input();
		for (let seq = 1; seq < messagesPerSecond(30) + 20; seq++) {
			Object.assign(input.data, { seq, moveX: 0, moveY: 0, buttons: 0, aimX: 0, aimY: 0 });
			input.send();
		}
		await until('the flood limit', () => left, 3000);
		await until('the room to close', () => game.rooms.count === 0);
	});

	await check(
		"live, netcode 'colyseus': the SDK's own reconciler, over the room's step, lands where the room has the player",
		async () => {
			const room = await clientOf().joinOrCreate(ROOM_NAME, { game: 'sdk' });
			const sim = serverRoom(room).sim;
			await until('the own player', () => room.state.players?.get(room.sessionId));
			const player = room.state.players.get(room.sessionId);
			const predict = Predict.get(room);
			const input = room.input();
			let corrected = 0;
			// The options the runtime builds (`online.ts` `reconcilerOf`), from the room's own game.
			const options = reconcilerOptions(sim.game, room.sessionId, player);
			assert.equal(typeof options?.step, 'function', 'the reconciler steps the room’s step');
			const me = predict.reconciler(player, {
				input,
				...options,
				warnOnDivergence: Number.POSITIVE_INFINITY,
				onReconcile() {
					if (me.lastCorrectionMag > 0) corrected += 1;
				},
			});
			const rng = createRng('live-sdk');
			let seq = 0;
			for (let i = 0; i < 90; i++) {
				predict.tick(performance.now());
				Object.assign(input.data, clampInput(randomInput(rng, ++seq), sim.game.field));
				input.send();
				await wait(1000 / 30);
			}
			await until('every input acknowledged', () => {
				predict.tick(performance.now());
				return input.lastProcessed === seq && me.reconcileSeq > 0;
			});
			const server = sim.players.get(room.sessionId).body;
			assert.deepEqual([me.state.x, me.state.y], [server.x, server.y]);
			assert.equal(corrected, 0, `${corrected} of the room's states disagreed`);
			predict.dispose();
			await room.leave();
			await until('the room to close', () => game.rooms.count === 0);
		},
	);

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
