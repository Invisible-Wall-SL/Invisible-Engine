// Online 3D arcade rooms (services/game-server roomSim3d.ts / arcadeRoom3d.ts; docs/design/3d-games.md
// Phase 1, docs/design/3d/gameplay-evaluation.md §2–§3): the room's fold of `stepPlayer3d` equals the
// device's prediction BIT FOR BIT over a seeded input script through a jittery, stalling link (a
// 3D player waits for its inputs, so latency cannot change its fold), falls into the void
// included, so a device never takes a correction; a player silent past CREDIT_SECONDS, or dropped,
// is stepped at rest (it falls and lands, its ack kept) and its device finds those steps exactly;
// world3dOf refuses a level that would freeze the room; two rooms of a world share its level;
// the input clamp is exact; bots fill seats and move; the interpolator
// and the camera helpers do what the view relies on. Then a real Colyseus 0.18 server with two
// `@colyseus/sdk` clients: each predicts its own player with zero corrections, sees the other and
// the bot move and is told of their jumps and landings, and the 2D and 3D rooms refuse each other's
// games.
//
// Run: pnpm check:room-sim-3d

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	createBody3d,
	createLevel3d,
	hashBodies3d,
	MAX_ZONES_3D,
	YAW_UNITS,
} from '../packages/engine-mechanics/src/motion3d.js';
import {
	ANIM3D,
	BUTTONS3D,
	MOVE_SCALE,
	PITCH_LIMIT,
	clampInput3d,
	createInterpolator3d,
	createPredictor3d,
	levelOf3d,
	moveFromStick,
	radiansOfYaw,
	respawnOnFall3d,
	sanitizeInput3d,
	stepPlayer3d,
	world3dOf,
	yawFromRadians,
} from '../packages/engine-mechanics/src/online3d.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { CREDIT_SECONDS, inputsThisStep } from '../services/game-server/src/roomSim.ts';
import { createRoomSim3d } from '../services/game-server/src/roomSim3d.ts';
import { ROOM_NAME, ROOM_NAME_3D, createGameServer } from '../services/game-server/src/server.ts';

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

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
	kind: 'box',
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});
/** A 40 m walled arena: a 4 m pit at (10, 0), a 3 m tier reached by a ramp, a trampoline. */
const ARENA = {
	colliders: [
		box(-20, -1, -20, 8, 0, 20),
		box(12, -1, -20, 20, 0, 20),
		box(8, -1, -20, 12, 0, -2),
		box(8, -1, 2, 12, 0, 20),
		box(-15, 0, -15, -5, 3, -5),
		{ kind: 'ramp', facing: '-x', minX: -5, minY: 0, minZ: -12, maxX: 3, maxY: 3, maxZ: -8 },
		box(-21, 0, -21, 21, 4, -20),
		box(-21, 0, 20, 21, 4, 21),
		box(-21, 0, -20, -20, 4, 20),
		box(20, 0, -20, 21, 4, 20),
	],
	zones: [
		{ kind: 'trampoline', minX: 0, minY: -0.1, minZ: 10, maxX: 2, maxY: 0.1, maxZ: 12, height: 4 },
		{ kind: 'void', minX: 8, minY: -10, minZ: -2, maxX: 12, maxY: 0, maxZ: 2 },
	],
	killY: -10,
};
const SPAWNS = [
	{ x: 0, z: 0 },
	{ x: -3, z: 3 },
	{ x: 3, z: -3 },
	{ x: -6, z: 6 },
];
const CHASE = {
	initial: 'hunt',
	states: [{ id: 'hunt', behaviour: 'chase', params: { tag: 'player', range: 500, speed: 4 } }],
	transitions: [],
};
const configOf = ({ online = {}, world3d, colliders = ARENA.colliders } = {}) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Room 3D',
	arcade: {
		field: { w: 40, h: 40 },
		bodies: {
			hero: { shape: 'circle', r: 0.4, tags: ['player'] },
			brute: { shape: 'circle', r: 0.4, tags: ['bot'] },
		},
		characters: [{ id: 'chaser', component: 'brute', brain: CHASE }],
		online: {
			characters: [
				{ id: 'hero', body: 'hero', speed: 5 },
				{ id: 'brute', body: 'brute', speed: 4 },
			],
			...online,
		},
		...(world3d === null
			? {}
			: { world3d: world3d ?? { level: { ...ARENA, colliders }, spawns: SPAWNS } }),
	},
});
const doc = (config) => normalizeGameConfigDoc(config);
const gameOf = (config) => {
	const game = onlineGameOf(doc(config));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};
