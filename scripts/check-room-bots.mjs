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
import {
	BUTTONS,
	MOVE_SCALE,
	characterBody,
	clampInput,
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
import { isoViewRect, sceneProjector } from '../packages/engine-layout/src/lib/projection.ts';
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
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim, RoomRefusal } from '../services/game-server/src/roomSim.ts';
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

// --- 3. Salmons as data ----------------------------------------------------------------------------

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

// --- 4. live: a real server ------------------------------------------------------------------------

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
	maxRooms: 3,
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
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-bots — ${passed} checks passed`);
process.exit(0);
