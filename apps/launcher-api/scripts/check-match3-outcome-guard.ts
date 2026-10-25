/**
 * The outcome guards of an RGS-decided match-3 game (`docs/design/game-families.md` §2.2 #2–#3,
 * P10.6):
 *   pnpm --filter launcher-api check:match3-outcome-guard
 *
 *  1. `withOutcome(vocab, 'rgs')` drops exactly the rules-only board actions; `rules`, absent, and
 *     every vocabulary without them come back as the same object.
 *  2. One composition: `composeFlowV2Vocab` applies the outcome, and a slot kind composes the same
 *     vocabulary with or without it.
 *  3. `rules-only-in-rgs`: the rules starter judged as an RGS game is refused by the publish gate's
 *     own validation, node by node, and only for the rules-only calls; judged as a rules game it is
 *     not. A slot starter's verdict is unchanged by the outcome.
 *  4. The RGS starter (`MATCH3_RGS_DRIVEN_SEED_DOC`) validates clean as an RGS game against the RGS
 *     scene set, calls no rules-only action, holds no money, and plays its chains headless.
 *  5. Money: a variable named after, or fed to, a money value in an RGS match-3 game is still
 *     `variable-shadows-money`.
 */
import {
	createContainerMountModel,
	createFlowState,
	createFlowV2Env,
	freshDrivenSeedDoc,
	MATCH3_DRIVEN_SEED_DOC,
	MATCH3_RGS_DRIVEN_SEED_DOC,
	MATCH3_RGS_SCREENS,
	MATCH3_RULES_ONLY_ACTIONS,
	MATCH3_VOCAB,
	flowOwnsSignal,
	runFlowEvent,
	signalChainCallsAction,
	TEMPLATE_VOCABULARIES,
	templateVocabulary,
	validateFlowDoc,
	withOutcome,
	type FlowDoc,
	type FlowIssue,
} from 'engine-flow-v2';
import { engineOwnedOnly, getFullSceneSet } from 'engine-layout';
import { GAME_KINDS, SLOT_GAME_KINDS } from 'constants-shared/gameKinds';
import { resolveOutcome } from 'game-config';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `engine-game`'s entry also exports its Svelte components, so the modules are read directly.
import { createMatch3Driver } from 'engine-game/src/game/match3Driver';
import { createMatch3RgsSession } from 'engine-game/src/game/match3RgsSession';
import {
	CONTINUOUS_INTENTS,
	MATCH3_RGS_MECHANIC,
	REELS_MECHANIC,
	runsIntent,
	WAGER_INTENTS,
} from 'engine-game/src/game/mechanic';
import { canSwap, createBoard, createRng, findMoves, resolve, swap } from 'engine-mechanics';

import { composeFlowV2Vocab } from '../src/lib/flowV2Vocab';
import { BUILTIN_SOUND_OPTIONS } from '../src/lib/soundOptions';
import { invalidFlowMessage, validateFlowV2Against } from '../src/lib/server/flowV2Validation';

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

const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
const json = (v: unknown) => JSON.stringify(v);
const errorsOf = (issues: FlowIssue[]) => issues.filter((i) => i.severity === 'error');
const codes = (issues: FlowIssue[]) => issues.map((i) => `${i.code}: ${i.message}`).join(' | ');
const nodeOf = (issue: FlowIssue) =>
	issue.at.on === 'node' || issue.at.on === 'pin' ? issue.at.node : undefined;
const clone = (doc: FlowDoc): FlowDoc => JSON.parse(JSON.stringify(doc)) as FlowDoc;

const RGS_VOCAB = withOutcome(MATCH3_VOCAB, 'rgs');
const scenesFor = (kind: string, outcome?: 'rgs' | 'rules') => {
	const set = getFullSceneSet(kind, outcome ? { outcome } : {});
	return set ? engineOwnedOnly(set).scenes : [];
};