const roomOf = (config, seed = 11) =>
	createRoomSim3d(gameOf(config), world3dOf(config.arcade.world3d), { seed });

/** A raw input a device might send, sometimes hostile: off-scale, extra fields, NaN. It walks to a
 *  target (now and then the pit), weaves, sprints and jumps. */
const scriptOf = (seed) => {
	const rng = createRng(seed);
	let target = { x: 0, z: 0 };
	let left = 0;
	let seq = 0;
	return (body) => {
		if (left-- <= 0) {
			left = 30 + Math.floor(rng() * 120);
			target =
				rng() < 0.25
					? { x: 10, z: 0 }
					: rng() < 0.3
						? { x: -2 + rng() * 4, z: -10 }
						: rng() < 0.2
							? { x: 1, z: 11 }
							: { x: rng() * 36 - 18, z: rng() * 36 - 18 };
		}
		const dx = target.x - body.x;
		const dz = target.z - body.z;
		const d = Math.sqrt(dx * dx + dz * dz) || 1;
		const raw = {
			seq: ++seq,
			moveX: Math.round((dx / d) * 160),
			moveZ: Math.round((dz / d) * 160),
			buttons: (rng() < 0.04 ? BUTTONS3D.jump : 0) | (rng() < 0.5 ? BUTTONS3D.sprint : 0),
			yaw: Math.floor(rng() * 200000) - 50000,
			pitch: Math.floor(rng() * 70000) - 35000,
			view: seq,
		};
		if (rng() < 0.05) Object.assign(raw, { x: 999, y: 999, z: -999, status: 0, team: 9 });
		if (rng() < 0.03) raw.moveZ = Number.NaN;
		return raw;
	};
};

/** What the transport does before the room sees an input: only the schema's fields, clamped, an
 *  older `seq` dropped. */
const receiver = () => {
	let last = 0;
	const queue = [];
	return {
		queue,
		receive(raw) {
			const decoded = sanitizeInput3d({
				seq: raw.seq,
				moveX: raw.moveX,
				moveZ: raw.moveZ,
				buttons: raw.buttons,
				yaw: raw.yaw,
				pitch: raw.pitch,
				view: raw.view,
			});
			if (decoded.seq <= last) return;
			last = decoded.seq;
			queue.push(decoded);
		},
		take: (credit) => queue.splice(0, inputsThisStep(queue.length, credit)),
	};
};

/** An in-order link (TCP): each message is late by 0–`spread` steps, and every `stallEvery` steps
 *  nothing arrives for `stallFor` — with the spread, under `CREDIT_SECONDS` (15 steps at 30 Hz): a
 *  longer silence is a device that stopped, which the room steps at rest (checked below). */
const linkOf = (seed, { spread = 3, stallEvery = 400, stallFor = 12 } = {}) => {
	const rng = createRng(seed);
	let last = 0;
	const inFlight = [];
	return {
		send(at, message) {
			let arrive = Math.max(last, at + Math.floor(rng() * (spread + 1)));
			const phase = arrive % stallEvery;
			if (phase < stallFor) arrive += stallFor - phase;
			last = arrive;
			inFlight.push({ arrive, message });
		},
		deliver(now) {
			const out = [];
			while (inFlight.length && inFlight[0].arrive <= now) out.push(inFlight.shift().message);
			return out;
		},
		get empty() {
			return inFlight.length === 0;
		},
	};
};

// --- 1. headless: the room's fold against the device's prediction --------------------------------

