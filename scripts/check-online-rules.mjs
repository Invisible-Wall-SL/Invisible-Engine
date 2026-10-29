// An online room's rules (engine-mechanics onlineRules.js; docs/design/realtime-multiplayer.md §4,
// §6, §8, §12; game-families §9 #18; P10.15): the rules run on the server as the config's data — the
// goal and the clock end a round and the next starts after the pause; an ability catches or stuns
// the players of its targets within reach, off cooldown, tested where its user saw them (held to the
// rewind window); a held player's inputs are taken but move it nowhere; scores live in the room; the
// `tag` rules module; the same inputs replay to the same events — first headless over the room's
// own code, then over a real Colyseus 0.18 server whose devices see the state and the events.
//
// Salmons' own rules (P11.3: engine-mechanics salmonsRules.js and the river's solids) replay its
// recorded traces exactly — the waterfall climb, the sandbank, the line, the golden salmon — and
// rocks and the river stop a player on the device as in the room.
//
// Abilities and zone forces are ONE module (P11.5: engine-mechanics abilities.js): the offline
// arcade loop (engine-game arcadeLoop.ts) and a room, given the same trace, raise the same uses,
// hits and catches on the same steps, hold the same characters out, and push a body through a zone
// to the same place.
//
// Run: pnpm check:online-rules (`-- --record` rewrites fixtures/salmons-traces.json after a
// deliberate change to Salmons' rules or river)

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	BUTTONS,
	clampInput,
	onlineLevel,
	stepContext,
	stepPlayer,
} from '../packages/engine-mechanics/src/online.js';
import { createPredictor } from '../packages/engine-mechanics/src/netcode.js';
import { salmonsConfig, salmonsRiver } from '../packages/engine-mechanics/src/salmons.js';
import { GOLDEN_WORTH, LINE } from '../packages/engine-mechanics/src/salmonsRules.js';
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
	resolveArcade,
} from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createArcadeLoop } from '../packages/engine-game/src/game/arcadeLoop.ts';
import * as abilitiesModule from '../packages/engine-mechanics/src/abilities.js';
import * as onlineRulesModule from '../packages/engine-mechanics/src/onlineRules.js';
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
	assert.deepEqual(errors({ module: 'trout' }), ['arcade.online.rules.module']);
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

// --- 5. Salmons' rules, on recorded traces (P11.3) -------------------------------------------------
//
// Each trace is a room of Salmons (no bots) on one seed's river: who joins, where the test puts
// them, and the inputs each sends, step by step. The room's events, a track of every player every
// ten steps and the end are recorded in packages/engine-mechanics/fixtures/salmons-traces.json; a
// replay must give exactly them. `--record` writes the file again after a deliberate change.

const TRACES_FILE = join(ROOT, 'packages/engine-mechanics/fixtures/salmons-traces.json');
const RECORD = process.argv.includes('--record');
const JUMP = BUTTONS.jump;
const salmonsGame = (() => {
	const doc = salmonsConfig();
	doc.arcade.online.bots.fillTo = 0;
	const game = onlineGameOf(normalizeGameConfigDoc(doc));
	assert.ok(game && !('refused' in game), 'Salmons is an online game');
	return game;
})();
const thousandths = (v) => Math.round(v * 1000) / 1000;

/** Play a trace and return what the room did: its events, a track and the end. */
function playTrace(trace) {
	const sim = createRoomSim(salmonsGame, { seed: trace.seed });
	for (const [id, character] of trace.joins) sim.join(id, { character });
	for (const [id, x, y] of trace.place) Object.assign(sim.players.get(id).body, { x, y });
	const events = sim
		.events()
		.filter((e) => e.type !== 'joined')
		.map((e) => ({ step: 0, ...e }));
	const track = [];
	const seqs = new Map();
	for (let step = 1; step <= trace.steps; step++) {
		for (const [at, id] of trace.leaves ?? []) if (at === step) sim.leave(id);
		const got = sim.step((id) => {
			const run = trace.runs.find((r) => r[0] === id && step >= r[1] && step <= r[2]);
			const [, , , moveX = 0, moveY = 0, buttons = 0, every = 0] = run ?? [];
			const seq = (seqs.get(id) ?? 0) + 1;
			seqs.set(id, seq);
			const press = !every || step % every === 0 ? buttons : 0;
			return [clampInput({ seq, view: sim.steps, moveX, moveY, buttons: press }, sim.game.field)];
		});
		for (const e of got) events.push({ step, ...e });
		if (step % 10 === 0)
			track.push([
				step,
				...[...sim.players.values()].map((p) => [
					p.id,
					thousandths(p.body.x),
					thousandths(p.body.y),
					p.status,
				]),
			]);
	}
	const end = Object.fromEntries(
		[...sim.players.values()].map((p) => [
			p.id,
			{
				x: thousandths(p.body.x),
				y: thousandths(p.body.y),
				status: p.status,
				score: p.score,
				golden: p.mark,
			},
		]),
	);
	return { events, track, end };
}

