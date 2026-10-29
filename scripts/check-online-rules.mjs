// An online room's rules (engine-mechanics onlineRules.js; docs/design/realtime-multiplayer.md §4,
// §6, §8, §12; game-families §9 #18; P10.15): the rules run on the server as the config's data — the
// goal and the clock end a round and the next starts after the pause; an ability catches or stuns
// the players of its targets within reach, off cooldown, tested where its user saw them (held to the
// rewind window); a held player's inputs are taken but move it nowhere; scores live in the room; the
// `tag` rules module; the same inputs replay to the same events — first headless over the room's
// own code, then over a real Colyseus 0.18 server whose devices see the state and the events.
//
// Salmons' own rules (the climb, the line, its river) and their recorded traces are P10.16's, with
// the rebuild (`docs/status/game-families.md`).
//
// Run: pnpm check:online-rules

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BUTTONS, clampInput } from '../packages/engine-mechanics/src/online.js';
import {
	GRACE_MS,
	ONLINE_EVENT,
	ONLINE_RULES_MODULES,
	REWIND_MS,
	STATUS,
} from '../packages/engine-mechanics/src/onlineRules.js';
import {
	SERVER_VALUE_KINDS,
	createAbilityPredictor,
	flowSignalsOf,
	serverValuesOf,
	shownInRoom,
} from '../packages/engine-mechanics/src/onlineFlow.js';
import { SERVER_VARIABLE_SOURCES } from '../packages/engine-flow-v2/src/variables.ts';
import {
	ONLINE_RULES_MODULE_IDS,
	normalizeGameConfigDoc,
	onlineGameOf,
} from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
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

const FIELD = { w: 1000, h: 600 };
const TICK = 30;
const CHARACTERS = [
	{ id: 'salmon', body: 'salmon', speed: 300 },
	{ id: 'bear', body: 'bear', speed: 300 },
];
const configOf = (rules, extra = {}) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Rules',
	arcade: {
		field: FIELD,
		bodies: {
			salmon: { shape: 'circle', r: 10, tags: ['player'] },
			bear: { shape: 'circle', r: 20, tags: ['player'] },
		},
		zones: [
			{ id: 'source', x: 900, y: 0, w: 100, h: 600 },
			{ id: 'river', x: 0, y: 400, w: 1000, h: 200 },
		],
		online: {
			characters: CHARACTERS,
			spawn: { x: 100, y: 300 },
			...(rules ? { rules } : {}),
			...extra,
		},
	},
});
const gameOf = (rules, extra) => {
	const game = onlineGameOf(normalizeGameConfigDoc(configOf(rules, extra)));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};

/** A room and a hand on each player's inputs: `press(id, input)` queues one for the next step. */
const roomOf = (rules, extra) => {
	const sim = createRoomSim(gameOf(rules, extra));
	const queued = new Map();
	const seqs = new Map();
	const events = [];
	const take = () => events.push(...sim.events());
	return {
		sim,
		events,
		join(id, character) {
			sim.join(id, { character });
			take();
			return sim.players.get(id);
		},
		press(id, input = {}) {
			const seq = (seqs.get(id) ?? 0) + 1;
			seqs.set(id, seq);
			const list = queued.get(id) ?? [];
			list.push(clampInput({ seq, view: sim.steps, ...input }, sim.game.field));
			queued.set(id, list);
		},
		step(n = 1) {
			for (let i = 0; i < n; i++) {
				events.push(...sim.step((id) => (queued.get(id) ?? []).splice(0, 1)));
			}
		},
		/** Step past the grace every player starts with, so it can be hit. */
		ready() {
			this.hold({}, Math.round((GRACE_MS * TICK) / 1000));
		},
		/** Step with every player pressing `inputs[id]` (or resting) each step. */
		hold(inputs, n) {
			for (let i = 0; i < n; i++) {
				for (const id of sim.players.keys()) this.press(id, inputs[id] ?? {});
				this.step();
			}
		},
		of: (type) => events.filter((e) => e.type === type),
	};
};

const RIGHT = { moveX: 127 };
const SWIPE = { buttons: BUTTONS.ability1 };

// --- 1. the config ------------------------------------------------------------------------------