console.log('1. the room equals the device');
await check('the clamp is exact and idempotent; extra fields and garbage change nothing', () => {
	const rng = createRng('clamp');
	for (let i = 0; i < 20000; i++) {
		const raw = {
			seq: rng() * 1e10 - 10,
			moveX: (rng() * 2 - 1) * 400,
			moveZ: (rng() * 2 - 1) * 400,
			buttons: rng() * 1e4,
			yaw: (rng() * 2 - 1) * 3e5,
			pitch: (rng() * 2 - 1) * 1e5,
			view: rng() < 0.1 ? Number.NaN : rng() * 1e6,
			x: 5,
		};
		const once = clampInput3d(raw);
		assert.deepEqual(clampInput3d(once), once);
		assert.deepEqual(Object.keys(once).sort(), [
			'buttons',
			'moveX',
			'moveZ',
			'pitch',
			'seq',
			'view',
			'yaw',
		]);
		assert.ok(once.moveX * once.moveX + once.moveZ * once.moveZ <= MOVE_SCALE * MOVE_SCALE);
		assert.ok(Number.isInteger(once.moveX) && Number.isInteger(once.moveZ));
		assert.ok(once.yaw >= 0 && once.yaw < YAW_UNITS && Math.abs(once.pitch) <= PITCH_LIMIT);
		assert.ok(once.buttons >= 0 && once.buttons < 64);
	}
	assert.equal(clampInput3d({ yaw: -1 }).yaw, YAW_UNITS - 1, 'yaw wraps');
});

const STEPS = 6000;
await check(
	`${STEPS} steps, two devices over a jittery, stalling link: the room's every body is the device fold's, bit for bit, respawns included; no prediction is ever corrected`,
	() => {
		const config = configOf();
		const sim = roomOf(config);
		const level = createLevel3d(sim.world.level);
		const ids = ['ann', 'bob'];
		const devices = ids.map((id, i) => {
			const player = sim.join(id, { name: id, character: 'hero' });
			const home = player.home;
			return {
				id,
				home,
				script: scriptOf(`dev${i}`),
				up: linkOf(`up${i}`),
				down: linkOf(`down${i}`, { spread: 2, stallEvery: 530, stallFor: 12 }),
				rx: receiver(),
				predictor: createPredictor3d({ body: createBody3d(home), level, dt: sim.ctx.dt }),
				/** The reference fold: every clamped input in order, a fall respawned at home. */
				ref: createBody3d(home),
				refHash: new Map([[0, hashBodies3d([createBody3d(home)])]]),
				respawns: 0,
				corrected: 0,
			};
		});
		const byId = new Map(devices.map((d) => [d.id, d]));
		const coverage = { jumped: 0, bounced: 0, enterZone: 0, respawned: 0, onRamp: 0 };
		let compared = 0;
		for (let t = 1; t <= STEPS + 200; t++) {
			for (const d of devices) for (const raw of d.up.deliver(t)) d.rx.receive(raw);
			const events = sim.step((id, credit) => byId.get(id)?.rx.take(credit) ?? []);
			for (const e of events) {
				if (e.type in coverage) coverage[e.type] += 1;
				if (e.type === 'respawned') byId.get(e.id).respawns += 1;
			}
			for (const d of devices) {
				const player = sim.players.get(d.id);
				assert.equal(
					hashBodies3d([player.body]),
					d.refHash.get(player.ack),
					`room ≠ fold for ${d.id} at seq ${player.ack}`,
				);
				compared += 1;
				d.down.send(t, {
					x: Math.fround(player.body.x),
					y: Math.fround(player.body.y),
					z: Math.fround(player.body.z),
					ack: player.ack,
					step: sim.steps,
				});
				for (const truth of d.down.deliver(t))
					if (d.predictor.reconcile(truth) === 'corrected') d.corrected += 1;
				if (t <= STEPS) {
					const raw = d.script(d.predictor.body);
					d.up.send(t, raw);
					const input = clampInput3d(raw);
					d.predictor.input(input);
					const result = stepPlayer3d(d.ref, input, level, undefined, sim.ctx.dt);
					if (result.onRamp) coverage.onRamp += 1;
					respawnOnFall3d(d.ref, result, d.home);
					d.refHash.set(input.seq, hashBodies3d([d.ref]));
				}
			}
			if (t > STEPS && devices.every((d) => sim.players.get(d.id).ack === STEPS)) break;
		}
		for (const d of devices) {
			const player = sim.players.get(d.id);
			assert.equal(player.ack, STEPS, `${d.id} applied every input`);
			assert.equal(hashBodies3d([d.predictor.body]), hashBodies3d([player.body]), d.id);
			assert.equal(d.corrected, 0, `${d.id}: ${d.corrected} corrections`);
			assert.ok(d.respawns > 0, `${d.id} never fell`);
		}
		for (const [name, count] of Object.entries(coverage)) assert.ok(count > 0, `never: ${name}`);
		assert.ok(compared > STEPS);
		console.log(`   ${compared} room/fold comparisons, 0 corrections; ${JSON.stringify(coverage)}`);
	},
);