const at = (result, id, step) => {
	const row = result.track.find((r) => r[0] === step);
	const [, x, y, status] = row.slice(1).find((p) => p[0] === id);
	return { x, y, status };
};

/** Where in a band's water a salmon can swim straight up past its top, clear of its rock. */
const clearX = (river, band) => {
	const mid = (band.left + band.right) / 2;
	const rock = river.rocks.find((r) => r.y < band.y + band.h && r.y + r.h > band.y);
	if (!rock || mid < rock.x - 60 || mid > rock.x + rock.w + 60) return mid;
	return rock.x - band.left > band.right - rock.x - rock.w ? rock.x - 70 : rock.x + rock.w + 70;
};

const TRACES = (() => {
	const river = salmonsRiver(3);
	const fall = river.waterfalls[0];
	const below = river.bands.find((b) => b.y === fall.y + fall.h / 2);
	const sand = river.sandbanks[0];
	const lineBand = river.bands[6];
	const mid = lineBand.y + lineBand.h / 2;
	const goldBand = salmonsRiver(4).bands[6];
	const goldY = goldBand.y + goldBand.h / 2;
	// -32 of 127 of a salmon's 240 px/s holds it against the 60 px/s current.
	const HOVER = -32;
	return {
		climb: {
			seed: 3,
			joins: [['s', 'salmon']],
			place: [['s', clearX(river, below), fall.y + fall.h + 22 + 40]],
			runs: [
				['s', 1, 40, 0, -127],
				['s', 41, 80, 0, -127, JUMP, 2],
				['s', 81, 120, 0, 127, JUMP, 2],
			],
			steps: 120,
		},
		sandbank: {
			seed: 3,
			joins: [['s', 'salmon']],
			place: [['s', sand.x + sand.w / 2, sand.y + sand.h + 40]],
			runs: [
				['s', 1, 50, 0, -127],
				['s', 51, 51, 0, -127, JUMP],
				['s', 52, 90, 0, -127],
			],
			steps: 90,
		},
		line: {
			seed: 3,
			joins: [
				['f', 'fisherman'],
				['a', 'salmon'],
				['b', 'salmon'],
			],
			place: [
				['f', lineBand.left - 60, mid],
				['a', lineBand.left + 120, mid],
				['b', lineBand.left + 180, mid],
			],
			runs: [
				['f', 31, 31, 0, 0, BUTTONS.ability1],
				['f', 140, 140, 0, 0, BUTTONS.ability1],
				['a', 1, 30, 0, HOVER],
				['b', 1, 140, 0, HOVER],
				['b', 141, 170, 0, 0, JUMP, 2],
			],
			steps: 200,
		},
		golden: {
			seed: 4,
			joins: [
				['k', 'bear'],
				['a', 'salmon'],
				['b', 'salmon'],
				['c', 'salmon'],
			],
			place: [
				['k', goldBand.left - 50, goldY],
				['a', goldBand.left + 50, goldY],
				['b', goldBand.left + 50, goldY - 35],
				['c', goldBand.left + 50, goldY + 35],
			],
			runs: [
				['a', 1, 34, 0, HOVER],
				['b', 1, 34, 0, HOVER],
				['c', 1, 34, 0, HOVER],
				['k', 35, 35, 0, 0, BUTTONS.ability1],
			],
			steps: 80,
		},
	};
})();
// The golden salmon leaves at step 60: which one it is, the seed decides.
TRACES.golden.leaves = [
	[60, playTrace({ ...TRACES.golden, steps: 1 }).events.find((e) => e.type === 'golden').id],
];