await check('the rules block normalizes, resolves with its defaults, and is validated', () => {
	const doc = normalizeGameConfigDoc(
		configOf({
			zones: [
				{ zone: 'source', goal: true, characters: ['salmon', 'salmon', ' '] },
				{ zone: 'river', force: { x: -40, y: 0 } },
				{ zone: 'river' },
				{ zone: 'river', force: { x: 0, y: 0 } },
			],
			abilities: [
				{ character: 'bear', button: 'ability1', reach: 60, targets: ['salmon'], effect: 'catch' },
				{ character: 'bear', button: 'jump', reach: 60, targets: ['salmon'], effect: 'catch' },
				{ character: 'bear', button: 'ability2', reach: 60, targets: [], effect: 'stun' },
				{ character: 'bear', button: 'ability2', reach: 60, targets: ['salmon'], effect: 'bite' },
			],
			round: { seconds: 90, nextRoundSeconds: 15, goalScore: 1 },
			module: ' tag ',
			cheat: true,
		}),
	);
	assert.deepEqual(doc.arcade.online.rules, {
		zones: [
			{ zone: 'source', goal: true, characters: ['salmon'] },
			{ zone: 'river', force: { x: -40, y: 0 } },
		],
		abilities: [
			{ character: 'bear', button: 'ability1', reach: 60, targets: ['salmon'], effect: 'catch' },
		],
		round: { seconds: 90, nextRoundSeconds: 15, goalScore: 1 },
		module: 'tag',
	});
	const game = onlineGameOf(doc);
	assert.deepEqual(game.online.rules.abilities[0], {
		character: 'bear',
		button: 'ability1',
		reach: 60,
		targets: ['salmon'],
		effect: 'catch',
		ms: 3000,
		score: 0,
		cooldownMs: 1000,
	});
	assert.deepEqual(gameOf().online.rules, {
		zones: [],
		abilities: [],
		round: { nextRoundSeconds: 15, goalScore: 1 },
	});
	const errors = (rules) =>
		validateFamily(normalizeGameConfigDoc(configOf(rules)))
			.filter((i) => i.severity === 'error')
			.map((i) => i.path);
	assert.deepEqual(errors({ zones: [{ zone: 'lake', goal: true }] }), [
		'arcade.online.rules.zones[0]',
	]);
	assert.deepEqual(
		errors({
			abilities: [
				{ character: 'shark', button: 'ability1', reach: 9, targets: ['eel'], effect: 'stun' },
			],
		}),
		['arcade.online.rules.abilities[0].character', 'arcade.online.rules.abilities[0].targets'],
	);
	assert.deepEqual(errors({ module: 'salmons' }), ['arcade.online.rules.module']);
	assert.deepEqual(errors({ module: 'tag' }), []);
	// A refused config makes no room.
	assert.ok('refused' in onlineGameOf(normalizeGameConfigDoc(configOf({ module: 'nope' }))));
});

await check('the rules modules game-config offers are the ones engine-mechanics runs', () => {
	assert.deepEqual([...ONLINE_RULES_MODULE_IDS].sort(), Object.keys(ONLINE_RULES_MODULES).sort());
});

await check('a game with no rules never ends a round and keeps P10.14 behaviour', () => {
	const room = roomOf();
	room.join('a', 'salmon');
	assert.equal(room.sim.rules.phase, 'running');
	room.hold({ a: RIGHT }, 600);
	assert.equal(room.sim.rules.phase, 'running');
	assert.equal(room.sim.rules.round, 1);
	assert.deepEqual(room.of('roundEnd'), []);
});

// --- 2. rounds ----------------------------------------------------------------------------------

await check(
	'the first into the goal wins; the next round starts after the pause, all at the spawn',
	() => {
		const room = roomOf({
			zones: [{ zone: 'source', goal: true, characters: ['salmon'] }],
			round: { nextRoundSeconds: 2, goalScore: 3 },
		});
		const a = room.join('a', 'salmon');
		const b = room.join('b', 'bear');
		assert.deepEqual(room.of('roundStart'), [{ type: 'roundStart', round: 1 }]);
		// The bear gets there first, but the goal is the salmon's.
		b.body.x = 950;
		// 10 px a step from x 100: the salmon's edge reaches the source (x 900) on step 79.
		room.hold({ a: RIGHT }, 85);
		const end = room.of('roundEnd');
		assert.equal(end.length, 1);
		assert.deepEqual(end[0], { type: 'roundEnd', round: 1, winner: 'a' });
		assert.equal(a.score, 3);
		assert.equal(room.sim.rules.phase, 'ended');
		assert.equal(room.sim.rules.winner, 'a');
		const endsAt = room.sim.rules.endsAt;
		// Players still move in the pause (the device's prediction holds), but nothing more is decided.
		room.hold({ a: RIGHT }, endsAt - room.sim.steps - 1);
		assert.equal(room.of('roundEnd').length, 1);
		assert.equal(room.sim.rules.phase, 'ended');
		room.step();
		assert.equal(room.sim.rules.phase, 'running');
		assert.equal(room.sim.rules.round, 2);
		assert.equal(room.sim.rules.winner, '');
		assert.deepEqual([a.score, b.score], [0, 0]);
		assert.deepEqual([a.body.x, a.body.y, b.body.x, b.body.y], [100, 300, 100, 300]);
		assert.deepEqual(room.of('roundStart').at(-1), { type: 'roundStart', round: 2 });
	},
);