/** Ann alone in the arena, jumped and still rising, with her device's predictor fed every state. */
const midAir = () => {
	const sim = roomOf(configOf());
	const player = sim.join('ann', { character: 'hero' });
	const rx = receiver();
	const predictor = createPredictor3d({
		body: createBody3d(player.home),
		level: sim.level,
		dt: sim.ctx.dt,
	});
	const verdicts = { match: 0, corrected: 0, stale: 0 };
	let seq = 0;
	const held = [];
	const send = (buttons = 0, hold = false) => {
		const input = clampInput3d({ seq: ++seq, moveX: 127, moveZ: 0, buttons, yaw: 900 });
		if (hold) held.push(input);
		else rx.receive(input);
		predictor.input(input);
	};
	const release = () => held.splice(0).forEach((input) => rx.receive(input));
	const step = (events = []) => {
		events.push(...sim.step((id, credit) => (id === 'ann' ? rx.take(credit) : [])));
		const { x, y, z } = player.body;
		verdicts[predictor.reconcile({ x, y, z, ack: player.ack, step: sim.steps })] += 1;
		return events;
	};
	for (let i = 0; i < 10; i++) {
		send(i === 5 ? BUTTONS3D.jump : 0);
		step();
	}
	assert.ok(player.body.y > 0.3 && player.body.vy > 0, 'rising');
	assert.equal(verdicts.corrected, 0);
	return { sim, player, send, release, step, verdicts, predictor };
};
const CREDIT_STEPS = Math.ceil(30 * CREDIT_SECONDS);

await check(
	'a player that stops sending waits CREDIT_SECONDS, then falls and lands for everyone, its ack kept; its device finds those resting steps exactly',
	() => {
		const { player, send, step, verdicts, predictor } = midAir();
		const ack = player.ack;
		const held = hashBodies3d([player.body]);
		for (let i = 0; i < CREDIT_STEPS; i++) step();
		assert.equal(hashBodies3d([player.body]), held, 'ordinary jitter: the fold waits');
		const events = [];
		const started = performance.now();
		for (let i = 0; i < 90; i++) step(events);
		assert.ok(performance.now() - started < 200);
		assert.equal(player.ack, ack, 'no input was applied');
		assert.ok(player.body.grounded && player.body.y === 0, `landed at ${player.body.y}`);
		assert.ok(
			events.some((e) => e.type === 'landed' && e.id === 'ann'),
			'the landing is told',
		);
		assert.equal(player.body.yaw, 900, 'it keeps facing its way');
		const before = verdicts.corrected;
		assert.ok(before >= 1, 'the device was told where it fell');
		const motion = ({ x, y, z, vx, vy, vz, grounded }) => ({ x, y, z, vx, vy, vz, grounded });
		assert.deepEqual(motion(predictor.body), motion(player.body), 'found exactly');
		for (let i = 0; i < 60; i++) {
			send();
			step();
		}
		assert.equal(hashBodies3d([predictor.body]), hashBodies3d([player.body]), 'back in step');
		const since = verdicts.corrected - before;
		assert.equal(since, 0, `${since} corrections after it resumed`);
		const settled = verdicts.match;
		for (let i = 0; i < 30; i++) {
			send();
			step();
		}
		assert.equal(verdicts.match - settled, 30, 'then every state matches');
		console.log(`   ${verdicts.corrected} corrections while idle, ${since} after resuming`);
	},
);

await check(
	'a link that stalls past CREDIT_SECONDS: the room rests the player, then plays the burst from there, and the device follows exactly',
	() => {
		const { player, send, release, step, verdicts, predictor } = midAir();
		const ack = player.ack;
		for (let i = 0; i < CREDIT_STEPS + 30; i++) {
			send(0, true);
			step();
		}
		assert.equal(player.ack, ack);
		assert.ok(player.body.grounded, 'rested to the floor');
		release();
		const before = verdicts.corrected;
		for (let i = 0; i < 60; i++) {
			send();
			step();
		}
		assert.equal(player.ack, ack + 60 + CREDIT_STEPS, 'the credit spent on the burst');
		for (let i = 0; i < CREDIT_STEPS * 2 + 10; i++) step();
		assert.equal(player.ack, ack + CREDIT_STEPS + 90, 'the burst drained');
		assert.equal(hashBodies3d([predictor.body]), hashBodies3d([player.body]));
		assert.equal(verdicts.corrected, before, 'no correction once the burst arrives');
	},
);

