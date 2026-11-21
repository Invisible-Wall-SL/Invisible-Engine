// Online rooms at 100 players (services/game-server; docs/design/realtime-multiplayer.md §5, §7,
// §12; P10.16): bots that fill a room's empty places with the P10.11 brains, a person taking a
// bot's place, bots that cannot win, the nearby-only state (each device sent only the players near
// its own, and its own `ack` only), per-character spawns, and Salmons as data (its river, its
// config, its nearby box against what its camera shows, a salmon that can swim it, a bear bot that
// catches one and a bot fisherman that casts only at a salmon in his sight that a device in his
// place would be sent, after a reaction time and short on a long cast, where a person's cast is
// at once and where it is aimed, and a bear bot that swipes at a player in his reach only after a
// reaction time, where a person's swipe lands on the press; P11.2 (e): a river of its own in
// every room, made from the room's seed) — headless over the room's own
// code, then over a real Colyseus 0.18 server on localhost with real `@colyseus/sdk` clients.
// And the device's view (`engine-mechanics` `shown.js`): what a device says its screen shows, the
// view a room with `nearby.max` sends it by as well as the box (never less than the box, so
// whoever can hook a salmon is in its state), held so it shrinks at most once a second, junk that
// declares nothing, and Salmons' `max` against what its camera shows on larger windows.
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

import {
	cameraZoom,
	resolveCameraSpec,
	resolveCameraZoom,
	zoomedView,
} from '../packages/engine-mechanics/src/camera.js';
import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	BUTTONS,
	MOVE_SCALE,
	characterBody,
	clampInput,
	sanitizeInput,
} from '../packages/engine-mechanics/src/online.js';
import {
	BOT_PREFIX,
	botInput,
	createBot,
	isBotId,
} from '../packages/engine-mechanics/src/onlineBots.js';
import { ONLINE_EVENT, STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import {
	ONLINE_GENERATORS,
	generatedOnlineGame,
} from '../packages/engine-mechanics/src/onlineGenerators.js';
import {
	SALMONS_LOBBY,
	SALMONS_SEED,
	salmonsConfig,
	salmonsGeometry,
	salmonsRiver,
} from '../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	BOT_AIM,
	BOT_SWIPE,
	LINE,
	SIGHT,
	inSight,
	pullIntoSight,
} from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	SHOWN_GRID,
	SHOWN_MAX,
	SHOWN_SHAPE,
	boxRegion,
	holdView,
	nearbyHolds,
	pastRegion,
	regionHolds,
	shownOf,
	viewRegion,
	widestRegion,
} from '../packages/engine-mechanics/src/shown.js';
import {
	isoProject,
	isoProjectMirrored,
	isoUnproject,
	isoViewRect,
	sceneProjector,
} from '../packages/engine-layout/src/lib/projection.ts';
import { salmonsReferenceLayout } from '../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import {
	sceneCamera,
	sceneCameraZoom,
	worldCameraScene,
} from '../packages/engine-layout/src/lib/worldCamera.ts';
import {
	ARCADE_ONLINE_BOT_DEFAULTS,
	ONLINE_GENERATOR_IDS,
	normalizeGameConfigDoc,
	onlineGameOf,
	resolveArcadeOnline,
} from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { NEARBY_MARGIN, VIEW_HOLD_SECONDS } from '../services/game-server/src/arcadeRoom.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim, RoomRefusal } from '../services/game-server/src/roomSim.ts';
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

await check('a bot aims a line only at a target it sees and its device would be sent', () => {
	const playerOf = (id, character, at, extra) => ({
		id,
		character: { id: character },
		body: characterBody(id, { shape: 'circle', r: 20, tags: [character] }, at),
		connected: true,
		status: STATUS.free,
		...extra,
	});
	const self = playerOf('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
	/** Where a bot with `ability` aims its press at a fish at `at`; `undefined`: it does not press. */
	const aimOf = (ability, at, options) => {
		const bot = createBot({
			brain: STILL,
			seed: 1,
			at: self.body,
			abilities: [ability],
			character: 'bear',
		});
		const players = [self, playerOf('a', 'fish', at)];
		const input = botInput(bot, self, players, {
			dt: 1 / 30,
			speed: 150,
			field: FIELD,
			view: 0,
			...options,
		});
		return input.buttons & BUTTONS.ability1 ? { x: input.aimX, y: input.aimY } : undefined;
	};
	const LINE = { ...CATCH, effect: 'hook' };
	// 1000 px along x and 600 along y from the bot.
	const far = { x: 1500, y: 1100 };
	assert.deepEqual(aimOf(LINE, far), far, 'neither: at any distance, at its place');
	const asked = [];
	const sees = (seen) => (who, at) => {
		asked.push([who, at.x, at.y]);
		return seen;
	};
	assert.deepEqual(aimOf(LINE, far, { sees: sees(true) }), far, 'seen: at its place');
	assert.deepEqual(asked, [[self, far.x, far.y]], 'the rules are asked of the bot and the place');
	assert.equal(aimOf(LINE, far, { sees: sees(false) }), undefined, 'not seen: no press');
	for (const [box, sent] of [
		[{ w: 2400, h: 1300 }, true],
		[{ w: 2000, h: 1200 }, true],
		[{ w: 1998, h: 1300 }, false],
		[{ w: 2400, h: 1198 }, false],
	])
		assert.equal(
			aimOf(LINE, far, { nearby: box, sees: sees(true) }) !== undefined,
			sent,
			`a ${box.w} × ${box.h} box about the bot: ${sent ? 'sent, so cast at' : 'not sent, so not'}`,
		);
	// Any other ability is pressed within its reach, whatever is seen or sent.
	const none = { sees: sees(false), nearby: { w: 2, h: 2 } };
	const close = { x: 500 + CATCH.reach, y: 500 };
	assert.deepEqual(aimOf(CATCH, close, none), close, 'a swipe: within reach');
	assert.equal(aimOf(CATCH, { x: close.x + 1, y: 500 }, { sees: sees(true) }), undefined);
	assert.deepEqual(aimOf({ ...CATCH, ahead: 40 }, { x: close.x + 40, y: 500 }, none), {
		x: close.x + 40,
		y: 500,
	});
	// A room whose rules have no module, or one that says nothing of sight, sees everything.
	for (const rules of [undefined, { module: 'tag' }]) {
		const sim = roomOf({ characters: CHARACTERS, rules });
		assert.equal(sim.rules.sees(self, { x: 1e6, y: -1e6 }), true);
	}
});

/** A fish-hooking line for a bear bot, and the limits of a bot's aim the checks below play with
 *  (those of an aimed ability: `aimed`). */
const HOOK = { ...CATCH, effect: 'hook', onPress: true };
const AIMED = { reactMs: { min: 400, max: 1200 }, surePx: 100, spread: 0.5 };
const AIM = { aimed: AIMED };
const DT = 1 / 30;
const stepsOf = (ms) => Math.round(ms / 1000 / DT);
const standIn = (id, character, at, extra) => ({
	id,
	character: { id: character },
	body: characterBody(id, { shape: 'circle', r: 20, tags: [character] }, at),
	connected: true,
	status: STATUS.free,
	...extra,
});
/** A swipe for a bear bot (pressed for a fish within its reach, once a press), and the reaction
 *  time the checks below give it (the limit of an ability pressed within reach: `inReach`). */
const SWIPE = { ...CATCH, onPress: true };
const REACH = { reactMs: { min: 300, max: 900 } };
/** A bot with the line at (500, 500), its aim `limited` by {@link AIM} or a machine's, and its next
 *  input among `fish`: the aim of its press, or `undefined` when it does not press. */
const hookBot = (seed, limited = true) => {
	const self = standIn('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
	const bot = createBot({
		brain: STILL,
		seed,
		at: self.body,
		abilities: [HOOK],
		character: 'bear',
	});
	const next = (fish, options) => {
		const input = botInput(bot, self, [self, ...fish], {
			dt: DT,
			speed: 150,
			field: FIELD,
			view: 0,
			aim: limited ? AIM : undefined,
			...options,
		});
		return input.buttons & BUTTONS.ability1 ? { x: input.aimX, y: input.aimY } : undefined;
	};
	return { self, bot, next };
};
/** A bot with the swipe at (500, 500), `limited` by {@link REACH} or a machine's: whether its next
 *  input among `fish` presses it. */
const swipeBot = (seed, limited = true) => {
	const self = standIn('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
	const bot = createBot({
		brain: STILL,
		seed,
		at: self.body,
		abilities: [SWIPE],
		character: 'bear',
	});
	const next = (fish) => {
		const input = botInput(bot, self, [self, ...fish], {
			dt: DT,
			speed: 150,
			field: FIELD,
			view: 0,
			aim: limited ? { inReach: REACH } : undefined,
		});
		return (input.buttons & BUTTONS.ability1) !== 0;
	};
	return { next };
};
/** How many inputs go by before the bot presses with `fish` in its sight (`limit` at most). */
const inputsUntilPress = (next, fish, limit = 200) => {
	for (let n = 0; n < limit; n++) if (next(fish)) return n;
	return undefined;
};

await check('a bot with a reaction time does not cast at a target before it has watched it', () => {
	const fish = [standIn('a', 'fish', { x: 1300, y: 500 })];
	// A machine (no limits) presses on its very first input.
	assert.equal(inputsUntilPress(hookBot(1, false).next, fish), 0);
	const waits = [];
	for (let seed = 1; seed <= 40; seed++) {
		const waited = inputsUntilPress(hookBot(seed).next, fish);
		assert.ok(
			waited >= stepsOf(AIMED.reactMs.min) && waited <= stepsOf(AIMED.reactMs.max),
			`seed ${seed}: pressed after ${waited} inputs, outside ${AIMED.reactMs.min}–${AIMED.reactMs.max} ms`,
		);
		assert.equal(inputsUntilPress(hookBot(seed).next, fish), waited, 'a seed: its reaction');
		waits.push(waited);
	}
	assert.ok(new Set(waits).size > 10, 'each bot draws its own reaction time');
	// The wait is the target's time IN SIGHT: one input out of it and the bot starts again.
	const { next } = hookBot(3);
	const full = inputsUntilPress(hookBot(3).next, fish);
	for (let n = 0; n < full; n++) assert.equal(next(fish), undefined);
	assert.equal(next(fish, { sees: () => false }), undefined, 'out of sight when it was due');
	const again = inputsUntilPress(next, fish);
	assert.ok(again >= stepsOf(AIMED.reactMs.min), `it watched anew (${again} inputs)`);
	// Each target has its own: a nearer one that only just came into sight is not cast at yet.
	const two = hookBot(5);
	const lone = inputsUntilPress(hookBot(5).next, fish);
	for (let n = 0; n < lone; n++) assert.equal(two.next(fish), undefined);
	const late = standIn('b', 'fish', { x: 700, y: 500 });
	const press = two.next([...fish, late]);
	assert.ok(press && press.x > 900, 'cast at the one it has watched, not at the newcomer');
});

await check('a bot waits again after a cast: while its line is out, and once it is home', () => {
	const fish = [standIn('a', 'fish', { x: 1300, y: 500 })];
	for (let seed = 1; seed <= 20; seed++) {
		const { self, next } = hookBot(seed);
		const first = inputsUntilPress(next, fish);
		assert.ok(first !== undefined);
		// The room took the cast: its line is out for a while, however long.
		self.lineActive = 1;
		for (let n = 0; n < 150; n++) assert.equal(next(fish), undefined, 'line out: no press');
		self.lineActive = 0;
		const second = inputsUntilPress(next, fish);
		assert.ok(
			second >= stepsOf(AIMED.reactMs.min) && second <= stepsOf(AIMED.reactMs.max),
			`seed ${seed}: the next cast ${second} inputs after the line came home`,
		);
		// A cast the room refused (no line went out) is waited after as well: no press every other
		// input, as a machine's.
		const third = inputsUntilPress(next, fish);
		assert.ok(third >= stepsOf(AIMED.reactMs.min), `seed ${seed}: ${third} inputs after a refusal`);
	}
	// A machine presses again every other input (`onPress`), line or no line.
	const machine = hookBot(1, false);
	machine.self.lineActive = 1;
	assert.deepEqual(
		[0, 1, 2, 3].map(() => machine.next(fish) !== undefined),
		[true, false, true, false],
	);
});

await check('a bot’s long cast falls short of its target, by more the longer it is', () => {
	/** The aim of the first press at a fish `px` to the right of the bot, less the fish's place. */
	const errorOf = (seed, px, limited) => {
		const at = { x: 500 + px, y: 500 };
		const { next } = hookBot(seed, limited);
		const fish = [standIn('a', 'fish', at)];
		let press;
		for (let n = 0; n < 200 && !press; n++) press = next(fish);
		return { x: press.x - at.x, y: press.y - at.y };
	};
	const SEEDS = 400;
	const mean = (px) => {
		let sum = 0;
		const width = (px - AIMED.surePx) * AIMED.spread;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const { x, y } = errorOf(seed, px);
			// Inside the disc that reaches from the fish back towards the bot: never beyond the fish.
			assert.ok(x <= 1e-3, `${px} px, seed ${seed}: ${x} px beyond its target`);
			assert.ok(
				Math.hypot(x + width / 2, y) <= width / 2 + 1e-3,
				`${px} px, seed ${seed}: (${x}, ${y}) is outside a ${width} px disc`,
			);
			sum += Math.hypot(x, y);
		}
		return sum / SEEDS;
	};
	// Within the sure distance: on the target, as a machine at any distance.
	for (let seed = 1; seed <= 20; seed++) {
		assert.deepEqual(errorOf(seed, AIMED.surePx / 2), { x: 0, y: 0 });
		assert.deepEqual(errorOf(seed, AIMED.surePx), { x: 0, y: 0 });
		assert.deepEqual(errorOf(seed, 1000, false), { x: 0, y: 0 }, 'a machine: at its place');
	}
	// Past it the error grows with the cast: evenly over a disc as wide as `spread` of the rest of
	// it, whose points are 16 / 9π of its width from a point of its edge on average.
	const lengths = [300, 500, 800, 1100];
	const means = lengths.map(mean);
	lengths.forEach((px, i) => {
		const expected = ((px - AIMED.surePx) * AIMED.spread * 16) / (9 * Math.PI);
		assert.ok(
			Math.abs(means[i] - expected) < expected * 0.08,
			`a ${px} px cast lands ${means[i].toFixed(1)} px off on average, not ${expected.toFixed(1)}`,
		);
		if (i) assert.ok(means[i] > means[i - 1] * 1.2, 'a longer cast lands further off');
	});
	// The error is drawn for each cast, from the bot's own stream.
	const some = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(errorOf(seed, 800))));
	assert.equal(some.size, 5, 'each bot its own');
	assert.deepEqual(errorOf(9, 800), errorOf(9, 800), 'a seed: its casts');
	const { next } = hookBot(9);
	const fish = [standIn('a', 'fish', { x: 1300, y: 500 })];
	const three = new Set();
	for (let n = 0; n < 400 && three.size < 3; n++) {
		const press = next(fish);
		if (press) three.add(JSON.stringify(press));
	}
	assert.equal(three.size, 3, 'three casts at one place: three places');
});

