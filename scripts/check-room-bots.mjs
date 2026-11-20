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
// region a room with `nearby.max` sends it by, junk that declares nothing, and Salmons' `max`
// against what its camera shows on larger windows.
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
	inSight,
	pullIntoSight,
} from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	SHOWN_GRID,
	SHOWN_MAX,
	SHOWN_SHAPE,
	nearbyRegion,
	regionHolds,
	shownOf,
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
import { NEARBY_MARGIN } from '../services/game-server/src/arcadeRoom.ts';
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
	const box = nearbyRegion(ROOMY, flat(2000, 1000));
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
	const turned = nearbyRegion(ROOMY, iso(view.w, view.h));
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

await check('with a max a device is sent by the view it declares, cut at the max', () => {
	const nearby = { w: 3300, h: 3300, max: { w: 6400, h: 4600 } };
	const boxOnly = { w: nearby.w, h: nearby.h };
	const theBox = { x: 1650, y: 1650, across: Infinity, down: Infinity };
	assert.deepEqual(nearbyRegion(nearby, undefined), theBox, 'nothing declared: the box');
	assert.deepEqual(nearbyRegion(nearby, flat(0, 0)), theBox, 'zeros: the box');
	assert.deepEqual(nearbyRegion(nearby, {}), theBox, 'an input with no such fields: the box');
	// Without a max, nothing a device declares changes its region.
	for (const shown of [flat(6000, 6000), iso(600, 600), flat(SHOWN_MAX, SHOWN_MAX)])
		assert.deepEqual(nearbyRegion(boxOnly, shown), theBox, 'no max: the box, whatever it says');
	// A larger view is sent a player the box would not; a smaller one not one the box would.
	const large = nearbyRegion(nearby, iso(4032, 2368));
	assert.ok(!regionHolds(theBox, 0, -1728) && regionHolds(large, 0, -1728), '36 cells up-river');
	const phone = nearbyRegion(nearby, iso(1376, 2720));
	assert.ok(regionHolds(theBox, 0, -1200) && !regionHolds(phone, 0, -1200), '25 cells up-river');
	assert.ok(regionHolds(phone, 0, -576), '12 cells up-river is on the phone');
	// A flat view: the smaller of the view and the max on each axis.
	assert.deepEqual(nearbyRegion(nearby, flat(5000, 9000)), {
		x: 2500,
		y: 2300,
		across: Infinity,
		down: Infinity,
	});
	assert.deepEqual(nearbyRegion(nearby, flat(SHOWN_MAX, SHOWN_MAX)), {
		x: 3200,
		y: 2300,
		across: Infinity,
		down: Infinity,
	});
	// An isometric view past the max is the max box: its corner is held, a px past a side is not.
	const most = nearbyRegion(nearby, iso(SHOWN_MAX, SHOWN_MAX));
	assert.ok(regionHolds(most, 3200, 2300) && regionHolds(most, -3200, -2300));
	assert.ok(!regionHolds(most, 3201, 0) && !regionHolds(most, 0, 2301));
	// One inside the max in the world keeps its own shape: the max cuts only its tips.
	const cut = nearbyRegion(nearby, iso(6000, 3000));
	assert.ok(regionHolds(cut, 1500, -1500), 'the screen’s right corner, inside the max');
	assert.ok(!regionHolds(cut, 0, 2400), 'past the max’s height, though on the screen');
	assert.ok(!regionHolds(cut, 2000, 2000), 'inside the max, off the screen');
	// The keep region is every limit the margin further out.
	for (const shown of [undefined, flat(5000, 3000), iso(4032, 2368)]) {
		const enter = nearbyRegion(nearby, shown);
		const keep = nearbyRegion(nearby, shown, NEARBY_MARGIN);
		for (const limit of ['x', 'y', 'across', 'down'])
			assert.equal(keep[limit], enter[limit] * (1 + NEARBY_MARGIN), `${limit} kept 25 % past`);
	}
	const keep = nearbyRegion(nearby, iso(4032, 2368), NEARBY_MARGIN);
	assert.ok(!regionHolds(large, 0, -2100) && regionHolds(keep, 0, -2100), 'held on the way out');
	assert.ok(!regionHolds(keep, 0, -2600), 'and let go past the margin');
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
	const wrapped = nearbyRegion(
		nearby,
		sanitizeInput({ shownW: 4464, shownH: 65_531, shownIso: 0 }),
	);
	assert.deepEqual([wrapped.x, wrapped.y], [2000, 1500]);
	assert.deepEqual(
		nearbyRegion(nearby, sanitizeInput({ shownW: 4464, shownH: 65_531, shownIso: 7 })),
		nearbyRegion(nearby, undefined),
		'a shape that is neither: the box',
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
	assert.ok(salmons.online.rules.zones.length <= 256, 'a room runs every zone rule');
	assert.equal(salmons.online.rules.round.nextRoundSeconds, 15, '§14 #6');
	assert.ok(salmons.online.nearby);
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
 * sent by that, so Salmons' `nearby.max` has to cover it. `mobile` as above.
 */
const MAX_WINDOWS = [
	{ name: 'a 2560 × 1440 desktop window', w: 2560, h: 1440, mobile: false },
	{ name: 'a 3840 × 2160 desktop window at 100 %', w: 3840, h: 2160, mobile: false },
	{ name: 'a 1280 × 800 tablet', w: 1280, h: 800, mobile: true },
];

await check('Salmons: a device declares what its camera shows, and nearby.max covers it', () => {
	const river = salmonsMapRiver(SALMONS_MAP_SEED);
	const game = gameOf(salmonsConfig(river, { lobby: SALMONS_LOBBY }));
	const { nearby } = game.online;
	assert.ok(nearby.max, 'Salmons no longer names a `nearby.max`: every device is sent by the box');
	const scene = worldCameraScene(salmonsReferenceLayout(river).scenes);
	const zoomSpec = sceneCameraZoom(scene);
	const projected = sceneProjector(scene) !== undefined;
	// The largest body's full size on every side: a look stands on its feet, so one standing a
	// body below the window's lower edge still shows its head (`apps/lines` `online.ts` `reach`).
	const reach = Math.max(
		...game.online.characters.map(({ body }) => {
			const { shape, r, w, h } = game.bodies[body];
			return shape === 'circle' ? 2 * r : Math.max(w, h);
		}),
	);
	const short = [];
	for (const { name, w, h, mobile } of [...NEARBY_WINDOWS, ...MAX_WINDOWS]) {
		// What the camera shows on the window, as the check above works it out, and the margin.
		const view = zoomedView({ w, h }, cameraZoom(zoomSpec, { mobile, windowScale: 1 }));
		const need = { w: view.w + 2 * reach, h: view.h + 2 * reach };
		// What the device says there, however the layout's box happens to fit the window.
		for (const windowScale of [1, 1.8, 0.4875]) {
			const zoom = cameraZoom(zoomSpec, { mobile, windowScale });
			const shown = shownOf({ window: { w, h }, windowScale, zoom, iso: projected, margin: reach });
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
				const region = nearbyRegion(nearby, shown);
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
		[null, geometry.spawns.bear, geometry.spawns.fisherman],
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

	/**
	 * A room of `game` with the own device and one still device at each of {@link VIEW_OTHERS}:
	 * `say` sends the own device's next input with what it says its screen shows (`undefined`: an
	 * input that never names the fields), `holds` is who it is sent now by name, `settled` waits
	 * for the room to act on the last input (two patches), `said` is what the room holds.
	 */
	const viewRoom = async (game) => {
		const own = await clientOf().joinOrCreate(ROOM_NAME, { game, character: 'own' });
		const heard = [];
		own.onMessage(ONLINE_EVENT, (events) => heard.push(...events));
		const others = {};
		for (const name of Object.keys(VIEW_OTHERS)) {
			others[name] = await clientOf().joinById(own.roomId, { character: 'other' });
			others[name].onMessage(ONLINE_EVENT, () => {});
		}
		await until('the own player', () => own.state.players?.has(own.sessionId));
		const room = matchMaker.getLocalRoomById(own.roomId);
		const input = own.input();
		let seq = 0;
		const say = (shown) => {
			seq += 1;
			Object.assign(input.data, clampInput({ seq }), shown);
			input.send();
		};
		const settled = async () => {
			await until('the input', () => room.sim.players.get(own.sessionId).ack === seq);
			await wait(3 * (1000 / room.sim.game.online.patchHz));
		};
		const holds = () =>
			Object.keys(VIEW_OTHERS).filter((name) => own.state.players.has(others[name].sessionId));
		const said = () => {
			const { shownW, shownH, shownIso } = room.inputs.get(own.sessionId).latest;
			return [shownW, shownH, shownIso];
		};
		const leave = () => Promise.all([own, ...Object.values(others)].map((c) => c.leave()));
		return { own, others, heard, say, settled, holds, said, leave };
	};

	await check(
		'live: with a max, a device is sent by the view it declares, cut at the max, and by the box when it says nothing',
		async () => {
			const { own, others, heard, say, settled, holds, said, leave } = await viewRoom('view');
			// A device that never names the fields (a runtime from before them): the box, as ever.
			say(undefined);
			await settled();
			assert.deepEqual(said(), [0, 0, 0], 'the room holds no view for it');
			assert.deepEqual(holds(), ['inBox']);
			// A larger flat view: a player the box would not send. Not the one past it.
			say(flat(2400, 1600));
			await settled();
			assert.deepEqual(said(), [2400, 1600, 0]);
			assert.deepEqual(holds(), ['inBox', 'east', 'corner']);
			// The same sizes as an isometric screen: the turned rectangle, so not the corner, which
			// stands inside its bounding box (1400 × 1400 about the own player).
			say(iso(2200, 1100));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'east']);
			// A smaller view than the box: not even the player the box would send.
			say(flat(400, 400));
			await settled();
			assert.deepEqual(holds(), []);
			// Past the max: cut at it (4000 × 3000 about the own player).
			say(flat(SHOWN_MAX, SHOWN_MAX));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'east', 'farEast', 'corner']);
			say(iso(SHOWN_MAX, SHOWN_MAX));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'east', 'farEast', 'corner']);
			// Hysteresis on a declared view: 1900 px away is past a 3200 px view's edge (1600) and
			// inside its margin (2000), so the player it holds stays; a 3000 px view lets it go
			// (1875), and neither brings it back.
			say(flat(3200, 3000));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'east', 'farEast', 'corner']);
			say(flat(3000, 3000));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'east', 'corner']);
			say(flat(3200, 3000));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'east', 'corner'], 'not back in: it is past the edge');
			// Events go by the same views: a leave it holds is told, one it does not hold is not.
			heard.length = 0;
			const gone = [others.east.sessionId, others.farEast.sessionId];
			await others.farEast.leave();
			await others.east.leave();
			await until('east’s leave', () => heard.some((e) => e.type === 'left' && e.id === gone[0]));
			assert.ok(!heard.some((e) => e.id === gone[1]), 'nothing about the player it was not sent');
			// Junk declares nothing, as its own encoder sends it and as the wire could carry it.
			for (const junk of [
				{ shownW: 70_000, shownH: -5, shownIso: 2 },
				{ shownW: Number.NaN, shownH: 3.7, shownIso: 255 },
				{ shownW: 3000, shownH: 3000, shownIso: 7 },
				{ shownW: 3000, shownH: 0, shownIso: 1 },
			]) {
				say(flat(2400, 1600));
				await settled();
				assert.deepEqual(holds(), ['inBox', 'corner']);
				// Written past the clamp, as a device that skips it would.
				Object.assign(own.input().data, junk);
				say(undefined);
				await settled();
				assert.deepEqual(said(), [0, 0, 0], `${JSON.stringify(junk)}: nothing declared`);
				assert.deepEqual(holds(), ['inBox'], 'the box');
			}
			// It stops declaring: back to the box.
			say(flat(2400, 1600));
			await settled();
			assert.deepEqual(holds(), ['inBox', 'corner']);
			say(flat(0, 0));
			await settled();
			assert.deepEqual(said(), [0, 0, 0]);
			assert.deepEqual(holds(), ['inBox']);
			// And it left: the room keeps nothing it said.
			const id = own.sessionId;
			const room = matchMaker.getLocalRoomById(own.roomId);
			say(flat(2400, 1600));
			await settled();
			await own.leave();
			await until('the leave', () => !room.sim.players.has(id));
			assert.equal(room.inputs.get(id).latest, undefined);
			await leave();
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
			assert.deepEqual(holds(), ['inBox', 'east', 'corner']);
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
			assert.deepEqual(holds(), ['inBox', 'east', 'corner']);
			await leave();
		},
	);
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-bots — ${passed} checks passed`);
process.exit(0);