await check(
	'a dropped player falls and lands at once, ack kept, and plays on when it rejoins',
	() => {
		const { sim, player, send, step } = midAir();
		const ack = player.ack;
		sim.drop('ann');
		const before = hashBodies3d([player.body]);
		step();
		assert.notEqual(hashBodies3d([player.body]), before, 'stepped on the first step it is gone');
		for (let i = 0; i < 90; i++) step();
		assert.equal(player.ack, ack);
		assert.ok(player.body.grounded && player.body.y === 0);
		sim.rejoin('ann');
		send();
		step();
		assert.equal(player.ack, ack + 1);
	},
);

await check('a player that has never sent an input waits at its home', () => {
	const sim = roomOf(configOf());
	const player = sim.join('ann', { character: 'hero' });
	sim.drop(sim.join('bob', { character: 'hero' }).id);
	for (let i = 0; i < CREDIT_STEPS * 4; i++) sim.step(() => []);
	for (const p of sim.players.values())
		assert.equal(hashBodies3d([p.body]), hashBodies3d([createBody3d(p.home)]), p.id);
	assert.equal(player.ack, 0);
});

await check('two rooms of one world share its one level', () => {
	const config = configOf();
	const world = world3dOf(config.arcade.world3d);
	const game = gameOf(config);
	const a = createRoomSim3d(game, world, { seed: 1 });
	const b = createRoomSim3d(game, world, { seed: 2 });
	assert.equal(a.level, b.level);
	assert.equal(a.level, levelOf3d(world));
	assert.notEqual(a.level, levelOf3d(world3dOf(config.arcade.world3d)), 'one per world');
});

await check('teams balance, characters keep their max, the room its size', () => {
	const sim = roomOf(
		configOf({
			online: { maxPlayers: 3, characters: [{ id: 'hero', body: 'hero', speed: 5, max: 2 }] },
		}),
	);
	assert.deepEqual(
		['a', 'b'].map((id) => sim.join(id, {}).team),
		[0, 1],
	);
	assert.throws(() => sim.join('c', { character: 'hero' }), /no place left/);
	assert.throws(() => sim.join('a', {}), /already/);
	assert.equal(sim.phase, 'running');
	sim.leave('a');
	sim.leave('b');
	assert.equal(sim.phase, 'waiting');
});

// --- 2. bots ------------------------------------------------------------------------------------

console.log('2. bots');
const BOTS = { fillTo: 3, characters: [{ character: 'brute', brain: 'chaser' }] };
await check('bots fill the room through the seat model and chase a person on the plane', () => {
	const sim = roomOf(configOf({ online: { bots: BOTS } }));
	const me = sim.join('ann', { character: 'hero' });
	const bots = [...sim.players.values()].filter((p) => p.bot);
	assert.equal(bots.length, 2);
	const gap = (p) => Math.sqrt((p.body.x - me.body.x) ** 2 + (p.body.z - me.body.z) ** 2);
	const start = bots.map(gap);
	const moved = bots.map((p) => ({ x: p.body.x, z: p.body.z }));
	let seq = 0;
	for (let i = 0; i < 240; i++) sim.step(() => [clampInput3d({ seq: ++seq })]);
	bots.forEach((p, i) => {
		assert.equal(p.ack, 240, 'a bot sends an input every step');
		assert.ok(Math.hypot(p.body.x - moved[i].x, p.body.z - moved[i].z) > 1, `${p.id} moved`);
		assert.ok(gap(p) < start[i] - 1 || gap(p) < 1.5, `${p.id} closed in (${start[i]} → ${gap(p)})`);
		assert.ok(p.anim & ANIM3D.grounded);
	});
	const late = sim.join('bob', { character: 'brute' });
	assert.equal(late.bot, undefined);
	assert.equal([...sim.players.values()].filter((p) => p.bot).length, 1, 'a person took a seat');
	sim.leave('ann');
	sim.leave('bob');
	assert.equal(sim.players.size, 0, 'bots leave an empty room');
});
await check('a seeded room replays exactly, bots included', () => {
	const run = () => {
		const sim = roomOf(configOf({ online: { bots: BOTS } }), 99);
		sim.join('ann', { character: 'hero' });
		const script = scriptOf('replay');
		const me = sim.players.get('ann');
		const hashes = [];
		for (let i = 0; i < 600; i++) {
			const input = clampInput3d(script(me.body));
			sim.step((id) => (id === 'ann' ? [input] : []));
			if (i % 50 === 0) hashes.push(hashBodies3d([...sim.players.values()].map((p) => p.body)));
		}
		return hashes;
	};
	assert.deepEqual(run(), run());
});

