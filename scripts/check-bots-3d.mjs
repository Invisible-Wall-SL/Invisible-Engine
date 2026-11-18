// Bots of a 3D room (docs/design/3d-games.md Phase 3 step 5, docs/design/3d/gameplay-evaluation.md
// §3 "Bots"): the grid nav graph a level derives at load (`engine-mechanics` `nav3d.js`), A* with
// seeded tie-breaks, the Crash brain (`crashBots3d.js`), and the room's seats
// (`services/game-server` `roomSim3d.ts`). On a hand-written two-tier level a bot, stepped by the
// room's own `stepPlayer3d`, reaches a target on the upper tier by the ramp and by the trampoline,
// takes a ledge by a jump and comes down by a one-way drop; an unreachable target gives the nearest
// reachable way; paths and whole matches replay by seed; line of sight is exact on ramps; the brain
// fights, wanders, carries to the pit, escorts and intercepts; bots fill 16 seats with even teams.
//
// Run: pnpm check:bots-3d

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	CRASH_BOT_DEFAULTS,
	createCrashBot3d,
	crashBotInput3d,
	crashOptionsFor,
} from '../packages/engine-mechanics/src/crashBots3d.js';
import {
	MOTION3D_DEFAULTS,
	createBody3d,
	createLevel3d,
	hashBodies3d,
} from '../packages/engine-mechanics/src/motion3d.js';
import {
	createNavGrid3d,
	findPath3d,
	lineOfSight3d,
	nearestNode3d,
	segmentHit3d,
} from '../packages/engine-mechanics/src/nav3d.js';
import {
	BUTTONS3D,
	clampInput3d,
	stepPlayer3d,
	world3dOf,
} from '../packages/engine-mechanics/src/online3d.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim3d } from '../services/game-server/src/roomSim3d.ts';
import { ROOM_NAME_3D, createGameServer } from '../services/game-server/src/server.ts';

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

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
	kind: 'box',
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});
const GROUND = box(-12, -1, -10, 4, 0, 10);
const TIER = box(4, -1, -10, 12, 2.5, 10);
const RAMP = {
	kind: 'ramp',
	facing: '+x',
	minX: -1,
	minY: 0,
	minZ: -10,
	maxX: 4,
	maxY: 2.5,
	maxZ: -6,
};
const PILLAR = box(7, 2.5, -2, 8, 5, 2);
const LEDGE = box(-6, 0, -2, -4, 1, 2);
const WALLS = [
	box(-13, -1, -11, 13, 4, -10),
	box(-13, -1, 10, 13, 4, 11),
	box(-13, -1, -10, -12, 4, 10),
	box(12, -1, -10, 13, 4, 10),
];
const TRAMPOLINE = {
	kind: 'trampoline',
	minX: 0,
	minY: -0.1,
	minZ: 4,
	maxX: 2,
	maxY: 0.2,
	maxZ: 6,
	height: 5,
};
const PIT = { kind: 'pit', minX: -10, minY: -1, minZ: -2, maxX: -8, maxY: 0.5, maxZ: 2 };
/** A two-tier level: ground at 0, a 2.5 m tier, a ramp up it, a trampoline onto it, a 1 m ledge,
 *  a pillar on the tier, walls round it, a pit marker. */
const TWO_TIER = {
	colliders: [GROUND, TIER, RAMP, PILLAR, LEDGE, ...WALLS],
	zones: [TRAMPOLINE, PIT],
	killY: -10,
};
const SPEC = MOTION3D_DEFAULTS;
const DT = 1 / 30;

const navOf = (raw) => {
	const level = createLevel3d(raw);
	return { level, nav: createNavGrid3d(level, SPEC) };
};
const nodeAt = (nav, x, y, z) => nearestNode3d(nav, x, y, z);
const pathKinds = (path) => new Set(path.steps.map((s) => s.kind));

/** One bot walking to a piece at `to` (its carry goal) by the room's own step; the steps it took
 *  to stand by it, the inputs' hash, the nodes it crossed and whether it pressed interact there. */
