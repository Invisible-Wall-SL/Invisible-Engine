// A ROOM'S LOBBY (docs/design/salmons-levels.md §4; owner, 2026-11-17): with `rules.lobby` a room
// waits before its first round until `minPlayers` people are in, or `maxWaitSeconds` after the first
// joined, whichever is first; a `countdown` of `countdownSeconds` then runs and round 1 starts.
// Bots never count. A lobby every person left starts over. Without a lobby the first join starts
// round 1 as before. Rounds after the first follow on as before (Salmons plays one game a room).
// Also: the device's Flow signals, Game Config's lobby block, and Salmons' export, layout and flow
// carrying the lobby screen.
// THE START MENU COMES BEFORE THE JOIN (owner bug, 2026-11-19: "the starting menu is now gone"): the
// menu was drawn only in the lobby, so a person who landed in a room already running was put in play
// as a salmon and could never pick fisherman or bear. A launch that carries no character joins no
// room until its person has picked (`engine-mechanics` `launchJoin`, what `apps/lines` `online.ts`
// boots by); the drawn half is `scripts/playtest/salmons-levels-play.mjs`.
// AND IT IS ASKED ONCE (owner, 2026-11-20): a new room's lobby no longer draws the menu a second
// time; it shows the room and who waits, in the node the published layout already has.
// A CLASS PICKED IN THE LOBBY (owner, 2026-11-25: "add some UI to the waiting room so that a player
// can change the played character"): until round 1 starts, the countdown included, a person changes
// the class it plays IN PLACE, through the room, by the Respawn's rule (a place, the bot that gives
// it, the bot let back into the class left, or a refusal); nobody leaves and joins again. The room's
// half is `roomSim.ts`; the device's (`engine-mechanics` `createRespawnAsk`, what `online.ts` sends
// and reads by) is played here against the room with a delay each way; a real Colyseus room and
// SDK client carry both over the wire; the drawn half is the playtest's.
// ONE ANSWER A PRESS (review, 2026-11-25): the room answers a run of inputs asking the same once
// and does not test the place again within it, the device makes every press a run of its own, and
// a caught person's Respawn reads its answer off the state as the lobby's pick does.
// THE WHOLE CLOCK AND THE NEXT GAME BY ITSELF (owner, 2026-11-26): from the first person on, the
// room's `endsAt` is round 1's start at the latest (the wait and the countdown), cut to the
// countdown's end when the room fills early, and 0 with nobody in; the device's code-drawn clock
// takes the place of the seconds node every published layout has; the win screen counts to the
// next game only for a person who played the round (pins; the drawn half is the playtests').
//
//   pnpm check:room-lobby

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { STATUS } from '../packages/engine-mechanics/src/abilities.js';
import {
	clampInput,
	createRespawnAsk,
	launchJoin,
} from '../packages/engine-mechanics/src/online.js';
import { flowSignalsOf, serverValuesOf } from '../packages/engine-mechanics/src/onlineFlow.js';
import { SALMONS_LOBBY, salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	SALMONS_SCREEN_ART,
	SALMONS_SCREENS,
	salmonsReferenceLayout,
} from '../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import {
	SALMONS_CLOCK_URGENT,
	SALMONS_RESPAWN_CHARACTERS,
} from '../packages/engine-layout/src/lib/referenceLayouts/salmonsScreens.ts';
import {
	SALMONS_FLOW_SCREENS,
	SALMONS_SEED_DOC,
} from '../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
import { ROOM_NAME, createGameServer } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);
const { matchMaker } = await import(
	pathToFileURL(gameServerRequire.resolve('@colyseus/core')).href
);

let passed = 0;
const check = (name, fn) => {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
};

const river = salmonsMapRiver(SALMONS_MAP_SEED);
const LOBBY = { minPlayers: 3, maxWaitSeconds: 20, countdownSeconds: 5 };
const docOf = (lobby) => normalizeGameConfigDoc(salmonsConfig(river, lobby ? { lobby } : {}));
const gameOf = (lobby) => onlineGameOf(docOf(lobby));

const NO_BOTS = { fillTo: 0, characters: [], canWin: false, spawns: [] };
/** A room with no bots, so only the people this gate joins are in it. */
const roomOf = (lobby) => {
	const game = gameOf(lobby);
	return createRoomSim({ ...game, online: { ...game.online, bots: NO_BOTS } }, { seed: 7 });
};
const rest = () => [];
/** Step `n` times; every event of those steps, and those of joins and leaves before them. */
const run = (sim, n) => {
	const events = sim.events();
	for (let i = 0; i < n; i++) events.push(...sim.step(rest));
	return events;
};
const types = (events) => events.map((e) => e.type);
/** The room's values as its state carries them to a device. */
const stateLike = (sim) => ({ step: sim.steps, phase: sim.rules.phase, endsAt: sim.rules.endsAt });

check('without a lobby, the first join starts round 1 (unchanged)', () => {
	const sim = roomOf(undefined);
	sim.join('a', { character: 'salmon' });
	assert.equal(sim.rules.phase, 'running');
	assert.ok(types(run(sim, 1)).includes('roundStart'));
});

check('a person joining a lobby is told, and the room waits', () => {
	const sim = roomOf(LOBBY);
	sim.join('a', { character: 'salmon' });
	const events = run(sim, 30);
	assert.equal(sim.rules.phase, 'waiting');
	assert.deepEqual(
		events.filter((e) => e.type === 'lobby'),
		[{ type: 'lobby', id: 'a' }],
	);
	assert.ok(!types(events).includes('roundStart'));
});

// THE WHOLE CLOCK (owner, 2026-11-26: "have the all countdown showing up"): from the first person
// on, the room's `endsAt` is when round 1 starts at the latest, the wait and the countdown; the
// countdown, once it runs, makes it its own end. A device reads the seconds off it.
check('from the first person the clock runs to round 1: the wait and the countdown', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	assert.equal(sim.rules.endsAt, 0, 'an empty lobby runs no clock');
	const joinedAt = sim.steps;
	sim.join('a', { character: 'salmon' });
	const full = joinedAt + (LOBBY.maxWaitSeconds + LOBBY.countdownSeconds) * hz;
	assert.equal(sim.rules.endsAt, full, 'the first join sets it');
	const seconds = () => serverValuesOf(stateLike(sim), 'a', hz).secondsLeft;
	assert.equal(seconds(), LOBBY.maxWaitSeconds + LOBBY.countdownSeconds);
	run(sim, 3 * hz);
	assert.equal(seconds(), LOBBY.maxWaitSeconds + LOBBY.countdownSeconds - 3, 'it ticks down');
	sim.join('b', { character: 'salmon' });
	run(sim, 1);
	assert.equal(sim.rules.endsAt, full, 'a person joining mid-wait does not move it');
	const counted = run(sim, (LOBBY.maxWaitSeconds - 3) * hz);
	assert.ok(types(counted).includes('countdown'), 'the wait ran out');
	assert.equal(sim.rules.endsAt, full, 'the countdown of a wait run out ends where the clock did');
	assert.equal(seconds(), LOBBY.countdownSeconds);
	let startedAt = 0;
	for (let i = 0; i <= LOBBY.countdownSeconds * hz && !startedAt; i++)
		if (types(run(sim, 1)).includes('roundStart')) startedAt = sim.steps;
	assert.equal(startedAt, full, 'round 1 starts at the step the clock named from the first');
});

check('a room that fills early cuts the clock to the countdown', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	for (const id of ['a', 'b']) sim.join(id, { character: 'salmon' });
	run(sim, 4 * hz);
	const seconds = () => serverValuesOf(stateLike(sim), 'a', hz).secondsLeft;
	assert.equal(seconds(), LOBBY.maxWaitSeconds + LOBBY.countdownSeconds - 4);
	sim.join('c', { character: 'salmon' });
	run(sim, 1);
	assert.equal(sim.rules.endsAt, sim.steps + LOBBY.countdownSeconds * hz);
	assert.equal(seconds(), LOBBY.countdownSeconds, 'it drops to the countdown');
});