await check('a round on the clock ends at its time; the top score wins, a tie wins nobody', () => {
	const rules = {
		abilities: [
			{
				character: 'bear',
				button: 'ability1',
				reach: 80,
				targets: ['salmon'],
				effect: 'stun',
				score: 1,
				ms: 100,
				cooldownMs: 100,
			},
		],
		round: { seconds: 5, nextRoundSeconds: 1 },
	};
	const room = roomOf(rules);
	room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	room.join('c', 'bear');
	room.ready();
	room.hold({ b: SWIPE }, 1);
	assert.equal(b.score, 1);
	room.hold({}, 5 * TICK);
	assert.deepEqual(room.of('roundEnd')[0], { type: 'roundEnd', round: 1, winner: 'b' });
	room.hold({}, TICK + 1);
	assert.equal(room.sim.rules.round, 2);
	room.hold({}, 5 * TICK + 1);
	assert.deepEqual(room.of('roundEnd')[1], { type: 'roundEnd', round: 2, winner: '' });
});

// --- 3. abilities -------------------------------------------------------------------------------

const CATCH = {
	character: 'bear',
	button: 'ability1',
	reach: 60,
	targets: ['salmon'],
	effect: 'catch',
	ms: 1000,
	score: 2,
	cooldownMs: 500,
};

await check(
	'a catch takes the target out, scores, respawns it later; reach, targets and cooldown hold',
	() => {
		const room = roomOf({ abilities: [CATCH] });
		const a = room.join('a', 'salmon');
		const b = room.join('b', 'bear');
		const c = room.join('c', 'bear');
		a.body.x = 400;
		b.body.x = 445;
		c.body.x = 430;
		room.ready();
		room.hold({ b: SWIPE }, 1);
		assert.equal(a.status, STATUS.out);
		assert.equal(c.status, STATUS.free, 'a bear does not catch a bear');
		assert.equal(b.score, 2);
		assert.deepEqual(room.of('caught'), [
			{ type: 'caught', by: 'b', target: 'a', effect: 'catch' },
		]);
		// Out: its inputs are acknowledged, but it goes nowhere.
		const ack = a.ack;
		room.hold({ a: RIGHT }, 10);
		assert.equal(a.ack, ack + 10);
		assert.equal(a.body.x, 400);
		// At its time it is back at the spawn, free.
		room.hold({}, TICK);
		assert.equal(a.status, STATUS.free);
		assert.deepEqual([a.body.x, a.body.y], [100, 300]);
		// Freed, it cannot be caught again at once.
		a.body.x = 300;
		b.body.x = 330;
		room.hold({}, 1);
		room.hold({ b: SWIPE }, 1);
		assert.equal(a.status, STATUS.free, 'a freed player has its grace');
		room.ready();
		// Out of reach: the swipe is used (the devices see it) but catches nobody.
		a.body.x = 300;
		b.body.x = 361 + 0.5;
		room.hold({ b: SWIPE }, 1);
		assert.equal(a.status, STATUS.free);
		assert.equal(room.of('ability').length, 3);
		// Within reach but on cooldown: nothing.
		b.body.x = 330;
		room.hold({ b: SWIPE }, 1);
		assert.equal(a.status, STATUS.free);
		assert.equal(room.of('ability').length, 3);
		room.hold({}, 15);
		room.hold({ b: SWIPE }, 1);
		assert.equal(a.status, STATUS.out);
	},
);