// ── 1. withOutcome ──────────────────────────────────────────────────────────────────────────────
{
	const dropped = MATCH3_VOCAB.actions
		.map((a) => a.name)
		.filter((name) => !RGS_VOCAB.actions.some((a) => a.name === name));
	check(
		'1. rgs drops exactly boardResolve, boardRefill and boardShuffle from the match-3 actions',
		json([...dropped].sort()) === json([...MATCH3_RULES_ONLY_ACTIONS].sort()) &&
			json(dropped.sort()) === json(['boardRefill', 'boardResolve', 'boardShuffle']),
		dropped.join(', '),
	);
	check(
		'1. …and keeps every other action as the same declaration, in order',
		RGS_VOCAB.actions.every(
			(a, i, kept) =>
				MATCH3_VOCAB.actions.includes(a) &&
				(i === 0 || MATCH3_VOCAB.actions.indexOf(kept[i - 1]) < MATCH3_VOCAB.actions.indexOf(a)),
		) && RGS_VOCAB.actions.length === MATCH3_VOCAB.actions.length - 3,
	);
	check(
		'1. …and touches nothing but the actions (events, cues, enums, structs, values are shared)',
		RGS_VOCAB.events === MATCH3_VOCAB.events &&
			RGS_VOCAB.cues === MATCH3_VOCAB.cues &&
			RGS_VOCAB.enums === MATCH3_VOCAB.enums &&
			RGS_VOCAB.structs === MATCH3_VOCAB.structs &&
			RGS_VOCAB.values === MATCH3_VOCAB.values &&
			RGS_VOCAB.templateId === MATCH3_VOCAB.templateId,
	);
	check('1. withOutcome does not mutate the match-3 vocabulary', MATCH3_VOCAB.actions.length > 3);
	check(
		'1. rules ⇒ the match-3 vocabulary itself',
		withOutcome(MATCH3_VOCAB, 'rules') === MATCH3_VOCAB,
	);
	check(
		'1. absent ⇒ the match-3 vocabulary itself',
		withOutcome(MATCH3_VOCAB, undefined) === MATCH3_VOCAB,
	);
	for (const id of Object.keys(TEMPLATE_VOCABULARIES)) {
		const vocab = templateVocabulary(id);
		check(
			`1. ${id}: rules and absent are identity${id === MATCH3_VOCAB.templateId ? '' : ', and so is rgs'}`,
			withOutcome(vocab, 'rules') === vocab &&
				withOutcome(vocab, undefined) === vocab &&
				(id === MATCH3_VOCAB.templateId || withOutcome(vocab, 'rgs') === vocab),
		);
	}
	for (const kind of GAME_KINDS) {
		const vocab = templateVocabulary(kind);
		if (vocab.templateId === MATCH3_VOCAB.templateId) continue;
		check(`1. kind ${kind}: rgs is identity`, withOutcome(vocab, 'rgs') === vocab);
	}
}

// ── 2. one composition ─────────────────────────────────────────────────────────────────────────
{
	const compose = (kind: string, outcome?: 'rgs' | 'rules') =>
		composeFlowV2Vocab(kind, { outcome, sounds: BUILTIN_SOUND_OPTIONS, sceneCues: [] });
	for (const kind of SLOT_GAME_KINDS) {
		check(
			`2. ${kind}: composeFlowV2Vocab with outcome rgs is the vocabulary it composed before`,
			json(compose(kind, 'rgs')) === json(compose(kind)),
		);
	}
	const names = (outcome?: 'rgs' | 'rules') =>
		compose('match3', outcome).actions.map((a) => a.name);
	check(
		'2. match3 composed as rgs offers no rules-only action',
		!names('rgs').some((n) => MATCH3_RULES_ONLY_ACTIONS.includes(n)),
	);
	check(
		'2. match3 composed as rules, or with no outcome, offers all three',
		MATCH3_RULES_ONLY_ACTIONS.every((n) => names('rules').includes(n) && names().includes(n)),
	);
	check(
		"2. what the callers pass: a match-3 config with no outcome resolves to rgs, with 'rules' to rules",
		resolveOutcome({ family: 'match3' }) === 'rgs' &&
			resolveOutcome({ family: 'match3', outcome: 'rules' }) === 'rules',
	);
}