const played = Object.fromEntries(
	Object.entries(TRACES).map(([name, trace]) => [name, { trace, result: playTrace(trace) }]),
);
if (RECORD) writeFileSync(TRACES_FILE, `${JSON.stringify(played, null, '\t')}\n`);
const recorded = JSON.parse(readFileSync(TRACES_FILE, 'utf8'));

await check('Salmons: every recorded trace replays exactly, and twice the same', () => {
	assert.deepEqual(Object.keys(recorded).sort(), Object.keys(TRACES).sort());
	for (const [name, { trace, result }] of Object.entries(played)) {
		assert.deepEqual(trace, recorded[name].trace, `${name}: the trace is the recorded one`);
		assert.deepEqual(result, recorded[name].result, `${name}: the room did what it did`);
		assert.deepEqual(playTrace(trace), result, `${name}: replays the same`);
	}
});

await check(
	'Salmons: a waterfall stops a salmon from below; tapping climbs it; down it passes',
	() => {
		const { trace, result } = played.climb;
		const fall = salmonsRiver(trace.seed).waterfalls[0];
		const foot = fall.y + fall.h + 22;
		assert.ok(Math.abs(at(result, 's', 40).y - foot) < 1e-3, 'held up at the foot');
		const climbed = result.events.filter((e) => e.type === 'climbed');
		assert.equal(climbed.length, 1);
		assert.ok(climbed[0].step > 41 && climbed[0].step <= 60, `climbed at ${climbed[0].step}`);
		assert.equal(climbed[0].zone, 'waterfall0');
		assert.ok(at(result, 's', 80).y < fall.y, 'above the waterfall');
		assert.ok(result.end.s.y > fall.y + fall.h, 'swimming down, it passes back through');
	},
);

await check('Salmons: a sandbank grounds a salmon until it jumps, and not again on it', () => {
	const { trace, result } = played.sandbank;
	const sand = salmonsRiver(trace.seed).sandbanks[0];
	const grounded = result.events.filter((e) => e.type === 'grounded');
	assert.equal(grounded.length, 1, 'grounded once');
	assert.ok(grounded[0].step < 40);
	assert.deepEqual(at(result, 's', 40), at(result, 's', 50), 'held still, pressing up');
	assert.equal(at(result, 's', 50).status, STATUS.grounded);
	assert.deepEqual(
		result.events.filter((e) => e.type === 'jumped').map((e) => e.step),
		[51],
	);
	assert.ok(result.end.s.y < sand.y, 'it swam off the sand upstream');
	assert.equal(result.end.s.status, STATUS.free);
});

await check(
	'Salmons: the line hooks the nearest salmon, reels it in and lands it; one escapes',
	() => {
		const { result } = played.line;
		const kinds = result.events
			.filter((e) => ['hooked', 'caught', 'escaped'].includes(e.type))
			.map((e) => [e.type, e.by, e.target, e.effect ?? '']);
		assert.deepEqual(kinds, [
			['hooked', 'f', 'a', ''],
			['caught', 'f', 'a', 'hook'],
			['hooked', 'f', 'b', ''],
			['escaped', 'f', 'b', ''],
		]);
		const hooked = result.events.find((e) => e.type === 'hooked');
		assert.equal(hooked.step, 31);
		assert.equal(at(result, 'a', 40).status, STATUS.hooked);
		assert.ok(at(result, 'a', 40).x < at(result, 'a', 30).x, 'reeled towards the bank');
		const golden = result.events.filter((e) => e.type === 'golden').map((e) => e.id);
		const worth = golden[0] === 'a' ? GOLDEN_WORTH : 1;
		assert.equal(result.end.f.score, 2 * worth, 'the cast’s score, at the landing');
		assert.equal(result.end.b.status, STATUS.free);
		assert.ok(LINE.escapeTaps === 5);
	},
);

await check('Salmons: one golden salmon, worth more; it passes on when it leaves', () => {
	const { trace, result } = played.golden;
	const golden = result.events.filter((e) => e.type === 'golden');
	assert.equal(golden[0].step, 1);
	const first = golden[0].id;
	assert.equal(trace.leaves[0][1], first);
	const caught = result.events.filter((e) => e.type === 'caught' && e.by === 'k');
	assert.deepEqual(caught.map((e) => e.target).sort(), ['a', 'b', 'c']);
	assert.equal(result.end.k.score, GOLDEN_WORTH + 1 + 1);
	assert.equal(golden.length, 2);
	assert.ok(golden[1].step >= 60 && golden[1].id !== first, 'another salmon is golden');
	assert.equal(result.end[golden[1].id].golden, true);
	assert.equal(Object.values(result.end).filter((p) => p.golden).length, 1);
});

