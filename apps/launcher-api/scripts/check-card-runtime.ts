/**
 * A card game, played headless end to end (`docs/design/card-games.md` §12.1, C3):
 *   pnpm --filter launcher-api check:card-runtime
 *
 *  1. THE STARTER GAME PLAYS TO A RESULT. Game Maker's seed config (`card.rules.json`) on
 *     `engine-game`'s driver and session (the code the runtime runs, with no presentation), a
 *     scripted player against the device, from a seed: the match ends, `matchEnded` is raised once
 *     and last, and the driver's state reads the result.
 *  2. A SEED REPLAYS: the same seed and the same player gives the same signals and the same match.
 *  3. EVERY EVENT REACHES ITS SIGNAL: each §2.6 event the presentation reacts to raises its §5.3
 *     signal with the names the vocabulary declares.
 *  4. A DROP OFF A LEGAL TARGET SNAPS BACK: an action the rules do not list now is refused, the
 *     match is unchanged and nothing is raised; so is any action on the device's turn or with input
 *     closed (`cardsSetInput`).
 *  5. THE MECHANIC: a rules card config is the card table (no spins, bets, RGS session or wallet);
 *     an RGS card config is `unplayable`; a slot config is `reels`, as before.
 *  7. THE STARTER FLOW (`CARD_DRIVEN_SEED_DOC`) on the real interpreter drives it: the deck pick's
 *     tap starts a match, `matchReady` shows the table, the result shows the won or lost screen, and
 *     its tap deals the next match. Every action the vocabulary declares has a runtime effect.
 *  6. THE FREE-PLAY BRANCH SENDS NO RGS REQUEST: a whole match runs with `fetch` refused; the card
 *     runtime module imports no RGS request, and `Game.svelte` mounts `<CardTable />` only for a
 *     mechanic that is a card table.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	awaitCompleteContainerIds,
	CARD_DRIVEN_SEED_DOC,
	CARD_MATCH_ACTIONS,
	CARD_SCREENS,
	CARD_VOCAB,
	createContainerMountModel,
	createFlowState,
	createFlowV2Env,
	runFlowEvent,
	stepFlowState,
	validateFlowDoc,
} from 'engine-flow-v2';
// The modules themselves: `engine-game`'s entry also exports its Svelte components.
import {
	createCardDriver,
	initialCardDriverState,
	signalsOf,
	type CardDriverState,
} from 'engine-game/src/game/cardDriver';
import { PLAYER } from 'engine-game/src/game/cardSession';
import { CARD_RULES_MECHANIC, REELS_MECHANIC, mechanicFor } from 'engine-game/src/game/mechanic';
import type { Action, CardEvent, Match } from 'engine-mechanics';
import { normalizeGameConfigDoc, type GameConfigDoc } from 'game-config';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) {
		passes++;
		console.log(`  PASS  ${name}`);
	} else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const SEED_CONFIG = normalizeGameConfigDoc(
	JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/card.rules.json')),
) as GameConfigDoc;

/** The player a test plays: the first play or attack the rules list, else end the phase. */
const scripted = (legal: Action[]): Action =>
	legal.find((a) => a.type === 'play' || a.type === 'attack') ?? { type: 'endPhase' };

const playMatch = async (seed: string, onSignal?: (name: string) => void) => {
	const state: CardDriverState = initialCardDriverState();
	const signals: { name: string; payload: Record<string, unknown> }[] = [];
	let syncs = 0;
	const driver = createCardDriver({
		doc: SEED_CONFIG,
		seed,
		state,
		signal: async (name, payload) => {
			signals.push({ name, payload });
			onSignal?.(name);
		},
		present: { sync: () => void syncs++, wait: async () => {} },
		onError: (error) => check('the driver never fails', false, String(error)),
	});
	await driver.newMatch();
	for (let i = 0; i < 2000 && !state.over; i++) {
		const legal = driver.session!.legal();
		if (!legal.length) break;
		await driver.act(scripted(legal));
	}
	await driver.idle();
	return { driver, state, signals, syncs };
};