check('a lobby everyone left runs no clock, and its next person starts a fresh one', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	sim.join('a', { character: 'salmon' });
	run(sim, 5 * hz);
	sim.leave('a');
	run(sim, 1);
	assert.equal(sim.rules.endsAt, 0);
	assert.equal(serverValuesOf(stateLike(sim), 'a', hz).secondsLeft, 0);
	run(sim, 2 * hz);
	const joinedAt = sim.steps;
	sim.join('b', { character: 'salmon' });
	assert.equal(sim.rules.endsAt, joinedAt + (LOBBY.maxWaitSeconds + LOBBY.countdownSeconds) * hz);
});

check('bots alone open no lobby and run no clock', () => {
	const sim = createRoomSim(gameOf({ ...LOBBY, minPlayers: 2 }), { seed: 7 });
	run(sim, 10);
	assert.ok([...sim.players.values()].some((p) => p.bot) || sim.players.size === 0);
	assert.equal(sim.rules.endsAt, 0);
});

check('without a lobby the clock is the round’s, as before', () => {
	const game = gameOf(undefined);
	const sim = roomOf(undefined);
	sim.join('a', { character: 'salmon' });
	assert.equal(sim.rules.phase, 'running');
	const seconds = game.online.rules.round.seconds;
	assert.equal(sim.rules.endsAt, seconds ? sim.steps + seconds * game.online.tickHz : 0);
});

check('enough people start the countdown; round 1 starts when it ends', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	for (const id of ['a', 'b']) sim.join(id, { character: 'salmon' });
	assert.ok(!types(run(sim, 5)).includes('countdown'), 'two of three: still waiting');
	sim.join('c', { character: 'salmon' });
	const counted = run(sim, 1);
	assert.deepEqual(
		counted.filter((e) => e.type === 'countdown'),
		[{ type: 'countdown', seconds: LOBBY.countdownSeconds }],
	);
	assert.equal(sim.rules.phase, 'waiting');
	assert.equal(
		sim.rules.endsAt,
		sim.steps + LOBBY.countdownSeconds * hz,
		'the clock is the countdown',
	);
	const before = run(sim, LOBBY.countdownSeconds * hz - 1);
	assert.ok(!types(before).includes('roundStart'), 'not before the countdown ends');
	const started = run(sim, 1);
	assert.ok(types(started).includes('roundStart'));
	assert.equal(sim.rules.phase, 'running');
	assert.equal(sim.rules.round, 1);
});

check('one person alone: the longest wait starts the countdown', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	sim.join('a', { character: 'salmon' });
	assert.ok(!types(run(sim, LOBBY.maxWaitSeconds * hz - 1)).includes('countdown'));
	assert.ok(types(run(sim, 1)).includes('countdown'));
	assert.ok(types(run(sim, LOBBY.countdownSeconds * hz)).includes('roundStart'));
});

check('bots never count towards the lobby', () => {
	const game = gameOf({ ...LOBBY, minPlayers: 2 });
	const sim = createRoomSim(game, { seed: 7 });
	sim.join('a', { character: 'salmon' });
	const events = run(sim, 10);
	assert.ok(
		[...sim.players.values()].some((p) => p.bot),
		'the room has its bots',
	);
	assert.equal(sim.rules.phase, 'waiting');
	assert.ok(!types(events).includes('countdown'));
	assert.ok(!events.some((e) => e.type === 'lobby' && e.id !== 'a'), 'no lobby event for a bot');
});

check('a lobby everyone left starts over, with a fresh wait', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	sim.join('a', { character: 'salmon' });
	run(sim, (LOBBY.maxWaitSeconds - 2) * hz);
	sim.leave('a');
	run(sim, 4 * hz);
	sim.join('b', { character: 'salmon' });
	const events = run(sim, 5 * hz);
	assert.ok(!types(events).includes('countdown'), 'the wait restarted with the new person');
	assert.equal(sim.rules.phase, 'waiting');
});

check('people who drop and rejoin keep the lobby going (no lobby stuck waiting)', () => {
	const sim = roomOf(LOBBY);
	const hz = sim.game.online.tickHz;
	sim.join('a', { character: 'salmon' });
	run(sim, 2);
	sim.drop('a');
	run(sim, 2);
	sim.rejoin('a');
	run(sim, LOBBY.maxWaitSeconds * hz);
	const solo = run(sim, (LOBBY.countdownSeconds + 1) * hz);
	assert.ok(types(solo).includes('roundStart'), 'a lone rejoined person still gets round 1');

	const pair = roomOf({ ...LOBBY, minPlayers: 2 });
	for (const id of ['a', 'b']) pair.join(id, { character: 'salmon' });
	assert.ok(types(run(pair, 1)).includes('countdown'));
	for (const id of ['a', 'b']) pair.drop(id);
	run(pair, 1);
	for (const id of ['a', 'b']) pair.rejoin(id);
	const resumed = run(pair, (LOBBY.countdownSeconds + 1) * hz);
	assert.ok(types(resumed).includes('roundStart'), 'the countdown carries on through a blip');
});

check('a longest wait of 0 starts the countdown at once, even on the first step', () => {
	const sim = roomOf({ ...LOBBY, maxWaitSeconds: 0 });
	sim.join('a', { character: 'salmon' });
	assert.ok(types(run(sim, 1)).includes('countdown'));
});

check('rounds after the first follow on as before', () => {
	const game = gameOf({ ...LOBBY, minPlayers: 1, countdownSeconds: 0 });
	const rules = {
		...game.online.rules,
		round: { seconds: 300, nextRoundSeconds: 15, goalScore: 1 },
	};
	const sim = createRoomSim(
		{ ...game, online: { ...game.online, rules, bots: NO_BOTS } },
		{ seed: 7 },
	);
	sim.join('a', { character: 'salmon' });
	run(sim, 2);
	assert.equal(sim.rules.phase, 'running');
	const hz = sim.game.online.tickHz;
	run(sim, 300 * hz + 1);
	assert.equal(sim.rules.phase, 'ended', 'the round ran out');
	const next = run(sim, sim.game.online.rules.round.nextRoundSeconds * hz + 1);
	assert.ok(types(next).includes('roundStart'), 'the next round starts on its own');
	assert.ok(!types(next).includes('lobby') && !types(next).includes('countdown'));
});

check("a device's Flow hears `lobby` (its own, `me`) and `countdown`", () => {
	assert.deepEqual(
		flowSignalsOf(
			[
				{ type: 'lobby', id: 'a' },
				{ type: 'lobby', id: 'b' },
				{ type: 'countdown', seconds: 10 },
			],
			'a',
		),
		[
			{ name: 'lobby', payload: { player: 'a', me: true } },
			{ name: 'lobby', payload: { player: 'b', me: false } },
			{ name: 'countdown', payload: { seconds: 10 } },
		],
	);
});

check('Game Config: a lobby block is kept, filled with defaults and held to its limits', () => {
	const doc = docOf({});
	assert.deepEqual(doc.arcade.online.rules.lobby, {}, 'an empty lobby is a lobby');
	assert.deepEqual(onlineGameOf(doc).online.rules.lobby, {
		minPlayers: 4,
		maxWaitSeconds: 60,
		countdownSeconds: 10,
	});
	const wild = docOf({ minPlayers: 500, maxWaitSeconds: 9999, countdownSeconds: 99 });
	assert.deepEqual(onlineGameOf(wild).online.rules.lobby, {
		minPlayers: 100,
		maxWaitSeconds: 600,
		countdownSeconds: 60,
	});
	const warned = validateFamily(wild).map((i) => i.path);
	assert.ok(warned.includes('arcade.online.rules.lobby'));
	assert.ok(warned.includes('arcade.online.rules.lobby.minPlayers'));
	assert.equal(onlineGameOf(docOf(undefined)).online.rules.lobby, undefined, 'none: no lobby');
});