await check(
	'Salmons: rocks and the river are solids a device predicts as the room moves them',
	() => {
		const river = salmonsRiver(3);
		const rock = river.rocks[0];
		const sim = createRoomSim(salmonsGame, { seed: 3 });
		const fish = sim.join('s', { character: 'salmon' });
		const bear = sim.join('k', { character: 'bear' });
		const band = river.bands.find((b) => rock.y >= b.y && rock.y < b.y + b.h);
		Object.assign(fish.body, { x: rock.x + rock.w / 2, y: rock.y + rock.h + 22 + 30 });
		Object.assign(bear.body, { x: band.left - 60, y: band.y + band.h / 2 });
		const device = (player) =>
			createPredictor({
				body: { ...player.body, tags: [...player.body.tags] },
				speed: player.character.speed,
				ctx: sim.ctx,
				field: sim.game.field,
				level: onlineLevel(
					sim.game.zones,
					sim.game.online.rules.zones,
					player.character.id,
					sim.game.field,
				),
			});
		const devices = { s: device(fish), k: device(bear) };
		const moves = { s: { moveY: -127 }, k: { moveX: 127 } };
		for (let seq = 1; seq <= 40; seq++) {
			const inputs = {};
			for (const id of ['s', 'k']) {
				inputs[id] = clampInput({ seq, view: sim.steps, ...moves[id] }, sim.game.field);
				devices[id].input(inputs[id]);
			}
			sim.step((id) => [inputs[id]]);
		}
		assert.ok(Math.abs(fish.body.y - (rock.y + rock.h + 22)) < 1e-6, 'stopped under the rock');
		assert.ok(Math.abs(bear.body.x - (band.left - 46)) < 1e-6, 'the bear stopped at the water');
		for (const [id, player] of [
			['s', fish],
			['k', bear],
		]) {
			assert.equal(devices[id].body.x, player.body.x, `${id}: the device's x is the room's`);
			assert.equal(devices[id].body.y, player.body.y, `${id}: the device's y is the room's`);
		}
	},
);

// --- 5b. one ability module, both loops (P11.5) -----------------------------------------------

/** A live set for the offline loop: instances placed by hand, in spawn order. */
const liveSetOf = (instances) => {
	const byId = new Map(instances.map((i) => [i.id, { ...i, layer: 'field' }]));
	return {
		live: () => [...byId.values()],
		get: (id) => byId.get(id),
		subscribe(layer, listener) {
			listener([...byId.values()]);
			return () => {};
		},
		move(moves) {
			for (const { id, x, y } of moves) Object.assign(byId.get(id) ?? {}, { x, y });
		},
		layer: () => ({}),
		despawn: (id) => byId.delete(id),
	};
};

/** The offline loop over `doc`'s arcade block, at the room's rate, with held actions per step. */
const offlineOf = (doc, instances) => {
	const held = new Set();
	const signals = [];
	const rules = resolveArcade(normalizeGameConfigDoc(doc));
	const loop = createArcadeLoop({
		rules,
		field: () => rules.field,
		layers: () => ['field'],
		live: liveSetOf(instances),
		signal: (name, payload) => signals.push({ step: loop.steps, name, payload }),
		seed: 1,
		input: { held: (action) => held.has(action), pointer: () => undefined },
	});
	return {
		loop,
		signals,
		step(actions = []) {
			held.clear();
			for (const a of actions) held.add(a);
			assert.equal(loop.frame(1000 / rules.fixedHz), 1, 'one step a frame');
		},
	};
};