// ── 1. the starter game plays to a result ──────────────────────────────────────────────────────
const first = await playMatch('c3-gate');
{
	const { state, signals, driver } = first;
	const ended = signals.filter((s) => s.name === 'matchEnded');
	check('1. the match ends', state.over && driver.session!.match.result !== null);
	check(
		'1. matchReady first, matchEnded once and last',
		signals[0]?.name === 'matchReady' &&
			ended.length === 1 &&
			signals.at(-1)?.name === 'matchEnded',
		signals
			.map((s) => s.name)
			.slice(-3)
			.join(' '),
	);
	const result = driver.session!.match.result!;
	check(
		'1. the state reads the result',
		state.won === (result.winner === PLAYER) &&
			state.reason === result.reason &&
			ended[0]?.payload.won === state.won,
		JSON.stringify({ result, won: state.won }),
	);
	check('1. the table was seated', first.syncs > 0);
}

// ── 2. a seed replays ──────────────────────────────────────────────────────────────────────────
{
	const again = await playMatch('c3-gate');
	check(
		'2. the same seed and player give the same signals and match',
		JSON.stringify(again.signals) === JSON.stringify(first.signals) &&
			JSON.stringify(again.driver.session!.match) === JSON.stringify(first.driver.session!.match),
	);
	const other = await playMatch('c3-gate-other');
	check(
		'2. another seed gives another match',
		JSON.stringify(other.signals) !== JSON.stringify(first.signals),
	);
}

// ── 3. every event reaches its signal ──────────────────────────────────────────────────────────
{
	const EVENT_SIGNAL: Partial<Record<CardEvent['type'], string>> = {
		turnStarted: 'turnStarted',
		phaseChanged: 'phaseChanged',
		drawn: 'cardDrawn',
		played: 'cardPlayed',
		attacked: 'unitAttacked',
		damaged: 'damaged',
		healed: 'healed',
		summoned: 'unitSummoned',
		died: 'unitDied',
		matchEnded: 'matchEnded',
	};
	const match = first.driver.session!.match as Match;
	const unit = { unit: 1 } as const;
	const samples: CardEvent[] = [
		{ type: 'turnStarted', player: 0, turn: 3 },
		{ type: 'phaseChanged', phase: 'combat' },
		{ type: 'drawn', player: 1, uid: 1, burned: true },
		{ type: 'played', player: 0, uid: 1, slot: 0 },
		{ type: 'attacked', attacker: 1, target: { hero: 1 } },
		{ type: 'damaged', target: unit, amount: 2, by: 1, shieldBroken: false },
		{ type: 'healed', target: { hero: 0 }, amount: 3 },
		{ type: 'summoned', player: 1, uid: 1, slot: 0 },
		{ type: 'died', uid: 1 },
		{ type: 'matchEnded', winner: 'draw', reason: 'turnLimit' },
	];
	const raised = signalsOf(samples, match, match);
	check(
		'3. each event raises its signal, in order',
		JSON.stringify(raised.map((s) => s.name)) ===
			JSON.stringify(samples.map((e) => EVENT_SIGNAL[e.type])),
		raised.map((s) => s.name).join(' '),
	);
	check(
		'3. the payloads name sides as mine and targets as card ids or heroes',
		raised[0].payload.mine === true &&
			raised[2].payload.mine === false &&
			raised[2].payload.burned === true &&
			raised[4].payload.target === 'enemyHero' &&
			raised[6].payload.target === 'myHero' &&
			typeof raised[5].payload.target === 'string' &&
			raised[9].payload.won === false &&
			raised[9].payload.reason === 'turnLimit',
		JSON.stringify(raised.map((s) => s.payload)),
	);
	const silent: CardEvent[] = [
		{ type: 'fatigue', player: 0, amount: 1 },
		{ type: 'buffed', uid: 1, attack: 1, health: 1 },
		{ type: 'keywordGiven', uid: 1, keyword: 'guard' },
		{ type: 'destroyed', uid: 1 },
		{ type: 'buffsExpired', uids: [1] },
	];
	check(
		'3. the presentation-only events raise nothing',
		signalsOf(silent, match, match).length === 0,
	);
	const seen = new Set(first.signals.map((s) => s.name));
	check(
		'3. a played match raised the core signals',
		['matchReady', 'turnStarted', 'phaseChanged', 'cardDrawn', 'cardPlayed', 'damaged'].every((s) =>
			seen.has(s),
		),
		[...seen].join(' '),
	);
}

