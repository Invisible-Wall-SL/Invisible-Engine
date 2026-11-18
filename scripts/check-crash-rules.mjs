// Crash, the rules of an online 3D room (engine-mechanics crashRules.js, run by services/game-server
// roomSim3d.ts; docs/design/3d/gameplay-evaluation.md §3, §6 steps 3–4). Seeded scripts through the
// real room sim prove: the config's defaults are BOTY's and a bad block is refused by path; teams
// balance; carry → throw → pit → score for the last carrier's team, the pit rises, the piece comes
// back; death → corpse → carried → scored → respawn after 3 s; melee hits by the attacker's rewound
// view (and not past REWIND_MS) and knocks back, and a device that applies the knockback as an
// impulse predicts the room bit for bit; hitscan is stopped by the level and climbs a tier with
// pitch; projectiles fly, are stopped by walls and splash; the void and the death plane kill without
// a corpse; the round clock ends and restarts the round; the whole room replays bit for bit by seed.
// A device's side: the events become Flow signals and the state the room-owned variables; the
// stage's room view takes a knockback with no correction and hides the dead. Then a real Colyseus server with two `@colyseus/sdk` clients: one carries a piece into the pit and
// both see the score.
//
// Run: pnpm check:crash-rules

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	BOTY_HEROES,
	BOTY_WEAPONS,
	CRASH_DEFAULTS,
	REWIND_MS,
	STATUS3D,
	crashRulesOf,
	rayCylinder,
	rayLevel3d,
} from '../packages/engine-mechanics/src/crashRules.js';
import {
	CRASH_FLOW_EVENTS,
	crashFlowSignalsOf,
	crashServerValuesOf,
} from '../packages/engine-mechanics/src/crashFlow.js';
import {
	createBody3d,
	createLevel3d,
	hashBodies3d,
} from '../packages/engine-mechanics/src/motion3d.js';
import {
	ANIM3D,
	BUTTONS3D,
	clampInput3d,
	createPredictor3d,
	world3dOf,
} from '../packages/engine-mechanics/src/online3d.js';
import { createRoomView3d } from '../packages/engine-3d/src/pure/roomView.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim3d } from '../services/game-server/src/roomSim3d.ts';
import { ROOM_NAME_3D, createGameServer } from '../services/game-server/src/server.ts';

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
/** A floor with a 4 × 4 m hole at (10, 0) over the pit, a 3 m tier, a wall, a void box. */
const LEVEL = {
	colliders: [
		box(-20, -1, -20, 8, 0, 20),
		box(12, -1, -20, 20, 0, 20),
		box(8, -1, -20, 12, 0, -2),
		box(8, -1, 2, 12, 0, 20),
		box(-15, 0, -15, -5, 3, -5),
		box(-10, 0, 8, -9, 3, 12),
	],
	zones: [
		{ kind: 'pit', minX: 8, minY: -9, minZ: -2, maxX: 12, maxY: -0.5, maxZ: 2 },
		{ kind: 'void', minX: -19, minY: 0, minZ: 15, maxX: -16, maxY: 2, maxZ: 18 },
	],
	killY: -10,
};
const SPAWNS = [
	{ x: 1, z: 0 },
	{ x: 0, z: 4 },
	{ x: -2, z: -2 },
	{ x: -4, z: 2 },
];
const CHASE = {
	initial: 'hunt',
	states: [{ id: 'hunt', behaviour: 'chase', params: { tag: 'player', range: 500, speed: 4 } }],
	transitions: [],
};
const configOf = ({ rules = {}, online = {} } = {}) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Crash',
	arcade: {
		field: { w: 40, h: 40 },
		bodies: {
			hero: { shape: 'circle', r: 0.4, tags: ['player'] },
			brute: { shape: 'circle', r: 0.4, tags: ['bot'] },
		},
		characters: [{ id: 'chaser', component: 'brute', brain: CHASE }],
		online: {
			characters: [
				{ id: 'Warrior', body: 'hero', speed: 5 },
				{ id: 'Gunmen', body: 'hero', speed: 5 },
				{ id: 'Cleric', body: 'hero', speed: 5 },
				{ id: 'brute', body: 'brute', speed: 4 },
			],
			...online,
		},
		world3d: {
			level: LEVEL,
			spawns: SPAWNS,
			rules: { module: 'crash', pieces: [{ x: 2.5, y: 0, z: 0 }], ...rules },
		},
	},
});
const gameOf = (config) => {
	const game = onlineGameOf(normalizeGameConfigDoc(config));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};
const roomOf = (config, seed = 7) =>
	createRoomSim3d(gameOf(config), world3dOf(config.arcade.world3d), {
		seed,
		rules: crashRulesOf(config.arcade.world3d.rules),
	});

/** Yaws (uint16) that face along the world axes: forward is (−sin θ, −cos θ). */
const YAW = { '-z': 0, '-x': 16384, '+z': 32768, '+x': 49152 };

/** A scripted table: each joined id gets one input a step from `inputs[id]` (a function of the step,
 *  or a fixed input); every event is kept. */