await check('a stun holds the target where it is, then frees it there', () => {
	const room = roomOf({ abilities: [{ ...CATCH, effect: 'stun', ms: 500 }] });
	const a = room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	a.body.x = 400;
	b.body.x = 420;
	room.ready();
	room.hold({ b: SWIPE }, 1);
	assert.equal(a.status, STATUS.stunned);
	assert.deepEqual(room.of('hit'), [{ type: 'hit', by: 'b', target: 'a', effect: 'stun' }]);
	room.hold({ a: RIGHT }, 14);
	assert.equal(a.body.x, 400);
	room.hold({ a: RIGHT }, 2);
	assert.equal(a.status, STATUS.free);
	assert.ok(a.body.x > 400 && a.body.x < 420, String(a.body.x));
});

await check('a hit is tested where its user saw the target, at most the rewind window back', () => {
	const rewindSteps = Math.floor((REWIND_MS * TICK) / 1000);
	/** The salmon swims away from the bear at 10 px a step for `swim` steps; then the bear swipes,
	 *  its device having drawn the salmon at step `view`. */
	const trial = (swim, view) => {
		const room = roomOf({ abilities: [CATCH] });
		const a = room.join('a', 'salmon');
		const b = room.join('b', 'bear');
		a.body.x = 400;
		b.body.x = 400;
		room.ready();
		room.hold({ a: RIGHT }, swim);
		assert.ok(a.body.x - b.body.x > CATCH.reach);
		room.press('a', RIGHT);
		room.press('b', { ...SWIPE, view: view(room.sim.steps) });
		room.step();
		return a.status;
	};
	assert.equal(
		trial(8, (now) => now),
		STATUS.free,
		'where the salmon is now, it is out of reach',
	);
	// The bear's device drew it 4 steps (133 ms) ago, 40 px away: the hit stands.
	assert.equal(
		trial(8, (now) => now - 4),
		STATUS.out,
	);
	// A claim older than the window is held to the window: 20 steps out, it was never that close.
	assert.equal(
		trial(20, () => 5),
		STATUS.free,
		'a view older than the window is not believed',
	);
	assert.equal(
		trial(20, (now) => now - rewindSteps),
		STATUS.free,
	);
	// A view in the future is the present.
	assert.equal(
		trial(8, (now) => now + 50),
		STATUS.free,
	);
});

await check('two abilities pressed in one input both act; two on one button each fire', () => {
	const STUN_BEARS = { ...CATCH, button: 'ability1', targets: ['bear'], effect: 'stun' };
	const CATCH_SALMON = { ...CATCH, button: 'ability2' };
	const room = roomOf({ abilities: [STUN_BEARS, CATCH_SALMON] });
	const a = room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	const c = room.join('c', 'bear');
	for (const p of [a, b, c]) p.body.x = 400;
	room.ready();
	room.hold({ b: { buttons: BUTTONS.ability1 | BUTTONS.ability2 } }, 1);
	assert.deepEqual([a.status, c.status], [STATUS.out, STATUS.stunned]);
	// One button, two entries: each keeps its own cooldown, so both act.
	const room2 = roomOf({ abilities: [STUN_BEARS, { ...CATCH_SALMON, button: 'ability1' }] });
	const a2 = room2.join('a', 'salmon');
	const b2 = room2.join('b', 'bear');
	const c2 = room2.join('c', 'bear');
	for (const p of [a2, b2, c2]) p.body.x = 400;
	room2.ready();
	room2.hold({ b: SWIPE }, 1);
	assert.deepEqual([a2.status, c2.status], [STATUS.out, STATUS.stunned]);
});

await check('a respawned player is never hit where it was before the respawn', () => {
	const room = roomOf({ abilities: [CATCH] });
	const a = room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	a.body.x = 700;
	b.body.x = 700;
	room.ready();
	room.hold({ b: SWIPE }, 1);
	assert.equal(a.status, STATUS.out);
	// It respawns at x 100; the bear stays at the catch and keeps swiping, its device having drawn
	// the salmon there a moment ago.
	while (a.status !== STATUS.free) room.hold({}, 1);
	const back = room.sim.steps;
	assert.deepEqual([a.body.x, b.body.x], [100, 700]);
	room.ready();
	for (let i = 0; i < 20; i++) {
		room.press('a');
		room.press('b', { ...SWIPE, view: back - 1 });
		room.step();
	}
	assert.equal(a.status, STATUS.free, 'caught at the place it left');
	assert.equal(room.of('caught').length, 1);
	// Without the grace: a view from just before the respawn still finds no old place.
	const room2 = roomOf({ abilities: [CATCH] });
	const a2 = room2.join('a', 'salmon');
	const b2 = room2.join('b', 'bear');
	a2.body.x = 700;
	b2.body.x = 700;
	room2.ready();
	room2.hold({ b: SWIPE }, 1);
	while (a2.status !== STATUS.free) room2.hold({}, 1);
	const at = room2.sim.steps;
	a2.safeUntil = 0;
	b2.cooldowns = {};
	room2.press('a');
	room2.press('b', { ...SWIPE, view: at - 1 });
	room2.step();
	assert.equal(a2.status, STATUS.free, 'the rewind found the place it held before its respawn');
});