// ── 4. a drop off a legal target snaps back ────────────────────────────────────────────────────
{
	const state = initialCardDriverState();
	const signals: string[] = [];
	const driver = createCardDriver({
		doc: SEED_CONFIG,
		seed: 'c3-drop',
		state,
		signal: async (name) => void signals.push(name),
		present: { sync: () => {}, wait: async () => {} },
	});
	await driver.newMatch();
	await driver.idle();
	const session = driver.session!;
	check('4. the player has the turn after the opening', session.playersTurn(), String(state.mine));
	const before = JSON.stringify(session.match);
	const raised = signals.length;
	const hand = session.match.players[PLAYER].hand;
	const card = hand[0];
	const offTarget: Action = { type: 'play', uid: card.uid, target: { unit: 99999 } };
	const notInHand: Action = { type: 'play', uid: 99999 };
	const attackNow: Action = { type: 'attack', attacker: card.uid, target: { hero: 1 } };
	const refused = [
		await driver.act(offTarget),
		await driver.act(notInHand),
		await driver.act(attackNow),
	];
	check(
		'4. an action off a legal target is refused and changes nothing',
		refused.every((r) => r === false) &&
			JSON.stringify(session.match) === before &&
			signals.length === raised,
	);
	driver.setInput(false);
	const legal = session.legal().find((a) => a.type === 'play' || a.type === 'endPhase')!;
	check('4. input closed by the flow refuses a legal action', (await driver.act(legal)) === false);
	driver.setInput(true);
	check(
		'4. a legal action is taken once input opens',
		(await driver.act(legal)) === true && JSON.stringify(session.match) !== before,
	);
	check(
		"4. actionsFor lists only the card's own plays and attacks",
		driver
			.actionsFor(card.uid)
			.every(
				(a) =>
					(a.type === 'play' && a.uid === card.uid) ||
					(a.type === 'attack' && a.attacker === card.uid),
			),
	);
}

// ── 5. the mechanic ────────────────────────────────────────────────────────────────────────────
{
	const m = mechanicFor(SEED_CONFIG);
	check(
		'5. a rules card config is the card table, free play',
		m === CARD_RULES_MECHANIC &&
			m.cardTable &&
			!m.spins &&
			!m.bets &&
			!m.rgsSession &&
			!m.wallet &&
			!m.playField &&
			!m.unplayable,
	);
	const rgs = normalizeGameConfigDoc({ ...SEED_CONFIG, outcome: undefined }) as GameConfigDoc;
	check('5. an RGS card config is unplayable', !!mechanicFor(rgs).unplayable);
	const slot = normalizeGameConfigDoc(
		JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/lines.json')),
	);
	check('5. a slot config is reels, as before', mechanicFor(slot) === REELS_MECHANIC);
	check('5. the reels mechanic is not a card table', REELS_MECHANIC.cardTable === false);
}