function carryRun(raw, from, to, { seed = 5, steps = 30 * 40 } = {}) {
	const { level, nav } = navOf(raw);
	const bot = createCrashBot3d({ seed, options: crashOptionsFor({}, 'hero') });
	const self = { id: 'bot:1', body: createBody3d(from), team: 0, connected: true, status: 0 };
	const piece = { id: 'p1', x: to.x, y: to.y, z: to.z, carrier: null };
	const situation = { players: [self], pieces: [piece], pit: null };
	let hash = 0x811c9dc5;
	let maxY = from.y;
	const kinds = new Set();
	for (let i = 0; i < steps; i++) {
		const input = crashBotInput3d(bot, self, situation, {
			nav,
			level,
			dt: DT,
			spec: SPEC,
			view: i,
		});
		for (const s of bot.follower.steps) kinds.add(s.kind);
		for (const v of [input.moveX, input.moveZ, input.buttons, input.yaw])
			hash = Math.imul(hash ^ (v & 0xffff), 0x01000193) >>> 0;
		const result = stepPlayer3d(self.body, input, level, SPEC, DT);
		bot.blocked = result.onWall;
		maxY = Math.max(maxY, self.body.y);
		const d = Math.hypot(self.body.x - to.x, self.body.z - to.z);
		if (d < 1 && Math.abs(self.body.y - to.y) < 0.3 && input.buttons & BUTTONS3D.interact)
			return { at: i, hash, kinds, maxY, body: self.body };
	}
	return { at: -1, hash, kinds, maxY, body: self.body };
}

// --- 1. the nav graph ---------------------------------------------------------------------------

console.log('1. the nav graph');
const base = navOf(TWO_TIER);

await check('a two-tier level gives walk, drop, jump and bounce edges; drops are one-way', () => {
	const { nav } = base;
	const count = { walk: 0, drop: 0, jump: 0, bounce: 0 };
	for (const list of nav.edges) for (const e of list) count[e.kind] += 1;
	for (const kind of Object.keys(count))
		assert.ok(count[kind] > 0, `${kind} edges (${JSON.stringify(count)})`);
	const tops = new Set(nav.nodes.map((n) => n.y.toFixed(2)));
	for (const y of ['0.00', '1.00', '2.50', '5.00']) assert.ok(tops.has(y), `a ${y} m tier`);
	assert.ok(
		nav.nodes.some((n) => n.ramp),
		'ramp nodes',
	);
	for (const [a, list] of nav.edges.entries())
		for (const e of list) {
			if (e.kind !== 'drop') continue;
			assert.ok(
				!nav.edges[e.to].some((back) => back.to === a && back.kind === 'walk'),
				'nothing walks back up a drop',
			);
		}
	for (const n of nav.nodes) {
		const inWall = WALLS.some((w) => n.x > w.minX && n.x < w.maxX && n.z > w.minZ && n.z < w.maxZ);
		if (inWall) assert.ok(n.y >= 4, 'only a wall top stands on a wall');
	}
	console.log(`   ${nav.nodes.length} nodes, edges ${JSON.stringify(count)}`);
});

await check('A* crosses tiers by the ramp and by the trampoline, by seed', () => {
	const noTramp = navOf({ ...TWO_TIER, zones: [PIT] }).nav;
	const byRamp = findPath3d(
		noTramp,
		nodeAt(noTramp, -8, 0, 8),
		nodeAt(noTramp, 9, 2.5, 8),
		createRng(1),
	);
	assert.ok(byRamp.reached);
	assert.ok(
		byRamp.steps.some((s) => noTramp.nodes[s.node].ramp),
		'over the ramp',
	);
	const noRamp = navOf({
		...TWO_TIER,
		colliders: TWO_TIER.colliders.filter((c) => c !== RAMP),
	}).nav;
	const byBounce = findPath3d(
		noRamp,
		nodeAt(noRamp, 1, 0, 8),
		nodeAt(noRamp, 8, 2.5, 6),
		createRng(1),
	);
	assert.ok(byBounce.reached);
	assert.ok(pathKinds(byBounce).has('bounce'), 'a trampoline link');
	const jump = findPath3d(
		base.nav,
		nodeAt(base.nav, -8, 0, 0),
		nodeAt(base.nav, -5, 1, 0),
		createRng(1),
	);
	assert.ok(pathKinds(jump).has('jump'), 'onto the ledge by a jump');
	const drop = findPath3d(
		base.nav,
		nodeAt(base.nav, 9, 2.5, 8),
		nodeAt(base.nav, -8, 0, 8),
		createRng(1),
	);
	assert.ok(drop.reached && pathKinds(drop).has('drop'), 'off the tier by a drop');
});