/** {@link AIMED} with a moment's lag of the eye and no long cast falling short (every cast within
 *  the sure distance), and the same with a rest after each cast. */
const LAGGED = { ...AIMED, surePx: 1e4, lagMs: { min: 300, max: 600 } };
const RESTED = { ...AIMED, restMs: { min: 2000, max: 3000 } };

await check('a bot casts at what it saw: to the side of a moving target, on a still one', () => {
	/** The first press's aim less the fish's place then, the fish stepping `(vx, vy)` px an input
	 *  from `at`: along the bot's line to it (`along`, + beyond it) and across it (`across`, + to the
	 *  side the fish steps across it). */
	const castAt = (seed, at, vx, vy, aimed = LAGGED) => {
		const self = standIn('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
		const bot = createBot({
			brain: STILL,
			seed,
			at: self.body,
			abilities: [HOOK],
			character: 'bear',
		});
		const fish = standIn('a', 'fish', { ...at });
		for (let n = 0; n < 200; n++) {
			fish.body.x += vx;
			fish.body.y += vy;
			const input = botInput(bot, self, [self, fish], {
				dt: DT,
				speed: 150,
				field: FIELD,
				view: 0,
				aim: { aimed },
			});
			if (!(input.buttons & BUTTONS.ability1)) continue;
			const ex = input.aimX - fish.body.x;
			const ey = input.aimY - fish.body.y;
			const d = Math.hypot(fish.body.x - 500, fish.body.y - 500);
			const [ux, uy] = [(fish.body.x - 500) / d, (fish.body.y - 500) / d];
			const sign = vx * -uy + vy * ux < 0 ? -1 : 1;
			return { along: ex * ux + ey * uy, across: sign * (ex * -uy + ey * ux) };
		}
		return undefined;
	};
	const least = stepsOf(LAGGED.lagMs.min);
	const most = stepsOf(LAGGED.lagMs.max);
	const offs = new Set();
	/** As far as a fish stepping 4 px an input goes in a lag, px, within float error. */
	const inLag = (px) => px >= 4 * least - 0.01 && px <= 4 * most + 0.01;
	for (let seed = 1; seed <= 40; seed++) {
		// Still: on it.
		assert.deepEqual(castAt(seed, { x: 900, y: 500 }, 0, 0), { along: 0, across: 0 });
		// Across his line, either way: to the side it came from, by as far as it went in the lag;
		// never short (it would swim into the bobber) nor beyond (the line is reeled home through it).
		for (const vy of [4, -4]) {
			const off = castAt(seed, { x: 900, y: 500 }, 0, vy);
			assert.ok(Math.abs(off.along) < 0.01, `seed ${seed}: ${off.along} px along his line`);
			assert.ok(-off.across > 0 && inLag(-off.across), `seed ${seed}: ${off.across} px across`);
			offs.add(off.across);
		}
		// Straight at him: to one side, by as far as it came.
		const at = castAt(seed, { x: 1300, y: 500 }, -4, 0);
		assert.ok(Math.abs(at.along) < 0.01 && inLag(Math.abs(at.across)), `seed ${seed}: at him`);
	}
	assert.ok(offs.size >= 4, 'each cast draws its own lag');
	// It looks back no further than it has watched: with a reaction time shorter than the lag, by
	// as far as the target went while watched.
	const quick = { ...LAGGED, reactMs: { min: 100, max: 100 }, lagMs: { min: 600, max: 600 } };
	const short = castAt(1, { x: 900, y: 500 }, 0, 4, quick);
	assert.ok(Math.abs(-short.across - 4 * stepsOf(100)) < 0.01, `${short.across} px: its watch`);
	// None named: on the moving target, as before.
	const machine = castAt(1, { x: 900, y: 500 }, 0, 4, { ...LAGGED, lagMs: undefined });
	assert.ok(Math.hypot(machine.along, machine.across) < 0.01, 'no lag: on it');
});

await check('a bot rests after a cast before it watches the water again', () => {
	const fish = [standIn('a', 'fish', { x: 1300, y: 500 })];
	const rested = (seed, aimed) => {
		const self = standIn('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
		const bot = createBot({
			brain: STILL,
			seed,
			at: self.body,
			abilities: [HOOK],
			character: 'bear',
		});
		const next = () =>
			botInput(bot, self, [self, ...fish], {
				dt: DT,
				speed: 150,
				field: FIELD,
				view: 0,
				aim: { aimed },
			}).buttons & BUTTONS.ability1;
		const presses = [];
		for (let n = 0; n < 1000 && presses.length < 4; n++) {
			if (next()) presses.push(n);
			// Its line is out for a second after each cast, then home.
			self.lineActive = presses.length && n - presses.at(-1) < 30 ? 1 : 0;
		}
		return presses.slice(1).map((n, i) => n - presses[i]);
	};
	const gaps = [];
	for (let seed = 1; seed <= 30; seed++) {
		for (const gap of rested(seed, RESTED)) {
			// From the cast: its rest, then a reaction time from the first input it looks again.
			const low = stepsOf(RESTED.restMs.min) + stepsOf(RESTED.reactMs.min);
			const high = stepsOf(RESTED.restMs.max) + stepsOf(RESTED.reactMs.max) + 1;
			assert.ok(
				gap >= low && gap <= high,
				`seed ${seed}: casts ${gap} inputs apart, not ${low}–${high}`,
			);
			gaps.push(gap);
		}
		// With no rest named it looks again as soon as the line is home.
		for (const gap of rested(seed, AIMED))
			assert.ok(gap <= 30 + stepsOf(AIMED.reactMs.max) + 1, `seed ${seed}: ${gap} with no rest`);
	}
	assert.ok(new Set(gaps).size > 10, 'each rest drawn for its cast');
	assert.deepEqual(rested(7, RESTED), rested(7, RESTED), 'a seed: its rests');
});

await check('a game whose rules name no limits for a bot’s aim has none', () => {
	for (const rules of [
		undefined,
		{ module: 'tag' },
		{ module: 'sandbanks' },
		{ module: 'waterfallClimb' },
		{ module: 'goldenSalmon' },
	])
		assert.equal(roomOf({ characters: CHARACTERS, rules }).rules.botAim, undefined);
	// Salmons names them, in cells; its line's module carries its own to the room in px, and the
	// whole game's adds the bears'.
	const aimed = {
		reactMs: BOT_AIM.reactMs,
		lagMs: BOT_AIM.lagMs,
		restMs: BOT_AIM.restMs,
		surePx: BOT_AIM.sureCells * CELL,
		spread: BOT_AIM.spread,
	};
	const limitsOf = (module) => roomOf({ characters: CHARACTERS, rules: { module } }).rules.botAim;
	assert.deepEqual(limitsOf('fishingLine'), { aimed });
	assert.deepEqual(limitsOf('salmons'), { aimed, inReach: { reactMs: BOT_SWIPE.reactMs } });
	// A bot's aim draws from a stream of its own: its brain does what it did before it had one.
	const wander = {
		initial: 'roam',
		states: [{ id: 'roam', behaviour: 'wander', params: { speed: 100, turnEvery: 500 } }],
		transitions: [],
	};
	const moves = (aim, ability = HOOK, px = 800) => {
		const self = standIn('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
		const bot = createBot({
			brain: wander,
			seed: 4,
			at: self.body,
			abilities: [ability],
			character: 'bear',
		});
		const fish = [self, standIn('a', 'fish', { x: 500 + px, y: 500 })];
		return Array.from({ length: 240 }, () => {
			const input = botInput(bot, self, fish, { dt: DT, speed: 150, field: FIELD, view: 0, aim });
			return [input.moveX, input.moveY];
		});
	};
	assert.deepEqual(moves(AIM), moves(undefined));
	assert.ok(new Set(moves(AIM).map(String)).size > 3, 'and it wanders');
	// The same for a swipe's reaction time, with a fish in its reach.
	assert.deepEqual(moves({ inReach: REACH }, SWIPE, 60), moves(undefined, SWIPE, 60));
});

await check('a bot with a reaction time for its reach does not swipe at a target before it', () => {
	const near = [standIn('a', 'fish', { x: 500 + SWIPE.reach, y: 500 })];
	const far = [standIn('a', 'fish', { x: 500 + SWIPE.reach + 1, y: 500 })];
	// A machine (no limits) presses on its very first input with a target in reach.
	assert.equal(inputsUntilPress(swipeBot(1, false).next, near), 0);
	const waits = [];
	for (let seed = 1; seed <= 40; seed++) {
		const waited = inputsUntilPress(swipeBot(seed).next, near);
		assert.ok(
			waited >= stepsOf(REACH.reactMs.min) && waited <= stepsOf(REACH.reactMs.max),
			`seed ${seed}: pressed after ${waited} inputs, outside ${REACH.reactMs.min}–${REACH.reactMs.max} ms`,
		);
		assert.equal(inputsUntilPress(swipeBot(seed).next, near), waited, 'a seed: its reaction');
		waits.push(waited);
	}
	assert.ok(new Set(waits).size > 8, 'each bot draws its own reaction time');
	// The wait is the target's time IN REACH: what it spent just out of it does not count.
	const { next } = swipeBot(3);
	for (let n = 0; n < 100; n++) assert.equal(next(far), false, 'out of reach: no press');
	const then = inputsUntilPress(next, near);
	assert.ok(then >= stepsOf(REACH.reactMs.min), `in reach for ${then} inputs before the press`);
	// One input out of reach and the bot starts again.
	const back = swipeBot(4);
	const full = inputsUntilPress(swipeBot(4).next, near);
	for (let n = 0; n < full; n++) assert.equal(back.next(near), false);
	assert.equal(back.next(far), false, 'out of reach when it was due');
	const again = inputsUntilPress(back.next, near);
	assert.ok(again >= stepsOf(REACH.reactMs.min), `it waited anew (${again} inputs)`);
});

await check('a bot waits again after each swipe', () => {
	const near = [standIn('a', 'fish', { x: 560, y: 500 })];
	for (let seed = 1; seed <= 20; seed++) {
		const { next } = swipeBot(seed);
		assert.ok(inputsUntilPress(next, near) !== undefined);
		const gaps = [inputsUntilPress(next, near), inputsUntilPress(next, near)];
		for (const gap of gaps)
			assert.ok(
				gap >= stepsOf(REACH.reactMs.min) && gap <= stepsOf(REACH.reactMs.max),
				`seed ${seed}: the next swipe ${gap} inputs after the last`,
			);
	}
	// A machine presses again every other input (`onPress`).
	const machine = swipeBot(1, false);
	assert.deepEqual(
		[0, 1, 2, 3].map(() => machine.next(near)),
		[true, false, true, false],
	);
});

await check('each kind of ability is limited only when the rules name its limit', () => {
	const near = [standIn('a', 'fish', { x: 560, y: 500 })];
	const pressOf = (ability, aim) => {
		const self = standIn('bot:1', 'bear', { x: 500, y: 500 }, { bot: true });
		const bot = createBot({
			brain: STILL,
			seed: 2,
			at: self.body,
			abilities: [ability],
			character: 'bear',
		});
		const input = botInput(bot, self, [self, ...near], {
			dt: DT,
			speed: 150,
			field: FIELD,
			view: 0,
			aim,
		});
		return input.buttons & BUTTONS.ability1 ? { x: input.aimX, y: input.aimY } : undefined;
	};
	// A game that limits only its aimed ability (a line with no bears) leaves a swipe a machine's.
	assert.deepEqual(pressOf(SWIPE, AIM), { x: 560, y: 500 });
	assert.deepEqual(pressOf(SWIPE, {}), { x: 560, y: 500 });
	assert.equal(pressOf(SWIPE, { ...AIM, inReach: REACH }), undefined, 'named: it waits');
	// And one that limits only its swipe leaves an aimed ability a machine's.
	assert.deepEqual(pressOf(HOOK, { inReach: REACH }), { x: 560, y: 500 });
	assert.equal(pressOf(HOOK, { ...AIM, inReach: REACH }), undefined, 'named: it waits');
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

// --- 3. the device's view --------------------------------------------------------------------------

/** A box with a `max` far past anything declared here, so only the declared view limits. */
const ROOMY = { w: 800, h: 600, max: { w: 20_000, h: 20_000 } };
const flat = (shownW, shownH) => ({ shownW, shownH, shownIso: SHOWN_SHAPE.flat });
const iso = (shownW, shownH) => ({ shownW, shownH, shownIso: SHOWN_SHAPE.iso });

await check('a flat view and an isometric one each hold their own offsets and no others', () => {
	const box = viewRegion(ROOMY, flat(2000, 1000));
	for (const [dx, dy] of [
		[0, 0],
		[1000, 500],
		[-1000, 500],
		[1000, -500],
		[-1000, -500],
	])
		assert.ok(regionHolds(box, dx, dy), `a flat 2000 × 1000 view holds (${dx}, ${dy})`);
	for (const [dx, dy] of [
		[1001, 0],
		[0, 501],
		[-1001, -500],
		[1000, -501],
	])
		assert.ok(!regionHolds(box, dx, dy), `…and not (${dx}, ${dy})`);

	// An isometric 2400 × 1000 view: a rectangle of the world turned 45°.
	const view = { w: 2400, h: 1000 };
	const turned = viewRegion(ROOMY, iso(view.w, view.h));
	const corners = [
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1],
	].map(([sx, sy]) => isoUnproject((sx * view.w) / 2, (sy * view.h) / 2));
	assert.deepEqual(
		corners.map((c) => [c.x, c.y]),
		[
			[1100, -100],
			[-100, 1100],
			[100, -1100],
			[-1100, 100],
		],
		'the screen’s four corners, in the world',
	);
	for (const c of corners) {
		assert.ok(regionHolds(turned, c.x, c.y), `its corner (${c.x}, ${c.y}) is held`);
		assert.ok(!regionHolds(turned, c.x * 1.001, c.y * 1.001), 'and nothing just past it');
	}
	// Inside the view's bounding box in the world (what an axis-aligned box would send), off the
	// screen: past its lower edge, its right one and its upper one.
	const bounds = isoViewRect({ x: -view.w / 2, y: -view.h / 2 }, view);
	assert.deepEqual([bounds.x1, bounds.y1], [1100, 1100]);
	for (const [dx, dy] of [
		[1000, 1000],
		[1000, -1000],
		[-600, -600],
	]) {
		assert.ok(Math.abs(dx) <= bounds.x1 && Math.abs(dy) <= bounds.y1);
		assert.ok(!regionHolds(turned, dx, dy), `(${dx}, ${dy}) is in its bounding box, not in it`);
	}
	// The one answer the layout's projection gives, mirrored or not, for any offset.
	const rng = createRng('shown:iso');
	let inside = 0;
	for (let i = 0; i < 20_000; i++) {
		const dx = (rng() * 2 - 1) * 1500;
		const dy = (rng() * 2 - 1) * 1500;
		const held = regionHolds(turned, dx, dy);
		for (const project of [isoProject, isoProjectMirrored]) {
			const at = project(dx, dy);
			assert.equal(
				held,
				Math.abs(at.x) <= view.w / 2 && Math.abs(at.y) <= view.h / 2,
				`(${dx}, ${dy}) is drawn at (${at.x}, ${at.y})`,
			);
		}
		inside += held ? 1 : 0;
	}
	assert.ok(inside > 4000 && inside < 16_000, `${inside} of 20000 samples are on the screen`);
});

/** Whether a device of a room with `nearby` is sent a player `dx`, `dy` from its own, saying
 *  `shown` (no hold: one patch's answer), `past` further out for one it already holds. */
const sends = (nearby, shown, dx, dy, past = 0) =>
	nearbyHolds(boxRegion(nearby, past), pastRegion(viewRegion(nearby, shown), past), dx, dy);

await check(
	'with a max a device is sent the box and the view it declares, as far as the max',
	() => {
		const nearby = { w: 3300, h: 3300, max: { w: 6400, h: 4600 } };
		const boxOnly = { w: nearby.w, h: nearby.h };
		assert.deepEqual(boxRegion(nearby), { x: 1650, y: 1650, across: Infinity, down: Infinity });
		// Nothing declared, or no max: no view, so the box alone.
		for (const nothing of [undefined, {}, flat(0, 0), iso(0, 2000)])
			assert.equal(viewRegion(nearby, nothing), undefined, 'nothing declared: no view');
		for (const shown of [flat(6000, 6000), iso(600, 600), flat(SHOWN_MAX, SHOWN_MAX)])
			assert.equal(viewRegion(boxOnly, shown), undefined, 'no max: no view, whatever it says');
		// A larger view adds a player the box would not send.
		const large = iso(4032, 2368);
		assert.ok(!sends(nearby, undefined, 0, -1728) && sends(nearby, large, 0, -1728), '36 cells');
		assert.ok(!sends(boxOnly, large, 0, -1728), 'and not without a max');
		// A flat view: the smaller of the view and the max on each axis.
		assert.deepEqual(viewRegion(nearby, flat(5000, 9000)), {
			x: 2500,
			y: 2300,
			across: Infinity,
			down: Infinity,
		});
		assert.deepEqual(viewRegion(nearby, flat(SHOWN_MAX, SHOWN_MAX)), {
			x: 3200,
			y: 2300,
			across: Infinity,
			down: Infinity,
		});
		// An isometric view past the max is the max box: its corner is held, a px past a side is not.
		const most = viewRegion(nearby, iso(SHOWN_MAX, SHOWN_MAX));
		assert.ok(regionHolds(most, 3200, 2300) && regionHolds(most, -3200, -2300));
		assert.ok(!regionHolds(most, 3201, 0) && !regionHolds(most, 0, 2301));
		// One inside the max in the world keeps its own shape: the max cuts only its tips.
		const cut = viewRegion(nearby, iso(6000, 3000));
		assert.ok(regionHolds(cut, 1500, -1500), 'the screen’s right corner, inside the max');
		assert.ok(!regionHolds(cut, 0, 2400), 'past the max’s height, though on the screen');
		assert.ok(!regionHolds(cut, 2000, 2000), 'inside the max, off the screen');
		// Kept: every limit the margin further out, the box's and the view's. The max bounds who comes
		// in; one already sent stays until 25 % past it, as with the box.
		for (const shown of [flat(5000, 3000), large, flat(SHOWN_MAX, SHOWN_MAX)]) {
			const enter = viewRegion(nearby, shown);
			const keep = pastRegion(enter, NEARBY_MARGIN);
			for (const limit of ['x', 'y', 'across', 'down'])
				assert.equal(keep[limit], enter[limit] * (1 + NEARBY_MARGIN), `${limit} kept 25 % past`);
		}
		assert.equal(pastRegion(undefined, NEARBY_MARGIN), undefined, 'no view, none kept');
		assert.deepEqual(boxRegion(nearby, NEARBY_MARGIN), {
			x: 2062.5,
			y: 2062.5,
			across: Infinity,
			down: Infinity,
		});
		assert.ok(!sends(nearby, large, 0, -2100) && sends(nearby, large, 0, -2100, NEARBY_MARGIN));
		assert.ok(!sends(nearby, large, 0, -2600, NEARBY_MARGIN), 'and let go past the margin');
		const all = pastRegion(viewRegion(nearby, flat(SHOWN_MAX, SHOWN_MAX)), NEARBY_MARGIN);
		assert.deepEqual([all.x, all.y], [4000, 2875], 'kept to 25 % past the max, not to the max');
	},
);

await check('a declared view only adds: a device is never sent less than the box', () => {
	const nearby = { w: 3300, h: 3300, max: { w: 6400, h: 6400 } };
	const boxOnly = { w: nearby.w, h: nearby.h };
	// A phone's view is smaller than the box across the screen: 25 cells up-river is off it.
	const phone = iso(1376, 2720);
	assert.ok(!regionHolds(viewRegion(nearby, phone), 0, -1200), 'off the phone’s own view');
	assert.ok(sends(nearby, phone, 0, -1200), 'sent all the same: it is in the box');
	// Whatever a device says, it is sent every player a room with no max sends it, coming in and
	// kept; and a view no larger than the box adds nobody.
	const rng = createRng('shown:superset');
	const views = [phone, iso(2720, 1376), iso(2496, 1504), flat(400, 400), flat(64, 6000)];
	let inBox = 0;
	let added = 0;
	for (let i = 0; i < 20_000; i++) {
		const dx = (rng() * 2 - 1) * 3600;
		const dy = (rng() * 2 - 1) * 3600;
		for (const past of [0, NEARBY_MARGIN]) {
			const onMain = sends(boxOnly, undefined, dx, dy, past);
			for (const shown of [...views, iso(4032, 2368), flat(SHOWN_MAX, SHOWN_MAX)])
				if (onMain) assert.ok(sends(nearby, shown, dx, dy, past), `(${dx}, ${dy}) is in the box`);
			if (!past) {
				inBox += onMain ? 1 : 0;
				added += !onMain && sends(nearby, iso(4032, 2368), dx, dy) ? 1 : 0;
			}
		}
		assert.equal(sends(nearby, flat(400, 400), dx, dy), sends(boxOnly, undefined, dx, dy));
	}
	assert.ok(inBox > 3000 && added > 100, `${inBox} in the box, ${added} more on a large window`);
});

await check('a view is held: it grows at once and shrinks at most once a window', () => {
	const nearby = { w: 800, h: 600, max: { w: 6400, h: 6400 } };
	const WINDOW = 20;
	const small = viewRegion(nearby, flat(400, 400));
	const large = viewRegion(nearby, flat(4000, 3000));
	/** The view the room sends by after each patch of `said` (a region a patch). */
	const play = (said) => {
		const views = [];
		let hold;
		for (const view of said) {
			hold = holdView(hold, view, WINDOW);
			views.push(hold.view);
		}
		return views;
	};
	// It grows the patch it is said.
	assert.deepEqual(play([small, small, large]), [small, small, large]);
	assert.deepEqual(play([undefined, large, undefined]), [undefined, large, large]);
	// Flipping between two views every other patch (or every patch): the larger, from the first
	// patch it was said, for good.
	for (const period of [1, 2, 3]) {
		const flips = Array.from({ length: 200 }, (_, i) =>
			Math.floor(i / period) % 2 ? small : large,
		);
		assert.ok(
			play(flips).every((view) => JSON.stringify(view) === JSON.stringify(large)),
			`flipping every ${period} patch(es) is holding the larger`,
		);
	}
	// A shape flip is covered too: the two widen to the box both fit in.
	const turned = viewRegion(nearby, iso(2200, 1100));
	const both = widestRegion(large, turned);
	assert.deepEqual(both, { x: 3200, y: 3200, across: Infinity, down: Infinity });
	assert.ok(
		play(Array.from({ length: 100 }, (_, i) => (i % 2 ? turned : large)))
			.slice(1)
			.every((view) => JSON.stringify(view) === JSON.stringify(both)),
	);
	assert.deepEqual(
		[widestRegion(undefined, small), widestRegion(small, undefined)],
		[small, small],
	);
	assert.equal(widestRegion(undefined, undefined), undefined);
	// A shrink for good takes effect between one window and two after the last larger view,
	// wherever in a window it falls; then the smaller is what it is sent by.
	for (const at of [1, 7, 19, 20, 21, 33]) {
		const said = Array.from({ length: at + 3 * WINDOW }, (_, i) => (i < at ? large : small));
		const views = play(said);
		const shrunk = views.findIndex((view) => JSON.stringify(view) === JSON.stringify(small));
		const after = shrunk - (at - 1);
		assert.ok(after > WINDOW && after <= 2 * WINDOW, `shrunk ${after} patches after the last`);
		assert.ok(views.slice(shrunk).every((view) => JSON.stringify(view) === JSON.stringify(small)));
	}
	// And one that stops saying anything has no view again within two windows.
	const stopped = play([large, ...Array.from({ length: 2 * WINDOW }, () => undefined)]);
	assert.equal(stopped.at(-1), undefined);
	assert.deepEqual(stopped[WINDOW], large, 'still held a window on');
	assert.equal(VIEW_HOLD_SECONDS, 1);
});

await check('junk a device can send declares nothing, and the step never reads a view', () => {
	const said = (shownW, shownH, shownIso) => {
		const input = sanitizeInput({ seq: 1, shownW, shownH, shownIso });
		return [input.shownW, input.shownH, input.shownIso];
	};
	assert.deepEqual(said(3072, 1824, 1), [3072, 1824, 1]);
	assert.deepEqual(said(3072.9, 1824.2, 0), [3072, 1824, 0], 'whole px');
	assert.deepEqual(said(1e9, 70_000, 1), [0xffff, 0xffff, 1], 'held to a uint16');
	for (const junk of [
		[Number.NaN, 1824, 1],
		[3072, -5, 1],
		[0, 1824, 1],
		[3072, 0, 0],
		[3072, 0.9, 1],
		[3072, 1824, 2],
		[3072, 1824, 255],
		[3072, 1824, -1],
		[3072, 1824, 0.5],
		[3072, 1824, Number.NaN],
		[3072, 1824, '1'],
		[3072, 1824, true],
		[3072, 1824, undefined],
		['3072', 1824, 1],
		[Number.NEGATIVE_INFINITY, Infinity, 1],
		[null, null, null],
		// What a device's own encoder makes of 70000 / -5 / shape 2, of NaN / 3.7 / 255 and of 1e9 /
		// Infinity / -1 before they reach the room (a uint16 wraps, a uint8 is kept).
		[4464, 65_531, 2],
		[0, 3, 255],
		[51_712, 0, 255],
	])
		assert.deepEqual(said(...junk), [0, 0, 0], `${JSON.stringify(junk)} declares nothing`);
	// A wrapped size with a real shape is simply a size: the max cuts it.
	assert.deepEqual(said(4464, 65_531, 1), [4464, 65_531, 1]);
	const nearby = { w: 800, h: 600, max: { w: 4000, h: 3000 } };
	const wrapped = viewRegion(nearby, sanitizeInput({ shownW: 4464, shownH: 65_531, shownIso: 0 }));
	assert.deepEqual([wrapped.x, wrapped.y], [2000, 1500]);
	assert.equal(
		viewRegion(nearby, sanitizeInput({ shownW: 4464, shownH: 65_531, shownIso: 7 })),
		undefined,
		'a shape that is neither: no view, the box alone',
	);
	// An input that says nothing keeps today's eight fields; one that says it carries three more,
	// and clamps to itself.
	assert.equal(Object.keys(clampInput({ seq: 1 })).length, 8);
	const once = clampInput({ seq: 1, shownW: 3072.5, shownH: 1824, shownIso: 1 });
	assert.deepEqual(
		[Object.keys(once).length, once.shownW, once.shownH, once.shownIso],
		[11, 3072, 1824, 1],
	);
	assert.deepEqual(clampInput(once), once);
	const half = clampInput({ seq: 1, shownIso: 1 });
	assert.deepEqual([half.shownW, half.shownH, half.shownIso], [0, 0, 0], 'half of one is none');
	// The same room, the same inputs, with and without a view on them: the same game.
	const play = (shown) => {
		const sim = roomOf({ characters: CHARACTERS, bots: BOTS, rules: { abilities: [CATCH] } }, 21);
		sim.join('a', { character: 'fish' });
		const events = run(sim, 400, (p, i) => ({
			moveX: Math.round(Math.sin(i / 15) * MOVE_SCALE),
			moveY: Math.round(Math.cos(i / 23) * MOVE_SCALE),
			...shown(i),
		}));
		return JSON.stringify({
			events,
			players: [...sim.players.values()].map((p) => [p.id, p.body.x, p.body.y, p.score, p.ack]),
		});
	};
	const plain = play(() => ({}));
	assert.equal(
		play(() => iso(3072, 1824)),
		plain,
	);
	assert.equal(
		play((i) => ({ shownW: i * 977, shownH: -i, shownIso: i % 5 })),
		plain,
	);
});

await check('a device declares its window over the camera’s zoom, on a 32 px grid', () => {
	assert.equal(SHOWN_GRID, 32);
	assert.ok(SHOWN_MAX <= 0xffff && SHOWN_MAX % SHOWN_GRID === 0 && SHOWN_MAX > 0xffff - 32);
	const ceil = (px) => Math.ceil(px / SHOWN_GRID) * SHOWN_GRID;
	const window = { w: 2560, h: 1080 };
	// A flat screen draws a world px at the layout box's scale: the window shows it over that.
	assert.deepEqual(
		shownOf({ window, windowScale: 1.35, margin: 40 }),
		flat(ceil(2560 / 1.35 + 80), ceil(1080 / 1.35 + 80)),
	);
	// A zoom counted in design px: over the scale and the zoom.
	assert.deepEqual(
		shownOf({
			window,
			windowScale: 1.35,
			zoom: cameraZoom({ zoom: 2 / 3 }, { windowScale: 1.35 }),
			iso: true,
			margin: 92,
		}),
		iso(ceil(2560 / 0.9 + 184), ceil(1080 / 0.9 + 184)),
	);
	// A zoom counted in window px: the same view however the layout's box fits the window.
	const inWindow = { zoom: 2 / 3, mobileZoom: 1 / 3, zoomIn: 'window' };
	for (const windowScale of [1, 1.35, 1.8, 0.4875]) {
		const zoom = cameraZoom(inWindow, { windowScale });
		assert.deepEqual(
			shownOf({ window, windowScale, zoom, iso: true, margin: 92 }),
			iso(4032, 1824),
			`box scale ${windowScale}`,
		);
	}
	// A view that lands on a grid line stays on it, whatever the last bit of its divisions says.
	const scaled = cameraZoom(inWindow, { windowScale: 1.35 });
	assert.ok(2160 / 1.35 / scaled + 184 > 3424, 'the divisions are not exact');
	assert.deepEqual(
		shownOf({
			window: { w: 3840, h: 2160 },
			windowScale: 1.35,
			zoom: scaled,
			iso: true,
			margin: 92,
		}),
		iso(5952, 3424),
	);
	assert.deepEqual(
		shownOf({ window, windowScale: 1, zoom: cameraZoom(inWindow, { windowScale: 1 }), iso: true }),
		iso(3840, 1632),
		'1620 px rounded up to the grid',
	);
	// The window's centre off the own player: each size grows by twice it, whichever way.
	const at = (off) => shownOf({ window, windowScale: 1, zoom: 2 / 3, iso: true, margin: 92, off });
	const rest = at(undefined);
	assert.deepEqual(rest, iso(4032, 1824));
	assert.deepEqual(at({ x: 0, y: 0 }), rest);
	assert.deepEqual(at({ x: 40, y: -72 }), iso(ceil(3840 + 184 + 80), ceil(1620 + 184 + 144)));
	assert.deepEqual(at({ x: -40, y: 72 }), at({ x: 40, y: -72 }));
	// A camera at rest or drifting a few px says the same thing on every input.
	for (const drift of [0.2, 1, 3, 4])
		assert.deepEqual(at({ x: drift, y: -drift }), rest, `${drift} px off: no new sizes`);
	assert.notDeepEqual(at({ x: 5, y: 0 }), rest, 'the next grid line');
	// No window, nothing said; a huge one is the most a uint16 carries.
	assert.deepEqual(shownOf({ window: { w: 0, h: 844 } }), flat(0, 0));
	assert.deepEqual(shownOf({ window: { w: 1e7, h: 1e7 }, iso: true }), iso(SHOWN_MAX, SHOWN_MAX));
});

// --- 4. Salmons as data ----------------------------------------------------------------------------

const salmonsShipped = gameOf(salmonsConfig());
/** Salmons with a few bears and fishermen by count, in turn, the room kept at 20: the scenarios
 *  below put one person among them, and are not about the room's mix (section 6 is). */
const salmons = (() => {
	const doc = salmonsConfig();
	const { online } = doc.arcade;
	online.bots = {
		characters: [
			{ character: 'bear', brain: 'bearBot' },
			{ character: 'fisherman', brain: 'fishermanBot' },
		],
		spawns: online.bots.spawns,
	};
	return gameOf(doc);
})();

await check('Salmons: the river is the seed’s, and its config is a valid online game', () => {
	assert.deepEqual(salmonsRiver(SALMONS_SEED), salmonsRiver(SALMONS_SEED));
	assert.notDeepEqual(salmonsRiver('another').bands, salmonsRiver(SALMONS_SEED).bands);
	assert.deepEqual(validateFamily(normalizeGameConfigDoc(salmonsConfig())), []);
	// The original's level, as exported: nothing but its zone rules' count, which its generator
	// makes again in the room (as before the bots' shares).
	assert.deepEqual(
		validateFamily(normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)))).map(
			(issue) => [issue.severity, issue.path],
		),
		[['warning', 'arcade.online.rules.zones']],
	);
	assert.equal(salmonsShipped.online.maxPlayers, 100);
	// Owner, 2026-11-20: 60% salmon, 25% fishermen, 15% bears when the room has no person; the
	// room is kept full, and a class's places are its share of it.
	assert.equal(salmonsShipped.online.bots.fillTo, 100, 'by shares the room is kept full');
	assert.deepEqual(salmonsShipped.online.bots.counts, { salmon: 60, fisherman: 25, bear: 15 });
	assert.equal(salmonsShipped.online.bots.canWin, false);
	assert.deepEqual(
		salmonsShipped.online.bots.characters.map((b) => [b.character, b.brain, b.share]),
		[
			['salmon', 'salmonBot', 60],
			['fisherman', 'fishermanBot', 25],
			['bear', 'bearBot', 15],
		],
	);
	assert.deepEqual(
		salmonsShipped.online.characters.map((c) => [c.id, c.max]),
		[
			['salmon', 60],
			['bear', 15],
			['fisherman', 25],
		],
		'no authored most: a class’s places follow from its share',
	);
	assert.deepEqual(Object.keys(salmonsShipped.brains).sort(), [
		'bearBot',
		'fishermanBot',
		'salmonBot',
	]);
	assert.ok(salmonsShipped.online.rules.zones.length <= 256, 'a room runs every zone rule');
	assert.equal(salmonsShipped.online.rules.round.nextRoundSeconds, 15, '§14 #6');
	assert.ok(salmonsShipped.online.nearby);
});

/**
 * The windows Salmons' `nearby` box is authored for: on a window no larger than these, a device is
 * sent every player its screen shows. `mobile` takes the camera's phone and tablet zoom.
 */
const NEARBY_WINDOWS = [
	{ name: 'a 1920 × 1080 desktop window', w: 1920, h: 1080, mobile: false },
	{ name: 'a 390 × 844 phone held upright', w: 390, h: 844, mobile: true },
];

await check('Salmons: the nearby box covers what its camera shows on the windows above', () => {
	// The config and the layout `scripts/salmons/export.mjs` writes: a person uploads them together.
	const river = salmonsMapRiver(SALMONS_MAP_SEED);
	const game = gameOf(salmonsConfig(river, { lobby: SALMONS_LOBBY }));
	const { nearby } = game.online;
	const scene = worldCameraScene(salmonsReferenceLayout(river).scenes);
	const zoomSpec = sceneCameraZoom(scene);
	const rework = 'This check does not work that out: rework it before trusting the box.';
	assert.ok(sceneProjector(scene), `Salmons’ river screen is no longer isometric. ${rework}`);
	assert.equal(
		resolveCameraZoom(zoomSpec).zoomIn,
		'window',
		'Salmons’ camera no longer zooms in window px, so what a window shows depends on how the ' +
			`layout’s box fits it. ${rework}`,
	);
	// The view is taken as centred on the own player: nothing may hold the camera off it.
	const { deadZone, lookAhead, clampToWorld, autoScroll } = resolveCameraSpec(sceneCamera(scene));
	assert.deepEqual(
		{ deadZone, lookAhead, clampToWorld, autoScroll },
		{ deadZone: { w: 0, h: 0 }, lookAhead: 0, clampToWorld: false, autoScroll: { x: 0, y: 0 } },
		'Salmons’ camera no longer keeps its own player at the centre of the window, so one side ' +
			`shows further than the other. ${rework}`,
	);
	// The room tests where a player stands. The margin is half the largest body on every side; a
	// look stands on its feet, so at the two lower corners its head can show a few px past that.
	const reach = Math.max(
		...game.online.characters.map(({ body }) => {
			const { shape, r, w, h } = game.bodies[body];
			return shape === 'circle' ? r : Math.max(w, h) / 2;
		}),
	);
	const needs = NEARBY_WINDOWS.map(({ name, w, h, mobile }) => {
		// A `window` zoom divides the box's scale out: the window is the view at a scale of 1.
		const view = zoomedView({ w, h }, cameraZoom(zoomSpec, { mobile, windowScale: 1 }));
		const seen = { w: view.w + 2 * reach, h: view.h + 2 * reach };
		// The room's test is axis-aligned, so the box has to cover the view's bounding box in the world.
		const box = isoViewRect({ x: -seen.w / 2, y: -seen.h / 2 }, seen);
		return { name, w: 2 * Math.ceil(box.x1), h: 2 * Math.ceil(box.y1) };
	});
	const short = needs.filter((need) => !(nearby.w >= need.w && nearby.h >= need.h));
	assert.deepEqual(
		short.map((need) => need.name),
		[],
		`Salmons’ nearby box (${nearby.w} × ${nearby.h}) sends less than its camera shows: ` +
			short.map((need) => `${need.name} shows players within ${need.w} × ${need.h} px`).join('; ') +
			'. A player then appears and vanishes inside the screen. Raise `nearby` in ' +
			'packages/engine-mechanics/src/salmons.js to cover them (and measure what it costs: ' +
			'scripts/room-load.mjs), or show less: SALMONS_CAMERA in ' +
			'packages/engine-layout/src/lib/referenceLayouts/salmons.ts.',
	);
});

/**
 * Windows larger than the box is authored for. A device there says what its window shows and is
 * sent that as well as the box, so Salmons' `nearby.max` has to cover it. `mobile` as above.
 */
const MAX_WINDOWS = [
	{ name: 'a 2560 × 1440 desktop window', w: 2560, h: 1440, mobile: false },
	{ name: 'a 3840 × 2160 desktop window at 100 %', w: 3840, h: 2160, mobile: false },
	{ name: 'a 1280 × 800 tablet', w: 1280, h: 800, mobile: true },
];

/**
 * Salmons as a person uploads it, and what a device says of a window there (`says`, however the
 * layout's box fits it). `reach` is the margin: the largest body's full size on every side, since
 * a look stands on its feet, so one standing a body below the window's lower edge still shows its
 * head (`apps/lines` `online.ts` `reach`).
 */
const salmonsScreen = () => {
	const river = salmonsMapRiver(SALMONS_MAP_SEED);
	const game = gameOf(salmonsConfig(river, { lobby: SALMONS_LOBBY }));
	const scene = worldCameraScene(salmonsReferenceLayout(river).scenes);
	const zoomSpec = sceneCameraZoom(scene);
	const reach = Math.max(
		...game.online.characters.map(({ body }) => {
			const { shape, r, w, h } = game.bodies[body];
			return shape === 'circle' ? 2 * r : Math.max(w, h);
		}),
	);
	const says = ({ w, h, mobile }, windowScale = 1) =>
		shownOf({
			window: { w, h },
			windowScale,
			zoom: cameraZoom(zoomSpec, { mobile, windowScale }),
			iso: sceneProjector(scene) !== undefined,
			margin: reach,
		});
	return { game, zoomSpec, reach, says };
};

await check('Salmons: a device declares what its camera shows, and nearby.max covers it', () => {
	const { game, zoomSpec, reach, says } = salmonsScreen();
	const { nearby } = game.online;
	assert.ok(nearby.max, 'Salmons no longer names a `nearby.max`: every device has the box alone');
	const short = [];
	for (const window of [...NEARBY_WINDOWS, ...MAX_WINDOWS]) {
		const { name, w, h, mobile } = window;
		// What the camera shows on the window, as the check above works it out, and the margin.
		const view = zoomedView({ w, h }, cameraZoom(zoomSpec, { mobile, windowScale: 1 }));
		const need = { w: view.w + 2 * reach, h: view.h + 2 * reach };
		// What the device says there, however the layout's box happens to fit the window.
		for (const windowScale of [1, 1.8, 0.4875]) {
			const shown = says(window, windowScale);
			assert.equal(shown.shownIso, SHOWN_SHAPE.iso, 'the isometric screen’s extents');
			for (const [said, needs] of [
				[shown.shownW, need.w],
				[shown.shownH, need.h],
			]) {
				assert.equal(said % SHOWN_GRID, 0);
				assert.ok(
					said > needs - 1e-3 && said < needs + SHOWN_GRID,
					`${name}, box scale ${windowScale}: it says ${said} px where its camera shows ` +
						`${needs} px: the first ${SHOWN_GRID} px step that covers it, and no more`,
				);
			}
			// The max is an axis-aligned box: it has to hold the view's bounding box in the world.
			const size = { w: shown.shownW, h: shown.shownH };
			const bounds = isoViewRect({ x: -size.w / 2, y: -size.h / 2 }, size);
			if (!(nearby.max.w >= 2 * bounds.x1 && nearby.max.h >= 2 * bounds.y1))
				short.push(`${name} shows players within ${2 * bounds.x1} × ${2 * bounds.y1} px`);
			else {
				const region = viewRegion(nearby, shown);
				for (const [sx, sy] of [
					[1, 1],
					[-1, 1],
					[1, -1],
					[-1, -1],
				]) {
					const corner = isoUnproject((sx * size.w) / 2, (sy * size.h) / 2);
					assert.ok(regionHolds(region, corner.x, corner.y), `${name}: a corner is cut`);
				}
			}
		}
	}
	assert.deepEqual(
		[...new Set(short)],
		[],
		`Salmons’ nearby.max (${nearby.max.w} × ${nearby.max.h}) cuts what a device declares: ` +
			`${[...new Set(short)].join('; ')}. A player then appears inside that screen. Raise ` +
			'`nearby.max` in packages/engine-mechanics/src/salmons.js (and measure what it costs: ' +
			'scripts/room-load.mjs --shown), or show less: SALMONS_CAMERA in ' +
			'packages/engine-layout/src/lib/referenceLayouts/salmons.ts.',
	);
});

/** A phone held upright: what it says its screen shows of Salmons' river is narrower across the
 *  screen than a fisherman's sight, so he can stand off it and hook the salmon in its middle. */
const PHONE = NEARBY_WINDOWS[1];

await check(
	'Salmons: a fisherman who can hook a salmon is sent to its device, whatever it says',
	() => {
		const { game, says } = salmonsScreen();
		const { nearby } = game.online;
		const phone = says(PHONE);
		assert.deepEqual(phone, iso(1376, 2720));
		const devices = [
			undefined,
			phone,
			says({ w: 844, h: 390, mobile: true }),
			says({ w: 1366, h: 768, mobile: false }),
			says(MAX_WINDOWS[0]),
			flat(SHOWN_GRID, SHOWN_GRID),
			iso(SHOWN_GRID, SHOWN_GRID),
		];
		// His line lands as far as his sight (`salmonsRules.js` `SIGHT`) and no further, and its
		// bobber takes a salmon within the hook's reach of where it lands: so he can hook one a
		// reach past his sight.
		const { reach } = game.online.rules.abilities.find((a) => a.effect === 'hook');
		const lands = Array.from({ length: 16 }, (_, i) => ({
			x: reach * Math.cos((i * Math.PI) / 8),
			y: reach * Math.sin((i * Math.PI) / 8),
		}));
		// The places furthest along an axis he can hook from: his sight's four corners, each a
		// reach further out. A box a few px too small misses only these.
		const across = SIGHT.screen.w / SIGHT.tile.w;
		const down = SIGHT.screen.h / SIGHT.tile.h;
		const places = [1, -1].flatMap((a) =>
			[1, -1].map((d) => {
				const x = ((a * across + d * down) / 2) * CELL;
				const y = ((d * down - a * across) / 2) * CELL;
				return Math.abs(x) > Math.abs(y)
					? { x: x + Math.sign(x) * reach, y }
					: { x, y: y + Math.sign(y) * reach };
			}),
		);
		const rng = createRng('salmons:reciprocal');
		for (let i = 0; i < 40_000; i++)
			places.push({ x: (rng() * 2 - 1) * 1700, y: (rng() * 2 - 1) * 1700 });
		const salmon = { x: 0, y: 0 };
		let seen = 0;
		let offPhone = 0;
		for (const from of places) {
			if (!inSight(from, salmon) && !lands.some((at) => inSight(from, at))) continue;
			seen += 1;
			for (const shown of devices)
				assert.ok(
					sends(nearby, shown, from.x, from.y),
					`a fisherman (${from.x}, ${from.y}) px from a salmon can hook it, and its device, saying ` +
						`${JSON.stringify(shown)}, is not sent him: he hooks it unseen`,
				);
			offPhone += regionHolds(viewRegion(nearby, phone), from.x, from.y) ? 0 : 1;
		}
		assert.ok(
			seen > 10_000 && offPhone > 4000,
			`${seen} places a fisherman sees a salmon from, ${offPhone} of them off a phone’s screen`,
		);
	},
);

/** A salmon that steers for the middle of the water a little upstream of it, round the rocks
 *  ahead, and taps jump every other step (P11.3: it climbs the waterfalls and jumps off the
 *  sandbanks). */
const swimmer = (river) => (player, step) => {
	const ahead = player.body.y - 120;
	const band =
		river.bands.find((b) => ahead >= b.y && ahead < b.y + b.h) ??
		(ahead < river.bands[0].y ? river.bands[0] : river.bands.at(-1));
	let aim = (band.left + band.right) / 2;
	const { x, y } = player.body;
	const rock = river.rocks.find(
		(r) => x > r.x - 60 && x < r.x + r.w + 60 && r.y + r.h > y - 200 && r.y + r.h < y,
	);
	if (rock)
		aim = rock.x - band.left > band.right - rock.x - rock.w ? rock.x - 70 : rock.x + rock.w + 70;
	const dx = aim - x;
	return {
		moveX: Math.max(-1, Math.min(1, dx / 60)) * 90,
		moveY: -MOVE_SCALE,
		buttons: step % 2 ? BUTTONS.jump : 0,
	};
};

await check('Salmons: each room plays a river of its own seed, and replays it', () => {
	assert.deepEqual([...ONLINE_GENERATOR_IDS].sort(), Object.keys(ONLINE_GENERATORS).sort());
	assert.equal(salmons.online.generator, 'salmonsRiver');
	const one = createRoomSim(salmons, { seed: 11 });
	const again = createRoomSim(salmons, { seed: 11 });
	const two = createRoomSim(salmons, { seed: 12 });
	assert.equal(one.seed, 11);
	assert.deepEqual(one.game.zones, again.game.zones, 'the same seed: the same river');
	assert.notDeepEqual(one.game.zones, two.game.zones, 'two rooms: two rivers');
	const geometry = salmonsGeometry(salmonsRiver(11));
	assert.deepEqual(one.game.zones, geometry.zones);
	assert.deepEqual(one.game.online.rules.zones, geometry.zoneRules);
	assert.deepEqual(one.game.online.spawn, geometry.spawn);
	assert.deepEqual(one.game.online.bots.spawns, geometry.botSpawns);
	assert.deepEqual(
		one.game.online.characters.map((c) => c.spawns ?? null),
		[[geometry.spawn], geometry.spawns.bear, geometry.spawns.fisherman],
		'a salmon’s one place is the room’s spawn: a bot salmon starts in the water, not on a bank',
	);
	// What the room keeps from the config: everything but the river's geometry.
	assert.deepEqual(
		one.game.online.characters.map((c) => c.speed),
		[240, 190, 140],
	);
	assert.deepEqual(one.game.online.rules.abilities, salmons.online.rules.abilities);
	assert.deepEqual(one.game.online.bots.characters, salmons.online.bots.characters);
	// The device runs the very same function on the seed the state carries.
	assert.deepEqual(generatedOnlineGame(salmons, 11).game, one.game);
	assert.deepEqual(generatedOnlineGame(salmons, 11).made, salmonsRiver(11));
	const me = one.join('me', { character: 'salmon' });
	assert.deepEqual([me.body.x, me.body.y], [geometry.spawn.x, geometry.spawn.y]);
	// A game that names no generator plays its field as authored.
	const plain = gameOf(configOf({ characters: CHARACTERS }));
	assert.equal(generatedOnlineGame(plain, 11).game, plain);
	assert.equal(generatedOnlineGame(plain, 11).made, undefined);
	assert.equal(createRoomSim(plain, { seed: 11 }).game, plain);
	const unknown = normalizeGameConfigDoc(configOf({ characters: CHARACTERS, generator: 'lake' }));
	assert.deepEqual(
		validateFamily(unknown)
			.filter((i) => i.path === 'arcade.online.generator')
			.map((i) => i.severity),
		['error'],
	);
});

await check('Salmons: a salmon that swims the river reaches the source and wins the game', () => {
	const sim = createRoomSim(salmons, { seed: 1 });
	const river = salmonsRiver(sim.seed);
	const me = sim.join('me', { character: 'salmon' });
	for (const bot of bots(sim)) bot.body.x = bot.body.x < 900 ? 0 : 1800;
	const swim = swimmer(river);
	let end;
	const steps = 120 * salmons.online.tickHz;
	for (let i = 0; i < steps && !end; i++) {
		const events = sim.step((id) => [clampInput({ ...swim(sim.players.get(id), i), seq: i + 1 })]);
		// Keep the bots off it: this checks the river, not the hunt.
		for (const bot of bots(sim)) bot.status = STATUS.stunned;
		end = events.find((e) => e.type === 'roundEnd');
	}
	assert.ok(end, `the salmon reached the source (it got to y = ${Math.round(me.body.y)})`);
	assert.equal(end.winner, 'me');
	// The original's: the first salmon to the source wins the game; there is no next round.
	assert.equal(sim.rules.phase, 'ended');
	assert.equal(sim.rules.winnerName, me.name);
	assert.equal(me.mark, false, 'golden only as the last game’s winner');
	for (let i = 0; i < 20 * salmons.online.tickHz; i++) sim.step(() => []);
	assert.equal(sim.rules.phase, 'ended', 'the room’s game is over');
});

await check(
	'Salmons: the current carries a resting salmon downstream; a bank pushes it back',
	() => {
		const sim = createRoomSim(salmons, { seed: 1 });
		const river = salmonsRiver(sim.seed);
		const band = river.bands[5];
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

await check('Salmons: a bear bot on its bank catches a salmon near the shore', () => {
	const sim = createRoomSim(salmons, { seed: 5 });
	const river = salmonsRiver(sim.seed);
	const me = sim.join('me', { character: 'salmon' });
	const bear = bots(sim).find((b) => b.character.id === 'bear');
	const band = river.bands.find((b) => bear.body.y >= b.y && bear.body.y < b.y + b.h);
	me.body.x = bear.body.x < band.left ? band.left + 50 : band.right - 50;
	me.body.y = bear.body.y;
	let caught;
	let wet = 0;
	for (let i = 0; i < 300 && !caught; i++) {
		const events = sim.step(() => [clampInput({ seq: i + 1 })]);
		caught = events.find((e) => e.type === 'caught' && e.target === 'me');
		for (const b of bots(sim)) {
			const at = river.bands.find((r) => b.body.y >= r.y && b.body.y < r.y + r.h);
			if (at && b.body.x > at.left + 1 && b.body.x < at.right - 1) wet += 1;
		}
	}
	assert.ok(caught, 'the bear bot chased the salmon and swiped');
	assert.equal(sim.players.get(caught.by).character.id, 'bear');
	assert.equal(me.status, STATUS.out);
	assert.equal(wet, 0, 'P11.3: the water is solid to bears and fishermen');
});

await check('Salmons: a bear bot sees and catches a salmon grounded on a sandbank', () => {
	const sim = createRoomSim(salmons, { seed: 5 });
	const river = salmonsRiver(sim.seed);
	const me = sim.join('me', { character: 'salmon' });
	const bear = bots(sim).find((b) => b.character.id === 'bear');
	const band = river.bands.find((b) => bear.body.y >= b.y && bear.body.y < b.y + b.h);
	me.body.x = bear.body.x < band.left ? band.left + 50 : band.right - 50;
	me.body.y = bear.body.y;
	// Grounded as the sandbanks module grounds it: held, and only a jump frees it.
	me.status = STATUS.grounded;
	let caught;
	for (let i = 0; i < 300 && !caught; i++) {
		const events = sim.step(() => [clampInput({ seq: i + 1 })]);
		caught = events.find((e) => e.type === 'caught' && e.target === 'me');
		if (!caught) assert.equal(me.status, STATUS.grounded);
	}
	assert.ok(caught, 'the bear bot went for the grounded salmon and swiped');
	assert.equal(sim.players.get(caught.by).character.id, 'bear');
	assert.equal(me.status, STATUS.out);
});

/** The same game, every player sent to every device. */
const salmonsUnboxed = { ...salmons, online: { ...salmons.online, nearby: undefined } };
/** The same game with a box smaller than a fisherman's sight (Salmons' own covers his sight). */
const salmonsBoxed = { ...salmons, online: { ...salmons.online, nearby: { w: 2400, h: 1800 } } };

/**
 * One bot fisherman, held at its place, and a salmon held in the middle of the water `rows` cells
 * along the river from him, for `seconds` or until his line is out: where each stands, what the
 * salmon's place is to him, and the bobber (`line`) and the step it went out in if he cast.
 */
const lineAt = (game, rows, seconds) => {
	const sim = createRoomSim(game, { seed: 5 });
	const me = sim.join('me', { character: 'salmon' });
	const fisher = bots(sim).find((b) => b.character.id === 'fisherman');
	for (const bot of bots(sim)) if (bot !== fisher) sim.players.delete(bot.id);
	const from = { x: fisher.body.x, y: fisher.body.y };
	const waters = sim.game.zones.filter((z) => /^band\d+Water$/.test(z.id));
	const wet = ({ x, y }) =>
		waters.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
	const y = from.y + rows * CELL;
	const water = waters.find((z) => y >= z.y && y < z.y + z.h);
	const at = { x: water.x + water.w / 2, y };
	const box = game.online.nearby;
	const found = {
		from,
		at,
		px: Math.hypot(at.x - from.x, at.y - from.y),
		seen: inSight(from, at),
		sent: !box || (Math.abs(at.x - from.x) <= box.w / 2 && Math.abs(at.y - from.y) <= box.h / 2),
		/** Whether a cast aimed at the salmon would land: the room pulls it in to the sight's edge. */
		lands: wet(pullIntoSight(from, at)),
	};
	for (let i = 0; i < seconds * game.online.tickHz; i++) {
		Object.assign(fisher.body, from);
		Object.assign(me.body, at);
		sim.step(() => [clampInput({ seq: i + 1 })]);
		if (fisher.lineActive) return { ...found, step: i, line: { x: fisher.lineX, y: fisher.lineY } };
	}
	return found;
};
/** How far the bobber is from the salmon the step it is cast: its first reel, and the current's
 *  push on the salmon. */
const off = (cast) => Math.hypot(cast.line.x - cast.at.x, cast.line.y - cast.at.y);
/** The furthest a bot fisherman's cast at a salmon `px` away may fall short of it (`BOT_AIM`), and
 *  his shortest and longest reaction, in the room's steps. */
const shortAt = (px) => Math.max(0, px - BOT_AIM.sureCells * CELL) * BOT_AIM.spread;
const reactSteps = (ms) => Math.round((ms / 1000) * salmons.online.tickHz);

await check(
	'Salmons: a bot fisherman casts at a salmon in his sight, after his reaction time, short of it',
	() => {
		const cast = lineAt(salmons, -15, 2);
		assert.ok(cast.seen && cast.sent, 'the salmon is on his screen, and sent to a device there');
		assert.ok(cast.px > 288, `far past the old 288 px gate (${Math.round(cast.px)} px)`);
		assert.ok(cast.line, 'it cast');
		assert.ok(
			cast.step >= reactSteps(BOT_AIM.reactMs.min) && cast.step <= reactSteps(BOT_AIM.reactMs.max),
			`${cast.step} steps after the salmon came into his sight: within his reaction time`,
		);
		assert.ok(off(cast) > CELL, 'a cast this long does not land on the salmon as a machine’s');
		assert.ok(
			off(cast) < shortAt(cast.px) + CELL,
			`the bobber landed ${Math.round(off(cast))} px from the salmon, and reels home from there: ` +
				`no further than a ${Math.round(cast.px)} px cast may fall short`,
		);
	},
);

await check('Salmons: a bot fisherman never casts at a salmon out of his sight', () => {
	for (const game of [salmons, salmonsUnboxed]) {
		const none = lineAt(game, 32, 20);
		assert.equal(none.seen, false, 'the salmon is off his screen');
		assert.ok(none.lands, 'a cast aimed at it would land, at the edge of his sight');
		assert.equal(none.line, undefined, 'in 20 s (80 cooldowns) it never cast');
	}
});

await check('Salmons: nor at one on his screen that a device there would not be sent', () => {
	const none = lineAt(salmonsBoxed, -21, 20);
	assert.ok(none.seen && !none.sent, 'in his sight, outside the nearby box');
	assert.equal(none.line, undefined, 'in 20 s it never cast');
	// Salmons' own box covers his whole sight, so there it is the sight alone, as with no box.
	for (const game of [salmons, salmonsUnboxed]) {
		const cast = lineAt(game, -21, 2);
		assert.ok(cast.seen && cast.sent, 'in his sight, and sent to a device there');
		assert.ok(cast.line, 'it cast');
		assert.ok(off(cast) < shortAt(cast.px) + CELL, 'at it, no further short than his aim falls');
	}
});

await check('Salmons: a max on the box does not lengthen a bot fisherman’s aim', () => {
	// A bot declares nothing: it is held to the box a device that says nothing is sent by.
	const boxedMax = {
		...salmons,
		online: { ...salmons.online, nearby: { w: 2400, h: 1800, max: { w: 6400, h: 6400 } } },
	};
	const none = lineAt(boxedMax, -21, 20);
	assert.ok(none.seen && !none.sent, 'in his sight, outside the box, inside the max');
	assert.equal(none.line, undefined, 'in 20 s it never cast');
	assert.deepEqual(salmons.online.nearby, { w: 3300, h: 3300, max: { w: 6400, h: 6400 } });
});

/** The middle of the water `rows` cells along the river from `from`, in a room's game. */
const waterAlong = (sim, from, rows) => {
	const y = from.y + rows * CELL;
	const water = sim.game.zones.find(
		(z) => /^band\d+Water$/.test(z.id) && y >= z.y && y < z.y + z.h,
	);
	return { x: water.x + water.w / 2, y };
};

await check('Salmons: a person’s cast goes out at once and lands where it is aimed', () => {
	const sim = createRoomSim(salmons, { seed: 5 });
	const me = sim.join('me', { character: 'fisherman' });
	const fish = sim.join('fish', { character: 'salmon' });
	for (const bot of bots(sim)) sim.players.delete(bot.id);
	const from = { x: me.body.x, y: me.body.y };
	const at = waterAlong(sim, from, -15);
	assert.ok(inSight(from, at) && Math.hypot(at.x - from.x, at.y - from.y) > 10 * CELL);
	const hold = () => {
		Object.assign(me.body, from);
		Object.assign(fish.body, at);
	};
	const rest = (seq) => [clampInput({ seq })];
	// Past the second a new player cannot be hooked for.
	const grace = 2 * salmons.online.tickHz;
	for (let i = 0; i < grace; i++) {
		hold();
		sim.step(() => rest(i + 1));
	}
	assert.equal(me.lineActive ?? 0, 0);
	hold();
	const aimed = clampInput(
		{ seq: grace + 1, buttons: BUTTONS.ability1, aimX: at.x, aimY: at.y },
		sim.game.field,
	);
	const events = sim.step((id) => (id === 'me' ? [aimed] : rest(grace + 1)));
	assert.equal(me.lineActive, 1, 'the first press casts: a person has no reaction time to wait');
	// The bobber: where it was aimed, less the step's reel towards him.
	const reel = (LINE.reelCellsPerSecond * CELL) / salmons.online.tickHz;
	const landed = Math.hypot(me.lineX - at.x, me.lineY - at.y);
	assert.ok(Math.abs(landed - reel) < 1e-6, `${landed} px from the aim: one reel of ${reel} px`);
	assert.ok(
		events.some((e) => e.type === 'hooked' && e.by === 'me' && e.target === 'fish'),
		'and the salmon there is hooked',
	);
});

await check('Salmons: as exported, a bear walks into the water, a person’s and a bot’s', () => {
	// The original's rule (`docs/reference/salmons-original.md` §5.2): only waterfalls, the bank
	// limit and the ends stop a bear. The band river (`salmonsRiver`) keeps its bears on the banks,
	// so a published config that names it plays bears that never wade.
	const doc = salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED), { lobby: SALMONS_LOBBY });
	assert.equal(doc.arcade.online.generator, 'salmonsMap', 'the export plays the original’s levels');
	const shipped = gameOf(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)));
	for (const seed of [1, 2, 3, 4]) {
		const sim = createRoomSim(shipped, { seed });
		const water = sim.game.zones.filter((z) => /^band\d+Water$/.test(z.id));
		const wet = ({ x, y }) =>
			water.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
		const me = sim.join('me', { character: 'bear' });
		const bears = bots(sim).filter((b) => b.character.id === 'bear');
		const band = water.find((z) => me.body.y >= z.y && me.body.y < z.y + z.h);
		const moveX = Math.sign(band.x + band.w / 2 - me.body.x) * MOVE_SCALE;
		const waded = new Set();
		for (let i = 0; i < 60 * shipped.online.tickHz; i++) {
			const going = i < 4 * shipped.online.tickHz;
			sim.step(() => [clampInput({ seq: i + 1, moveX: going ? moveX : 0 }, sim.game.field)]);
			if (i === 4 * shipped.online.tickHz - 1)
				assert.ok(
					wet(me.body),
					`room ${seed}: a person’s bear walked from its bank into the water`,
				);
			for (const bear of bears) if (wet(bear.body)) waded.add(bear.id);
		}
		assert.ok(waded.size >= 2, `room ${seed}: ${waded.size} bear bots went into the water in 60 s`);
	}
});