await check(
	'a rules config cannot ask for unbounded work: huge zones and bodies stay cheap',
	() => {
		const doc = configOf(
			{
				zones: [
					{ zone: 'river', force: { x: -40, y: 0 } },
					{ zone: 'source', goal: true },
				],
				abilities: [{ ...CATCH, cooldownMs: 0 }],
			},
			{ characters: [{ id: 'salmon', body: 'salmon', speed: 300 }, CHARACTERS[1]] },
		);
		doc.arcade.zones = [
			{ id: 'river', x: -1e6, y: -1e6, w: 2e6, h: 2e6 },
			{ id: 'source', x: -1e6, y: 500, w: 2e6, h: 1e6 },
		];
		doc.arcade.bodies.salmon = { shape: 'circle', r: 20_000 };
		const game = onlineGameOf(normalizeGameConfigDoc(doc));
		assert.equal(game.online.rules.abilities[0].cooldownMs, 100, 'a cooldown is at least 100 ms');
		const started = performance.now();
		const sim = createRoomSim(game);
		for (let i = 0; i < 4; i++) sim.join(`p${i}`, { character: i % 2 ? 'bear' : 'salmon' });
		let seq = 0;
		for (let s = 0; s < 600; s++) {
			seq += 1;
			sim.step(() => [clampInput({ seq, moveX: 127, buttons: BUTTONS.ability1 }, game.field)]);
		}
		const ms = performance.now() - started;
		assert.ok(ms < 1500, `600 steps took ${ms} ms`);
	},
);

await check('scores are whole numbers within the limits', () => {
	const game = gameOf({
		abilities: [{ ...CATCH, score: 2.6 }],
		round: { goalScore: 1e9 },
	});
	assert.equal(game.online.rules.abilities[0].score, 3);
	assert.equal(game.online.rules.round.goalScore, 1000);
});

await check(
	'the tag module: "it" passes on a touch, not straight back, and everyone else scores',
	() => {
		const room = roomOf({ module: 'tag', round: { seconds: 60 } });
		const a = room.join('a', 'salmon');
		const b = room.join('b', 'salmon');
		a.body.x = 200;
		b.body.x = 600;
		room.step();
		assert.equal(a.mark, true, 'the first player in is it');
		room.hold({}, TICK * 2);
		assert.ok(b.score >= 2 && a.score === 0, `${a.score} ${b.score}`);
		// It is touching b; after the first second it may pass it on.
		b.body.x = 205;
		room.step();
		assert.deepEqual([a.mark, b.mark], [false, true]);
		assert.deepEqual(room.of('hit').at(-1), { type: 'hit', by: 'a', target: 'b', effect: 'tag' });
		room.hold({}, TICK - 2);
		assert.deepEqual([a.mark, b.mark], [false, true], 'not passed straight back');
		room.hold({}, 3);
		assert.deepEqual([a.mark, b.mark], [true, false]);
		// It leaves: someone else is it.
		room.sim.leave('a');
		room.step();
		assert.equal(b.mark, true);
	},
);

await check('the same inputs replay to the same bodies, scores and events', () => {
	const run = () => {
		const room = roomOf({
			zones: [
				{ zone: 'source', goal: true, characters: ['salmon'] },
				{ zone: 'river', force: { x: -70, y: 10 } },
			],
			abilities: [CATCH, { ...CATCH, button: 'ability2', effect: 'stun', reach: 120 }],
			round: { seconds: 20, nextRoundSeconds: 1 },
		});
		const ids = ['a', 'b', 'c', 'd'];
		ids.forEach((id, i) => room.join(id, i % 2 ? 'bear' : 'salmon'));
		let state = 7;
		const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
		for (let s = 0; s < 3000; s++) {
			for (const id of ids) {
				room.press(id, {
					moveX: Math.round(next() * 254 - 127),
					moveY: Math.round(next() * 254 - 127),
					buttons: next() < 0.1 ? BUTTONS.ability1 : next() < 0.1 ? BUTTONS.ability2 : 0,
				});
			}
			room.step();
		}
		return {
			bodies: [...room.sim.players.values()].map((p) => [p.body.x, p.body.y, p.score, p.status]),
			events: room.events,
		};
	};
	const one = run();
	const two = run();
	assert.deepEqual(one, two);
	const types = new Set(one.events.map((e) => e.type));
	for (const type of ['caught', 'hit', 'ability', 'roundEnd', 'roundStart', 'joined']) {
		assert.ok(types.has(type), `no ${type} in 3 000 steps`);
	}
});