const tableOf = (room) => {
	const seqs = new Map();
	const inputs = new Map();
	const log = [];
	log.push(...room.events());
	const step = (n = 1) => {
		for (let i = 0; i < n; i++) {
			const at = room.steps;
			log.push(
				...room.step((id) => {
					const make = inputs.get(id);
					if (!make) return [];
					const seq = (seqs.get(id) ?? 0) + 1;
					seqs.set(id, seq);
					const raw = typeof make === 'function' ? make(at) : make;
					return [clampInput3d({ view: at, ...raw, seq })];
				}),
			);
		}
	};
	return {
		log,
		inputs,
		step,
		join(id, character, input = {}) {
			room.join(id, { name: id, character });
			log.push(...room.events());
			inputs.set(id, input);
			return room.players.get(id);
		},
		of: (type) => log.filter((e) => e.type === type),
		place(id, x, y, z) {
			Object.assign(room.players.get(id).body, createBody3d({ x, y, z }));
		},
	};
};

const crashOnly = (online = {}) => ({ online: { maxPlayers: 16, ...online } });

// --- 1. the config ---------------------------------------------------------------------------

console.log('1. the config');
await check('the defaults are BOTY’s numbers; heroes and weapons read off its assets', () => {
	const rules = crashRulesOf({ module: 'crash' });
	assert.equal(rules.roundSeconds, 180);
	assert.equal(rules.interactRange, 2.5);
	assert.equal(rules.pitRise, 0.1);
	assert.equal(rules.pitMax, 5);
	assert.equal(rules.corpseScoredSeconds, 3);
	assert.equal(rules.corpseSeconds, 10);
	assert.deepEqual(rules.corpseTeams, [0]);
	assert.deepEqual(rules.killScore, [1, 0]);
	assert.equal(rules.weapons.Barbarian_Sword.type, 'melee');
	assert.equal(rules.weapons.Barbarian_Sword.damage, 50);
	assert.equal(rules.weapons.Barbarian_Sword.range, 2);
	assert.equal(rules.weapons.Barbarian_Sword.fireRate, 0.5);
	assert.equal(rules.weapons.Rifle.type, 'hitscan');
	assert.equal(rules.weapons.Bow.projectileSpeed, 30);
	assert.equal(rules.heroes.Warrior.maxHealth, 100);
	assert.equal(rules.heroes.Gunmen.maxShields, 5);
	assert.deepEqual(Object.keys(rules.heroes).sort(), Object.keys(BOTY_HEROES).sort());
	assert.deepEqual(Object.keys(rules.weapons).sort(), Object.keys(BOTY_WEAPONS).sort());
	assert.equal(crashRulesOf(undefined), undefined);
	assert.equal(CRASH_DEFAULTS.roundSeconds, 180);
});
await check('a bad block is refused by its path', () => {
	const bad = [
		[{ module: 'tag' }, 'rules.module'],
		[{ module: 'crash', roundSeconds: 0 }, 'rules.roundSeconds'],
		[{ module: 'crash', corpseTeams: [2] }, 'rules.corpseTeams'],
		[{ module: 'crash', killScore: [1] }, 'rules.killScore'],
		[{ module: 'crash', pieces: [{ x: 'a' }] }, 'rules.pieces.0.x'],
		[{ module: 'crash', weapons: { W: { type: 'laser' } } }, 'rules.weapons.W.type'],
		[{ module: 'crash', weapons: { W: { type: 'melee', arc: 400 } } }, 'rules.weapons.W.arc'],
		[
			{ module: 'crash', heroes: { H: { startingWeapons: ['Nope'] } } },
			'rules.heroes.H.startingWeapons',
		],
		[{ module: 'crash', defaultHero: 'Nobody' }, 'rules.defaultHero'],
	];
	for (const [raw, path] of bad)
		assert.throws(
			() => crashRulesOf(raw),
			(e) => e.message.includes(path),
			path,
		);
});

// --- 2. teams, carry, pit ---------------------------------------------------------------------