await check('Salmons: as shipped, a bot fisherman still hooks a salmon that keeps still', () => {
	const shipped = gameOf(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)));
	const tickHz = shipped.online.tickHz;
	// He looks back no further than he has watched: the lag fits in his least reaction time.
	assert.ok(BOT_AIM.lagMs.max <= BOT_AIM.reactMs.min, 'BOT_AIM.lagMs within reactMs.min');
	let tested = 0;
	for (let seed = 1; seed <= 8; seed++)
		for (const cells of [4, 8]) {
			const sim = createRoomSim(shipped, { seed });
			const me = sim.join('me', { character: 'salmon' });
			const water = sim.game.zones.filter((z) => /^band\d+Water$/.test(z.id));
			const wet = (x, y) =>
				[-CELL, 0, CELL].every((u) =>
					water.some((z) => x + u >= z.x && x + u < z.x + z.w && y + u >= z.y && y + u < z.y + z.h),
				);
			let him;
			let spot;
			for (const fisher of bots(sim).filter((b) => b.character.id === 'fisherman')) {
				for (let k = 0; k < 360 && !spot; k++) {
					const x = fisher.body.x + Math.cos((k * Math.PI) / 180) * cells * CELL;
					const y = fisher.body.y + Math.sin((k * Math.PI) / 180) * cells * CELL;
					if (wet(x, y) && inSight(fisher.body, { x, y })) spot = { x, y };
				}
				if (spot) {
					him = fisher;
					break;
				}
			}
			if (!spot) continue;
			tested += 1;
			for (const bot of bots(sim)) if (bot !== him) sim.players.delete(bot.id);
			// Out of his sight until the second a new salmon cannot be hooked for is over; he waits.
			const from = { x: him.body.x, y: him.body.y };
			for (let i = 0; i < 2 * tickHz; i++) {
				Object.assign(me.body, { x: spot.x, y: spot.y + 60 * CELL });
				Object.assign(him.body, from);
				sim.step(() => [clampInput({ seq: i + 1 })]);
			}
			let hookedAt;
			for (let i = 0; i < 3 * tickHz && hookedAt === undefined; i++) {
				Object.assign(me.body, spot);
				const events = sim.step(() => [clampInput({ seq: 2 * tickHz + i + 1 })]);
				if (events.some((e) => e.type === 'hooked' && e.target === 'me')) hookedAt = i / tickHz;
			}
			assert.ok(
				hookedAt !== undefined,
				`room ${seed}: still ${cells} cells off, not hooked in 3 s`,
			);
		}
	assert.ok(tested >= 12, `only ${tested} of 16 rooms had a still spot to test`);
});