await check('an unreachable target gives the nearest reachable way (or none, if asked)', () => {
	const { nav } = base;
	const from = nodeAt(nav, -8, 0, 0);
	const top = nodeAt(nav, 7.5, 5, 0);
	assert.equal(nav.nodes[top].y, 5, 'the pillar top is a node');
	const partial = findPath3d(nav, from, top, createRng(3));
	assert.equal(partial.reached, false);
	const end = nav.nodes[partial.steps.at(-1).node];
	assert.ok(Math.hypot(end.x - 7.5, end.z) < 1.6, `ends beside the pillar (${end.x}, ${end.z})`);
	assert.equal(findPath3d(nav, from, top, createRng(3), { partial: false }), null);
	assert.equal(findPath3d(nav, -1, top, createRng(3)), null);
});

await check('A* breaks ties by the seed: one seed one path, seeds differ', () => {
	const { nav } = base;
	const way = (seed) =>
		findPath3d(nav, nodeAt(nav, -10, 0, -8), nodeAt(nav, -2, 0, 8), createRng(seed))
			.steps.map((s) => s.node)
			.join();
	assert.equal(way(7), way(7));
	const ways = new Set(Array.from({ length: 16 }, (_, i) => way(i + 1)));
	assert.ok(ways.size > 1, `${ways.size} different equally short ways`);
	const costs = new Set(
		Array.from({ length: 16 }, (_, i) =>
			findPath3d(
				nav,
				nodeAt(nav, -10, 0, -8),
				nodeAt(nav, -2, 0, 8),
				createRng(i + 1),
			).cost.toFixed(6),
		),
	);
	assert.equal(costs.size, 1, 'and every one is as short');
});

await check('line of sight: boxes block, a ramp blocks only below its surface', () => {
	const { level } = base;
	assert.ok(lineOfSight3d(level, -8, 1.5, 0, -2, 1.5, 0), 'open ground');
	assert.ok(!lineOfSight3d(level, -8, 0.5, 0, -2, 0.5, 0), 'the ledge blocks low');
	assert.ok(!lineOfSight3d(level, 0, 1.5, 0, 9, 1.5, 0), 'the tier face blocks');
	assert.ok(lineOfSight3d(level, 0, 2.2, -8, 3, 3.2, -8), 'just above the ramp');
	assert.ok(!lineOfSight3d(level, 0, 0.5, -8, 3, 0.5, -8), 'into the ramp');
	const t = segmentHit3d(level, 0, 3, -8, 3, 0, -8);
	assert.ok(Math.abs(t - 5 / 9) < 1e-9, `meets the slope y = (x + 1) / 2 at x = 5/3 (t ${t})`);
});

// --- 2. a bot on the level ----------------------------------------------------------------------

console.log('2. a bot on the level');

await check('a bot reaches a piece on the tier by the ramp', () => {
	const raw = { ...TWO_TIER, zones: [PIT] };
	const run = carryRun(raw, { x: -8, y: 0, z: 8 }, { x: 9, y: 2.5, z: 8 });
	assert.ok(
		run.at > 0,
		`reached (body ${run.body.x.toFixed(2)}, ${run.body.y.toFixed(2)}, ${run.body.z.toFixed(2)})`,
	);
	console.log(`   by the ramp in ${(run.at * DT).toFixed(1)} s`);
});

await check('a bot reaches a piece on the tier by the trampoline', () => {
	const raw = { ...TWO_TIER, colliders: TWO_TIER.colliders.filter((c) => c !== RAMP) };
	const run = carryRun(raw, { x: 1, y: 0, z: 8 }, { x: 8, y: 2.5, z: 6 });
	assert.ok(run.kinds.has('bounce'), 'its path bounced');
	assert.ok(run.maxY > 3, 'it flew');
	assert.ok(
		run.at > 0,
		`reached (body ${run.body.x.toFixed(2)}, ${run.body.y.toFixed(2)}, ${run.body.z.toFixed(2)})`,
	);
	console.log(`   by the trampoline in ${(run.at * DT).toFixed(1)} s`);
});