console.log('2. teams, carry, the pit');
await check('a joiner takes the smaller team, red on a tie (BOTY redCount <= blueCount)', () => {
	const room = roomOf(configOf(crashOnly()));
	const t = tableOf(room);
	const teams = ['a', 'b', 'c', 'd', 'e'].map((id) => t.join(id, 'Warrior').team);
	assert.deepEqual(teams, [0, 1, 0, 1, 0]);
	assert.equal(room.phase, 'running');
	assert.equal(room.rules.round, 1);
	assert.equal(t.of('roundStart').length, 1);
	assert.equal(room.players.get('a').hp, 100);
	assert.equal(room.players.get('a').weapon, 'Barbarian_Sword');
});
await check(
	'carry → throw → pit: the last carrier’s team scores, the pit rises, the piece returns',
	() => {
		const room = roomOf(configOf(crashOnly()));
		const t = tableOf(room);
		const ann = t.join('ann', 'Warrior');
		t.step(10);
		const [piece] = room.rules.entities.values();
		assert.equal(piece.kind, 'piece');
		t.inputs.set('ann', { buttons: BUTTONS3D.interact, yaw: YAW['+x'] });
		t.step(1);
		assert.equal(t.of('picked').length, 1);
		assert.equal(ann.carrying, piece.id);
		assert.equal(piece.carriedBy, 'ann');
		t.inputs.set('ann', { yaw: YAW['+x'] });
		t.step(2);
		assert.ok(ann.anim & ANIM3D.carrying, 'the carrier’s anim shows it');
		assert.ok(
			Math.abs(piece.body.y - (ann.body.y + 2)) < 1e-9,
			'the piece rides above its carrier',
		);
		t.inputs.set('ann', { buttons: BUTTONS3D.interact, yaw: YAW['+x'] });
		t.step(1);
		assert.equal(t.of('thrown').length, 1);
		assert.equal(ann.carrying, '');
		t.inputs.set('ann', { yaw: YAW['+x'] });
		for (let i = 0; i < 120 && !t.of('pieceScored').length; i++) t.step(1);
		const [scored] = t.of('pieceScored');
		assert.ok(scored, 'the piece reached the pit');
		assert.deepEqual(
			{
				team: scored.team,
				by: scored.by,
				points: scored.points,
				red: scored.red,
				blue: scored.blue,
			},
			{ team: 'red', by: 'ann', points: 1, red: 1, blue: 0 },
		);
		assert.deepEqual([...room.rules.scores], [1, 0]);
		assert.equal(room.rules.pitLevel, 0.1);
		assert.equal(t.of('pitRise')[0].level, 0.1);
		assert.equal(room.rules.entities.size, 0, 'a scored piece is gone');
		t.step(30 * 5);
		assert.equal(room.rules.entities.size, 1, 'and back at its spawn after pieceRespawnSeconds');
		assert.ok(!(ann.anim & ANIM3D.carrying));
	},
);
await check('the pit rises at most to pitMax', () => {
	const room = roomOf(
		configOf({ ...crashOnly(), rules: { pitRise: 3, pitMax: 5, pieceRespawnSeconds: 0.1 } }),
	);
	const t = tableOf(room);
	t.join('ann', 'Warrior');
	t.step(5);
	for (let n = 0; n < 2; n++) {
		const piece = [...room.rules.entities.values()][0];
		Object.assign(piece.body, createBody3d({ x: 10, y: 0.5, z: 0 }));
		piece.asleep = false;
		piece.lastTeam = 1;
		piece.lastCarrier = 'ann';
		t.step(40);
	}
	assert.deepEqual([...room.rules.scores], [0, 2]);
	assert.equal(room.rules.pitLevel, 5);
});

// --- 3. combat, death, corpse -----------------------------------------------------------------