await check('Salmons: a room replays its bot fishermen’s casts exactly from its seed', () => {
	/** Every cast of a room's bot fishermen in 30 s (step, who, where the bobber is that step) at a
	 *  salmon held on the water 12 cells up the river from the first of them, the bears taken out. */
	const castsOf = (seed) => {
		const sim = createRoomSim(salmons, { seed });
		const me = sim.join('me', { character: 'salmon' });
		for (const bot of bots(sim)) if (bot.character.id === 'bear') sim.players.delete(bot.id);
		const fishers = bots(sim);
		const at = waterAlong(sim, fishers[0].body, -12);
		const out = new Set();
		const casts = [];
		for (let i = 0; i < 30 * salmons.online.tickHz; i++) {
			Object.assign(me.body, at);
			sim.step(() => [clampInput({ seq: i + 1 })]);
			for (const f of fishers) {
				if (f.lineActive && !out.has(f.id))
					casts.push({
						step: i,
						by: f.id,
						x: f.lineX,
						y: f.lineY,
						at: Math.hypot(f.lineX - at.x, f.lineY - at.y),
					});
				if (f.lineActive) out.add(f.id);
				else out.delete(f.id);
			}
		}
		return casts;
	};
	const casts = castsOf(5);
	assert.ok(casts.length >= 6, `the room's fishermen cast ${casts.length} times`);
	assert.ok(new Set(casts.map((c) => c.by)).size >= 2, 'more than one of them');
	assert.ok(
		casts.filter((c) => c.at > 2 * CELL).length >= casts.length / 2,
		'and most casts fell short of the salmon',
	);
	assert.deepEqual(castsOf(5), casts, 'the same seed: the same casts, to the px');
	assert.notDeepEqual(castsOf(6), casts, 'another seed: other casts');
});