await check('a bot jumps onto a ledge and drops off the tier', () => {
	const up = carryRun(TWO_TIER, { x: -9, y: 0, z: 0 }, { x: -5, y: 1, z: 0 });
	assert.ok(up.kinds.has('jump') && up.at > 0, 'onto the ledge');
	const down = carryRun(TWO_TIER, { x: 9, y: 2.5, z: 8 }, { x: -6, y: 0, z: 8 });
	assert.ok(down.kinds.has('drop') && down.at > 0, 'off the tier');
});

await check('the same seed gives the same inputs', () => {
	const a = carryRun(TWO_TIER, { x: -8, y: 0, z: 8 }, { x: 9, y: 2.5, z: -8 }, { seed: 9 });
	const b = carryRun(TWO_TIER, { x: -8, y: 0, z: 8 }, { x: 9, y: 2.5, z: -8 }, { seed: 9 });
	assert.ok(a.at > 0);
	assert.equal(a.hash, b.hash);
	assert.equal(a.at, b.at);
});

// --- 3. the Crash brain -------------------------------------------------------------------------

console.log('3. the Crash brain');

const brainWorld = (raw = TWO_TIER) => {
	const { level, nav } = navOf(raw);
	return { level, nav };
};
const player = (id, team, at) => ({ id, team, connected: true, status: 0, body: createBody3d(at) });
/** Step `bots` (and `still` players, who get no input) `steps` times; per bot the buttons it pressed. */
function play({ level, nav }, bots, situation, steps) {
	const pressed = new Map(bots.map(({ self }) => [self.id, { attack: 0, interact: 0, jump: 0 }]));
	for (let i = 0; i < steps; i++)
		for (const { bot, self } of bots) {
			const input = crashBotInput3d(bot, self, situation, {
				nav,
				level,
				dt: DT,
				spec: SPEC,
				view: i,
			});
			const count = pressed.get(self.id);
			if (input.buttons & BUTTONS3D.attack) count.attack += 1;
			if (input.buttons & BUTTONS3D.interact) count.interact += 1;
			if (input.buttons & BUTTONS3D.jump) count.jump += 1;
			bot.blocked = stepPlayer3d(self.body, input, level, SPEC, DT).onWall;
		}
	return pressed;
}

await check(
	'fight: a bot chases an enemy across the level and swings only in reach and sight',
	() => {
		const w = brainWorld();
		const self = player('bot:1', 0, { x: -9, y: 0, z: 8 });
		const enemy = player('ann', 1, { x: 9, y: 2.5, z: 8 });
		const friend = player('bob', 0, { x: -9, y: 0, z: -8 });
		const bot = createCrashBot3d({ seed: 2 });
		const situation = { players: [self, enemy, friend], pieces: [], pit: null };
		const early = play(w, [{ bot, self }], situation, 30);
		assert.equal(bot.goal.kind, 'fight');
		assert.equal(bot.goal.id, 'ann', 'its target is the enemy, not the friend');
		assert.equal(early.get('bot:1').attack, 0, 'no swing out of reach');
		const later = play(w, [{ bot, self }], situation, 30 * 20);
		const gap = Math.hypot(
			self.body.x - enemy.body.x,
			self.body.y - enemy.body.y,
			self.body.z - enemy.body.z,
		);
		assert.ok(gap <= CRASH_BOT_DEFAULTS.attackRange, `in reach (${gap.toFixed(2)} m)`);
		assert.ok(later.get('bot:1').attack > 0, 'swings');
		const walled = {
			...TWO_TIER,
			colliders: [...TWO_TIER.colliders, box(-3, 0, -10, -2.5, 3.9, 10)],
		};
		const wl = brainWorld(walled);
		const a = player('bot:2', 0, { x: -4, y: 0, z: 0 });
		const b = player('cat', 1, { x: -1.5, y: 0, z: 0 });
		const blind = play(
			wl,
			[
				{
					bot: createCrashBot3d({ seed: 3, options: crashOptionsFor({ attackRange: 3 }, 'x') }),
					self: a,
				},
			],
			{ players: [a, b] },
			1,
		);
		assert.equal(blind.get('bot:2').attack, 0, 'no swing through a wall');
	},
);