// --- 4. what reaches Flow (P11.2) ---------------------------------------------------------------

// The online events' names against the arcade vocabulary: the launcher's check:flow-variables.
await check("the room values are the ones Flow's variables may mirror", () => {
	assert.deepEqual(SERVER_VALUE_KINDS, SERVER_VARIABLE_SOURCES);
});

await check('room events become Flow signals; the own ability is left to the press', () => {
	const room = roomOf({ abilities: [CATCH], round: { seconds: 5, nextRoundSeconds: 1 } });
	const a = room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	a.body.x = 400;
	b.body.x = 445;
	room.ready();
	room.hold({ b: SWIPE }, 1);
	room.hold({}, 5 * TICK);
	const drawn = (id) => ({
		x: id === 'b' ? 445 : 0,
		y: 300,
		character: id === 'b' ? 'bear' : 'salmon',
	});
	const forA = flowSignalsOf(room.events, 'a', drawn);
	const names = forA.map((s) => s.name);
	assert.deepEqual(names.slice(0, 3), ['roundStart', 'playerJoined', 'playerJoined']);
	assert.ok(names.includes('caught') && names.includes('roundEnd'), JSON.stringify(names));
	assert.deepEqual(forA.find((s) => s.name === 'caught').payload, {
		by: 'b',
		target: 'a',
		effect: 'catch',
		mine: false,
		me: true,
	});
	assert.deepEqual(forA.find((s) => s.name === 'ability').payload, {
		player: 'b',
		character: 'bear',
		button: 'ability1',
		x: 445,
		y: 300,
		mine: false,
		predicted: false,
	});
	// The bear's device raised its swipe on the press; the room's echo of it is not raised again.
	const pressedAt = room.events.findIndex((e) => e.type === 'ability');
	const bear = createAbilityPredictor(room.sim.game, 'bear');
	const forB = flowSignalsOf(room.events.slice(0, pressedAt), 'b', drawn, bear);
	assert.deepEqual(bear.step(BUTTONS.ability1, true), ['ability1']);
	forB.push(...flowSignalsOf(room.events.slice(pressedAt), 'b', drawn, bear));
	assert.ok(!forB.some((s) => s.name === 'ability'), "the bear's own swipe is raised on its press");
	// Without a press it raised (the device thought it held), the room's echo is raised now.
	const unsure = createAbilityPredictor(room.sim.game, 'bear');
	assert.deepEqual(unsure.step(BUTTONS.ability1, false), []);
	assert.deepEqual(
		flowSignalsOf(room.events.slice(pressedAt), 'b', drawn, unsure).find(
			(s) => s.name === 'ability',
		)?.payload,
		{
			player: 'b',
			character: 'bear',
			button: 'ability1',
			x: 445,
			y: 300,
			mine: true,
			predicted: false,
		},
		'a press the room took and the device did not predict is drawn when the room tells',
	);
	assert.equal(forB.find((s) => s.name === 'caught').payload.mine, true);
	assert.deepEqual(forB.find((s) => s.name === 'roundEnd').payload, {
		round: 1,
		winner: 'b',
		won: true,
	});
});