/** A place on a bank of a room's band river and, 77 px from it, one in its water: a bear there
 *  has a salmon there within its swipe once it faces it. */
const bankAndWater = (sim) => {
	const band = salmonsRiver(sim.seed).bands[5];
	const y = band.y + band.h / 2;
	return { bank: { x: band.left - 47, y }, water: { x: band.left + 30, y } };
};

await check('Salmons: a bear bot swipes at a salmon in his reach after his reaction time', () => {
	/**
	 * Every swipe a room's bear bots make in 20 s (the step, who) at a salmon held in the water by a
	 * bank and kept safe from every hit, so a bear that has it in reach goes on swiping; and the
	 * step it first came within each bear's reach. The fishermen are taken out.
	 */
	const swipesOf = (seed) => {
		const sim = createRoomSim(salmons, { seed });
		const me = sim.join('me', { character: 'salmon' });
		for (const bot of bots(sim)) if (bot.character.id !== 'bear') sim.players.delete(bot.id);
		const bears = bots(sim);
		const swipe = sim.game.online.rules.abilities.find((a) => a.character === 'bear');
		const reach = swipe.reach + swipe.ahead;
		// By the bank the first bear stands on: it comes to the water's edge for it.
		const river = salmonsRiver(sim.seed);
		const band = river.bands.find((b) => bears[0].body.y >= b.y && bears[0].body.y < b.y + b.h);
		const at = {
			x: bears[0].body.x < band.left ? band.left + 50 : band.right - 50,
			y: bears[0].body.y,
		};
		const swipes = [];
		const inReachAt = new Map();
		for (let i = 0; i < 20 * salmons.online.tickHz; i++) {
			Object.assign(me.body, at);
			me.safeUntil = Infinity;
			for (const bear of bears) {
				const near = Math.hypot(bear.body.x - at.x, bear.body.y - at.y) <= reach;
				if (!near) inReachAt.delete(bear.id);
				else if (!inReachAt.has(bear.id)) inReachAt.set(bear.id, i);
			}
			for (const e of sim.step(() => [clampInput({ seq: i + 1 })]))
				if (e.type === 'ability' && isBotId(e.by))
					swipes.push({ step: i, by: e.by, inReachFor: i - inReachAt.get(e.by) });
		}
		assert.equal(me.status, STATUS.free, 'kept safe, it is never caught');
		return swipes;
	};
	const swipes = swipesOf(5);
	const [min, max] = [BOT_SWIPE.reactMs.min, BOT_SWIPE.reactMs.max].map(reactSteps);
	assert.ok(swipes.length >= 6, `the bear swiped ${swipes.length} times`);
	// The first: once the salmon has been within his reach for his reaction time, not on the step.
	assert.ok(
		swipes[0].inReachFor >= min - 1 && swipes[0].inReachFor <= max + 1,
		`his first swipe came ${swipes[0].inReachFor} steps after the salmon came within his reach`,
	);
	// Each after: never sooner than a reaction time after the last (a machine swipes every other
	// step), drawn anew; longer only when the salmon was out of his reach in between.
	const own = swipes.filter((s) => s.by === swipes[0].by);
	const gaps = own.slice(1).map((s, k) => s.step - own[k].step);
	assert.ok(
		gaps.every((gap) => gap >= min),
		`his swipes are ${gaps} steps apart: none sooner than his reaction time of ${min} steps`,
	);
	assert.ok(
		gaps.filter((gap) => gap <= max + 1).length > gaps.length / 2,
		`most of them (${gaps}) a reaction time of ${min}–${max} steps after the last`,
	);
	assert.ok(new Set(gaps).size > 1, 'and not the same wait each time');
	// A room replays them from its seed.
	assert.deepEqual(swipesOf(5), swipes, 'the same seed: the same swipes, to the step');
	assert.notDeepEqual(swipesOf(6), swipes, 'another seed: other swipes');
});