// --- 3. what the view relies on -----------------------------------------------------------------

console.log('3. the device helpers');
await check('a stick seen by a camera becomes world axes; yaw 0 looks down −z', () => {
	assert.deepEqual(moveFromStick(0, 1, 0), { moveX: 0, moveZ: -MOVE_SCALE });
	assert.deepEqual(moveFromStick(1, 0, 0), { moveX: MOVE_SCALE, moveZ: 0 });
	assert.deepEqual(moveFromStick(0, 1, YAW_UNITS / 4), { moveX: -MOVE_SCALE, moveZ: 0 });
	const diag = moveFromStick(1, 1, 0);
	assert.ok(diag.moveX * diag.moveX + diag.moveZ * diag.moveZ <= MOVE_SCALE * MOVE_SCALE);
	assert.equal(yawFromRadians(Math.PI / 2), YAW_UNITS / 4);
	assert.equal(yawFromRadians(-Math.PI / 2), (YAW_UNITS * 3) / 4);
	assert.equal(radiansOfYaw(YAW_UNITS / 2), Math.PI);
});
await check('the interpolator lerps x/y/z, turns yaw the short way, snaps a respawn', () => {
	const lerp = createInterpolator3d();
	lerp.push('p', 10, { x: 0, y: 0, z: 0, yaw: 65000, anim: 1 });
	lerp.push('p', 12, { x: 2, y: 1, z: -2, yaw: 800, anim: 3 });
	lerp.push('p', 11, { x: 99, y: 99, z: 99, yaw: 0 });
	const mid = lerp.at('p', 11);
	assert.deepEqual([mid.x, mid.y, mid.z, mid.yaw, mid.anim], [1, 0.5, -1, 132, 1]);
	assert.equal(lerp.at('p', 12).anim, 3);
	lerp.push('p', 14, { x: 30, y: 0, z: 0, yaw: 536 });
	assert.equal(lerp.at('p', 13).x, 2, 'a long jump is not slid across');
	assert.equal(lerp.at('p', 14).x, 30);
	lerp.retain(new Set());
	assert.equal(lerp.at('p', 14), undefined);
});

// --- 4. config ----------------------------------------------------------------------------------