// ── 3. rules-only-in-rgs ───────────────────────────────────────────────────────────────────────
{
	const rulesCalls = MATCH3_DRIVEN_SEED_DOC.graph.nodes
		.filter((n) => n.kind === 'action' && MATCH3_RULES_ONLY_ACTIONS.includes(n.ref))
		.map((n) => n.id)
		.sort();
	const asRgs = validateFlowDoc(
		MATCH3_DRIVEN_SEED_DOC,
		RGS_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		undefined,
		undefined,
		'rgs',
	);
	const flagged = asRgs.filter((i) => i.code === 'rules-only-in-rgs');
	check(
		'3. the rules starter as an RGS game: every rules-only call is rules-only-in-rgs',
		json(flagged.map(nodeOf).sort()) === json(rulesCalls) && rulesCalls.length === 3,
		codes(asRgs),
	);
	check(
		'3. …each an error saying the server deals, refills and resolves the board',
		flagged.every(
			(i) => i.severity === 'error' && i.message.includes('the server deals, refills and resolves'),
		),
	);
	check(
		'3. …reported instead of ref-unresolved (no generic issue on those nodes)',
		!asRgs.some((i) => i.code === 'ref-unresolved' && rulesCalls.includes(nodeOf(i) ?? '')),
		codes(asRgs),
	);
	check(
		'3. …and nothing else is wrong with it',
		asRgs.every((i) => i.code === 'rules-only-in-rgs'),
		codes(asRgs),
	);
	const asRules = validateFlowDoc(
		MATCH3_DRIVEN_SEED_DOC,
		withOutcome(MATCH3_VOCAB, 'rules'),
		EMPTY_LIBRARY,
		undefined,
		undefined,
		undefined,
		undefined,
		'rules',
	);
	check('3. the rules starter as a rules game: no issue', asRules.length === 0, codes(asRules));
	check(
		'3. a vocabulary that HAS the actions is never second-guessed (no outcome given)',
		!validateFlowDoc(MATCH3_DRIVEN_SEED_DOC, MATCH3_VOCAB, EMPTY_LIBRARY).some(
			(i) => i.code === 'rules-only-in-rgs',
		),
	);
	const rulesScenes = scenesFor('match3', 'rules');
	const gate = errorsOf(
		validateFlowV2Against(
			MATCH3_DRIVEN_SEED_DOC,
			rulesScenes,
			null,
			EMPTY_LIBRARY,
			[],
			undefined,
			[],
			'rgs',
		),
	);
	check(
		'3. the publish gate (validateFlowV2Against, rgs) refuses the rules starter on rules-only-in-rgs',
		gate.length > 0 && gate.every((i) => i.code === 'rules-only-in-rgs'),
		codes(gate),
	);
	check(
		'3. …and its refusal names the reason',
		invalidFlowMessage(gate).includes('in an RGS game the server deals'),
	);
	check(
		'3. the publish gate passes the same starter as a rules game',
		errorsOf(
			validateFlowV2Against(
				MATCH3_DRIVEN_SEED_DOC,
				rulesScenes,
				null,
				EMPTY_LIBRARY,
				[],
				undefined,
				[],
				'rules',
			),
		).length === 0,
	);
	for (const kind of SLOT_GAME_KINDS) {
		const doc = freshDrivenSeedDoc(kind);
		const scenes = scenesFor(kind);
		check(
			`3. ${kind}: the starter's verdict is the same with outcome rgs as with none`,
			json(validateFlowV2Against(doc, scenes, null, EMPTY_LIBRARY, [], undefined, [], 'rgs')) ===
				json(validateFlowV2Against(doc, scenes, null, EMPTY_LIBRARY)),
		);
	}
}