console.log('3. combat, death, the corpse');
await check(
	'melee: two sword hits kill; the red corpse is carried to the pit by anyone; its player respawns 3 s later',
	() => {
		const room = roomOf(configOf(crashOnly()));
		const t = tableOf(room);
		const red = t.join('red', 'Warrior');
		const blue = t.join('blue', 'Warrior');
		const red2 = t.join('red2', 'Warrior');
		assert.deepEqual([red.team, blue.team, red2.team], [0, 1, 0]);
		t.place('blue', 0, 0, 0);
		t.place('red', 0, 0, 1.5);
		t.place('red2', 0, 0, 3);
		t.step(31);
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['+z'] });
		t.step(1);
		assert.equal(t.of('hit').length, 1);
		assert.equal(red.hp, 50);
		assert.equal(t.of('knockback').length, 1);
		t.inputs.set('blue', {});
		t.step(2);
		t.place('red', 0, 0, 1.5);
		t.step(14);
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['+z'] });
		t.step(1);
		assert.equal(red.status, STATUS3D.dead);
		const [kill] = t.of('kill');
		assert.deepEqual([kill.by, kill.target, kill.cause], ['blue', 'red', 'weapon']);
		assert.deepEqual([...room.rules.scores], [0, 0], 'a blue kill scores nothing (BOTY)');
		const [corpseEvent] = t.of('corpse');
		assert.ok(corpseEvent, 'a red death leaves a corpse');
		const corpse = room.rules.entities.get(corpseEvent.entity);
		assert.equal(corpse.kind, 'corpse');
		t.inputs.set('blue', {});
		const ack = red.ack;
		const at = { ...red.body };
		t.inputs.set('red', { moveX: 127, buttons: BUTTONS3D.jump });
		t.step(5);
		assert.ok(red.ack > ack, 'a dead player’s inputs are taken');
		assert.deepEqual(
			[red.body.x, red.body.y, red.body.z],
			[at.x, at.y, at.z],
			'and do not move it',
		);
		t.inputs.set('red', {});
		t.place('red2', corpse.body.x, 0, corpse.body.z - 1);
		t.inputs.set('red2', { buttons: BUTTONS3D.interact, yaw: YAW['+x'] });
		t.step(1);
		assert.equal(corpse.carriedBy, 'red2');
		t.inputs.set('red2', { yaw: YAW['+x'] });
		t.step(1);
		t.place('red2', 6.5, 0, 0);
		t.inputs.set('red2', { buttons: BUTTONS3D.interact, yaw: YAW['+x'], pitch: -4000 });
		t.step(1);
		t.inputs.set('red2', { yaw: YAW['+x'] });
		for (let i = 0; i < 90 && !t.of('pieceScored').length; i++) t.step(1);
		const [scored] = t.of('pieceScored');
		assert.ok(scored && scored.kind === 'corpse' && scored.team === 'red');
		const scoredAt = room.steps;
		for (let i = 0; i < 200 && red.status === STATUS3D.dead; i++) t.step(1);
		assert.equal(red.status, STATUS3D.free);
		assert.equal(room.steps - scoredAt, 90, 'respawned 3 s (90 steps at 30 Hz) after the score');
		assert.equal(red.hp, 100);
		assert.deepEqual([red.body.x, red.body.z], [red.home.x, red.home.z]);
		assert.ok(t.of('respawn').some((e) => e.id === 'red'));
	},
);
await check(
	'a blue death leaves no corpse and respawns after 3 s; a red kill scores 1 for red',
	() => {
		const room = roomOf(
			configOf({ ...crashOnly(), rules: { heroes: { Warrior: { maxHealth: 50 } } } }),
		);
		const t = tableOf(room);
		const red = t.join('red', 'Warrior');
		const blue = t.join('blue', 'Warrior');
		t.place('red', 0, 0, 0);
		t.place('blue', 0, 0, -1.5);
		t.step(31);
		t.inputs.set('red', { buttons: BUTTONS3D.attack, yaw: YAW['-z'] });
		t.step(1);
		assert.equal(blue.status, STATUS3D.dead);
		assert.equal(t.of('corpse').length, 0);
		assert.deepEqual([...room.rules.scores], [1, 0]);
		t.inputs.set('red', {});
		const at = room.steps;
		for (let i = 0; i < 200 && blue.status === STATUS3D.dead; i++) t.step(1);
		assert.equal(room.steps - at, 90);
		void red;
	},
);
await check(
	'an uncarried corpse respawns its player after corpseSeconds (paused while carried)',
	() => {
		const room = roomOf(
			configOf({
				...crashOnly(),
				rules: { corpseSeconds: 1, heroes: { Warrior: { maxHealth: 50 } } },
			}),
		);
		const t = tableOf(room);
		const red = t.join('red', 'Warrior');
		t.join('blue', 'Warrior');
		t.join('red2', 'Warrior');
		t.place('blue', 0, 0, 0);
		t.place('red', 0, 0, 1.5);
		t.place('red2', -6, 0, 0);
		t.step(31);
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['+z'] });
		t.step(1);
		t.inputs.set('blue', {});
		const corpse = room.rules.entities.get(t.of('corpse')[0].entity);
		t.step(10);
		t.place('red2', corpse.body.x - 1, 0, corpse.body.z);
		t.inputs.set('red2', { buttons: BUTTONS3D.interact });
		t.step(1);
		t.inputs.set('red2', {});
		t.step(60);
		assert.equal(red.status, STATUS3D.dead, 'still dead while carried');
		t.inputs.set('red2', { buttons: BUTTONS3D.interact, pitch: -16000 });
		t.step(1);
		t.inputs.set('red2', {});
		for (let i = 0; i < 40 && red.status === STATUS3D.dead; i++) t.step(1);
		assert.equal(red.status, STATUS3D.free);
	},
);
const rewindSteps = Math.floor((REWIND_MS * 30) / 1000);
await check(`melee is judged where the attacker saw its target, held to ${REWIND_MS} ms`, () => {
	const fresh = () => {
		const room = roomOf(
			configOf({ ...crashOnly(), rules: { heroes: { Warrior: { maxHealth: 1000 } } } }),
		);
		const t = tableOf(room);
		t.join('red', 'Warrior');
		t.join('blue', 'Warrior');
		t.place('blue', 0, 0, 0);
		t.place('red', 0, 0, 1.5);
		t.step(31);
		return { room, t };
	};
	{
		const { room, t } = fresh();
		const near = room.steps;
		t.place('red', 0, 0, 6);
		t.step(1);
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['+z'], view: near });
		t.step(1);
		assert.equal(t.of('hit').length, 1, 'hit where the device drew it');
	}
	{
		const { room, t } = fresh();
		t.place('red', 0, 0, 6);
		t.step(1);
		t.inputs.set('blue', (at) => ({ buttons: BUTTONS3D.attack, yaw: YAW['+z'], view: at }));
		t.step(1);
		assert.equal(t.of('hit').length, 0, 'missed where it is now');
		void room;
	}
	{
		const { room, t } = fresh();
		const near = room.steps;
		t.place('red', 0, 0, 6);
		t.step(10);
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['+z'], view: near });
		t.step(1);
		assert.equal(t.of('hit').length, 0, 'a view older than the rewind is held to it');
	}
	{
		const { t } = fresh();
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['-z'] });
		t.step(1);
		assert.equal(t.of('hit').length, 0, 'behind the sword is out of its arc');
		t.place('red', -5.5, 3, -6);
		t.place('blue', -4.5, 0, -6);
		t.step(rewindSteps + 1);
		t.inputs.set('blue', { buttons: BUTTONS3D.attack, yaw: YAW['-x'] });
		t.step(20);
		assert.equal(t.of('hit').length, 0, 'above its height band');
	}
});
await check('knockback: a device applying the room’s impulse predicts its body bit for bit', () => {
	const run = (applyImpulse) => {
		const room = roomOf(
			configOf({ ...crashOnly(), rules: { heroes: { Warrior: { maxHealth: 5000 } } } }),
		);
		const t = tableOf(room);
		const victim = t.join('red', 'Warrior');
		t.join('blue', 'Warrior');
		t.place('blue', 0, 0, 0);
		t.place('red', 0, 0, 1.5);
		t.step(31);
		const predictor = createPredictor3d({
			body: createBody3d(victim.body),
			level: room.level,
			spec: victim.spec,
			dt: room.ctx.dt,
			ack: victim.ack,
			fallRespawns: false,
		});
		Object.assign(predictor.body, victim.body);
		const rng = createRng('kb');
		const verdicts = { match: 0, corrected: 0, stale: 0 };
		let seq = victim.ack;
		const pendingStates = [];
		let seen = 0;
		for (let i = 0; i < 240; i++) {
			const input = clampInput3d({
				seq: ++seq,
				moveX: Math.round(Math.sin(i / 20) * 100),
				moveZ: Math.round(Math.cos(i / 25) * 60),
				buttons: rng() < 0.03 ? BUTTONS3D.jump : 0,
				yaw: 0,
				view: room.steps,
			});
			predictor.input(input);
			t.inputs.set('red', input);
			t.inputs.set('blue', (at) => ({
				buttons: i % 40 === 5 ? BUTTONS3D.attack : 0,
				yaw: YAW['+z'],
				view: at,
			}));
			const dist = Math.hypot(victim.body.x, victim.body.z);
			if (dist > 1.8) t.place('blue', victim.body.x, victim.body.y, victim.body.z - 1.5);
			t.step(1);
			// The state arrives two steps late, then the step's events (afterNextPatch).
			pendingStates.push({
				x: victim.body.x,
				y: victim.body.y,
				z: victim.body.z,
				ack: victim.ack,
				step: room.steps,
				events: t.log.length,
			});
			if (pendingStates.length > 2) {
				const truth = pendingStates.shift();
				verdicts[predictor.reconcile(truth)] += 1;
				for (const e of t.log.slice(seen, truth.events))
					if (applyImpulse && e.type === 'knockback' && e.id === 'red') predictor.impulse(e.seq, e);
				seen = truth.events;
			}
		}
		return { room, predictor, victim, verdicts, kicks: t.of('knockback').length };
	};
	const good = run(true);
	assert.ok(good.kicks >= 4, `the victim was knocked back (${good.kicks})`);
	assert.equal(
		hashBodies3d([good.predictor.body]),
		hashBodies3d([good.victim.body]),
		'device === room',
	);
	const bad = run(false);
	assert.ok(
		bad.verdicts.corrected > good.verdicts.corrected,
		`without the impulse the device corrects more (${bad.verdicts.corrected} vs ${good.verdicts.corrected})`,
	);
	console.log(
		`   ${good.kicks} knockbacks: with the impulse ${JSON.stringify(good.verdicts)}, without ${JSON.stringify(bad.verdicts)}`,
	);
});
await check('hitscan: a wall stops the shot; pitch reaches a target on the tier', () => {
	const level = createLevel3d(LEVEL);
	assert.ok(
		Math.abs(rayLevel3d(level, -12, 1.6, 10, 1, 0, 0, 100) - 2) < 1e-9,
		'the wall at x = −10',
	);
	assert.equal(rayLevel3d(level, -12, 3.5, 10, 1, 0, 0, 100), Infinity, 'over the wall');
	assert.equal(rayCylinder(0, 1, -5, 0, 0, 1, 0, 0, 0, 1.8, 0.4), 4.6);
	assert.equal(rayCylinder(0, 2, -5, 0, 0, 1, 0, 0, 0, 1.8, 0.4), Infinity);
	const room = roomOf(configOf(crashOnly()));
	const t = tableOf(room);
	const shooter = t.join('blue0', 'Warrior');
	const gunner = t.join('gun', 'Gunmen');
	const target = t.join('red', 'Warrior');
	void shooter;
	assert.deepEqual([gunner.team, target.team], [1, 0]);
	assert.equal(gunner.weapon, 'Rifle');
	t.place('blue0', 15, 0, 15);
	t.place('gun', -12, 0, 10);
	t.place('red', -6, 0, 10);
	t.step(31);
	t.inputs.set('gun', { buttons: BUTTONS3D.attack, yaw: YAW['+x'] });
	t.step(1);
	t.inputs.set('gun', {});
	const [blocked] = t.of('shot');
	assert.equal(blocked.target, '', 'the wall stopped it');
	assert.ok(Math.abs(blocked.x + 10) < 1e-6);
	t.place('red', -10, 3, -6);
	t.place('gun', -10, 0, 4);
	t.step(10);
	t.inputs.set('gun', { buttons: BUTTONS3D.attack, yaw: YAW['-z'], pitch: 0 });
	t.step(1);
	t.inputs.set('gun', {});
	t.step(10);
	assert.equal(t.of('shot')[1].target, '', 'level: the tier’s face');
	t.inputs.set('gun', { buttons: BUTTONS3D.attack, yaw: YAW['-z'], pitch: 2354 });
	t.step(1);
	assert.equal(t.of('shot')[2].target, 'red', 'pitched up over the edge');
	assert.equal(target.hp, 90);
});
await check('projectiles fly at their speed, stop at walls, and splash', () => {
	const rules = {
		heroes: {
			Cleric: { maxHealth: 100, startingWeapons: ['Blaster'] },
			Warrior: { maxHealth: 100 },
		},
		weapons: {
			Blaster: {
				type: 'projectile',
				fireRate: 0.15,
				damage: 10,
				range: 100,
				projectileSpeed: 40,
				splashRadius: 2,
			},
			Barbarian_Sword: { type: 'melee', fireRate: 0.5, damage: 50, range: 2 },
		},
	};
	const room = roomOf(configOf({ ...crashOnly(), rules }));
	const t = tableOf(room);
	t.join('blue0', 'Warrior');
	const mage = t.join('mage', 'Cleric');
	const a = t.join('a', 'Warrior');
	t.join('blue1', 'Warrior');
	const b = t.join('b', 'Warrior');
	assert.deepEqual([mage.team, a.team, b.team], [1, 0, 0]);
	t.place('blue0', 15, 0, 15);
	t.place('blue1', 15, 0, -15);
	t.place('mage', -12, 0, 0);
	t.place('a', -2, 0, 0);
	t.place('b', -2, 0, 1.5);
	t.step(31);
	t.inputs.set('mage', { buttons: BUTTONS3D.attack, yaw: YAW['+x'], pitch: 0 });
	t.step(1);
	t.inputs.set('mage', {});
	const fired = room.steps;
	for (let i = 0; i < 30 && !t.of('impact').length; i++) t.step(1);
	const [impact] = t.of('impact');
	assert.equal(impact.target, 'a');
	assert.ok(
		room.steps - fired >= 6 && room.steps - fired <= 9,
		`about 10 m at 40 m/s (${room.steps - fired} steps)`,
	);
	assert.equal(a.hp, 90);
	assert.equal(b.hp, 90, 'splashed');
	room.level.colliders.length;
	t.place('a', 8.5, 0, 5);
	t.place('b', 8.5, 0, 9);
	t.place('mage', -9.5, 0, 6);
	t.step(5);
	t.inputs.set('mage', { buttons: BUTTONS3D.attack, yaw: YAW['+z'], pitch: 0 });
	t.step(1);
	t.inputs.set('mage', {});
	for (let i = 0; i < 30 && t.of('impact').length < 2; i++) t.step(1);
	assert.equal(t.of('impact')[1].target, '', 'the wall took it');
	assert.equal(a.hp, 90);
});
await check(
	'the void and the death plane kill with no corpse; the player is back home 3 s later',
	() => {
		const room = roomOf(configOf(crashOnly()));
		const t = tableOf(room);
		const red = t.join('red', 'Warrior');
		t.place('red', -17.5, 0.5, 16.5);
		t.step(2);
		assert.equal(red.status, STATUS3D.dead);
		assert.equal(t.of('kill')[0].cause, 'void');
		t.step(90);
		assert.equal(red.status, STATUS3D.free);
		t.place('red', 10, 0.5, 0);
		for (let i = 0; i < 90 && t.of('kill').length < 2; i++) t.step(1);
		assert.equal(t.of('kill')[1].cause, 'fall');
		assert.equal(t.of('corpse').length, 0);
		assert.ok(!t.of('respawned').length, 'the fold’s trip home is the rules’ death instead');
		t.step(90);
		assert.equal(red.status, STATUS3D.free);
		assert.deepEqual([red.body.x, red.body.y, red.body.z], [red.home.x, red.home.y, red.home.z]);
	},
);
await check(
	'the round clock ends the round with the leading team, and the next starts fresh',
	() => {
		const room = roomOf(
			configOf({ ...crashOnly(), rules: { roundSeconds: 4, nextRoundSeconds: 2 } }),
		);
		const t = tableOf(room);
		t.join('ann', 'Warrior');
		t.step(5);
		const piece = [...room.rules.entities.values()][0];
		Object.assign(piece.body, createBody3d({ x: 10, y: 0.5, z: 0 }));
		piece.asleep = false;
		piece.lastTeam = 1;
		t.step(30);
		assert.deepEqual([...room.rules.scores], [0, 1]);
		t.step(121 - room.steps);
		const [end] = t.of('roundEnd');
		assert.ok(end, 'the round ended');
		assert.deepEqual([end.round, end.winner, end.red, end.blue], [1, 'blue', 0, 1]);
		assert.equal(room.phase, 'ended');
		assert.equal(room.rules.endsAt, room.steps + 60, 'the next round in nextRoundSeconds');
		t.step(60);
		assert.equal(room.phase, 'running');
		assert.equal(room.rules.round, 2);
		assert.deepEqual([...room.rules.scores], [0, 0]);
		assert.equal(room.rules.pitLevel, 0);
		assert.equal(room.rules.entities.size, 1);
		room.leave('ann');
		assert.equal(room.phase, 'waiting');
	},
);