// ── 6. the free-play branch sends no RGS request ───────────────────────────────────────────────
{
	const realFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = (() => {
		requests++;
		return Promise.reject(new Error('no request in a free-play card game'));
	}) as typeof fetch;
	try {
		const played = await playMatch('c3-no-fetch');
		check(
			'6. a whole match runs with no request',
			played.state.over && requests === 0,
			String(requests),
		);
	} finally {
		globalThis.fetch = realFetch;
	}
	const runtime = read('apps/lines/src/game/cards.ts');
	check(
		'6. the card runtime imports no RGS request or fetcher',
		!/from 'rgs-(requests|fetcher)'|fetch\(/.test(runtime),
	);
	const game = read('apps/lines/src/components/Game.svelte');
	check(
		'6. Game.svelte mounts <CardTable /> only under mechanic.cardTable, after the play field',
		/\{#if mechanic\.playField\}[\s\S]*?<ArcadeStage[\s\S]*?\{:else if mechanic\.cardTable\}[\s\S]*?<CardTable[\s\S]*?\{:else\}/.test(
			game,
		),
	);
}

// ── 7. the starter flow drives the match ──────────────────────────────────────────────────────
{
	const doc = CARD_DRIVEN_SEED_DOC;
	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(
		doc.containers,
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const state = initialCardDriverState();
	let driver: ReturnType<typeof createCardDriver>;
	const effects: Record<string, (p: Record<string, unknown>) => void> = {
		cardsEndPhase: () => void driver.endPhase(),
		cardsConcede: () => void driver.concede(),
		cardsNewMatch: (p) => void driver.newMatch(typeof p.deck === 'string' ? p.deck : ''),
		cardsSetInput: (p) => driver.setInput(p.enabled === true),
		cardsHint: () => driver.hint(),
	};
	check(
		'7. every card action the vocabulary declares has a runtime effect',
		CARD_MATCH_ACTIONS.length > 0 && CARD_MATCH_ACTIONS.every((a) => a in effects),
		CARD_MATCH_ACTIONS.join(' '),
	);
	const env = createFlowV2Env({
		mount,
		effect: (name) => effects[name],
		broadcast: () => {},
		waitForTimeout: async () => {},
		timeScale: () => 1,
		engineRead: () => undefined,
		state: flowState,
	});
	const ctx = { vocab: CARD_VOCAB, library: { version: 2 as const, functions: [] }, env };
	const signals: string[] = [];
	driver = createCardDriver({
		doc: SEED_CONFIG,
		seed: 'c3-flow',
		state,
		signal: async (name, payload) => {
			signals.push(name);
			await runFlowEvent(doc, ctx, name, payload);
			stepFlowState(flowState, 1000 / 60, () => {});
		},
		present: { sync: () => {}, wait: async () => {} },
		onError: (error) => check('7. the driver never fails', false, String(error)),
	});
	const settle = async () => {
		for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));
	};
	check(
		'7. the starter flow validates clean as a card game',
		validateFlowDoc(
			doc,
			CARD_VOCAB,
			{ version: 2, functions: [] },
			undefined,
			undefined,
			undefined,
			undefined,
			'rules',
		).filter((i) => i.severity === 'error').length === 0,
	);
	void runFlowEvent(doc, ctx, 'load', {});
	void runFlowEvent(doc, ctx, 'tapToStart', {});
	await settle();
	check('7. boot shows the deck pick', mount.isShown(CARD_SCREENS.deckPick));
	mount.complete(CARD_SCREENS.deckPick);
	await settle();
	check(
		"7. the deck pick's tap starts a match and matchReady shows the table",
		state.active && signals[0] === 'matchReady' && mount.isShown(CARD_SCREENS.table),
		signals.slice(0, 3).join(' '),
	);
	for (let i = 0; i < 2000 && !state.over; i++) {
		const legal = driver.session!.legal();
		if (!legal.length) {
			await settle();
			continue;
		}
		void driver.act(scripted(legal));
		await settle();
	}
	await settle();
	const result = state.won ? CARD_SCREENS.won : CARD_SCREENS.lost;
	check('7. the match ends on its result screen', state.over && mount.isShown(result), result);
	const firstMatch = driver.session;
	mount.complete(result);
	await settle();
	check(
		"7. the result's tap deals the next match",
		!mount.isShown(result) && driver.session !== firstMatch && !state.over,
	);
}

console.log(`\ncheck:card-runtime — ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