await check('wander: with nobody to fight a bot roams', () => {
	const w = brainWorld();
	const self = player('bot:1', 0, { x: -9, y: 0, z: -8 });
	const bot = createCrashBot3d({ seed: 4 });
	let travelled = 0;
	let last = { x: self.body.x, z: self.body.z };
	for (let i = 0; i < 20; i++) {
		play(w, [{ bot, self }], { players: [self] }, 30);
		travelled += Math.hypot(self.body.x - last.x, self.body.z - last.z);
		last = { x: self.body.x, z: self.body.z };
	}
	assert.equal(bot.goal.kind, 'wander');
	assert.ok(travelled > 20, `roamed ${travelled.toFixed(1)} m`);
});

await check('carry: to a free piece, then (carrying it) to the pit; off by the switch', () => {
	const w = brainWorld();
	const self = player('bot:1', 0, { x: 9, y: 2.5, z: 8 });
	const bot = createCrashBot3d({ seed: 6 });
	const piece = { id: 'p1', x: -2, y: 0, z: 8, carrier: null };
	const pit = { x: -9, y: -1, z: 0 };
	const situation = { players: [self], pieces: [piece], pit };
	let picked = -1;
	for (let i = 0; i < 30 * 30 && picked < 0; i++) {
		const pressed = play(w, [{ bot, self }], situation, 1);
		if (pressed.get('bot:1').interact) picked = i;
	}
	assert.ok(picked > 0, 'pressed interact at the piece');
	assert.equal(bot.goal.kind, 'carry');
	piece.carrier = self.id;
	play(w, [{ bot, self }], situation, 1);
	assert.equal(bot.goal.kind, 'score');
	play(w, [{ bot, self }], situation, 30 * 20);
	assert.ok(Math.hypot(self.body.x - pit.x, self.body.z - pit.z) < 1.2, 'at the pit');
	const off = createCrashBot3d({ seed: 6, options: crashOptionsFor({ carry: false }, 'x') });
	piece.carrier = null;
	play(w, [{ bot: off, self }], situation, 1);
	assert.equal(off.goal.kind, 'wander', 'carry: false ignores pieces');
});

await check('escort an own carrier, intercept the other team’s', () => {
	const w = brainWorld();
	const self = player('bot:1', 0, { x: -9, y: 0, z: -8 });
	const ally = player('bob', 0, { x: -2, y: 0, z: 6 });
	const foe = player('ann', 1, { x: 9, y: 2.5, z: 8 });
	const pieces = [{ id: 'p1', x: ally.body.x, y: 0, z: ally.body.z, carrier: 'bob' }];
	const escort = createCrashBot3d({
		seed: 8,
		options: crashOptionsFor({ weights: { fight: 0, intercept: 0 } }, 'x'),
	});
	play(w, [{ bot: escort, self }], { players: [self, ally, foe], pieces, pit: null }, 30 * 10);
	assert.equal(escort.goal.kind, 'escort');
	const gap = Math.hypot(self.body.x - ally.body.x, self.body.z - ally.body.z);
	assert.ok(
		gap < CRASH_BOT_DEFAULTS.escortDistance + 0.6,
		`beside the carrier (${gap.toFixed(2)} m)`,
	);
	pieces[0].carrier = 'ann';
	const hunter = createCrashBot3d({ seed: 8 });
	play(w, [{ bot: hunter, self }], { players: [self, ally, foe], pieces, pit: null }, 1);
	assert.equal(hunter.goal.kind, 'intercept');
	assert.equal(hunter.goal.id, 'ann');
});

await check('per-hero weights are data', () => {
	const base3 = {
		weights: { fight: 2 },
		sight: 10,
		heroes: { mage: { sight: 40, weights: { carry: 3 } } },
	};
	const warrior = crashOptionsFor(base3, 'warrior');
	const mage = crashOptionsFor(base3, 'mage');
	assert.equal(warrior.sight, 10);
	assert.equal(mage.sight, 40);
	assert.equal(mage.weights.fight, 2);
	assert.equal(mage.weights.carry, 3);
	assert.equal(warrior.weights.carry, CRASH_BOT_DEFAULTS.weights.carry);
	assert.equal(mage.carry, true, 'carrying is on by default');
});