// --- 3b. the device ---------------------------------------------------------------------------

console.log('3b. the device: Flow and the stage');
await check('room events → Flow signals; the state → the room-owned variables', () => {
	const room = roomOf(
		configOf({ ...crashOnly(), rules: { roundSeconds: 2, nextRoundSeconds: 1 } }),
	);
	const t = tableOf(room);
	const ann = t.join('ann', 'Warrior');
	t.join('bob', 'Warrior');
	t.step(5);
	const piece = [...room.rules.entities.values()][0];
	Object.assign(piece.body, createBody3d({ x: 10, y: 0.5, z: 0 }));
	piece.asleep = false;
	piece.lastTeam = 0;
	piece.lastCarrier = 'ann';
	t.step(70);
	const forAnn = crashFlowSignalsOf(t.log, 'ann', ann.team);
	const forBob = crashFlowSignalsOf(t.log, 'bob', 1);
	const names = new Set(forAnn.map((s) => s.name));
	for (const name of [
		'playerJoined',
		'roundStart',
		'pieceScored',
		'pitRise',
		'roundEnd',
		'respawn',
	])
		assert.ok(names.has(name), name);
	const scoredA = forAnn.find((s) => s.name === 'pieceScored').payload;
	const scoredB = forBob.find((s) => s.name === 'pieceScored').payload;
	assert.deepEqual([scoredA.me, scoredA.ours, scoredA.red], [true, true, 1]);
	assert.deepEqual([scoredB.me, scoredB.ours], [false, false]);
	assert.equal(forAnn.find((s) => s.name === 'roundEnd').payload.won, true);
	assert.equal(forBob.find((s) => s.name === 'roundEnd').payload.won, false);
	assert.ok(Object.values(CRASH_FLOW_EVENTS).includes('kill'));
	const players = new Map(
		[...room.players].map(([id, p]) => [id, { team: p.team, status: p.status }]),
	);
	const state = {
		step: room.steps,
		phase: room.phase,
		round: room.rules.round,
		endsAt: room.rules.endsAt,
		winner: room.rules.winner,
		scores: [...room.rules.scores],
		players,
	};
	const values = crashServerValuesOf(
		{ ...state, phase: 'ended', winner: 'red', endsAt: state.step + 45 },
		'ann',
		30,
	);
	assert.deepEqual(values, {
		score: 1,
		status: 'free',
		round: 1,
		phase: 'ended',
		secondsLeft: 2,
		winner: 'red',
		won: true,
	});
	assert.equal(crashServerValuesOf({ ...state, winner: 'red' }, 'bob', 30).won, false);
	players.get('bob').status = STATUS3D.dead;
	assert.equal(crashServerValuesOf(state, 'bob', 30).status, 'dead');
});
await check(
	'the stage’s room view: a knocked-back device takes no correction; the dead are not drawn',
	() => {
		const config = configOf({
			...crashOnly(),
			rules: { heroes: { Warrior: { maxHealth: 5000 } } },
		});
		const room = roomOf(config);
		const queue = [];
		room.join('red', { name: 'red', character: 'Warrior' });
		room.join('blue', { name: 'blue', character: 'Warrior' });
		const view = createRoomView3d({
			meId: 'red',
			world: world3dOf(config.arcade.world3d),
			tickHz: 30,
			patchHz: 30,
			send: (input) => queue.push(input),
			fallRespawns: false,
		});
		const stateOf = () => ({
			step: room.steps,
			players: {
				forEach(each) {
					for (const [id, p] of room.players)
						each(
							{
								x: Math.fround(p.body.x),
								y: Math.fround(p.body.y),
								z: Math.fround(p.body.z),
								yaw: p.body.yaw,
								anim: p.anim,
								ack: p.ack,
								character: p.character.id,
								status: p.status,
							},
							id,
						);
				},
			},
		});
		const red = room.players.get('red');
		const blue = room.players.get('blue');
		Object.assign(red.body, createBody3d({ x: 0, y: 0, z: 1.5 }));
		Object.assign(blue.body, createBody3d({ x: 0, y: 0, z: 0 }));
		view.received(stateOf(), 0);
		let blueSeq = 0;
		let kicks = 0;
		let now = 0;
		for (let i = 0; i < 300; i++) {
			now += 1000 / 30;
			view.frame(1000 / 30, now, { right: Math.sin(i / 30) * 0.6, forward: 0.3, buttons: 0 }, 0);
			Object.assign(blue.body, createBody3d({ x: red.body.x, y: red.body.y, z: red.body.z - 1.5 }));
			const events = room.step((id) =>
				id === 'red'
					? queue.splice(0)
					: [
							clampInput3d({
								seq: ++blueSeq,
								buttons: i > 35 && i % 40 === 5 ? BUTTONS3D.attack : 0,
								yaw: YAW['+z'],
								view: room.steps,
							}),
						],
			);
			kicks += events.filter((e) => e.type === 'knockback' && e.id === 'red').length;
			view.received(stateOf(), now);
			view.events(events);
		}
		assert.ok(kicks >= 4, `knocked back ${kicks} times`);
		assert.equal(view.me.corrections, 0, `corrections ${view.me.corrections}`);
		assert.equal(hashBodies3d([view.me.body]), hashBodies3d([red.body]), 'device === room');
		assert.ok(view.bodies().some((b) => b.id === 'blue'));
		blue.status = STATUS3D.dead;
		view.received(stateOf(), now + 1);
		assert.ok(!view.bodies().some((b) => b.id === 'blue'), 'a dead player is not drawn');
		console.log(`   ${kicks} knockbacks through the stage's view, 0 corrections`);
	},
);