console.log('4. the config');
const dir = mkdtempSync(join(tmpdir(), 'room-3d-'));
const LIVE_WORLD = {
	level: {
		colliders: [
			box(-30, -1, -30, 30, 0, 30),
			{ kind: 'ramp', facing: '+x', minX: 4, minY: 0, minZ: -8, maxX: 10, maxY: 2, maxZ: -4 },
		],
		zones: [
			{
				kind: 'trampoline',
				minX: -6,
				minY: -0.1,
				minZ: 4,
				maxX: -4,
				maxY: 0.1,
				maxZ: 6,
				height: 3,
			},
		],
	},
	spawns: [
		{ x: 0, z: 0 },
		{ x: 3, z: 3 },
		{ x: -3, z: -3 },
	],
};
writeFileSync(
	join(dir, 'arena.json'),
	JSON.stringify(configOf({ online: { bots: { ...BOTS, fillTo: 3 } }, world3d: LIVE_WORLD })),
);
writeFileSync(join(dir, 'flat.json'), JSON.stringify(configOf({ world3d: null })));
writeFileSync(
	join(dir, 'broken.json'),
	JSON.stringify(
		configOf({
			world3d: { level: { colliders: [{ ...box(0, 0, 0, 1, 1, 1), kind: 'ramp', facing: 'up' }] } },
		}),
	),
);
await check(
	'the server reads arcade.world3d from the raw doc, and refuses a bad one by path',
	async () => {
		const load = createConfigSource({ dir });
		const arena = await load('arena');
		assert.equal(arena.world3d.level.colliders.length, 2);
		assert.equal(arena.world3d.spawns[1].x, 3);
		assert.equal((await load('arena')).world3d, arena.world3d, 'one world per doc');
		assert.equal((await load('flat')).world3d, undefined);
		await assert.rejects(load('broken'), /arcade\.world3d\.level\.colliders\.0\.facing/);
		assert.equal(
			normalizeGameConfigDoc(configOf()).arcade.world3d,
			undefined,
			'game-config does not know the block (it is in every runtime)',
		);
		assert.throws(() => world3dOf({ motion: { gravity: 9.81 } }), /gravity/);
		assert.throws(() => world3dOf({ spawns: [] }), /spawns/);
		assert.equal(world3dOf({ characters: { hero: { speed: 7 } } }).characters.hero.speed, 7);
	},
);
await check(
	'world3dOf refuses, by path and at once, a level too big to index, a fine grid, a wide body, a flat trampoline and too many zones',
	() => {
		const zone = (i, extra = {}) => ({
			kind: 'pad',
			minX: i,
			minY: 0,
			minZ: 0,
			maxX: i + 1,
			maxY: 1,
			maxZ: 1,
			...extra,
		});
		const refused = [
			[{ level: { colliders: [box(-1e9, -1, -1e9, 1e9, 0, 1e9)] } }, /level: .*collider 0 .*cells/],
			[
				{
					level: {
						colliders: [box(0, 0, 0, 1, 1, 1), box(-100, -1, -100, 100, 0, 100)],
						cellSize: 0.25,
					},
				},
				/collider 1 takes the level past/,
			],
			[{ level: { colliders: [box(0, 0, 0, 1, 1, 1)], cellSize: 1e-6 } }, /level\.cellSize/],
			[{ level: { cellSize: 0 } }, /level\.cellSize/],
			[{ level: { cellSize: 0.5 }, motion: { radius: 5 } }, /world3d\.motion\.radius/],
			[{ characters: { hero: { radius: 40 } } }, /world3d\.characters\.hero\.radius/],
			[{ level: { zones: [zone(0, { kind: 'trampoline', height: -3 })] } }, /zones\.0\.height/],
			[{ level: { zones: [zone(0), zone(1, { kind: 'trampoline' })] } }, /zones\.1\.height/],
			[{ level: { zones: [zone(0, { kind: 'trampoline', height: 0 })] } }, /zones\.0\.height/],
			[
				{ level: { zones: Array.from({ length: MAX_ZONES_3D + 1 }, (_, i) => zone(i)) } },
				/level\.zones: a list of at most 256/,
			],
		];
		for (const [raw, error] of refused) {
			const started = performance.now();
			assert.throws(() => world3dOf(raw), error);
			assert.ok(performance.now() - started < 100, `${error} took long`);
		}
		const zones = Array.from({ length: MAX_ZONES_3D }, (_, i) => zone(i));
		assert.equal(world3dOf({ level: { zones, cellSize: 0.25 } }).level.zones.length, 256);
		assert.equal(world3dOf({ level: { cellSize: 0.5 }, motion: { radius: 4 } }).motion.radius, 4);
	},
);

// --- 5. live: a real Colyseus 0.18 server, two SDK clients ----------------------------------------