// ── 4. the RGS starter ─────────────────────────────────────────────────────────────────────────
{
	const doc = MATCH3_RGS_DRIVEN_SEED_DOC;
	check('4. the RGS starter is a match3 doc', doc.templateId === MATCH3_VOCAB.templateId);
	const direct = validateFlowDoc(
		doc,
		RGS_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		undefined,
		undefined,
		'rgs',
	);
	check(
		'4. it validates clean against withOutcome(MATCH3_VOCAB, rgs) as rgs',
		direct.length === 0,
		codes(direct),
	);
	const rgsScenes = scenesFor('match3', 'rgs');
	const sceneIds = rgsScenes.map((s) => s.id).sort();
	check(
		'4. its screens are exactly the RGS scene set',
		json(Object.values(MATCH3_RGS_SCREENS).sort()) === json(sceneIds) &&
			json(doc.containers.map((c) => c.sceneId).sort()) === json(sceneIds),
		sceneIds.join(', '),
	);
	const gated = validateFlowV2Against(
		doc,
		rgsScenes,
		null,
		EMPTY_LIBRARY,
		[],
		undefined,
		[],
		'rgs',
	);
	check(
		'4. the publish gate passes it against the RGS scene set',
		errorsOf(gated).length === 0,
		codes(gated),
	);
	check(
		'4. no rules-only-in-rgs, no variable-shadows-money',
		!gated.some((i) => i.code === 'rules-only-in-rgs' || i.code === 'variable-shadows-money'),
	);
	check(
		'4. it calls no rules-only action',
		!doc.graph.nodes.some((n) => n.kind === 'action' && MATCH3_RULES_ONLY_ACTIONS.includes(n.ref)),
	);
	check(
		'4. its one variable is the game-scoped movesLeft (no score, no target, no money)',
		json(doc.variables) === json([{ id: 'movesLeft', type: 'int', initial: 0, scope: 'game' }]),
	);
	check(
		'4. it owns load, boardReady, swap and roundEnd, and never noMoves',
		['load', 'boardReady', 'swap', 'roundEnd'].every((e) => flowOwnsSignal(doc, e)) &&
			!flowOwnsSignal(doc, 'noMoves'),
	);
	check(
		'4. boardReady and roundEnd call boardSetInput',
		signalChainCallsAction(doc, undefined, 'boardReady', 'boardSetInput') &&
			signalChainCallsAction(doc, undefined, 'roundEnd', 'boardSetInput'),
	);

	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(doc.containers);
	const input: boolean[] = [];
	const env = createFlowV2Env({
		mount,
		effect: (name) =>
			name === 'boardSetInput' ? (payload) => void input.push(payload.enabled === true) : undefined,
		broadcast: () => {},
		waitForTimeout: async () => {},
		timeScale: () => 1,
		engineRead: () => undefined,
		state: flowState,
	});
	const ctx = { vocab: RGS_VOCAB, library: EMPTY_LIBRARY, env };
	const raise = (name: string, payload: Record<string, unknown> = {}) =>
		runFlowEvent(doc, ctx, name, payload);
	const moves = () => flowState.read('movesLeft');
	const cell = (reel: number, row: number) => ({ reel, row });

	await raise('load');
	check('4. load shows the splash', mount.isShown(MATCH3_RGS_SCREENS.loading));
	await raise('complete:loading');
	check(
		'4. once loaded: background, board, moves readout, hudBar and hudCorners are up, the splash is gone',
		!mount.isShown(MATCH3_RGS_SCREENS.loading) &&
			[
				MATCH3_RGS_SCREENS.background,
				MATCH3_RGS_SCREENS.basegame,
				MATCH3_RGS_SCREENS.hud,
				MATCH3_RGS_SCREENS.hudBar,
				MATCH3_RGS_SCREENS.hudCorners,
			].every((s) => mount.isShown(s)),
	);
	await raise('boardReady', { moves: 3, target: 0 });
	check(
		"4. boardReady sets movesLeft to the server's count and opens the board",
		moves() === 3 && json(input) === json([true]),
		json({ moves: moves(), input }),
	);
	await raise('swap', { from: cell(0, 0), to: cell(1, 0), accepted: false });
	check('4. a refused swap spends nothing', moves() === 3);
	for (let i = 0; i < 5; i++) {
		await raise('swap', { from: cell(0, 0), to: cell(1, 0), accepted: true });
	}
	check('4. every accepted swap spends one move, never below 0', moves() === 0, String(moves()));
	await raise('match', { groups: [], points: 0, step: 1 });
	await raise('settled', { steps: 1, points: 0 });
	check('4. match / settled change nothing', moves() === 0 && input.length === 1);
	await raise('roundEnd', { totalWin: 2.5, reason: 'movesUsed' });
	check('4. roundEnd locks the board', json(input) === json([true, false]), json(input));
	await raise('boardReady', { moves: 7, target: 0 });
	check(
		'4. the next round resets the moves and reopens the board',
		moves() === 7 && input.at(-1) === true,
	);
}