// --- 4. determinism ---------------------------------------------------------------------------

console.log('4. a room replays by seed');
const randomRun = (seed) => {
	const room = roomOf(
		configOf({
			online: {
				maxPlayers: 16,
				bots: { fillTo: 8, characters: [{ character: 'brute', brain: 'chaser' }] },
			},
			rules: {
				pieces: [
					{ x: 2.5, y: 0, z: 0 },
					{ x: 5, y: 0, z: 5 },
					{ x: -3, y: 0, z: -8 },
				],
				heroes: {
					Warrior: { maxHealth: 100 },
					Gunmen: { maxHealth: 30, maxShields: 5, startingWeapons: ['Rifle'] },
					Cleric: { maxHealth: 30, startingWeapons: ['Blaster'] },
				},
				corpseTeams: [0, 1],
			},
		}),
		seed,
	);
	const t = tableOf(room);
	const rng = createRng(`script${seed}`);
	const heroes = ['Warrior', 'Gunmen', 'Cleric'];
	for (let i = 0; i < 6; i++) {
		const id = `p${i}`;
		t.join(id, heroes[i % 3]);
		let target = { x: 0, z: 0 };
		t.inputs.set(id, (at) => {
			if (rng() < 0.02)
				target = rng() < 0.3 ? { x: 10, z: 0 } : { x: rng() * 36 - 18, z: rng() * 36 - 18 };
			const me = room.players.get(id).body;
			const dx = target.x - me.x;
			const dz = target.z - me.z;
			const d = Math.hypot(dx, dz) || 1;
			return {
				moveX: Math.round((dx / d) * 127),
				moveZ: Math.round((dz / d) * 127),
				buttons:
					(rng() < 0.05 ? BUTTONS3D.jump : 0) |
					(rng() < 0.3 ? BUTTONS3D.attack : 0) |
					(rng() < 0.05 ? BUTTONS3D.interact : 0),
				yaw: Math.floor(rng() * 65536),
				pitch: Math.floor(rng() * 8000) - 4000,
				view: Math.max(0, at - Math.floor(rng() * 10)),
			};
		});
	}
	t.step(3000);
	const bodies = [...room.players.values()].map((p) => p.body);
	const entities = [...room.rules.entities.values()].map((e) => e.body);
	const counts = {};
	for (const e of t.log) counts[e.type] = (counts[e.type] ?? 0) + 1;
	return {
		hash: hashBodies3d(entities, hashBodies3d(bodies)),
		events: JSON.stringify(t.log),
		scores: [...room.rules.scores],
		counts,
	};
};
await check('6 people + bots × 3000 steps: one seed, one room; another seed, another', () => {
	const a = randomRun(3);
	const b = randomRun(3);
	assert.equal(a.hash, b.hash);
	assert.equal(a.events, b.events);
	for (const type of ['hit', 'kill', 'respawn', 'attack', 'knockback', 'shot', 'impact'])
		assert.ok(a.counts[type] > 0, `the script covers ${type}`);
	const c = randomRun(4);
	assert.notEqual(a.hash, c.hash);
	console.log(`   scores ${JSON.stringify(a.scores)}; ${JSON.stringify(a.counts)}`);
});