check("Salmons ships its lobby: the export's config, the screens and the flow", () => {
	const shipped = docOf(SALMONS_LOBBY);
	assert.deepEqual(shipped.arcade.online.rules.lobby, { ...SALMONS_LOBBY });
	assert.deepEqual(
		validateFamily(shipped).filter((i) => i.severity === 'error'),
		[],
	);
	const scenes = salmonsReferenceLayout(river).scenes.map((s) => s.id);
	for (const id of [SALMONS_SCREENS.lobby, SALMONS_SCREENS.countdown]) {
		assert.ok(scenes.includes(id), `the layout has ${id}`);
		assert.ok(
			SALMONS_SEED_DOC.containers.some((c) => c.sceneId === id),
			`the flow shows ${id}`,
		);
	}
	assert.equal(SALMONS_FLOW_SCREENS.lobby, SALMONS_SCREENS.lobby);
	assert.equal(SALMONS_FLOW_SCREENS.countdown, SALMONS_SCREENS.countdown);
	const nodes = SALMONS_SEED_DOC.graph.nodes;
	const hides = nodes.filter((n) => n.kind === 'hideContainer').map((n) => n.ref);
	assert.ok(hides.includes(SALMONS_SCREENS.lobby) && hides.includes(SALMONS_SCREENS.countdown));
	assert.ok(SALMONS_SEED_DOC.variables.some((v) => v.id === 'phase' && v.server === 'phase'));
});

check('the lobby’s clock is drawn in place of the seconds every published layout has', () => {
	const countdown = salmonsReferenceLayout(river).scenes.find(
		(scene) => scene.id === SALMONS_SCREENS.countdown,
	);
	const seconds = countdown.nodes.find((node) => node.id === SALMONS_SCREEN_ART.clock);
	assert.equal(SALMONS_SCREEN_ART.clock, 'sm-countdown-seconds', 'the published node’s id');
	assert.equal(seconds?.params?.source, 'var:secondsLeft', 'the plain number until the art is in');
	assert.equal(SALMONS_CLOCK_URGENT, 10, 'red and pulsing for the last 10 seconds');
	const screens = readFileSync(
		join(ROOT, 'packages/engine-layout/src/lib/salmonsArt/screens.ts'),
		'utf8',
	);
	assert.match(screens, /\[SALMONS_SCREEN_ART\.clock, clock\.mount\]/);
	assert.match(screens, /seconds !== undefined && seconds <= SALMONS_CLOCK_URGENT/);
	// The device shows the room's seconds (the flow's `secondsLeft`) only while the room waits.
	const online = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
	assert.match(
		online,
		/screens\.clock\(\s*waiting\s*\? serverValuesOf\(state, current\.room\.sessionId, current\.game\.online\.tickHz\)\s*\.secondsLeft\s*: undefined,\s*\);/,
	);
});

check('the win screen joins the next game by itself only for a person who played the round', () => {
	const win = readFileSync(
		join(ROOT, 'packages/engine-layout/src/lib/salmonsArt/winAnimation.ts'),
		'utf8',
	);
	assert.match(win, /export const NEXT_GAME_SECONDS = 10;/);
	// At 0 it does what the button does; a hidden page, or the screen taken away, stops it.
	assert.match(win, /if \(count === 'running' && leftMs <= 0\) press\(\);/);
	assert.match(win, /const button = pixelButton\(labelOf\(won\), press\);/);
	assert.match(
		win,
		/if \(count === 'running' && \(!onScreen\(root\) \|\| !pageShown\(\)\)\) count = 'stopped';/,
	);
	assert.match(win, /count = next\?\.count \? \(pageShown\(\) \? 'pending' : 'stopped'\) : 'off';/);
	const online = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
	assert.match(online, /won: event\.winner === me,\s*count: current\.played,/);
	assert.match(online, /else if \(event\.type === 'roundStart'\) current\.played = false;/);
	assert.match(
		online,
		/\(input\.moveX \|\| input\.moveY \|\| input\.buttons \|\| input\.respawn\) &&\s*stateOf\(current\.room\)\.phase === 'running'\s*\)\s*current\.played = true;/,
	);
});