// --- 4. the room: 16 seats ----------------------------------------------------------------------

console.log('4. the room: 16 seats');

const CHASE = {
	initial: 'hunt',
	states: [{ id: 'hunt', behaviour: 'chase', params: { tag: 'player', range: 500, speed: 4 } }],
	transitions: [],
};
const SPAWNS = [
	{ x: -10, z: -8 },
	{ x: 10, y: 2.5, z: 8 },
	{ x: -10, z: 8 },
	{ x: 10, y: 2.5, z: -8 },
];
const configOf = (bots = { crash: {} }) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Crash bots',
	arcade: {
		field: { w: 24, h: 20 },
		bodies: {
			hero: { shape: 'circle', r: 0.4, tags: ['player'] },
			brute: { shape: 'circle', r: 0.4, tags: ['bot'] },
		},
		characters: [{ id: 'chaser', component: 'brute', brain: CHASE }],
		online: {
			maxPlayers: 16,
			characters: [
				{ id: 'hero', body: 'hero', speed: 5 },
				{ id: 'brute', body: 'brute', speed: 5 },
			],
			bots: { fillTo: 16, characters: [{ character: 'brute', brain: 'chaser' }] },
		},
		world3d: { level: TWO_TIER, spawns: SPAWNS, ...(bots ? { bots } : {}) },
	},
});
const roomOf = (seed = 21, bots) => {
	const config = configOf(bots);
	const game = onlineGameOf(normalizeGameConfigDoc(config));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return createRoomSim3d(game, world3dOf(config.arcade.world3d), { seed });
};
const teams = (sim) => {
	const t = [0, 0];
	for (const p of sim.players.values()) t[p.team] += 1;
	return t;
};

await check('bots fill 16 seats with even teams; a person takes a bot seat on their team', () => {
	const sim = roomOf();
	assert.ok(sim.nav && sim.nav.nodes.length > 0, 'the room built the nav graph');
	sim.join('ann', { character: 'hero' });
	assert.equal(sim.players.size, 16);
	assert.deepEqual(teams(sim), [8, 8]);
	assert.equal(sim.players.get('ann').team, 0);
	const bob = sim.join('bob', { character: 'hero' });
	assert.equal(bob.team, 1, 'the second person joins the team with fewer people');
	assert.equal(sim.players.size, 16);
	assert.deepEqual(teams(sim), [8, 8]);
	const cat = sim.join('cat', {});
	assert.equal(cat.team, 0);
	assert.deepEqual(teams(sim), [8, 8]);
	sim.drop('bob');
	assert.equal(sim.players.size, 16, 'a dropped person keeps the seat through the grace');
	sim.leave('bob');
	assert.equal(sim.players.size, 16, 'a bot refills the seat');
	assert.deepEqual(teams(sim), [8, 8]);
	assert.equal([...sim.players.values()].filter((p) => !p.bot).length, 2);
	sim.leave('ann');
	sim.leave('cat');
	assert.equal(sim.players.size, 0, 'bots leave an empty room');
});

const match = (seed, steps = 30 * 60) => {
	const sim = roomOf(seed);
	sim.join('ann', { character: 'hero' });
	const start = new Map([...sim.players.values()].map((p) => [p.id, { x: p.body.x, z: p.body.z }]));
	const travelled = new Map([...start.keys()].map((id) => [id, 0]));
	let upper = 0;
	let respawns = 0;
	const t0 = performance.now();
	for (let i = 0; i < steps; i++) {
		for (const e of sim.step(() => [])) if (e.type === 'respawned') respawns += 1;
		if (i % 15 === 0)
			for (const p of sim.players.values()) {
				const was = start.get(p.id);
				travelled.set(p.id, travelled.get(p.id) + Math.hypot(p.body.x - was.x, p.body.z - was.z));
				start.set(p.id, { x: p.body.x, z: p.body.z });
				if (p.bot && p.body.y > 2 && p.body.x > 4) upper += 1;
			}
	}
	const ms = performance.now() - t0;
	return {
		sim,
		travelled,
		upper,
		respawns,
		ms,
		hash: hashBodies3d([...sim.players.values()].map((p) => p.body)),
	};
};