// --- 5. live -------------------------------------------------------------------------------------

console.log('5. live');
const dir = mkdtempSync(join(tmpdir(), 'crash-rules-'));
writeFileSync(join(dir, 'crash.json'), JSON.stringify(configOf(crashOnly())));
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
	commit: 'crash0000000',
	gracefullyShutdown: false,
});
await server.listen(port);
const rooms = [];
try {
	await check(
		'live: Ann carries the piece into the pit; Ann and Bob both see red score',
		async () => {
			const clientOf = () => new Client(`ws://127.0.0.1:${port}`);
			const a = await clientOf().joinOrCreate(ROOM_NAME_3D, {
				game: 'crash',
				name: 'Ann',
				character: 'Warrior',
			});
			const b = await clientOf().joinOrCreate(ROOM_NAME_3D, {
				game: 'crash',
				name: 'Bob',
				character: 'Warrior',
			});
			rooms.push(a, b);
			assert.equal(a.roomId, b.roomId);
			const heard = new Map([a, b].map((room) => [room, []]));
			for (const room of [a, b])
				room.onMessage('event', (events) => heard.get(room).push(...events));
			const sim = matchMaker.getLocalRoomById(a.roomId).sim;
			await until('the state', () => a.state.entities?.size === 1 && b.state.players?.size === 2);
			const ann = sim.players.get(a.sessionId);
			assert.equal(ann.team, 0);
			const input = a.input();
			const send = async (raw, n = 1) => {
				for (let i = 0; i < n; i++) {
					Object.assign(input.data, clampInput3d({ ...raw, seq: ++seqA, view: sim.steps }));
					input.send();
					await wait(1000 / 30);
				}
			};
			let seqA = 0;
			await send({ yaw: YAW['+x'] }, 3);
			await send({ buttons: BUTTONS3D.interact, yaw: YAW['+x'] });
			await until('Ann carries it', () => a.state.players.get(a.sessionId)?.carrying !== '');
			await send({ moveX: 127, yaw: YAW['+x'] }, 30);
			await send({ yaw: YAW['+x'] }, 6);
			await until('Ann at the pit’s edge', () => ann.body.x > 5 && ann.body.x < 8);
			await send({ buttons: BUTTONS3D.interact, yaw: YAW['+x'], pitch: -4000 });
			await send({ yaw: YAW['+x'] }, 3);
			await until('both told of the score', () =>
				[a, b].every((room) => heard.get(room).some((e) => e.type === 'pieceScored')),
			);
			await until('both see the scores', () =>
				[a, b].every((room) => room.state.scores?.[0] === 1 && room.state.scores?.[1] === 0),
			);
			assert.ok(Math.abs(b.state.pitLevel - 0.1) < 1e-6, 'Bob sees the pit rise');
			const scored = heard.get(b).find((e) => e.type === 'pieceScored');
			assert.deepEqual([scored.team, scored.by], ['red', a.sessionId]);
			assert.equal(a.state.phase, 'running');
			assert.ok(a.state.endsAt > a.state.step);
			console.log(
				`   red ${b.state.scores[0]} – blue ${b.state.scores[1]}, pit ${b.state.pitLevel.toFixed(2)} m, seen by both`,
			);
		},
	);
} finally {
	for (const room of rooms) await room.leave().catch(() => {});
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:crash-rules — ${passed} checks passed`);
process.exit(0);