await check('Salmons: a person’s swipe lands on the press, with no wait', () => {
	const sim = createRoomSim(salmons, { seed: 5 });
	const me = sim.join('me', { character: 'bear' });
	const fish = sim.join('fish', { character: 'salmon' });
	for (const bot of bots(sim)) sim.players.delete(bot.id);
	const { bank, water } = bankAndWater(sim);
	const hold = () => {
		Object.assign(me.body, bank);
		Object.assign(fish.body, water);
	};
	const rest = (seq) => [clampInput({ seq })];
	// Past the second a new player cannot be caught for.
	const grace = 2 * salmons.online.tickHz;
	for (let i = 0; i < grace; i++) {
		hold();
		sim.step(() => rest(i + 1));
	}
	assert.equal(fish.status, STATUS.free);
	hold();
	// One input: a step towards the salmon (the swipe lands a tile ahead of it) and the press.
	const press = clampInput({ seq: grace + 1, moveX: MOVE_SCALE, buttons: BUTTONS.ability1 });
	const events = sim.step((id) => (id === 'me' ? [press] : rest(grace + 1)));
	assert.ok(
		events.some((e) => e.type === 'caught' && e.by === 'me' && e.target === 'fish'),
		'the first press catches: a person has no reaction time to wait',
	);
	assert.equal(fish.status, STATUS.out);
});