await check("a round's start clears the device's cooldowns, as it clears the room's", () => {
	const room = roomOf({
		abilities: [{ ...CATCH, cooldownMs: 60_000 }],
		round: { seconds: 5, nextRoundSeconds: 0 },
	});
	room.join('a', 'salmon');
	room.join('b', 'bear');
	const bear = createAbilityPredictor(room.sim.game, 'bear');
	const drawn = [];
	let seen = room.events.length;
	for (let i = 0; i < 8 * TICK; i++) {
		// The device presses on what it last saw: the round running.
		const running = room.sim.rules.phase === 'running';
		for (const button of bear.step(BUTTONS.ability1, running))
			drawn.push({ i, button, predicted: true });
		room.press('b', { buttons: BUTTONS.ability1 });
		room.step();
		// The state, then the step's events after it.
		bear.acked(room.sim.players.get('b').ack);
		for (const signal of flowSignalsOf(room.events.slice(seen), 'b', undefined, bear))
			if (signal.name === 'ability') drawn.push({ i, predicted: signal.payload.predicted });
		seen = room.events.length;
	}
	const used = room.of('ability').length;
	assert.equal(used, 2, 'the room takes one swipe a round on a minute-long cooldown');
	assert.deepEqual(
		drawn.map((d) => d.predicted),
		[true, true],
		`each drawn once, on the press: ${JSON.stringify(drawn)}`,
	);
	assert.ok(drawn[1].i > 5 * TICK, 'the second is in round two');
});

await check('server-owned values come from the room: scores, status, round, clock, winner', () => {
	const room = roomOf({ abilities: [CATCH], round: { seconds: 5, nextRoundSeconds: 1 } });
	const a = room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	a.body.x = 400;
	b.body.x = 445;
	room.ready();
	room.hold({ b: SWIPE }, 1);
	const state = () => ({
		step: room.sim.steps,
		phase: room.sim.rules.phase,
		round: room.sim.rules.round,
		endsAt: room.sim.rules.endsAt,
		winner: room.sim.rules.winner,
		players: room.sim.players,
	});
	assert.deepEqual(serverValuesOf(state(), 'b', TICK), {
		score: CATCH.score,
		status: 'free',
		round: 1,
		phase: 'running',
		secondsLeft: Math.ceil((room.sim.rules.endsAt - room.sim.steps) / TICK),
		winner: '',
		won: false,
	});
	const ofA = serverValuesOf(state(), 'a', TICK);
	assert.equal(ofA.status, 'out');
	assert.ok(ofA.secondsLeft >= 3 && ofA.secondsLeft <= 4);
	room.hold({}, 4 * TICK);
	assert.deepEqual(
		[serverValuesOf(state(), 'b', TICK).won, serverValuesOf(state(), 'a', TICK).winner],
		[true, 'b'],
	);
	assert.equal(serverValuesOf({}, 'a', TICK).phase, 'waiting');
});

await check('an out player is hidden until it respawns', () => {
	const room = roomOf({ abilities: [CATCH] });
	const a = room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	a.body.x = 400;
	b.body.x = 445;
	room.ready();
	assert.ok(shownInRoom(a));
	room.hold({ b: SWIPE }, 1);
	assert.equal(shownInRoom(a), false);
	assert.ok(shownInRoom(b));
	room.hold({}, TICK + 1);
	assert.ok(shownInRoom(a), 'respawned, it is drawn again');
	a.status = STATUS.stunned;
	assert.ok(shownInRoom(a), 'a stunned player is still drawn');
});

await check('a predicted ability is raised on the press, at every step the room uses it', () => {
	const room = roomOf({ abilities: [CATCH, { ...CATCH, button: 'ability2', cooldownMs: 300 }] });
	room.join('a', 'salmon');
	const b = room.join('b', 'bear');
	room.ready();
	const bear = createAbilityPredictor(room.sim.game, 'bear');
	const salmon = createAbilityPredictor(room.sim.game, 'salmon');
	const predicted = [];
	const pressed = [];
	for (let i = 0; i < 90; i++) {
		const buttons = (i % 7 < 5 ? BUTTONS.ability1 : 0) | (i % 11 < 3 ? BUTTONS.ability2 : 0);
		const before = room.events.length;
		room.press('b', { buttons });
		room.step();
		pressed.push(...bear.step(buttons, b.status === STATUS.free).map((button) => [i, button]));
		predicted.push(
			...room.events
				.slice(before)
				.filter((e) => e.type === 'ability' && e.by === 'b')
				.map((e) => [i, e.button]),
		);
		assert.deepEqual(salmon.step(buttons, true), [], 'a salmon has no ability');
	}
	assert.ok(pressed.length > 4);
	assert.deepEqual(
		pressed,
		predicted,
		'the device raises each ability on the step the room uses it',
	);
	assert.deepEqual(bear.step(BUTTONS.ability1 | BUTTONS.ability2, false), [], 'not while held');
});

// --- 5. live: a real server ----------------------------------------------------------------------