// ── 5. money ───────────────────────────────────────────────────────────────────────────────────
{
	const named = clone(MATCH3_RGS_DRIVEN_SEED_DOC);
	named.variables = [
		...(named.variables ?? []),
		{ id: 'win', type: 'float', initial: 0, scope: 'game' },
	];
	const judge = (doc: FlowDoc, outcome: 'rgs' | 'rules') =>
		validateFlowDoc(
			doc,
			withOutcome(MATCH3_VOCAB, outcome),
			EMPTY_LIBRARY,
			undefined,
			undefined,
			undefined,
			undefined,
			outcome,
		);
	check(
		'5. an RGS match-3 doc with a variable named win gets variable-shadows-money',
		judge(named, 'rgs').some((i) => i.code === 'variable-shadows-money' && i.severity === 'error'),
	);
	check(
		'5. …which the publish gate refuses',
		errorsOf(
			validateFlowV2Against(
				named,
				scenesFor('match3', 'rgs'),
				null,
				EMPTY_LIBRARY,
				[],
				undefined,
				[],
				'rgs',
			),
		).some((i) => i.code === 'variable-shadows-money'),
	);
	check(
		'5. the same doc as a rules game is not about money',
		!judge(named, 'rules').some((i) => i.code === 'variable-shadows-money'),
	);
	const fed = clone(MATCH3_RGS_DRIVEN_SEED_DOC);
	fed.graph.nodes.push({
		id: 'm3r_money',
		kind: 'action',
		ref: 'showMessage',
		pos: { x: 0, y: 0 },
		inputs: { amount: { kind: 'accessor', path: { on: 'var', id: 'movesLeft' } } },
	});
	check(
		'5. an RGS match-3 doc feeding a variable to a money amount gets variable-shadows-money',
		judge(fed, 'rgs').some((i) => i.code === 'variable-shadows-money' && nodeOf(i) === 'm3r_money'),
		codes(judge(fed, 'rgs')),
	);
}