// --- 5. live: a real server ------------------------------------------------------------------------

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
	join(dir, 'nearbots.json'),
	JSON.stringify(
		configOf({
			characters: CHARACTERS,
			bots: { ...BOTS, fillTo: 4 },
			nearby: { w: 4000, h: 4000 },
		}),
	),
);
// The device's view: one `own` player in the middle of a wide field and still `other`s at known
// offsets from it, in a room whose box has a max (`view`) and in one whose box has none (`box`).
const VIEW_FIELD = { w: 8000, h: 8000 };
const VIEW_OWN = { x: 4000, y: 4000 };
const VIEW_OTHERS = {
	inBox: { x: 300, y: 0 },
	east: { x: 1000, y: 0 },
	farEast: { x: 1900, y: 0 },
	pastMax: { x: 2100, y: 0 },
	corner: { x: 700, y: 700 },
	// Past the box (400) and inside its keep margin (500), on the side away from the others.
	ring: { x: -450, y: 0 },
};
const VIEW_NEARBY = { w: 800, h: 600, max: { w: 4000, h: 3000 } };
const viewGame = (nearby) =>
	configOf(
		{
			characters: [
				{ id: 'own', body: 'fishLook', speed: 300, spawns: [VIEW_OWN] },
				{
					id: 'other',
					body: 'bearLook',
					speed: 300,
					spawns: Object.values(VIEW_OTHERS).map((o) => ({
						x: VIEW_OWN.x + o.x,
						y: VIEW_OWN.y + o.y,
					})),
				},
			],
			nearby,
		},
		{ field: VIEW_FIELD },
	);