await check(
	'abilities and zone forces are one module: the room calls it, game-config agrees',
	() => {
		assert.equal(onlineRulesModule.STATUS, abilitiesModule.STATUS);
		assert.equal(onlineRulesModule.GRACE_MS, abilitiesModule.GRACE_MS);
		const source = readFileSync(join(ROOT, 'packages/engine-mechanics/src/onlineRules.js'), 'utf8');
		assert.match(source, /useAbilities\(player, stamp, abilities/);
		assert.match(source, /endStatuses\(players, stamp, grace, respawn\)/);
		assert.doesNotMatch(source, /target\.status = ability\.effect/, 'no second copy of the hit');
		const online = readFileSync(join(ROOT, 'packages/engine-mechanics/src/online.js'), 'utf8');
		assert.match(online, /addZoneForces\(body, currents\)/);
		const loop = readFileSync(
			join(ROOT, 'packages/engine-game/src/game/arcadeAbilities.ts'),
			'utf8',
		);
		assert.match(loop, /useAbilities\(user, stamp, specs/);
		assert.match(loop, /endStatuses\(list, stamp, grace/);
	},
);

const ABILITY_TRACE = (() => {
	// The bear presses on these steps (after the room's join grace): a stun on both salmon, a press
	// on cooldown, a catch of the near one once their grace is over, a stun of the far one, both
	// buttons on cooldown, and a stun while every salmon is safe after its status.
	const presses = new Map([
		[31, ['ability1']],
		[32, ['ability1']],
		[80, ['ability2']],
		[85, ['ability1']],
		[86, ['ability1', 'ability2']],
		[110, ['ability1']],
	]);
	return { presses, steps: 120 };
})();
const TRACE_ABILITIES = [
	{
		character: 'bear',
		button: 'ability1',
		reach: 60,
		targets: ['salmon'],
		effect: 'stun',
		ms: 500,
		cooldownMs: 700,
	},
	{
		character: 'bear',
		button: 'ability2',
		reach: 40,
		targets: ['salmon'],
		effect: 'catch',
		ms: 600,
		cooldownMs: 1000,
		score: 2,
	},
];
const PLACES = { a: { x: 400, y: 300 }, b: { x: 430, y: 300 }, c: { x: 480, y: 300 } };

await check(
	'offline and online abilities agree: the same trace raises the same events on the same steps',
	() => {
		const room = roomOf({ abilities: TRACE_ABILITIES });
		const players = {
			a: room.join('a', 'salmon'),
			b: room.join('b', 'bear'),
			c: room.join('c', 'salmon'),
		};
		for (const [id, at] of Object.entries(PLACES)) Object.assign(players[id].body, at);
		const onlineTrace = [];
		const onlineOut = [];
		const bit = { ability1: BUTTONS.ability1, ability2: BUTTONS.ability2 };
		for (let step = 1; step <= ABILITY_TRACE.steps; step++) {
			const pressed = ABILITY_TRACE.presses.get(step) ?? [];
			const before = room.events.length;
			room.hold({ b: { buttons: pressed.reduce((m, a) => m | bit[a], 0) } }, 1);
			for (const e of room.events.slice(before)) {
				if (e.type === 'ability') onlineTrace.push([step, 'ability', e.by, e.button]);
				if (e.type === 'hit' || e.type === 'caught')
					onlineTrace.push([step, e.type, e.by, e.target, e.effect]);
			}
			onlineOut.push(
				[...room.sim.players.values()]
					.filter((p) => p.status === STATUS.out)
					.map((p) => p.id)
					.join(),
			);
		}

		const doc = {
			family: 'arcade',
			outcome: 'rules',
			gameName: 'Abilities',
			arcade: {
				field: FIELD,
				fixedHz: TICK,
				bodies: {
					salmonLook: { shape: 'circle', r: 10, tags: ['player'] },
					bearLook: { shape: 'circle', r: 20, tags: ['player'] },
				},
				characters: [
					{ id: 'salmon', component: 'salmonLook' },
					{ id: 'bear', component: 'bearLook', controller: { kind: 'topDown', speed: 300 } },
				],
				abilities: TRACE_ABILITIES,
			},
		};
		assert.deepEqual(validateFamily(normalizeGameConfigDoc(doc)), []);
		const offline = offlineOf(doc, [
			{ id: 'a', componentId: 'salmonLook', ...PLACES.a },
			{ id: 'b', componentId: 'bearLook', ...PLACES.b },
			{ id: 'c', componentId: 'salmonLook', ...PLACES.c },
		]);
		// The room's players start with its join grace and the loop's with none: idle through it.
		const start = room.sim.steps - ABILITY_TRACE.steps;
		for (let i = 0; i < start; i++) offline.step();
		const offlineOut = [];
		for (let step = 1; step <= ABILITY_TRACE.steps; step++) {
			offline.step(ABILITY_TRACE.presses.get(step) ?? []);
			offlineOut.push([...offline.loop.culled()].sort().join());
		}
		const offlineTrace = offline.signals.map(({ step, name, payload }) =>
			name === 'ability'
				? [step - start, name, payload.player, payload.button]
				: [step - start, name, payload.by, payload.target, payload.effect],
		);
		assert.ok(
			onlineTrace.some((e) => e[1] === 'caught') && onlineTrace.some((e) => e[1] === 'hit'),
		);
		assert.deepEqual(offlineTrace, onlineTrace);
		assert.deepEqual(offlineOut, onlineOut);
		const caught = offline.signals.find((s) => s.name === 'caught');
		assert.equal(caught.payload.points, 2);
		assert.equal(caught.payload.targetInstance.id, 'a');
		assert.equal(caught.payload.mine, true);
	},
);

await check(
	'offline and online zone forces agree: a body swims through a current to the same place',
	() => {
		const zones = [{ id: 'current', x: 300, y: 200, w: 200, h: 200 }];
		const force = { x: -120, y: 35 };
		const level = onlineLevel(zones, [{ zone: 'current', force }], 'salmon', FIELD);
		const ctx = stepContext(TICK, 1);
		const body = { id: 's', shape: 'circle', r: 10, x: 250, y: 300, vx: 0, vy: 0 };
		const doc = {
			family: 'arcade',
			outcome: 'rules',
			gameName: 'Forces',
			arcade: {
				field: FIELD,
				fixedHz: TICK,
				bodies: { salmonLook: { shape: 'circle', r: 10 } },
				zones,
				characters: [
					{ id: 'salmon', component: 'salmonLook', controller: { kind: 'topDown', speed: 300 } },
				],
				forces: [{ zone: 'current', force }],
			},
		};
		assert.deepEqual(validateFamily(normalizeGameConfigDoc(doc)), []);
		const offline = offlineOf(doc, [{ id: 's', componentId: 'salmonLook', x: 250, y: 300 }]);
		for (let i = 0; i < 60; i++) {
			stepPlayer(body, clampInput({ seq: i + 1, moveX: 127 }, FIELD), 300, ctx, FIELD, level);
			offline.step(['right']);
			const [own] = offline.loop.bodies();
			assert.ok(
				Math.abs(own.x - body.x) < 1e-9 && Math.abs(own.y - body.y) < 1e-9,
				`step ${i + 1}`,
			);
		}
		assert.ok(body.y > 300 && body.x < 250 + 300 * 2, 'the current pushed it');
		const [own] = offline.loop.bodies();
		assert.equal(own.vx, 300, 'the push is taken off after the move');
	},
);

await check(
	'a zone force with characters pushes only them; one with none pushes every body',
	() => {
		const zones = [{ id: 'wind', x: 0, y: 0, w: 1000, h: 600 }];
		const doc = (characters) => ({
			family: 'arcade',
			outcome: 'rules',
			gameName: 'Wind',
			arcade: {
				field: FIELD,
				bodies: { leaf: { shape: 'circle', r: 5 }, kite: { shape: 'circle', r: 5 } },
				zones,
				characters: [{ id: 'kite', component: 'kite' }],
				forces: [{ zone: 'wind', force: { x: 60, y: 0 }, ...(characters ? { characters } : {}) }],
			},
		});
		const at = (d) => {
			const offline = offlineOf(d, [
				{ id: 'leaf', componentId: 'leaf', x: 100, y: 100 },
				{ id: 'kite', componentId: 'kite', x: 100, y: 200 },
			]);
			for (let i = 0; i < 60; i++) offline.step();
			return Object.fromEntries(offline.loop.bodies().map((b) => [b.id, b.x]));
		};
		const all = at(doc());
		assert.ok(all.leaf > 150 && all.kite > 150, JSON.stringify(all));
		const kites = at(doc(['kite']));
		assert.equal(kites.leaf, 100);
		assert.equal(kites.kite, all.kite);
	},
);

// --- 6. live: a real server ----------------------------------------------------------------------

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