const freePort = () =>
	new Promise((resolve) => {
		const probe = createServer().listen(0, '127.0.0.1', () => {
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

const dir = mkdtempSync(join(tmpdir(), 'online-rules-'));
writeFileSync(
	join(dir, 'river.json'),
	JSON.stringify(
		configOf({
			zones: [{ zone: 'source', goal: true, characters: ['salmon'] }],
			abilities: [{ ...CATCH, reach: 400 }],
			round: { nextRoundSeconds: 1 },
		}),
	),
);
const port = await freePort();
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 2,
	commit: 'onlinerules0',
	gracefullyShutdown: false,
	trustProxy: true,
	matchmakePerWindow: 120,
});
await server.listen(port);
const client = () => new Client(`ws://127.0.0.1:${port}`);

try {
	const salmon = await client().joinOrCreate(ROOM_NAME, { game: 'river', character: 'salmon' });
	const bear = await client().joinById(salmon.roomId, { character: 'bear' });
	const heard = { salmon: [], bear: [] };
	salmon.onMessage(ONLINE_EVENT, (events) => heard.salmon.push(...events));
	bear.onMessage(ONLINE_EVENT, (events) => heard.bear.push(...events));
	await until('both in the state', () => salmon.state.players?.size === 2);

	await check('live: the devices see the round, a catch, the score and the status', async () => {
		assert.equal(salmon.state.phase, 'running');
		assert.equal(salmon.state.round, 1);
		await wait(GRACE_MS + 100);
		const input = bear.input();
		let seq = 0;
		Object.assign(input.data, { seq: ++seq, buttons: BUTTONS.ability1, view: salmon.state.step });
		input.send();
		await until('the catch', () => heard.salmon.some((e) => e.type === 'caught'));
		// The event comes after the patch that shows it.
		const me = salmon.state.players.get(salmon.sessionId);
		assert.equal(me.status, STATUS.out);
		assert.equal(bear.state.players.get(bear.sessionId).score, CATCH.score);
		// What each device's Flow gets: the catch, its score as a room value, the out salmon hidden.
		assert.deepEqual(
			flowSignalsOf(heard.salmon, salmon.sessionId).find((s) => s.name === 'caught').payload,
			{ by: bear.sessionId, target: salmon.sessionId, effect: 'catch', mine: false, me: true },
		);
		assert.equal(serverValuesOf(bear.state, bear.sessionId, TICK).score, CATCH.score);
		assert.equal(serverValuesOf(salmon.state, salmon.sessionId, TICK).status, 'out');
		assert.equal(shownInRoom(bear.state.players.get(salmon.sessionId)), false);
		assert.deepEqual(
			heard.bear.find((e) => e.type === 'caught'),
			{ type: 'caught', by: bear.sessionId, target: salmon.sessionId, effect: 'catch' },
		);
		await until(
			'the respawn',
			() => salmon.state.players.get(salmon.sessionId).status === STATUS.free,
			3000,
		);
	});

	await check(
		'live: reaching the goal ends the round for everyone, and the next one starts',
		async () => {
			const input = salmon.input();
			let seq = 100;
			const timer = setInterval(() => {
				Object.assign(input.data, { seq: ++seq, moveX: 127, moveY: 0, buttons: 0, view: 0 });
				input.send();
			}, 1000 / TICK);
			try {
				await until('the round end', () => heard.bear.some((e) => e.type === 'roundEnd'), 8000);
			} finally {
				clearInterval(timer);
			}
			assert.deepEqual(
				heard.bear.find((e) => e.type === 'roundEnd'),
				{
					type: 'roundEnd',
					round: 1,
					winner: salmon.sessionId,
				},
			);
			await until(
				'the state',
				() => bear.state.phase === 'ended' && bear.state.winner === salmon.sessionId,
			);
			await until(
				'round two',
				() => bear.state.round === 2 && bear.state.phase === 'running',
				3000,
			);
			assert.ok(heard.salmon.some((e) => e.type === 'roundStart' && e.round === 2));
			assert.deepEqual(
				flowSignalsOf(heard.salmon, salmon.sessionId).find((s) => s.name === 'roundEnd').payload,
				{ round: 1, winner: salmon.sessionId, won: true },
			);
			assert.equal(serverValuesOf(bear.state, bear.sessionId, TICK).round, 2);
		},
	);

	await check('live: a leave is told to the others', async () => {
		await bear.leave();
		await until('left', () =>
			heard.salmon.some((e) => e.type === 'left' && e.id === bear.sessionId),
		);
	});
	await salmon.leave();
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:online-rules — ${passed} checks passed`);
process.exit(0);
