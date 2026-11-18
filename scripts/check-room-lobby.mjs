// A ROOM'S LOBBY (docs/design/salmons-levels.md §4; owner, 2026-11-17): with `rules.lobby` a room
// waits before its first round until `minPlayers` people are in, or `maxWaitSeconds` after the first
// joined, whichever is first; a `countdown` of `countdownSeconds` then runs and round 1 starts.
// Bots never count. A lobby every person left starts over. Without a lobby the first join starts
// round 1 as before. Rounds after the first follow on as before (Salmons plays one game a room). Also: the device's Flow signals,
// Game Config's lobby block, and Salmons' export, layout and flow carrying the lobby screen.
//
//   pnpm check:room-lobby

import assert from 'node:assert/strict';

import { flowSignalsOf } from '../packages/engine-mechanics/src/onlineFlow.js';
import { SALMONS_LOBBY, salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	SALMONS_SCREENS,
	salmonsReferenceLayout,
} from '../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import {
	SALMONS_FLOW_SCREENS,
	SALMONS_SEED_DOC,
} from '../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

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

/** A room with no bots, so only the people this gate joins are in it. */
const roomOf = (lobby) => {
	const game = gameOf(lobby);
	return createRoomSim(
		{ ...game, online: { ...game.online, bots: { ...game.online.bots, fillTo: 0 } } },
		{ seed: 7 },
	);
};
const rest = () => [];
/** Step `n` times; every event of those steps, and those of joins and leaves before them. */
const run = (sim, n) => {
	const events = sim.events();
	for (let i = 0; i < n; i++) events.push(...sim.step(rest));
	return events;
};
const types = (events) => events.map((e) => e.type);

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
	assert.equal(sim.rules.endsAt, 0, 'no clock until the countdown');
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
		{ ...game, online: { ...game.online, rules, bots: { ...game.online.bots, fillTo: 0 } } },
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

console.log(`check:room-lobby — ${passed} checks passed`);