console.log('5. live');
const freePort = () =>
	new Promise((resolve) => {
		const probe = createServer();
		probe.listen(0, () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, test, ms = 8000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (test()) return;
		await wait(10);
	}
	throw new Error(`timed out waiting for ${what}`);
};

const port = await freePort();
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 4,
	commit: 'room3d000000',
	gracefullyShutdown: false,
});
await server.listen(port);
const clientOf = () => new Client(`ws://127.0.0.1:${port}`);
const rooms = [];
try {
	await check('live: each room refuses the other kind of game, and a bad world', async () => {
		await assert.rejects(clientOf().joinOrCreate(ROOM_NAME, { game: 'arena' }));
		await assert.rejects(clientOf().joinOrCreate(ROOM_NAME_3D, { game: 'flat' }));
		await assert.rejects(clientOf().joinOrCreate(ROOM_NAME_3D, { game: 'broken' }));
		const flat = await clientOf().joinOrCreate(ROOM_NAME, { game: 'flat' });
		await flat.leave();
	});

	await check(
		'live: two devices predict their own players with no correction, and see each other and the bot move',
		async () => {
			const a = await clientOf().joinOrCreate(ROOM_NAME_3D, {
				game: 'arena',
				name: 'Ann',
				character: 'hero',
			});
			const b = await clientOf().joinOrCreate(ROOM_NAME_3D, {
				game: 'arena',
				name: 'Bob',
				character: 'hero',
			});
			rooms.push(a, b);
			const heard = new Map([a, b].map((room) => [room, []]));
			for (const room of [a, b])
				room.onMessage('event', (events) => heard.get(room).push(...events));
			assert.equal(a.roomId, b.roomId, 'one room');
			const sim = matchMaker.getLocalRoomById(a.roomId).sim;
			await until(
				'both in the state',
				() => a.state.players?.size === 3 && b.state.players?.size === 3,
			);
			const bot = [...sim.players.values()].find((p) => p.bot);
			assert.ok(bot, 'a bot took the third seat');
			const level = createLevel3d(sim.world.level);
			const devices = [a, b].map((room, i) => {
				const server = sim.players.get(room.sessionId);
				const predictor = createPredictor3d({
					body: createBody3d(server.home),
					level,
					dt: sim.ctx.dt,
				});
				const verdicts = { match: 0, corrected: 0, stale: 0 };
				room.onStateChange((state) => {
					const me = state.players.get(room.sessionId);
					if (!me || me.ack === 0) return;
					verdicts[
						predictor.reconcile({ x: me.x, y: me.y, z: me.z, ack: me.ack, step: state.step })
					] += 1;
				});
				return {
					room,
					server,
					predictor,
					verdicts,
					script: scriptOf(`live${i}`),
					input: room.input(),
				};
			});
			const N = 150;
			const botFrom = { x: bot.body.x, z: bot.body.z };
			for (let seq = 1; seq <= N; seq++) {
				for (const d of devices) {
					const input = clampInput3d({ ...d.script(d.predictor.body), seq });
					Object.assign(d.input.data, input);
					d.input.send();
					d.predictor.input(input);
				}
				await wait(1000 / 40);
			}
			for (const d of devices) {
				await until('every input applied', () => d.server.ack === N);
				await until('the patch', () => d.room.state.players.get(d.room.sessionId).ack === N);
				assert.equal(
					hashBodies3d([d.predictor.body]),
					hashBodies3d([d.server.body]),
					'device === room',
				);
				assert.equal(d.verdicts.corrected, 0, JSON.stringify(d.verdicts));
				assert.ok(d.verdicts.match > 5, JSON.stringify(d.verdicts));
				const drawn = d.room.state.players.get(d.room.sessionId);
				assert.deepEqual(
					[drawn.x, drawn.y, drawn.z, drawn.yaw],
					[
						Math.fround(d.server.body.x),
						Math.fround(d.server.body.y),
						Math.fround(d.server.body.z),
						d.server.body.yaw,
					],
				);
			}
			const [da, db] = devices;
			const bInA = a.state.players.get(b.sessionId);
			assert.ok(
				Math.hypot(bInA.x - db.server.home.x, bInA.z - db.server.home.z) > 1,
				'Ann sees Bob move',
			);
			const aInB = b.state.players.get(a.sessionId);
			assert.ok(
				Math.hypot(aInB.x - da.server.home.x, aInB.z - da.server.home.z) > 1,
				'Bob sees Ann move',
			);
			const botInA = a.state.players.get(bot.id);
			assert.ok(
				botInA.bot && Math.hypot(botInA.x - botFrom.x, botInA.z - botFrom.z) > 0.5,
				'the bot moved',
			);
			assert.notEqual(aInB.team, bInA.team, 'Ann and Bob are on two teams');
			const told = (room, id) =>
				new Set(
					heard
						.get(room)
						.filter((e) => e.id === id)
						.map((e) => e.type),
				);
			await until('the events of the last steps', () =>
				['jumped', 'landed'].every((t) => told(b, a.sessionId).has(t)),
			);
			assert.ok(told(a, b.sessionId).has('jumped'), 'Ann is told of Bob’s jumps');
			console.log(
				`   Ann ${JSON.stringify(da.verdicts)}, Bob ${JSON.stringify(db.verdicts)}; bot moved ${Math.hypot(botInA.x - botFrom.x, botInA.z - botFrom.z).toFixed(2)} m`,
			);
		},
	);
} finally {
	for (const room of rooms) await room.leave().catch(() => {});
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-sim-3d — ${passed} checks passed`);
process.exit(0);