// ── 6. the runtime: an RGS board has no local RNG, and money comes only from the server ─────────
{
	const ROOT = join(import.meta.dirname, '../../..');
	const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

	check(
		'6. an RGS match-3 is playable: it bets, its round is interactive, its board never spins',
		MATCH3_RGS_MECHANIC.unplayable === undefined &&
			MATCH3_RGS_MECHANIC.bets &&
			MATCH3_RGS_MECHANIC.interactiveRound &&
			!MATCH3_RGS_MECHANIC.spins,
	);
	check(
		'6. its round takes a bet and the bet steps, never autoplay or a bonus buy; a slot takes all',
		['spin', 'increase', 'decrease'].every((i) => runsIntent(MATCH3_RGS_MECHANIC, i)) &&
			CONTINUOUS_INTENTS.every((i) => !runsIntent(MATCH3_RGS_MECHANIC, i)) &&
			WAGER_INTENTS.every((i) => runsIntent(REELS_MECHANIC, i)),
	);

	// A stand-in server: deal a board, and answer a move as the facade translates the wire.
	const strips = Array.from({ length: 6 }, (_, reel) =>
		Array.from({ length: 30 }, (_, i) => ['H1', 'H2', 'H3', 'L1', 'L2'][(i * 7 + reel * 3) % 5]),
	);
	const dealt = createBoard({ cols: 6, rows: 6, pool: strips, rng: createRng('guard'), minRun: 3 });
	const names = dealt.cells.map((reel) => reel.map((gem) => ({ name: gem!.name })));
	const legal = findMoves(dealt, { limit: 1 })[0];
	// The one chain the server deals for that swap: a pool resolve draws from the board's shared rng,
	// so it is resolved once and every answer and expectation reads it.
	const chain = resolve(swap(dealt, legal.from, legal.to), { source: 'pool' });
	const serverBook = (from: typeof legal.from, to: typeof legal.to, lie = false) => {
		return [
			{ index: 0, type: 'swap', from, to, accepted: true },
			...chain.steps.flatMap((step, i) => [
				{
					index: 1 + i * 2,
					type: 'tumbleBoard',
					explodingSymbols: step.event.explodingSymbols.map((c, k) => ({
						reel: c.reel,
						row: c.row + 1 + (lie && k === 0 ? 1 : 0),
					})),
					newSymbols: step.event.newSymbols,
				},
				{ index: 2 + i * 2, type: 'updateTumbleWin', amount: 10 * (i + 1) },
			]),
			{ index: 90, type: 'movesLeft', count: 4, board: chain.board.cells },
		];
	};
	let requests = 0;
	const mismatches: string[] = [];
	const session = createMatch3RgsSession({
		board: names,
		movesLeft: 5,
		minRun: 3,
		requestMove: async (from, to) => {
			requests++;
			return serverBook(from, to);
		},
		onMismatch: (m) => mismatches.push(m),
	});
	check('6. the RGS board is built with no RNG', session.board.rng === null);
	const throws = (run: () => unknown) => {
		try {
			run();
			return false;
		} catch {
			return true;
		}
	};
	check(
		'6. a local deal, shuffle or resolve throws on it',
		throws(session.deal) && throws(session.shuffle) && throws(session.resolveNow),
	);
	let illegal: { from: typeof legal.from; to: typeof legal.to } | undefined;
	for (let reel = 0; reel < 5 && !illegal; reel++)
		for (let row = 0; row < 6 && !illegal; row++)
			if (!canSwap(dealt, { reel, row }, { reel: reel + 1, row }))
				illegal = { from: { reel, row }, to: { reel: reel + 1, row } };
	const refused = await session.trySwap(illegal!.from, illegal!.to);
	check(
		'6. a swap the board cannot match is refused with no request (the pre-check is UX only)',
		!refused.accepted && requests === 0,
	);
	const moved = await session.trySwap(legal.from, legal.to);
	const expected = chain;
	check(
		'6. a legal swap is one request, and its cascade is the server’s',
		requests === 1 &&
			moved.accepted &&
			moved.steps.length === expected.steps.length &&
			moved.points === 0 &&
			moved.steps.every((step) => step.points === 0 && step.tail?.[0]?.type === 'updateTumbleWin'),
	);
	check(
		'6. the mirror takes the server’s settled board and moves',
		json(session.board.cells.map((r) => r.map((g) => g?.name))) ===
			json(expected.board.cells.map((r) => r.map((g) => g?.name))) &&
			session.movesLeft === 4 &&
			moved.tail?.some((e) => (e as { type: string }).type === 'movesLeft') === true,
	);
	check(
		'6. a move that replays exactly reports no mismatch',
		mismatches.length === 0,
		json(mismatches),
	);

	const liar = createMatch3RgsSession({
		board: names,
		movesLeft: 5,
		minRun: 3,
		requestMove: async (from, to) => serverBook(from, to, true),
		onMismatch: (m) => mismatches.push(m),
	});
	const lied = await liar.trySwap(legal.from, legal.to);
	check(
		'6. exploded cells the board’s rules do not match are logged as a wire bug, never overridden',
		mismatches.length > 0 &&
			lied.accepted &&
			json(liar.board.cells.map((r) => r.map((g) => g?.name))) ===
				json(expected.board.cells.map((r) => r.map((g) => g?.name))),
	);

	// The driver over an RGS board: the same signals, the server's tail, and no local refill.
	const signals: string[] = [];
	const errors: unknown[] = [];
	const tails: string[] = [];
	const driven = createMatch3RgsSession({
		board: names,
		movesLeft: 5,
		minRun: 3,
		requestMove: async (from, to) => [
			...serverBook(from, to),
			{ index: 91, type: 'match3RoundEnd', totalWin: 50, reason: 'movesUsed' },
		],
	});
	const driver = createMatch3Driver({
		session: driven,
		state: { busy: false, inputEnabled: true, selected: undefined, moves: 0 },
		signal: async (name) => void signals.push(name),
		present: {
			seat: () => {},
			swap: async () => {},
			step: async () => {},
			mark: () => {},
			tail: async (events) => void tails.push(...events.map((e) => (e as { type: string }).type)),
		},
		onError: (error) => errors.push(error),
	});
	await driver.start();
	await driver.swapCells(legal.from, legal.to);
	check(
		'6. the driver raises boardReady, swap, match / cascadeStep per step, settled — never noMoves',
		signals[0] === 'boardReady' &&
			signals[1] === 'swap' &&
			signals.filter((s) => s === 'match').length === expected.steps.length &&
			signals.at(-1) === 'settled' &&
			!signals.includes('noMoves'),
		json(signals),
	);
	check(
		'6. the server’s tail (moves left, the round’s end) is played after the move settles',
		json(tails) === json(['movesLeft', 'match3RoundEnd']),
		json(tails),
	);
	driver.effects.boardRefill({});
	driver.effects.boardShuffle({});
	await driver.idle();
	check(
		'6. a flow that still calls Refill or Shuffle board on an RGS board gets an error, not a deal',
		errors.length === 2,
		`${errors.length} errors`,
	);

	// The wiring, read off the source: the runtime's RGS board is the mirror, the round machine waits
	// on it, and collects it whatever it won.
	const runtime = read('apps/lines/src/game/match3.svelte.ts');
	const presentBoard = runtime.slice(runtime.indexOf('export const presentMatch3Board'));
	check(
		'6. the runtime mirrors the server’s board (createMatch3RgsSession), never deals one',
		/createMatch3RgsSession\(/.test(presentBoard) &&
			!/createMatch3Session\(|createRng|createBoard/.test(presentBoard),
	);
	const actor = read('apps/lines/src/game/actor.ts');
	check(
		'6. the round machine waits on the open round between the bet and the collect',
		/checkIsInteractiveRound: \(bet\) =>\s*gameMechanic\(\)\.interactiveRound &&\s*bet\.state\.some\(\(bookEvent\) => bookEvent\.type === 'boardInit'\)/.test(
			actor,
		) && /onInteractiveRound: \(\) => awaitMatch3Round\(\)/.test(actor),
	);
	const machines = read('packages/utils-xstate/src/createPrimaryMachines.ts');
	check(
		'6. an interactive round is collected whatever it won, and a slot never is one',
		/if \(checkIsInteractiveRound\(bet\)\) return 'interactive';/.test(machines) &&
			/interactive: \{[\s\S]{0,120}endGame: async \(\) => \{\s*const data = await handleRequestEndRound\(\);/.test(
				machines,
			) &&
			/checkIsInteractiveRound = \(\) => false/.test(machines),
	);
}

console.log(
	fails
		? `check:match3-outcome-guard — ${fails} failed, ${passes} passed`
		: `check:match3-outcome-guard — all ${passes} passed`,
);
if (fails) process.exit(1);