writeFileSync(join(dir, 'view.json'), JSON.stringify(viewGame(VIEW_NEARBY)));
writeFileSync(
	join(dir, 'box.json'),
	JSON.stringify(viewGame({ w: VIEW_NEARBY.w, h: VIEW_NEARBY.h })),
);
const duo = salmonsConfig();
duo.arcade.online.maxPlayers = 2;
delete duo.arcade.online.bots;
writeFileSync(join(dir, 'riverduo.json'), JSON.stringify(duo));
// Salmons on one river with four seats, for a salmon on a phone and the fisherman who hooks it: a
// person (`phonerod`, no bots) or the room's one bot (`phonebot`).
const phoneGame = (bots) => {
	const doc = salmonsConfig();
	doc.arcade.online.maxPlayers = 4;
	doc.arcade.online.levels = { seeds: [5] };
	if (bots) Object.assign(doc.arcade.online.bots, bots);
	else delete doc.arcade.online.bots;
	return doc;
};
writeFileSync(join(dir, 'phonerod.json'), JSON.stringify(phoneGame()));
writeFileSync(
	join(dir, 'phonebot.json'),
	JSON.stringify(
		phoneGame({ characters: [{ character: 'fisherman', brain: 'fishermanBot' }], fillTo: 2 }),
	),
);
writeFileSync(
	join(dir, 'bots.json'),
	JSON.stringify(configOf({ characters: CHARACTERS, bots: { ...BOTS, fillTo: 4 } })),
);
const port = await freePort();
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 4,
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
		'live: nearby — a device is told of the bots that give way and come back',
		async () => {
			const a = await clientOf().joinOrCreate(ROOM_NAME, { game: 'nearbots', character: 'fish' });
			const heard = [];
			a.onMessage(ONLINE_EVENT, (events) => heard.push(...events));
			await until('the bots', () => a.state.players?.size === 4);
			// Only what happens after: the first bots' joins may still be on their way.
			await wait(200);
			heard.length = 0;
			const b = await clientOf().joinById(a.roomId, { character: 'fish' });
			await until('a bot’s leave', () => heard.some((e) => e.type === 'left' && isBotId(e.id)));
			heard.length = 0;
			await b.leave();
			await until('a bot’s join', () => heard.some((e) => e.type === 'joined' && isBotId(e.id)));
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
	await check(
		'live: two rooms of one game play two rivers, each the one its devices make from its seed',
		async () => {
			const duoGame = gameOf(duo);
			const join = (c, character) =>
				c === undefined
					? clientOf().joinOrCreate(ROOM_NAME, { game: 'riverduo', character })
					: clientOf().joinById(c, { character });
			const a = await join(undefined, 'salmon');
			const b = await join(a.roomId, 'bear');
			const c = await join(undefined, 'salmon');
			assert.notEqual(a.roomId, c.roomId, 'the first room is full: a second one');
			const seeded = (room) => typeof room.state.seed === 'number' && room.state.players?.size;
			await until('both seeds', () => seeded(a) && seeded(b) && seeded(c));
			assert.equal(a.state.seed, b.state.seed, 'one room, one seed');
			assert.notEqual(a.state.seed, c.state.seed, 'two rooms, two seeds');
			const rivers = [a, c].map((room) => generatedOnlineGame(duoGame, room.state.seed));
			assert.notDeepEqual(rivers[0].made.bands, rivers[1].made.bands, 'two rivers');
			// Each device's river is the server's: the salmon stands where its river's sea is.
			for (const [room, { game }] of [
				[a, rivers[0]],
				[c, rivers[1]],
			]) {
				const me = room.state.players.get(room.sessionId);
				assert.deepEqual([me.x, me.y], [game.online.spawn.x, game.online.spawn.y]);
			}
			// (Nearby: the bear on its bank is sent to its own device, not to the salmon at the sea.)
			const bear = b.state.players.get(b.sessionId);
			const bank = rivers[0].game.online.characters[1].spawns[0];
			assert.deepEqual([bear.x, bear.y], [bank.x, bank.y], 'the bear is on the room’s bank');
			await Promise.all([a.leave(), b.leave(), c.leave()]);
		},
	);

	const patchMs = (room) => 1000 / room.sim.game.online.patchHz;
	/** A hold window of `room`, in patches. */
	const holdPatches = (room) => Math.round(room.sim.game.online.patchHz * VIEW_HOLD_SECONDS);
	/**
	 * The room's patches counted from now, and `each` told the count after every one: its own
	 * `onBeforePatch`, which Colyseus calls once a patch. The waits below count these, not
	 * milliseconds, so a loaded machine makes them slower and not wrong.
	 */
	const counters = new WeakMap();
	const patchesOf = (room) => {
		const known = counters.get(room);
		if (known) return known;
		const patch = room.onBeforePatch;
		const counted = { count: 0, each: undefined };
		room.onBeforePatch = function (...args) {
			patch.apply(this, args);
			counted.count += 1;
			counted.each?.(counted.count);
		};
		counters.set(room, counted);
		return counted;
	};
	/** Waits `n` more patches of the room, and one more for the last to reach its devices. */
	const patches = async (room, n) => {
		const counted = patchesOf(room);
		const from = counted.count;
		await until(`${n} patches`, () => counted.count >= from + n, 30_000);
		await wait(patchMs(room));
	};
	/** Long enough for the room to let go of a view a device no longer says: two hold windows. */
	const lapse = (room) => patches(room, 2 * holdPatches(room) + 1);
	/** `holds` once it is `expected`, or the assert's own message of how it differs. */
	const comesTo = async (holds, expected, message) => {
		await until('who it is sent', () => holds().join() === expected.join(), 5000).catch(() => {});
		assert.deepEqual(holds(), expected, message);
	};

	/**
	 * One still device of a view room: `say` sends its next input with what it says its screen
	 * shows (`undefined`: an input that never names the fields), `holds` is who it is sent now by
	 * name, `settled` waits for the room to act on its last input (three patches), `said` is what
	 * the room holds of it.
	 */
	const viewDevice = (client, room, others) => {
		const input = client.input();
		let seq = 0;
		return {
			client,
			say: (shown) => {
				seq += 1;
				Object.assign(input.data, clampInput({ seq }), shown);
				input.send();
			},
			settled: async () => {
				await until('the input', () => room.sim.players.get(client.sessionId).ack === seq);
				await patches(room, 3);
			},
			holds: () =>
				Object.keys(VIEW_OTHERS).filter((name) => client.state.players.has(others[name].sessionId)),
			said: () => {
				const { shownW, shownH, shownIso } = room.inputs.get(client.sessionId).latest;
				return [shownW, shownH, shownIso];
			},
		};
	};

	/**
	 * A room of `game` with the own device (and, asked for, a `twin` of it at the same place) and
	 * one still device at each of {@link VIEW_OTHERS}.
	 */
	const viewRoom = async (game, { twin = false } = {}) => {
		const own = await clientOf().joinOrCreate(ROOM_NAME, { game, character: 'own' });
		const heard = [];
		own.onMessage(ONLINE_EVENT, (events) => heard.push(...events));
		const all = [own];
		if (twin) all.push(await clientOf().joinById(own.roomId, { character: 'own' }));
		const others = {};
		for (const name of Object.keys(VIEW_OTHERS)) {
			others[name] = await clientOf().joinById(own.roomId, { character: 'other' });
			all.push(others[name]);
		}
		for (const client of all.slice(1)) client.onMessage(ONLINE_EVENT, () => {});
		await until('the own players', () =>
			all.slice(0, twin ? 2 : 1).every((c) => c.state.players?.has(c.sessionId)),
		);
		const room = matchMaker.getLocalRoomById(own.roomId);
		patchesOf(room);
		return {
			own,
			others,
			heard,
			room,
			...viewDevice(own, room, others),
			twin: twin ? viewDevice(all[1], room, others) : undefined,
			leave: () => Promise.all(all.map((c) => c.leave())),
		};
	};

	await check(
		'live: with a max, a device is sent the box and the view it declares, as far as the max: never less than the box',
		async () => {
			const { own, others, heard, room, say, settled, holds, said, leave } = await viewRoom('view');
			// A device that never names the fields (a runtime from before them): the box, as ever.
			say(undefined);
			await settled();
			assert.deepEqual(said(), [0, 0, 0], 'the room holds no view for it');
			assert.deepEqual(holds(), ['inBox']);
			// An isometric view adds the players on that screen: the turned rectangle, so not the
			// corner, which stands inside its bounding box (2200 × 2200 about the own player).
			say(iso(2200, 1100));
			await settled();
			assert.deepEqual(said(), [2200, 1100, 1]);
			await comesTo(holds, ['inBox', 'east', 'ring']);
			// Past the max: as far as the max box (4000 × 3000 about the own player), and no further.
			say(iso(SHOWN_MAX, SHOWN_MAX));
			await settled();
			await comesTo(holds, ['inBox', 'east', 'farEast', 'corner', 'ring']);
			// A view smaller than the box: once the larger is let go, the box is what is left. The
			// device is never sent less than it, and keeps who the box keeps: `ring`, 450 px away, is
			// past the small view's own margin (250) and inside the box's (500).
			say(flat(400, 400));
			await settled();
			await lapse(room);
			assert.deepEqual(said(), [400, 400, 0]);
			await comesTo(
				holds,
				['inBox', 'ring'],
				'the box and who it keeps, though it says its screen shows less',
			);
			// Junk declares nothing, as its own encoder sends it and as the wire could carry it: nobody
			// is added (a view would add them the patch it is said).
			for (const junk of [
				{ shownW: 70_000, shownH: -5, shownIso: 2 },
				{ shownW: Number.NaN, shownH: 3.7, shownIso: 255 },
				{ shownW: 3000, shownH: 3000, shownIso: 7 },
				{ shownW: 3000, shownH: 0, shownIso: 1 },
			]) {
				// Written past the clamp, as a device that skips it would.
				Object.assign(own.input().data, junk);
				say(undefined);
				await settled();
				assert.deepEqual(said(), [0, 0, 0], `${JSON.stringify(junk)}: nothing declared`);
				assert.deepEqual(holds(), ['inBox', 'ring'], 'the box');
			}
			// A flat view past the max: the max box again.
			say(flat(SHOWN_MAX, SHOWN_MAX));
			await settled();
			await comesTo(holds, ['inBox', 'east', 'farEast', 'corner', 'ring']);
			// Hysteresis on a declared view: 1900 px away is past a 3200 px view's edge (1600) and
			// inside its margin (2000), so the player it holds stays; a 3000 px view lets it go
			// (1875), and the larger one does not bring it back.
			say(flat(3200, 3000));
			await settled();
			await lapse(room);
			assert.deepEqual(holds(), ['inBox', 'east', 'farEast', 'corner', 'ring']);
			say(flat(3000, 3000));
			await settled();
			await lapse(room);
			await comesTo(holds, ['inBox', 'east', 'corner', 'ring']);
			say(flat(3200, 3000));
			await settled();
			assert.deepEqual(
				holds(),
				['inBox', 'east', 'corner', 'ring'],
				'not back in: it is past the edge',
			);
			// Events go by the same views: a leave it holds is told, one it does not hold is not.
			heard.length = 0;
			const gone = [others.east.sessionId, others.farEast.sessionId];
			await others.farEast.leave();
			await others.east.leave();
			await until('east’s leave', () => heard.some((e) => e.type === 'left' && e.id === gone[0]));
			assert.ok(!heard.some((e) => e.id === gone[1]), 'nothing about the player it was not sent');
			// It stops declaring: the box alone again, once what it said is let go.
			say(flat(0, 0));
			await settled();
			assert.deepEqual(said(), [0, 0, 0]);
			await lapse(room);
			await comesTo(holds, ['inBox', 'ring']);
			// And it left: the room keeps nothing it said.
			const id = own.sessionId;
			say(flat(2400, 1600));
			await settled();
			assert.ok(room.held.get(id).view);
			await own.leave();
			await until('the leave', () => !room.sim.players.has(id));
			assert.equal(room.inputs.get(id).latest, undefined);
			assert.equal(room.held.has(id), false, 'nor the view it held');
			await leave();
		},
	);

	await check(
		'live: a device flipping between two views is sent what one holding the larger is sent, and a view shrunk for good is let go within two seconds',
		async () => {
			const { others, room, leave, twin, ...own } = await viewRoom('view', { twin: true });
			const large = flat(2400, 1600);
			const small = flat(400, 400);
			const sent = ['inBox', 'east', 'corner', 'ring'];
			own.say(large);
			twin.say(large);
			await own.settled();
			await twin.settled();
			assert.deepEqual([own.holds(), twin.holds()], [sent, sent]);
			// Each player as the device holds it: one taken away and sent again is another object.
			const players = () =>
				sent.map((name) => own.client.state.players.get(others[name].sessionId));
			const first = players();
			// Three hold windows of saying the smaller and the larger in turn, every other patch (by
			// the room's own count of them), read several times a patch against the twin, which only
			// ever said the larger.
			const counted = patchesOf(room);
			const window = holdPatches(room);
			const until3 = counted.count + 3 * window;
			let flips = 0;
			for (let next = counted.count; counted.count < until3;) {
				if (counted.count >= next) {
					own.say(flips % 2 ? large : small);
					flips += 1;
					next = counted.count + 2;
				}
				assert.deepEqual(own.holds(), twin.holds(), `after ${flips} flips: what the twin is sent`);
				assert.deepEqual(own.holds(), sent, `after ${flips} flips: nobody is taken away`);
				await wait(10);
			}
			assert.ok(flips >= 25, `${flips} flips`);
			assert.ok(
				players().every((player, i) => player === first[i]),
				'and nobody was taken away and sent again in between',
			);
			// The smaller for good: let go of between one hold window and two after the room last
			// read the larger, counted in its patches. Not sooner, or a flip a second would thrash.
			own.say(large);
			await own.settled();
			const id = own.client.sessionId;
			const held = room.seen.get(id).size;
			let lastLarge = counted.count;
			let letGo;
			counted.each = (count) => {
				if (room.inputs.get(id).latest.shownW === large.shownW) lastLarge = count;
				else if (letGo === undefined && room.seen.get(id).size < held) letGo = count - lastLarge;
			};
			own.say(small);
			await until('the smaller view', () => letGo !== undefined, 30_000);
			counted.each = undefined;
			assert.ok(
				letGo > window && letGo <= 2 * window,
				`sent by the smaller view ${letGo} patches after the larger was last read (a window is ${window})`,
			);
			await comesTo(own.holds, ['inBox', 'ring'], 'the box and who it keeps are what is left');
			assert.deepEqual(twin.holds(), sent, 'and the twin, still saying the larger, has them all');
			await leave();
		},
	);

	/**
	 * A salmon whose device says a phone's view, held in mid-water, and a fisherman who after a
	 * second on a bank far off comes to one he sees it from, off that phone's screen: `person` (he
	 * casts at it on a tap, every three seconds) or the room's one bot. Until he hooks it: what
	 * the salmon's device heard, and whether it held him all the while.
	 */
	const hookedOnAPhone = async (game, person) => {
		const { game: uploaded, says } = salmonsScreen();
		const phone = says(PHONE);
		const salmon = await clientOf().joinOrCreate(ROOM_NAME, { game, character: 'salmon' });
		const heard = [];
		salmon.onMessage(ONLINE_EVENT, (events) => heard.push(...events));
		const rod = person
			? await clientOf().joinById(salmon.roomId, { character: 'fisherman' })
			: undefined;
		rod?.onMessage(ONLINE_EVENT, () => {});
		const room = matchMaker.getLocalRoomById(salmon.roomId);
		const { sim } = room;
		const { nearby, tickHz } = sim.game.online;
		assert.deepEqual(nearby, uploaded.online.nearby, 'the box and the max Salmons ships');
		const fisherman = () => [...sim.players.values()].find((p) => p.character.id === 'fisherman');
		await until('both players', () => fisherman() && salmon.state.players?.has(salmon.sessionId));
		const me = sim.players.get(salmon.sessionId);
		const him = fisherman();
		assert.equal(Boolean(him.bot), !person);
		// A bank a fisherman starts on, and the first mid-water place along the river from it that
		// he sees, that the box about it holds him from, and whose phone screen he is two cells or
		// more off the side of; open water, two cells or more from the source, a fall, a rock.
		const isWater = (z) => /^band\d+Water$/.test(z.id);
		const waters = sim.game.zones.filter(isWater);
		const open = ({ x, y }) =>
			sim.game.zones.every((z) => {
				const dx = Math.max(z.x - x, 0, x - z.x - z.w);
				const dy = Math.max(z.y - y, 0, y - z.y - z.h);
				return isWater(z) || Math.hypot(dx, dy) >= 2 * CELL;
			});
		const banks = sim.game.online.characters.find((c) => c.id === 'fisherman').spawns;
		let from;
		let at;
		for (const bank of [{ x: him.body.x, y: him.body.y }, ...banks]) {
			for (let rows = -30; rows <= 30 && !at; rows++) {
				const y = bank.y + rows * CELL;
				const water = waters.find((z) => y >= z.y && y < z.y + z.h);
				const place = water && { x: water.x + water.w / 2, y };
				if (!place || !open(place) || !inSight(bank, place)) continue;
				const dx = bank.x - place.x;
				const dy = bank.y - place.y;
				const across = Math.abs(dx - dy);
				if (regionHolds(boxRegion(nearby), dx, dy) && across >= phone.shownW / 2 + 2 * CELL) {
					from = { x: bank.x, y: bank.y };
					at = place;
				}
			}
			if (at) break;
		}
		assert.ok(at, 'no place on this river where a fisherman sees a salmon from off its phone');
		// Where he stands first: a bank the salmon's device is not sent him at, whatever it holds.
		const away = banks.find(
			(bank) => !regionHolds(boxRegion(nearby, NEARBY_MARGIN), bank.x - at.x, bank.y - at.y),
		);
		assert.ok(away, 'no bank on this river far from that place');
		let seq = 0;
		let unheld = 0;
		let heldAway;
		const salmonInput = salmon.input();
		const rodInput = rod?.input();
		// A bot's long cast lands short of the salmon: it then swims to where his bobber landed, once
		// the room's steps are past the grace a new player cannot be hooked in. Counted in the room's
		// steps, not this timer's ticks, which fall behind them on a busy machine: a cast made before
		// the ticks caught up was wasted, and each costs the bot's rest between casts.
		let bobber;
		let lineOut = false;
		const view = viewRegion(nearby, phone);
		const offScreen = () => !regionHolds(view, him.body.x - me.body.x, him.body.y - me.body.y);
		// Read at the room's step that casts and at the one that hooks, not from this timer: a cast
		// landing on the salmon hooks it in that same step, the device hears it at the next patch,
		// often before this timer ticks again, and from the hook on the salmon is reeled to him.
		let offScreenAtCast;
		let offScreenAtHook;
		const step = sim.step;
		sim.step = (take) => {
			const events = step(take);
			for (const e of events) {
				if (e.type === 'ability' && e.by === him.id) offScreenAtCast ??= offScreen();
				if (e.type === 'hooked' && e.target === me.id) offScreenAtHook ??= offScreen();
			}
			return events;
		};
		const timer = setInterval(() => {
			if (seq === tickHz) heldAway = salmon.state.players.has(him.id);
			Object.assign(him.body, seq < tickHz ? away : from);
			if (!him.lineActive) bobber = undefined;
			else if (!person && !lineOut && sim.steps >= me.safeUntil)
				bobber = { x: him.lineX, y: him.lineY };
			lineOut = Boolean(him.lineActive);
			if (me.status === STATUS.free) Object.assign(me.body, bobber ?? at);
			seq += 1;
			Object.assign(salmonInput.data, clampInput({ seq, ...phone }, sim.game.field));
			salmonInput.send();
			if (rodInput) {
				const tap = seq % (3 * tickHz) === 2 * tickHz ? BUTTONS.ability1 : 0;
				const aimed = clampInput({ seq, buttons: tap, aimX: at.x, aimY: at.y }, sim.game.field);
				Object.assign(rodInput.data, aimed);
				rodInput.send();
			}
			// From half a second after he came (the room's next patches sent).
			if (seq > 1.5 * tickHz && !salmon.state.players.has(him.id)) unheld += 1;
		}, 1000 / tickHz);
		try {
			await until('the hook', () => heard.some((e) => e.type === 'hooked'), 30_000);
		} finally {
			clearInterval(timer);
			sim.step = step;
		}
		const said = room.inputs.get(salmon.sessionId).latest;
		const found = {
			said: [said.shownW, said.shownH, said.shownIso],
			him: him.id,
			me: salmon.sessionId,
			offScreenAtCast,
			offScreenAtHook,
			heard: heard.map((e) => ({ ...e })),
			heldAway,
			unheld,
			holdsHim: salmon.state.players.has(him.id),
		};
		await Promise.all([salmon, rod].filter(Boolean).map((c) => c.leave()));
		return found;
	};

	for (const [who, game, person] of [
		['a person', 'phonerod', true],
		['a bot', 'phonebot', false],
	])
		await check(
			`live: a salmon whose device says a phone’s view holds the fisherman (${who}) who hooks it from off that screen, and hears his cast`,
			async () => {
				const found = await hookedOnAPhone(game, person);
				assert.deepEqual(found.said, [1376, 2720, 1], 'the room holds the phone’s view');
				assert.deepEqual(
					[found.offScreenAtCast, found.offScreenAtHook],
					[true, true],
					'when he casts and when it is hooked, he is off the screen the phone says it shows',
				);
				assert.equal(found.heldAway, false, 'on the far bank he was not sent to it');
				const cast = found.heard.findIndex((e) => e.type === 'ability' && e.by === found.him);
				const hook = found.heard.findIndex((e) => e.type === 'hooked');
				assert.deepEqual(
					{ by: found.heard[hook].by, target: found.heard[hook].target },
					{ by: found.him, target: found.me },
					'it is hooked by him',
				);
				assert.ok(cast >= 0 && cast < hook, 'its device heard his cast before the hook');
				assert.equal(found.unheld, 0, 'and held him at every input since he came, until then');
				assert.ok(found.holdsHim, 'as it does now');
			},
		);

	await check('live: without a max, what a device declares changes nothing', async () => {
		const { say, settled, holds, said, leave } = await viewRoom('box');
		say(undefined);
		await settled();
		assert.deepEqual(holds(), ['inBox']);
		for (const shown of [flat(SHOWN_MAX, SHOWN_MAX), iso(6000, 6000), flat(100, 100)]) {
			say(shown);
			await settled();
			assert.deepEqual(said(), [shown.shownW, shown.shownH, shown.shownIso], 'it is heard');
			assert.deepEqual(holds(), ['inBox'], 'and the box is what it is sent by');
		}
		await leave();
	});

	await check(
		'live: a device that never names its view plays as before, beside one that does',
		async () => {
			const { own, others, say, settled, holds, leave } = await viewRoom('view');
			say(flat(2400, 1600));
			await settled();
			await comesTo(holds, ['inBox', 'east', 'corner', 'ring']);
			// `east` and `inBox` are old runtimes: their inputs have the eight fields. 700 px apart,
			// neither is sent the other; `east` walks 300 px west and each is in the other's box.
			const room = matchMaker.getLocalRoomById(own.roomId);
			const east = room.sim.players.get(others.east.sessionId);
			const sentTo = (who) =>
				Object.keys(others).filter(
					(name) => name !== who && others[who].state.players.has(others[name].sessionId),
				);
			assert.deepEqual([sentTo('east'), sentTo('inBox')], [[], []]);
			const from = east.body.x;
			const input = others.east.input();
			for (let seq = 1; seq <= 30; seq++) {
				const step = clampInput({ seq, moveX: -MOVE_SCALE });
				assert.equal(Object.keys(step).length, 8, 'its inputs name no view');
				Object.assign(input.data, step);
				input.send();
				await wait(1000 / 30);
			}
			await until('its inputs', () => east.ack === 30);
			assert.ok(Math.abs(from - east.body.x - 300) < 1e-6, 'thirty steps at its 300 px/s');
			const latest = room.inputs.get(others.east.sessionId).latest;
			assert.deepEqual([latest.shownW, latest.shownH, latest.shownIso], [0, 0, 0]);
			await until('each in the other’s box', () => sentTo('east').length && sentTo('inBox').length);
			assert.deepEqual([sentTo('east'), sentTo('inBox')], [['inBox'], ['east']]);
			// The declaring device beside them is sent by its own view, as before the walk.
			assert.deepEqual(holds(), ['inBox', 'east', 'corner', 'ring']);
			await leave();
		},
	);
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-bots — ${passed} checks passed`);
process.exit(0);