await check('a 16-seat Crash room of bots plays a minute, everywhere, and replays by seed', () => {
	const a = match(31);
	const b = match(31);
	const c = match(32);
	assert.equal(a.hash, b.hash, 'one seed, one match');
	assert.notEqual(a.hash, c.hash, 'another seed, another match');
	for (const p of a.sim.players.values()) {
		if (!p.bot) continue;
		assert.equal(p.ack, 30 * 60, `${p.id} sent an input every step`);
		assert.ok(a.travelled.get(p.id) > 10, `${p.id} moved (${a.travelled.get(p.id).toFixed(1)} m)`);
	}
	assert.ok(a.upper > 0, 'bots used the upper tier');
	console.log(
		`   15 bots × 1800 steps in ${a.ms.toFixed(0)} ms (${((a.ms / 1800) * 1000).toFixed(0)} µs a step), ${a.respawns} falls`,
	);
});

await check('a world without a crash block keeps the plane brain, untouched', () => {
	const sim = roomOf(21, null);
	assert.equal(sim.nav, undefined);
	sim.join('ann', { character: 'hero' });
	let seq = 0;
	for (let i = 0; i < 60; i++)
		sim.step((id) => (id === 'ann' ? [clampInput3d({ seq: ++seq })] : []));
	assert.equal(sim.players.size, 16);
});

await check('the bots block is checked by path', () => {
	const bad = (bots, path) =>
		assert.throws(
			() => world3dOf({ level: TWO_TIER, bots }),
			(e) => e.message.startsWith(path),
		);
	bad(5, 'arcade.world3d.bots');
	bad({ nav: { cell: 0 } }, 'arcade.world3d.bots.nav.cell');
	bad({ crash: { carry: 'yes' } }, 'arcade.world3d.bots.crash.carry');
	bad({ crash: { weights: { fight: -1 } } }, 'arcade.world3d.bots.crash.weights.fight');
	bad(
		{ crash: { heroes: { mage: { sight: 'far' } } } },
		'arcade.world3d.bots.crash.heroes.mage.sight',
	);
	assert.equal(world3dOf({ level: TWO_TIER }).bots, undefined);
	assert.deepEqual(world3dOf({ level: TWO_TIER, bots: { crash: {} } }).bots.crash, {});
});

// --- 5. live: a real game server, its seats filled by Crash bots ---------------------------------

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
const dir = mkdtempSync(join(tmpdir(), 'bots3d-'));
writeFileSync(join(dir, 'crash.json'), JSON.stringify(configOf()));
const port = await freePort();
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 2,
	commit: 'bots3d000000',
	gracefullyShutdown: false,
});
await server.listen(port);
try {
	await check('live: one idle device joins and 15 Crash bots play the room for 5 s', async () => {
		const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME_3D, {
			game: 'crash',
			name: 'Ann',
			character: 'hero',
		});
		room.onMessage('*', () => {});
		let last = -1;
		room.onStateChange((state) => {
			for (const p of state.players.values()) if (p.bot) last = Math.max(last, p.ack);
		});
		const end = Date.now() + 8000;
		while (Date.now() < end && (room.state.players?.size !== 16 || last < 0)) await wait(20);
		assert.equal(room.state.players.size, 16, 'sixteen seats');
		const seen = () => [...room.state.players.values()].filter((p) => p.bot);
		assert.equal(seen().length, 15);
		const from = new Map(seen().map((p) => [p.name, { x: p.x, z: p.z }]));
		const step0 = last;
		await wait(5000);
		const steps = last - step0;
		const moved = seen().filter(
			(p) => Math.hypot(p.x - from.get(p.name).x, p.z - from.get(p.name).z) > 1,
		);
		const red = [...room.state.players.values()].filter((p) => p.team === 0).length;
		assert.ok(steps > 100, `the bots sent an input a step (${steps})`);
		assert.ok(moved.length >= 12, `${moved.length} of 15 bots moved`);
		assert.equal(red, 8, 'even teams');
		console.log(`   ${steps} steps in 5 s, ${moved.length}/15 bots moved, teams 8/8`);
		await room.leave();
	});
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:bots-3d — ${passed} checks passed`);
process.exit(0);