check('a new room’s lobby has no form: its note shows the room, who waits and the classes', () => {
	const art = (file) =>
		readFileSync(join(ROOT, 'packages/engine-layout/src/lib/salmonsArt', file), 'utf8');
	const screens = art('screens.ts');
	// What the room's screens draw in the lobby: the room's river with its people, who the device
	// plays, and one button a class, which asks the host (the runtime) and nothing else.
	const note = /\nfunction createLobbyNote\([\s\S]*?\n}\n/.exec(screens)?.[0] ?? '';
	assert.match(note, /riverRows\(\[\{ roomId: shown\.roomId, players \}\]\)/);
	assert.match(note, /You are /);
	assert.match(
		note,
		/choiceRow\(\s*SALMONS_RESPAWN_CHARACTERS\.map\(\(id\) => \(\{ id, label: CHARACTER_NAMES\[id\] \}\)\),\s*onPick,\s*\)/,
		'a button a class, each pressed straight to the host',
	);
	assert.deepEqual([...SALMONS_RESPAWN_CHARACTERS], ['salmon', 'fisherman', 'bear']);
	assert.match(note, /row\.select\(shown\.character\)/, 'the class the ROOM has it as is lit');
	assert.match(note, /row\.view\.visible = picking;/, 'only while the room lets its people pick');
	assert.match(note, /full\.visible = picking && shown\?\.refused === true;/);
	assert.match(note, /noteLine\(12, LOBBY\.full, NO_PLACE\)/, 'the death screen’s words');
	assert.match(screens, /const full = label\(NO_PLACE, 12, 0xffaaaa\);/);
	assert.match(note, /row\.view\.scale\.set\(fit\);/, 'the row fits a phone');
	assert.match(note, /const fit = fitTo\(w, row\.width\);/);
	assert.match(screens, /Math\.min\(1, \(w - 2 \* LOBBY\.margin\) \/ width\)/);
	for (const form of [/createElement/, /rejoin/, /<input|Join River/, /pixelButton\('/])
		assert.doesNotMatch(note, form, `the lobby's note has ${form}`);
	assert.match(
		screens,
		/\[SALMONS_SCREEN_ART\.lobby, lobby\.mount\]/,
		'it is what the lobby mounts',
	);
	assert.match(screens, /createLobbyNote\(host\.rivers, host\.pick\)/);
	// Nothing drawn in a room makes a text field or keeps a name, and a room's screens can leave
	// for a new room only as the player is (the win screen's button): never as another choice.
	assert.doesNotMatch(screens, /createElement\(|Join River|localStorage/);
	assert.match(screens, /\n\trejoin: \(\) => void;\n/);
	const online = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
	assert.match(online, /\n\t\trejoin: \(\) => void switchRoom\(current, launch\),\n/);
	// That leave joins as the player is in the room it leaves (its name, its class, the winner's
	// pass), on the same page. The join is kept for the boot after one that failed, and taken
	// back once the device is in.
	assert.match(
		online,
		/join = launchJoin\(\s+\{\s+\.\.\.\(me\?\.name \? \{ name: me\.name \} : \{\}\),\s+\.\.\.\(me \? \{ character: me\.character \} : \{\}\),\s+\.\.\.\(current\.pass \? \{ pass: current\.pass \} : \{\}\),\s+\},\s+launch\.own,\s+false,\s+\)\.join;\s+keepNextJoin\(launch, join\);/,
	);
	// It is taken back as soon as the device is in the new room. Whatever stops the switch (a
	// refusal, no answer in time, anything thrown, art that does not load) ends in one place,
	// which keeps the join and loads the page again: a person is never left on a dead win screen,
	// in any kind of boot (the error screen shows only on a live-authoring one).
	assert.match(
		online,
		/closeSession\(replaced\);[\s\S]{0,400}?dropNextJoin\(\);\s+\}\s+session = current;/,
	);
	assert.match(
		online,
		/function failSwitch\([^)]*\) \{\s+if \(reloading\) return;\s+reloading = true;[\s\S]{0,400}?keepNextJoin\(launch, join\);\s+window\.location\.reload\(\);\s+\}/,
	);
	// Until its session is made, a room's leave is the join's answer, said once (no second
	// error screen), and clears nothing of the picture that stands.
	assert.match(online, /left = code;\s+if \(!made\) return predict\?\.dispose\(\);/);
	assert.match(
		online,
		/const seed = generator \? await roomSeed\(room\) : undefined;\s+if \(left !== undefined\) return `the room closed as it was joined/,
	);
	// A join that answers after the switch failed is left, not shown over the reload.
	assert.equal(
		online.match(
			/if \(switched && reloading\) \{\s+room\.leave\(true\)[^;]*;\s+return undefined;\s+\}/g,
		)?.length,
		2,
	);
	assert.equal(online.match(/location\.reload/g).length, 1, 'loaded again from that one place');
	const switching = online.slice(
		online.indexOf('async function switchRoom('),
		online.indexOf('/** Whether a failed switch'),
	);
	assert.match(switching, /Promise\.race\(\[\s+enterRoom\(launch, join, current\),/);
	assert.match(switching, /setTimeout\(\(\) => resolve\([^)]*\), SWITCH_MS\)/);
	assert.match(switching, /if \(refused !== undefined\) failSwitch\(launch, join, refused\);/);
	assert.match(switching, /let timer[^\n]*\n\ttry \{\n\t\tconst me = /, 'all of it is caught');
	assert.match(switching, /\} catch \(error\) \{\s+failSwitch\(launch, join,/);
	assert.doesNotMatch(switching, /refuseOnlineBoot/);
	assert.match(
		online,
		/if \(switched && session === current\)\s+failSwitch\(launch, join, `the new room’s art did not load/,
	);
	assert.match(online, /chain\.catch\(\(error: unknown\) => failSwitch\(launch, join,/);
	// A class pressed in the lobby stays in the room: it is what the device asks, sent as inputs,
	// as a caught player's Respawn is; every input's `respawn` is that ask's and nothing else's.
	assert.match(
		online,
		/const ask = \(character: string\) => \{\n\t\tconst respawn = respawnOf\(current, character\);\n\t\tif \(respawn\) current\.ask\.press\(respawn\);\n\t\};\n\treturn \{\n\t\trespawn: ask,\n\t\tpick: ask,\n/,
	);
	assert.match(online, /raw\.respawn = current\.ask\.input\(current\.seq\);/);
	assert.equal(online.match(/\.respawn = /g).length, 1, 'written in that one place');
	// The note while the room waits, and only then; its classes only while the room SAYS its people
	// may pick (a server older than the pick never does), when the pick reads its answer. A caught
	// player's Respawn reads its own off the same state while the room takes one (it plays nothing
	// while it is out), and neither waits for the room's event.
	assert.match(online, /const picking = !!me && waiting && state\.picking === true;/);
	assert.match(
		online,
		/if \(me && out\) \{\n\t\tif \(state\.phase === 'running' && current\.game\.online\.rules\.respawn === 'manual'\)\n\t\t\task\.answer\(me\.ack, 0\);\n\t\} else if \(picking\) ask\.answer\(me\.ack, respawnOf\(current, me\.character\)\);\n\telse ask\.drop\(\);/,
	);
	assert.match(online, /if \(out && ask\.refused && !refused\) screens\.refused\(\);/);
	assert.doesNotMatch(online, /event\.type === 'respawnRefused'/);
	assert.match(online, /screens\.lobby\(\s*me && waiting\s*\? \{/);
	// A press on one of those buttons is the screen's: its `down` is kept from the pointer and the
	// touch control, so it begins no press there, steers nothing and taps nothing. What takes a
	// press is what Pixi gives it to: the note asks Pixi's own hit test, not a box of its own.
	assert.match(
		online,
		/if \(type === 'down' && onScreenButton\(toGlobal\(e\.clientX, e\.clientY\)\)\) return;\n\t\tconst control =/,
	);
	assert.match(
		note,
		/const target = part\.app\(\)\?\.renderer\.events\.rootBoundary\.hitTest\(x, y\);\n\t\t\treturn !!target && row\.has\(target\);/,
	);
	assert.doesNotMatch(screens, /toLocal\(/);
	// A player that became another class is spawned again as that class's component, the frame
	// its class changes (a lobby pick never hides it, so nothing else would).
	assert.match(
		online,
		/if \(was === undefined \|\| was === player\.character\) return;\n\t\tconst instance = current\.drawn\.get\(id\);\n\t\tif \(instance\) \{\n\t\t\tlive\.despawn\(instance\);\n\t\t\tcurrent\.drawn\.delete\(id\);\n\t\t\}/,
	);
	// The one place that asks a name or leaves for another choice: the start menu, before the join.
	const start = art('startMenu.ts');
	assert.match(start, /Join River/);
	assert.match(start, /styled\('input'/);
	// The published layout is not touched: the note is drawn in the node the menu was drawn in,
	// under the layout's own title, and that node is as it was published.
	const lobby = salmonsReferenceLayout(river).scenes.find((s) => s.id === SALMONS_SCREENS.lobby);
	assert.deepEqual(
		lobby.nodes.map((n) => n.id),
		['sm-lobby-name', 'sm-lobby-tagline', 'sm-lobby-title', 'sm-lobby-menu'],
	);
	assert.deepEqual(lobby.nodes.at(-1), {
		id: SALMONS_SCREEN_ART.lobby,
		label: 'Start menu (drawn in code)',
		kind: 'container',
		x: 0,
		y: 0,
		children: [],
	});
});

check(
	'a launch that carries no character asks its start menu; one that carries it joins at once',
	() => {
		const published = { name: null, character: null };
		assert.deepEqual(launchJoin({}, published, true), {
			join: { name: undefined, character: undefined },
			choose: true,
		});
		assert.equal(launchJoin({}, { name: 'Ann', character: '' }, true).choose, true);
		assert.deepEqual(launchJoin({}, { name: 'Ann', character: null }, true).join, {
			name: 'Ann',
			character: undefined,
		});
		// `?rooms_character=`: every playtest's launch.
		assert.deepEqual(launchJoin({}, { name: 'Bo', character: 'bear' }, true), {
			join: { name: 'Bo', character: 'bear' },
			choose: false,
		});
		// The join the last page carried (the win screen's "Join New Game") wins over the launch's.
		assert.deepEqual(
			launchJoin(
				{ name: 'Wyn', character: 'salmon', pass: 'p' },
				{ name: 'x', character: 'bear' },
				true,
			),
			{ join: { name: 'Wyn', character: 'salmon', pass: 'p' }, choose: false },
		);
		assert.equal(launchJoin({ pass: 'p' }, published, true).choose, true, 'a pass is no choice');
		assert.deepEqual(launchJoin({ pass: 'p' }, published, true).join.pass, 'p');
		// A game with no start menu (the online sample): the room picks, as before.
		assert.deepEqual(launchJoin({}, { name: 'Ann', character: null }, false), {
			join: { name: 'Ann', character: undefined },
			choose: false,
		});
	},
);

/**
 * A device opening the game as `online.ts` boots it: with a character carried it joins at once;
 * with none it shows the menu and joins only with what is picked there.
 */
const open = (sim, id, launch = { name: null, character: null }) => {
	const plan = launchJoin({}, launch, true);
	const join = (picked = {}) => sim.join(id, { ...plan.join, ...picked });
	return plan.choose ? { menu: true, pick: join } : { menu: false, player: join() };
};
/** Salmons as it ships (bots and all), its lobby over: one person in, the game running. */
const runningRoom = () => {
	const sim = createRoomSim(gameOf({ minPlayers: 1, maxWaitSeconds: 0, countdownSeconds: 0 }), {
		seed: 7,
	});
	assert.equal(open(sim, 'a', { name: 'Ann', character: 'salmon' }).menu, false);
	run(sim, 2);
	assert.equal(sim.rules.phase, 'running');
	return sim;
};
const peopleOf = (sim) => [...sim.players.values()].filter((p) => !p.bot);

for (const picked of ['fisherman', 'bear'])
	check(
		`opening the game into a running room: in no room while the menu is up, then a ${picked}`,
		() => {
			const sim = runningRoom();
			const hz = sim.game.online.tickHz;
			const size = sim.players.size;
			const device = open(sim, 'p');
			assert.equal(device.menu, true, 'no character carried: the menu');
			const meanwhile = run(sim, 5 * hz);
			assert.ok(!sim.players.has('p'), 'not in the room');
			assert.deepEqual(
				peopleOf(sim).map((p) => p.id),
				['a'],
			);
			assert.equal(sim.players.size, size, 'no bot gave its place');
			assert.ok(
				!meanwhile.some((e) => [e.id, e.by, e.target].includes('p')),
				'nothing happened to it',
			);

			const player = device.pick({ name: 'Pip', character: picked });
			const placed = { x: player.body.x, y: player.body.y };
			const told = run(sim, 1);
			assert.equal(sim.rules.phase, 'running', 'the game went on');
			assert.equal(player.character.id, picked);
			assert.equal(player.name, 'Pip');
			assert.equal(player.status, STATUS.free);
			assert.ok(!sim.rules.holds(player), 'in play');
			const character = sim.game.online.characters.find((c) => c.id === picked);
			assert.ok(
				character.spawns.some((at) => Math.hypot(at.x - placed.x, at.y - placed.y) < 1e-6),
				`at a ${picked}'s start, not a salmon's`,
			);
			assert.ok(told.some((e) => e.type === 'joined' && e.id === 'p'));
			assert.ok(!told.some((e) => e.type === 'lobby'), 'no lobby: the room is past it');
			assert.equal(sim.players.size, size, 'a bot gave its place to the person');
		},
	);

// --- A class picked in the lobby ---------------------------------------------------------------

/** Salmons as it ships (bots by shares), a room of ten: 6 salmon, 3 fishermen, 1 bear. */
const sharesRoom = (lobby, seed = 7) =>
	createRoomSim(onlineGameOf(docOf(lobby), { size: 10 }), { seed });
/** What an input's `respawn` says for each class: 1 + its place in the config's characters. */
const PICK = Object.fromEntries(gameOf(LOBBY).online.characters.map((c, i) => [c.id, i + 1]));
const botsOf = (sim) => [...sim.players.values()].filter((p) => p.bot);
const census = (players) =>
	Object.fromEntries(
		Object.keys(PICK).map((id) => [id, players.filter((p) => p.character.id === id).length]),
	);
/** One step in which each person in `inputs` sends that input (a move, a `respawn`), `seq` added. */
const stepWith = (sim, inputs) =>
	sim.step((id) =>
		inputs[id] ? [clampInput({ seq: sim.steps + 1, ...inputs[id] }, sim.game.field)] : [],
	);
/** Everything a room holds that a pick could have changed. */
const roomKey = (sim) =>
	JSON.stringify([
		sim.rules.phase,
		sim.rules.round,
		[...sim.players.values()].map((p) => [
			p.id,
			p.character.id,
			p.body.x,
			p.body.y,
			p.home,
			p.status,
			p.score,
		]),
	]);
const told = (events, type, id) => events.filter((e) => e.type === type && e.id === id).length;

check(
	'a lobby pick changes the class in place: a bot gives its place, a bot takes the one left',
	() => {
		const sim = sharesRoom(LOBBY);
		const a = sim.join('a', { name: 'Ann', character: 'salmon' });
		run(sim, 3);
		assert.equal(sim.rules.picking, true, 'the room lets its people pick');
		assert.deepEqual(census(botsOf(sim)), { salmon: 5, bear: 1, fisherman: 3 });
		const fishermen = botsOf(sim).filter((p) => p.character.id === 'fisherman');
		const events = stepWith(sim, { a: { respawn: PICK.fisherman } });
		assert.equal(sim.players.get('a'), a, 'the same player of the same room');
		assert.equal(a.character.id, 'fisherman');
		assert.equal(a.name, 'Ann');
		assert.equal(a.status, STATUS.free);
		assert.equal(sim.rules.phase, 'waiting', 'the lobby goes on');
		const fisherman = sim.game.online.characters.find((c) => c.id === 'fisherman');
		const body = sim.game.bodies[fisherman.body];
		assert.deepEqual(
			[a.body.shape, a.body.w, a.body.h, a.body.r],
			[body.shape, body.w, body.h, body.r],
			'a fisherman’s body',
		);
		assert.ok(
			fisherman.spawns.some((at) => Math.hypot(at.x - a.body.x, at.y - a.body.y) < 1e-6),
			'at a fisherman’s start',
		);
		assert.ok(fisherman.spawns.includes(a.home), 'and its next spawns are a fisherman’s');
		assert.deepEqual(
			events.filter((e) => e.type === 'respawned'),
			[{ type: 'respawned', id: 'a', character: 'fisherman' }],
		);
		assert.ok(!sim.players.has(fishermen.at(-1).id), 'the newest fisherman bot gave its place');
		assert.ok(events.some((e) => e.type === 'left' && e.id === fishermen.at(-1).id));
		assert.deepEqual(
			census(botsOf(sim)),
			{ salmon: 6, bear: 1, fisherman: 2 },
			'a salmon bot back',
		);
		assert.equal(sim.players.size, 10, 'the room is as full as it was');
		for (const type of ['joined', 'left', 'lobby', 'roundStart', 'respawnRefused'])
			assert.equal(told(events, type, 'a'), 0, `no ${type} of the person: it never left`);
		assert.ok(!events.some((e) => e.type === 'roundStart'));
	},
);

check('a pick of the class it plays, or of no class, does nothing: no move, no spawn burnt', () => {
	const pair = [sharesRoom(LOBBY), sharesRoom(LOBBY)];
	for (const sim of pair) {
		sim.join('a', { character: 'salmon' });
		run(sim, 3);
	}
	const [picked, plain] = pair;
	for (let i = 0; i < 12; i++) {
		// A device sends its pick on every input until it hears the answer.
		const respawn = i < 6 ? PICK.salmon : 9;
		const got = stepWith(picked, { a: { moveX: 100, moveY: -60, respawn } });
		const expected = stepWith(plain, { a: { moveX: 100, moveY: -60 } });
		assert.deepEqual(got, expected, `step ${i}: the same events`);
	}
	assert.equal(roomKey(picked), roomKey(plain));
	// The spawn turns too: the next person in gets the same place in both rooms.
	for (const sim of pair) sim.join('b', { character: 'salmon' });
	assert.equal(roomKey(picked), roomKey(plain));
});

check('a full class refuses and says so, press after press; the person plays on as it was', () => {
	const sim = sharesRoom(LOBBY);
	sim.join('a', { character: 'bear' });
	for (const id of ['c', 'd', 'e']) sim.join(id, { character: 'fisherman' });
	const b = sim.join('b', { character: 'salmon' });
	run(sim, 3);
	assert.deepEqual(census(botsOf(sim)), { salmon: 5, bear: 0, fisherman: 0 });
	const at = () => ({ x: b.body.x, y: b.body.y });
	/** `n` inputs asking for `character` (0: nothing), as a device holding a pick sends them. */
	const ask = (character, n) => {
		const events = [];
		for (let i = 0; i < n; i++)
			events.push(
				...stepWith(sim, {
					b: { moveX: 0, moveY: -127, ...(character ? { respawn: PICK[character] } : {}) },
				}),
			);
		return events;
	};
	const from = at();
	const first = ask('bear', 4);
	assert.equal(told(first, 'respawnRefused', 'b'), 1, 'told once for the inputs of one press');
	assert.equal(b.character.id, 'salmon');
	assert.equal(told(first, 'respawned', 'b'), 0);
	assert.ok(from.y - at().y > 1, 'a refused pick does not spend the input: it swam on');
	// The same class again after the device stopped asking (it heard the answer): told again.
	assert.equal(told(ask(undefined, 2), 'respawnRefused', 'b'), 0);
	assert.equal(told(ask('bear', 4), 'respawnRefused', 'b'), 1, 'the same class, pressed again');
	// Another full class with no input between: a new ask, told at once; and back again.
	assert.equal(told(ask('fisherman', 4), 'respawnRefused', 'b'), 1, 'another full class');
	assert.equal(told(ask('bear', 4), 'respawnRefused', 'b'), 1, 'and the first once more');
	assert.equal(b.character.id, 'salmon');
	assert.deepEqual(census(botsOf(sim)), { salmon: 5, bear: 0, fisherman: 0 }, 'no bot moved');
	// A place opens (a fisherman leaves; a bot takes it): a new ask for it is let in.
	sim.leave('e');
	const opened = ask('fisherman', 2);
	assert.equal(b.character.id, 'fisherman');
	assert.equal(told(opened, 'respawned', 'b'), 1, 'once: the second input asks for its own class');
	assert.equal(told(opened, 'respawnRefused', 'b'), 0);
});

check('one answer a press: a place that opens during a refused run is the next press’s', () => {
	const sim = sharesRoom(LOBBY);
	sim.join('a', { character: 'bear' });
	const b = sim.join('b', { character: 'salmon' });
	run(sim, 3);
	const ask = (respawn, n) => {
		const events = [];
		for (let i = 0; i < n; i++) events.push(...stepWith(sim, { b: { moveX: 60, respawn } }));
		return events;
	};
	assert.equal(told(ask(PICK.bear, 2), 'respawnRefused', 'b'), 1);
	// The bears' person leaves while b's device still sends the ask it was refused: those inputs
	// are that same ask. The device already shows "No place left", so it is not let in behind it.
	sim.leave('a');
	assert.equal(census(botsOf(sim)).bear, 1, 'a bot holds the bears’ place now');
	const late = ask(PICK.bear, 6);
	assert.equal(b.character.id, 'salmon', 'the refused ask stays refused');
	assert.equal(told(late, 'respawned', 'b') + told(late, 'respawnRefused', 'b'), 0, 'and silent');
	// The ask ends with an input that asks for nothing; the next press is tested afresh.
	ask(0, 1);
	const next = ask(PICK.bear, 2);
	assert.equal(b.character.id, 'bear');
	assert.equal(told(next, 'respawned', 'b'), 1);
	assert.equal(census(botsOf(sim)).bear, 0, 'the bot gave the place to the person');
});

check('a caught person’s refused Respawn is told again on its next press too', () => {
	const sim = sharesRoom(undefined);
	sim.join('a', { character: 'bear' });
	const b = sim.join('b', { character: 'salmon' });
	run(sim, 2);
	assert.equal(sim.rules.phase, 'running');
	Object.assign(b, { status: STATUS.out, until: Infinity });
	assert.ok(sim.rules.awaitsRespawn(b));
	const press = (respawn) => [
		...stepWith(sim, { b: { respawn } }),
		...stepWith(sim, { b: { respawn } }),
		...stepWith(sim, { b: {} }),
	];
	assert.equal(told(press(PICK.bear), 'respawnRefused', 'b'), 1);
	assert.equal(told(press(PICK.bear), 'respawnRefused', 'b'), 1, 'a second Respawn as a bear');
	assert.equal(b.status, STATUS.out, 'still out');
	// One answer a press here too: the bears' place opens while the refused Respawn is still
	// asked, and it stays refused (each input spent, as a caught player's is); the next press,
	// after an input that asks for nothing, is let in.
	assert.equal(told(stepWith(sim, { b: { respawn: PICK.bear } }), 'respawnRefused', 'b'), 1);
	sim.leave('a');
	const late = [];
	for (let i = 0; i < 6; i++) late.push(...stepWith(sim, { b: { respawn: PICK.bear } }));
	assert.equal(b.status, STATUS.out, 'the refused Respawn stays refused');
	assert.equal(told(late, 'respawned', 'b') + told(late, 'respawnRefused', 'b'), 0);
	stepWith(sim, { b: {} });
	assert.equal(told(press(PICK.bear), 'respawned', 'b'), 1, 'a new press, after it ended');
	assert.equal(b.character.id, 'bear');
	assert.equal(b.status, STATUS.free);
});

check('a pick during the countdown works, and round 1 starts with the person as that class', () => {
	const sim = sharesRoom({ ...LOBBY, minPlayers: 1 });
	const hz = sim.game.online.tickHz;
	const a = sim.join('a', { character: 'salmon' });
	assert.ok(types(run(sim, 1)).includes('countdown'));
	run(sim, hz);
	assert.equal(sim.rules.picking, true, 'the countdown is still the lobby');
	stepWith(sim, { a: { respawn: PICK.bear } });
	assert.equal(a.character.id, 'bear');
	const started = run(sim, LOBBY.countdownSeconds * hz);
	assert.ok(types(started).includes('roundStart'));
	assert.equal(sim.rules.phase, 'running');
	assert.equal(sim.rules.picking, false);
	assert.equal(a.character.id, 'bear');
	const bear = sim.game.online.characters.find((c) => c.id === 'bear');
	assert.deepEqual(census(botsOf(sim)), { salmon: 6, bear: 0, fisherman: 3 });
	assert.ok(bear.spawns.includes(a.home), 'it starts the round from a bear’s start');
});

check(
	'once round 1 runs a free person’s pick is ignored; a game with no lobby never reads one',
	() => {
		for (const lobby of [{ ...LOBBY, minPlayers: 1, countdownSeconds: 0 }, undefined]) {
			const pair = [sharesRoom(lobby), sharesRoom(lobby)];
			for (const sim of pair) {
				sim.join('a', { character: 'salmon' });
				run(sim, 2);
				assert.equal(sim.rules.phase, 'running');
				assert.equal(sim.rules.picking, false);
			}
			const [picked, plain] = pair;
			for (let i = 0; i < 30; i++) {
				const move = { moveX: 40, moveY: -110 };
				const respawn = [PICK.bear, PICK.fisherman, PICK.salmon][i % 3];
				const got = stepWith(picked, { a: { ...move, respawn } });
				assert.deepEqual(got, stepWith(plain, { a: move }), `step ${i}: the same events`);
			}
			assert.equal(picked.players.get('a').character.id, 'salmon');
			assert.equal(roomKey(picked), roomKey(plain), lobby ? 'after a lobby' : 'no lobby');
		}
	},
);

/**
 * A device in `sim` as `online.ts` asks, `lag` steps from the room each way: every step it sends
 * one input carrying what its ask says (`createRespawnAsk`), which the room applies `lag` steps
 * later, and it reads the room's state as it was `lag` steps ago, as `drawScreens` does: its own
 * player's `ack` and class, whether it is out (it plays nothing then, and a Respawn is answered
 * while a round runs), and whether the room lets its people pick.
 */
const deviceIn = (sim, id, lag) => {
	const ask = createRespawnAsk();
	const sent = [];
	const states = [];
	const events = [];
	let seq = 0;
	let carried = 0;
	const step = () => {
		seq += 1;
		const respawn = ask.input(seq);
		if (respawn) carried += 1;
		sent.push({ at: sim.steps + lag, input: clampInput({ seq, respawn }, sim.game.field) });
		const now = sim.steps;
		events.push(
			...sim.step((who) => (who === id && sent[0].at <= now ? [sent.shift().input] : [])),
		);
		const me = sim.players.get(id);
		states.push({
			at: sim.steps + lag,
			ack: me.ack,
			playing: PICK[me.character.id],
			out: me.status === STATUS.out,
			running: sim.rules.phase === 'running',
			picking: sim.rules.picking,
		});
		while (states.length && states[0].at <= sim.steps) {
			const state = states.shift();
			if (state.out) {
				if (state.running) ask.answer(state.ack, 0);
			} else if (state.picking) ask.answer(state.ack, state.playing);
			else ask.drop();
		}
	};
	return {
		ask,
		events,
		press: (character) => ask.press(PICK[character]),
		steps: (n) => {
			for (let i = 0; i < n; i++) step();
		},
		/** Step until the ask is answered (refused, or gone), at most a round trip and a few more. */
		answered: () => {
			for (let i = 0; i < 3 * lag + 8 && ask.held() && !ask.refused; i++) step();
		},
		/** Inputs that carried an ask so far. */
		get carried() {
			return carried;
		},
	};
};

check(
	'an ask on the device: a press after inputs asking the same first sends one asking nothing',
	() => {
		const ask = createRespawnAsk();
		assert.equal(ask.input(1), 0, 'nothing pressed');
		ask.press(PICK.bear);
		assert.deepEqual(
			[ask.input(2), ask.input(3)],
			[PICK.bear, PICK.bear],
			'a first press: at once',
		);
		assert.deepEqual(ask.held(), { respawn: PICK.bear, from: 2, refused: false });
		ask.answer(1, 0);
		assert.equal(ask.refused, false, 'no input that carried it is acknowledged yet');
		ask.answer(2, 0);
		assert.equal(ask.refused, true, 'acknowledged, and the room has it as something else');
		// Pressed again before any input asked for nothing: the room would hear one run.
		ask.press(PICK.bear);
		assert.deepEqual([ask.input(4), ask.input(5)], [0, PICK.bear], 'a gap, then the ask');
		assert.equal(ask.held().from, 5, 'acknowledged only from the input that carried it');
		ask.answer(4, 0);
		assert.equal(ask.refused, false, 'the gap’s acknowledgement answers nothing');
		// Another character needs no gap (the room hears another ask), nor does one after a rest.
		ask.press(PICK.fisherman);
		assert.equal(ask.input(6), PICK.fisherman);
		ask.answer(6, PICK.fisherman);
		assert.equal(ask.held(), null, 'the character asked for: done');
		assert.equal(ask.input(7), 0);
		ask.press(PICK.fisherman);
		assert.equal(ask.input(8), PICK.fisherman);
	},
);

for (const lag of [0, 1, 4, 9])
	check(
		`a device ${lag} steps away: each press is answered once, and nothing is sent after`,
		() => {
			const sim = sharesRoom(LOBBY);
			sim.join('a', { character: 'bear' });
			const p = sim.join('p', { character: 'salmon' });
			const device = deviceIn(sim, 'p', lag);
			// The most inputs one press may ride: there, back, and the step it is read in.
			const most = 2 * lag + 2;
			device.steps(5);
			assert.equal(device.carried, 0, 'nothing pressed, nothing asked');

			device.press('fisherman');
			device.steps(3 * lag + 6);
			assert.equal(p.character.id, 'fisherman');
			assert.equal(device.ask.held(), null, 'answered: the class asked for');
			assert.equal(device.ask.refused, false);
			assert.ok(device.carried >= 1 && device.carried <= most, `${device.carried} inputs`);
			assert.equal(
				told(device.events, 'respawned', 'p'),
				1,
				'one change, however many inputs asked',
			);

			// The bears' one place is a person's: refused, twice in a row, then a third time with no
			// step between the answer and the press. The device makes that press a run of its own
			// too (one input that asks for nothing first), so the room answers all three.
			for (const [n, gap] of [
				[1, 6],
				[2, 0],
				[3, 6],
			]) {
				const before = device.carried;
				device.press('bear');
				assert.equal(device.ask.refused, false, `press ${n}: the last answer is cleared`);
				device.answered();
				assert.equal(device.ask.refused, true, `press ${n}: answered, no place left`);
				assert.equal(p.character.id, 'fisherman');
				const rode = device.carried - before;
				assert.ok(rode >= 1 && rode <= most, `press ${n}: ${rode} inputs`);
				device.steps(gap);
				assert.equal(device.carried - before, rode, `press ${n}: nothing sent after the answer`);
			}
			device.steps(lag + 2);
			assert.equal(told(device.events, 'respawnRefused', 'p'), 3, 'the room answered each press');

			// The bears' person leaves the step the room refuses a fourth press: the place is open
			// while that ask is still arriving, and it is not let in behind the refusal the device
			// shows. The press after it is.
			device.press('bear');
			while (told(device.events, 'respawnRefused', 'p') < 4) device.steps(1);
			sim.leave('a');
			device.steps(3 * lag + 8);
			assert.equal(device.ask.refused, true, 'shown as refused');
			assert.equal(p.character.id, 'fisherman', 'and the room agrees, with the place open');
			assert.equal(told(device.events, 'respawned', 'p'), 1, 'only the first press’s');
			device.press('bear');
			device.answered();
			assert.equal(p.character.id, 'bear', 'the next press gets the place');
			assert.equal(device.ask.held(), null);
			device.press('fisherman');
			device.answered();
			assert.equal(p.character.id, 'fisherman');
			sim.join('a', { character: 'bear' });

			// A change of mind before the answer: the last press is the one answered.
			device.press('bear');
			device.steps(1);
			device.press('salmon');
			device.steps(3 * lag + 6);
			assert.equal(p.character.id, 'salmon');
			assert.equal(device.ask.held(), null);
			const settled = device.carried;
			device.steps(60);
			assert.equal(device.carried, settled, 'and the device asks nothing more');
		},
	);

for (const lag of [0, 1, 4, 9])
	check(
		`a caught person’s device ${lag} steps away: each Respawn is answered, none asked for ever`,
		() => {
			const sim = sharesRoom(undefined);
			sim.join('a', { character: 'bear' });
			const p = sim.join('p', { character: 'salmon' });
			const device = deviceIn(sim, 'p', lag);
			device.steps(lag + 3);
			assert.equal(sim.rules.phase, 'running');
			Object.assign(p, { status: STATUS.out, until: Infinity });
			device.steps(lag + 2);
			const most = 2 * lag + 2;
			// The bears' one place is a person's. Respawn as a bear, then again the moment the
			// refusal shows, with no step between (a double press), then once more.
			for (const [n, gap] of [
				[1, 0],
				[2, 0],
				[3, 5],
			]) {
				const before = device.carried;
				device.press('bear');
				assert.equal(device.ask.refused, false, `Respawn ${n}: the last answer is cleared`);
				device.answered();
				assert.equal(device.ask.refused, true, `Respawn ${n}: answered, no place left`);
				assert.equal(p.status, STATUS.out);
				const rode = device.carried - before;
				assert.ok(rode >= 1 && rode <= most, `Respawn ${n}: ${rode} inputs`);
				device.steps(gap);
				assert.equal(device.carried - before, rode, `Respawn ${n}: nothing sent after`);
			}
			device.steps(lag + 2);
			assert.equal(told(device.events, 'respawnRefused', 'p'), 3, 'the room answered each');
			// The place opens: nothing is asked, so nothing happens, until the next press.
			sim.leave('a');
			device.steps(2 * lag + 6);
			assert.equal(p.status, STATUS.out, 'no press, no Respawn');
			device.press('bear');
			device.answered();
			device.steps(lag + 1);
			assert.equal(p.status, STATUS.free, 'back');
			assert.equal(p.character.id, 'bear');
			assert.equal(device.ask.held(), null, 'and what it asked is forgotten');
			const settled = device.carried;
			device.steps(40);
			assert.equal(device.carried, settled, 'nothing more is asked');
			// Its own class always has its place: Respawn as it is.
			Object.assign(p, { status: STATUS.out, until: Infinity });
			device.steps(lag + 2);
			device.press('bear');
			device.steps(3 * lag + 8);
			assert.equal(p.status, STATUS.free);
			assert.equal(told(device.events, 'respawned', 'p'), 2);
		},
	);

check('a pick still waiting when round 1 starts is dropped, and never sent again', () => {
	const lag = 4;
	const sim = sharesRoom({ ...LOBBY, minPlayers: 1 });
	const p = sim.join('p', { character: 'salmon' });
	const device = deviceIn(sim, 'p', lag);
	device.steps(1);
	// Pressed so late that its first input reaches the room after the round started.
	device.steps(sim.rules.endsAt - sim.steps - 2);
	assert.equal(sim.rules.picking, true);
	device.press('bear');
	device.steps(1);
	assert.notEqual(device.ask.held(), null, 'on its way');
	device.steps(4 * lag);
	assert.equal(sim.rules.phase, 'running');
	assert.equal(p.character.id, 'salmon', 'the room did not read it');
	assert.equal(device.ask.held(), null, 'dropped');
	assert.equal(device.ask.refused, false, 'and not shown as refused');
	const sentBy = device.carried;
	device.steps(60);
	assert.equal(device.carried, sentBy);
	assert.equal(
		told(device.events, 'respawned', 'p') + told(device.events, 'respawnRefused', 'p'),
		0,
	);
	// A room that never says its people may pick (a server older than the pick): the device's note
	// has no classes, and a pick, were one made, is dropped before it rides an input.
	const older = createRespawnAsk();
	older.press(PICK.bear);
	older.drop();
	assert.equal(older.input(1), 0);
});

// --- Live: a real Colyseus room, a real SDK client ----------------------------------------------

const checkLive = async (name, fn) => {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, test, ms = 8000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (test()) return;
		await wait(10);
	}
	throw new Error(`timed out waiting for ${what}`);
};
const dir = mkdtempSync(join(tmpdir(), 'room-lobby-'));
const LIVE_LOBBY = { minPlayers: 2, maxWaitSeconds: 600, countdownSeconds: 2 };
writeFileSync(join(dir, 'lobby.json'), JSON.stringify(docOf(LIVE_LOBBY)));
writeFileSync(join(dir, 'plain.json'), JSON.stringify(docOf(undefined)));
const port = await new Promise((resolve) => {
	const probe = createServer();
	probe.listen(0, () => {
		const { port: free } = probe.address();
		probe.close(() => resolve(free));
	});
});
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 4,
	commit: 'roomlobby000',
	gracefullyShutdown: false,
});
await server.listen(port);
/** Join a room of `game` as the runtime does, and wait for its first state and own player. */
const joinRoom = async (game, character) => {
	const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, {
		game,
		character,
	});
	const events = [];
	room.onMessage('*', (_type, message) => events.push(...message));
	await until('its own player', () => room.state?.players?.get(room.sessionId) !== undefined);
	return { room, events, me: () => room.state.players.get(room.sessionId) };
};
/** Send inputs as the runtime does, one a step, each carrying what the device's pick says, until
 *  `done()`; returns how many carried a pick. */
const play = async (device, pick, done) => {
	const handle = device.room.input();
	const sim = matchMaker.getLocalRoomById(device.room.roomId).sim;
	let carried = 0;
	for (let i = 0; i < 300 && !done(); i++) {
		device.seq = (device.seq ?? 0) + 1;
		const respawn = pick.input(device.seq);
		if (respawn) carried += 1;
		Object.assign(handle.data, clampInput({ seq: device.seq, respawn }, sim.game.field));
		handle.send();
		await wait(1000 / sim.game.online.tickHz);
		const { state } = device.room;
		if (state.picking === true) pick.answer(device.me().ack, PICK[device.me().character]);
		else pick.drop();
	}
	return carried;
};
try {
	await checkLive(
		'live: a lobby room says its people may pick; a pick changes the class in its state, in place',
		async () => {
			const a = await joinRoom('lobby', 'salmon');
			const { sim } = matchMaker.getLocalRoomById(a.room.roomId);
			assert.equal(a.room.state.phase, 'waiting');
			assert.equal(a.room.state.picking, true, 'the state says so');
			assert.equal(a.me().character, 'salmon');
			const hz = sim.game.online.tickHz;
			const fullClock = LIVE_LOBBY.maxWaitSeconds + LIVE_LOBBY.countdownSeconds;
			await until('the clock in the state', () => a.room.state.endsAt > 0);
			const waitSeconds = serverValuesOf(a.room.state, a.room.sessionId, hz).secondsLeft;
			assert.ok(
				waitSeconds <= fullClock && waitSeconds >= fullClock - 2,
				`the state's clock runs to round 1 from the first person: ${waitSeconds} s`,
			);
			const pick = createRespawnAsk();
			pick.press(PICK.fisherman);
			const carried = await play(a, pick, () => pick.held() === null);
			assert.equal(a.me().character, 'fisherman', 'the state shows the class asked for');
			assert.equal(sim.players.get(a.room.sessionId).character.id, 'fisherman');
			assert.ok(carried >= 1 && carried < 60, `${carried} inputs carried it`);
			assert.ok(a.events.some((e) => e.type === 'respawned' && e.id === a.room.sessionId));
			assert.ok(!a.events.some((e) => e.type === 'left' && e.id === a.room.sessionId));

			// A class whose places are people's: the device reads the refusal off the state, and the
			// room says it too. The room of 100 has 15 bears' places: each is held here as a dropped
			// person's is (no device behind it, so the room asks it for no input).
			const bears = sim.game.online.bots.counts.bear;
			for (let i = 0; i < bears; i++) {
				sim.join(`held${i}`, { character: 'bear' });
				sim.drop(`held${i}`);
			}
			const asked = a.events.length;
			pick.press(PICK.bear);
			await play(a, pick, () => pick.refused);
			assert.equal(pick.refused, true);
			assert.equal(a.me().character, 'fisherman');
			await until('the room’s refusal', () =>
				a.events.slice(asked).some((e) => e.type === 'respawnRefused' && e.id === a.room.sessionId),
			);
			// The places open again at once: an input of that refused ask still on its way is not
			// let in behind the refusal.
			for (let i = 0; i < bears; i++) sim.leave(`held${i}`);
			await until('its inputs applied', () => sim.players.get(a.room.sessionId).ack === a.seq);
			assert.equal(sim.players.get(a.room.sessionId).character.id, 'fisherman');

			// A second person starts the countdown; round 1 ends the picking, for both.
			const b = await joinRoom('lobby', 'salmon');
			assert.equal(b.room.roomId, a.room.roomId);
			assert.equal(b.room.state.picking, true, 'through the countdown');
			await until(
				'the clock cut to the countdown',
				() =>
					serverValuesOf(b.room.state, b.room.sessionId, hz).secondsLeft <=
					LIVE_LOBBY.countdownSeconds,
			);
			await until('round 1', () => a.room.state.phase === 'running', 10000);
			await until('the pick withdrawn', () => a.room.state.picking === false);
			assert.equal(b.room.state.picking, false);
			assert.equal(a.me().character, 'fisherman', 'round 1 plays the class it picked');
			pick.press(PICK.salmon);
			await play(a, pick, () => pick.held() === null);
			assert.equal(a.me().character, 'fisherman', 'a pick after round 1 started changes nothing');
			await Promise.all([a.room.leave(), b.room.leave()]);
		},
	);

	await checkLive(
		'live: a room of a game with no lobby never says so, and reads no pick',
		async () => {
			const a = await joinRoom('plain', 'salmon');
			assert.equal(a.room.state.phase, 'running');
			assert.equal(a.room.state.picking, undefined, 'the field is not sent at all');
			const pick = createRespawnAsk();
			const handle = a.room.input();
			const { sim } = matchMaker.getLocalRoomById(a.room.roomId);
			for (let seq = 1; seq <= 10; seq++) {
				Object.assign(handle.data, clampInput({ seq, respawn: PICK.bear }, sim.game.field));
				handle.send();
				await wait(1000 / sim.game.online.tickHz);
			}
			await until('its inputs applied', () => a.me().ack === 10);
			assert.equal(a.me().character, 'salmon');
			assert.equal(a.room.state.picking, undefined);
			assert.equal(pick.held(), null);
			await a.room.leave();
		},
	);
} finally {
	await server.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-lobby — ${passed} checks passed`);
