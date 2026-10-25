/**
 * A rules-decided match-3 game, played headless end to end (`docs/design/game-families.md` §7.2,
 * P10.5):
 *   pnpm --filter launcher-api check:match3-rules
 *
 *  1. THE STARTER GAME PLAYS TO ITS GOAL. Game Maker's seed config (`match3.rules.json`) and starter
 *     flow (`MATCH3_DRIVEN_SEED_DOC`), on `engine-game`'s driver and session (the very code the
 *     runtime runs, with no presentation) and the real Flow interpreter: `boardReady` sets the
 *     round, every accepted swap spends one move and adds its points, the goal shows `roundWon`
 *     and locks the board, and the tap that completes it deals a new round with its variables reset.
 *  2. A ROUND IS LOST when the moves run out before the goal (`roundLost`).
 *  3. A REFUSED SWAP spends nothing and scores nothing; the board is unchanged.
 *  4. NO MOVES: the flow's `noMoves` chain shuffles, and the shuffled board has a move.
 *  5. SELECT / HINT: a tap selects, a neighbour swaps, the same cell again drops the selection;
 *     input is refused while the board plays or the flow closed it.
 *  6. A SEED REPLAYS: the same seed and moves give the same boards, steps and score.
 *  7. SCORE: the score table prices each group by its gem count; no table pays per gem; each step
 *     carries the padded `tumbleBoard` the runtime plays.
 *  8. THE MECHANIC: a slot config is `reels`, exactly as before; a rules match-3 is free play (no
 *     RGS session, no spin, no wallet, board input); an RGS-decided arcade config refuses to boot
 *     (a rules one is P10.8's `check:arcade-rules`).
 *  9. THE FREE-PLAY BRANCH SENDS NO RGS REQUEST (source-scanned): `<Authenticate freePlay>` returns
 *     before `requestAuthenticate` and the balance poll, and refuses under a delivery profile; the
 *     runtime layout passes the mechanic's `rgsSession`; `Game.svelte` gates the spin hotkey, the
 *     hold-to-spin and the coded HUD on `mechanic.spins` and mounts `<Match3Input />` only for
 *     board input; the Flow runtime reaches the board actions through the registry, never by
 *     importing the match-3 module.
 * 10. THE VOCABULARY: the starter flow validates clean as a rules game; every board action has a
 *     driver effect; the rules-only actions are board actions; `select` / `hint` are offered only to
 *     a match-3 project.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	awaitCompleteContainerIds,
	createContainerMountModel,
	createFlowState,
	createFlowV2Env,
	MATCH3_BOARD_ACTIONS,
	MATCH3_DRIVEN_SEED_DOC,
	MATCH3_RULES_ONLY_ACTIONS,
	MATCH3_SCREENS,
	MATCH3_VOCAB,
	runFlowEvent,
	stepFlowState,
	validateFlowDoc,
	type FlowDoc,
} from 'engine-flow-v2';
// The modules themselves: `engine-game`'s entry also exports its Svelte components.
import {
	createMatch3Driver,
	type Match3DriverState,
	type Match3Mark,
} from 'engine-game/src/game/match3Driver';
import {
	createMatch3Session,
	DEFAULT_POINTS_PER_GEM,
	scoreGroups,
	type Match3Step,
} from 'engine-game/src/game/match3Session';
import {
	MATCH3_RGS_MECHANIC,
	MATCH3_RULES_MECHANIC,
	mechanicFor,
	runsIntent,
	WAGER_INTENTS,
	REELS_MECHANIC,
} from 'engine-game/src/game/mechanic';
import { MATCH3_SYMBOL_STATES, symbolStatesForKind } from 'engine-layout';
import { findMoves, hasMoves, type Board, type Cell } from 'engine-mechanics';
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
	JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/match3.rules.json')),
) as GameConfigDoc;
const EMPTY_LIBRARY = { version: 2 as const, functions: [] };

/** One game: the driver over a seeded session, the starter flow on the real interpreter, and a
 *  presenter that records instead of drawing. */
const playGame = (
	config: GameConfigDoc,
	seed: number | string,
	doc: FlowDoc = MATCH3_DRIVEN_SEED_DOC,
) => {
	const flowState = createFlowState(doc);
	const mount = createContainerMountModel(
		doc.containers,
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const seated: Board[] = [];
	const steps: Match3Step[] = [];
	const marks: { cells: readonly Cell[]; state: Match3Mark }[] = [];
	const signals: string[] = [];
	const state: Match3DriverState = {
		busy: false,
		inputEnabled: false,
		selected: undefined,
		moves: 0,
	};
	const session = createMatch3Session(config, seed);
	let driver: ReturnType<typeof createMatch3Driver>;
	const env = createFlowV2Env({
		mount,
		effect: (name) =>
			(driver.effects as Record<string, (p: Record<string, unknown>) => void>)[name],
		broadcast: () => {},
		waitForTimeout: async () => {},
		timeScale: () => 1,
		engineRead: () => undefined,
		state: flowState,
	});
	const ctx = { vocab: MATCH3_VOCAB, library: EMPTY_LIBRARY, env };
	driver = createMatch3Driver({
		session,
		state,
		signal: async (name, payload) => {
			signals.push(name);
			await runFlowEvent(doc, ctx, name, payload);
			stepFlowState(flowState, 1000 / 60, () => {});
		},
		present: {
			seat: (board) => void seated.push(board),
			swap: async () => {},
			step: async (step) => void steps.push(step),
			mark: (cells, how) => void marks.push({ cells, state: how }),
		},
		onError: (error) => check('the driver never fails', false, String(error)),
	});
	const vars = () => ({
		score: flowState.read('score') as number,
		movesLeft: flowState.read('movesLeft') as number,
		target: flowState.read('target') as number,
	});
	/** Let the queued board work and the chains it raised run, until the board is idle or a round
	 *  screen holds the move on the player's tap (which the move then waits for, by design). */
	const settle = async () => {
		const holding = () => mount.isShown(MATCH3_SCREENS.won) || mount.isShown(MATCH3_SCREENS.lost);
		for (let quiet = 0, i = 0; i < 500 && quiet < 5; i++) {
			await new Promise((r) => setTimeout(r, 0));
			quiet = !state.busy || holding() ? quiet + 1 : 0;
		}
	};
	return { driver, session, state, mount, vars, seated, steps, marks, signals, settle };
};

const legalMove = (board: Board) => findMoves(board, { limit: 1 })[0];

// ── 1. the starter game plays to its goal ──────────────────────────────────────────────────────
{
	const game = playGame(SEED_CONFIG, 7);
	await game.driver.start();
	await game.settle();
	check(
		'1. boardReady sets the round from the config (score 0, 20 moves, target 1500)',
		JSON.stringify(game.vars()) === JSON.stringify({ score: 0, movesLeft: 20, target: 1500 }),
		JSON.stringify(game.vars()),
	);
	check('1. …and opens the board to input', game.state.inputEnabled && game.driver.takesInput());
	check('1. the dealt board is seated first', game.seated[0] === game.session.board);
	let accepted = 0;
	let scored = 0;
	let won = false;
	for (let turn = 0; turn < 20 && !won; turn++) {
		const move = legalMove(game.session.board);
		if (!move) break;
		const before = game.vars();
		const stepsBefore = game.steps.length;
		void game.driver.swapCells(move.from, move.to);
		await game.settle();
		accepted++;
		const points = game.steps.slice(stepsBefore).reduce((sum, s) => sum + s.points, 0);
		scored += points;
		const after = game.vars();
		won = game.mount.isShown(MATCH3_SCREENS.won);
		if (won) break;
		if (after.movesLeft !== before.movesLeft - 1 || after.score !== before.score + points) {
			check(
				`1. move ${turn + 1} spends one move and adds its points`,
				false,
				JSON.stringify({ before, after, points }),
			);
			break;
		}
	}
	check('1. the hint player reaches the goal within its moves', won, JSON.stringify(game.vars()));
	const atWin = game.vars();
	check(
		'1. at the win the score is the goal or more, and the moves spent are the accepted swaps',
		atWin.score >= atWin.target && atWin.score === scored && atWin.movesLeft === 20 - accepted,
		JSON.stringify({ atWin, scored, accepted }),
	);
	check('1. the win locks the board', !game.state.inputEnabled && !game.driver.takesInput());
	check(
		'1. the deal raised boardReady, then every move swap, match / cascadeStep per step, settled',
		/^boardReady( swap( match cascadeStep)+ settled( noMoves)?)+$/.test(game.signals.join(' ')) &&
			game.signals.filter((s) => s === 'swap').length === accepted &&
			game.signals.filter((s) => s === 'match').length === game.steps.length,
		game.signals.join(' '),
	);
	const boardAtWin = game.session.board;
	game.mount.complete(MATCH3_SCREENS.won);
	await game.settle();
	check('1. the tap hides the win screen', !game.mount.isShown(MATCH3_SCREENS.won));
	check(
		'1. …and deals a new round: a new board, the variables reset, input open',
		game.session.board !== boardAtWin &&
			JSON.stringify(game.vars()) === JSON.stringify({ score: 0, movesLeft: 20, target: 1500 }) &&
			game.state.inputEnabled,
		JSON.stringify(game.vars()),
	);
}

// ── 2. a round is lost when the moves run out ──────────────────────────────────────────────────
{
	const config = {
		...SEED_CONFIG,
		match3: {
			...SEED_CONFIG.match3,
			moves: 2,
			goals: [{ type: 'score' as const, target: 100000 }],
		},
	};
	const game = playGame(config, 11);
	await game.driver.start();
	await game.settle();
	for (let i = 0; i < 2; i++) {
		const move = legalMove(game.session.board);
		if (move) void game.driver.swapCells(move.from, move.to);
		await game.settle();
	}
	check(
		'2. two moves of two, goal not reached ⇒ roundLost, board locked',
		game.mount.isShown(MATCH3_SCREENS.lost) &&
			!game.mount.isShown(MATCH3_SCREENS.won) &&
			game.vars().movesLeft === 0 &&
			!game.state.inputEnabled,
		JSON.stringify(game.vars()),
	);
}

// ── 2b. no moves limit: a round only ends on its goal ──────────────────────────────────────────
{
	const { moves: _moves, ...rules } = SEED_CONFIG.match3!;
	const game = playGame(
		{ ...SEED_CONFIG, match3: { ...rules, goals: [{ type: 'score' as const, target: 100000 }] } },
		11,
	);
	await game.driver.start();
	await game.settle();
	for (let i = 0; i < 3; i++) {
		const move = legalMove(game.session.board);
		if (move) void game.driver.swapCells(move.from, move.to);
		await game.settle();
	}
	check(
		'2b. a config with no Moves never loses a round to its moves',
		!game.mount.isShown(MATCH3_SCREENS.lost) &&
			game.state.inputEnabled &&
			game.driver.takesInput() &&
			game.vars().score > 0,
		JSON.stringify(game.vars()),
	);
}

// ── 3. a refused swap ──────────────────────────────────────────────────────────────────────────
{
	const game = playGame(SEED_CONFIG, 3);
	await game.driver.start();
	await game.settle();
	const board = game.session.board;
	let refused: { from: Cell; to: Cell } | undefined;
	for (let reel = 0; reel + 1 < board.cols && !refused; reel++)
		for (let row = 0; row < board.rows && !refused; row++)
			if (!game.session.canSwap({ reel, row }, { reel: reel + 1, row }))
				refused = { from: { reel, row }, to: { reel: reel + 1, row } };
	const before = game.vars();
	const signals = game.signals.length;
	void game.driver.swapCells(refused!.from, refused!.to);
	await game.settle();
	check(
		'3. a refused swap spends no move, scores nothing and leaves the board',
		JSON.stringify(game.vars()) === JSON.stringify(before) && game.session.board === board,
	);
	check(
		'3. …and raises only swap (accepted: false)',
		JSON.stringify(game.signals.slice(signals)) === JSON.stringify(['swap']),
	);
	check(
		'3. a swap of two cells that do not touch does nothing',
		await (async () => {
			const n = game.signals.length;
			void game.driver.swapCells({ reel: 0, row: 0 }, { reel: 2, row: 0 });
			await game.settle();
			return game.signals.length === n && game.state.moves === 1;
		})(),
	);
}

// ── 4. no moves: the flow shuffles ─────────────────────────────────────────────────────────────
{
	const game = playGame(SEED_CONFIG, 5);
	await game.driver.start();
	await game.settle();
	const board = game.session.board;
	game.driver.effects.boardShuffle();
	await game.settle();
	check(
		'4. Shuffle board seats a different arrangement of the same gems, with a move and no match',
		game.session.board !== board &&
			game.seated.at(-1) === game.session.board &&
			hasMoves(game.session.board) &&
			JSON.stringify(
				board.cells
					.flat()
					.map((g) => g?.name)
					.sort(),
			) ===
				JSON.stringify(
					game.session.board.cells
						.flat()
						.map((g) => g?.name)
						.sort(),
				),
	);
	const seats = game.seated.length;
	const ctxGame = playGame(SEED_CONFIG, 5);
	await ctxGame.driver.start();
	await ctxGame.settle();
	// The starter flow's own `noMoves` chain calls the action.
	await runFlowEvent(
		MATCH3_DRIVEN_SEED_DOC,
		{
			vocab: MATCH3_VOCAB,
			library: EMPTY_LIBRARY,
			env: createFlowV2Env({
				mount: createContainerMountModel(MATCH3_DRIVEN_SEED_DOC.containers),
				effect: (name) =>
					(ctxGame.driver.effects as Record<string, (p: Record<string, unknown>) => void>)[name],
				broadcast: () => {},
				waitForTimeout: async () => {},
				timeScale: () => 1,
				engineRead: () => undefined,
			}),
		},
		'noMoves',
		{},
	);
	await ctxGame.settle();
	check(
		'4. the starter flow answers noMoves with a shuffle',
		ctxGame.seated.length === 2 && seats > 1,
	);

	// A real dead end: a 4 × 1 board whose strips deal only `H1 H1 H3 H1`. Its one move matches the
	// three left cells, and the refill leaves a board with no move — which no shuffle of four gems
	// can fix, so the shuffle the flow asks for deals afresh.
	const dead = {
		...SEED_CONFIG,
		numReels: 4,
		numRows: [1],
		paddingReels: { basegame: [['H1'], ['H1', 'H2'], ['H3'], ['H1']] },
	} as GameConfigDoc;
	const end = playGame(dead, 1);
	await end.driver.start();
	await end.settle();
	void end.driver.swapCells({ reel: 2, row: 0 }, { reel: 3, row: 0 });
	await end.settle();
	check(
		'4. a move that leaves no move raises noMoves after settled, and the flow re-seats a board with a move',
		end.signals.join(' ') === 'boardReady swap match cascadeStep settled noMoves' &&
			hasMoves(end.session.board) &&
			end.seated.at(-1) === end.session.board &&
			end.driver.takesInput(),
		end.signals.join(' '),
	);
}

// ── 5. select / hint / input ───────────────────────────────────────────────────────────────────
{
	const game = playGame(SEED_CONFIG, 9);
	await game.driver.start();
	await game.settle();
	const move = legalMove(game.session.board)!;
	game.driver.selectCell(move.from);
	check(
		'5. a tap selects its cell',
		JSON.stringify(game.state.selected) === JSON.stringify(move.from) &&
			game.marks.at(-1)?.state === 'select',
	);
	game.driver.selectCell(move.from);
	check(
		'5. the same cell again drops the selection',
		game.state.selected === undefined && game.marks.at(-1)?.state === 'static',
	);
	game.driver.showHint();
	check(
		'5. Hint lights the two cells of a legal swap',
		game.marks.at(-1)?.state === 'hint' &&
			game.session.canSwap(game.marks.at(-1)!.cells[0], game.marks.at(-1)!.cells[1]),
	);
	game.driver.selectCell(move.from);
	const swapping = game.driver.selectCell(move.to);
	check('5. a neighbour of the selected cell swaps the two', swapping instanceof Promise);
	check('5. input is refused while the move plays', game.state.busy && !game.driver.takesInput());
	await game.settle();
	check('5. …and back once it has', game.driver.takesInput() && game.state.moves === 1);
	game.driver.effects.boardSetInput({ enabled: false });
	check('5. Set board input off closes it', !game.driver.takesInput());
}

// ── 5b. a flow action with a bad payload does nothing ─────────────────────────────────────────
{
	const game = playGame(SEED_CONFIG, 9);
	await game.driver.start();
	await game.settle();
	const signals = game.signals.length;
	game.driver.effects.boardSelect({});
	game.driver.effects.boardSwap({ from: { reel: 0 } });
	game.driver.effects.boardSelect({ cell: 'a' });
	await game.settle();
	check(
		'5b. Select / Swap with no cell do nothing',
		game.signals.length === signals && !game.state.selected && game.state.moves === 0,
	);
	game.driver.reseat();
	await game.settle();
	check(
		'5b. reseat shows the same board again and raises nothing',
		game.seated.at(-1) === game.session.board && game.signals.length === signals,
	);
}

// ── 6. a seed replays ──────────────────────────────────────────────────────────────────────────
{
	const run = async () => {
		const game = playGame(SEED_CONFIG, 'replay-seed');
		await game.driver.start();
		await game.settle();
		for (let i = 0; i < 6; i++) {
			const move = legalMove(game.session.board);
			if (move) void game.driver.swapCells(move.from, move.to);
			await game.settle();
		}
		return JSON.stringify({
			board: game.session.board.cells,
			steps: game.steps.map((s) => s.event),
			vars: game.vars(),
		});
	};
	check('6. the same seed and moves replay identically', (await run()) === (await run()));
}

// ── 7. score ───────────────────────────────────────────────────────────────────────────────────
{
	const group = (n: number) => ({
		symbol: 'H1',
		cells: Array.from({ length: n }, (_, row) => ({ reel: 0, row })),
		shape: 'line3' as const,
	});
	const table = { '3': 50, '4': 120, '5': 250 };
	check(
		'7. the table prices each group by its gem count (the longest run at or under it)',
		scoreGroups([group(3)], table) === 50 &&
			scoreGroups([group(4), group(3)], table) === 170 &&
			scoreGroups([group(7)], table) === 250 &&
			scoreGroups([group(2)], table) === 0,
	);
	check(
		'7. no table pays per gem',
		scoreGroups([group(3)], undefined) === 3 * DEFAULT_POINTS_PER_GEM,
	);
	const game = playGame(SEED_CONFIG, 7);
	await game.driver.start();
	await game.settle();
	const move = legalMove(game.session.board)!;
	void game.driver.swapCells(move.from, move.to);
	await game.settle();
	const step = game.steps[0];
	check(
		"7. a step's tumbleBoard explodes its groups' cells one row down (the reel's top pad)",
		step.event.type === 'tumbleBoard' &&
			JSON.stringify(step.event.explodingSymbols.map((c) => `${c.reel}:${c.row}`).sort()) ===
				JSON.stringify(
					step.groups.flatMap((g) => g.cells.map((c) => `${c.reel}:${c.row + 1}`)).sort(),
				),
	);
}

// ── 8. the mechanic ────────────────────────────────────────────────────────────────────────────
{
	const slot = normalizeGameConfigDoc(
		JSON.parse(read('apps/launcher-api/src/lib/data/gameConfig/ways.json')),
	);
	check(
		'8. no config and a slot config play as reels',
		mechanicFor(null) === REELS_MECHANIC && mechanicFor(slot) === REELS_MECHANIC,
	);
	check(
		'8. reels spins, opens an RGS session, has a wallet, takes no board input',
		REELS_MECHANIC.spins &&
			REELS_MECHANIC.rgsSession &&
			REELS_MECHANIC.wallet &&
			!REELS_MECHANIC.boardInput,
	);
	check('8. a rules match-3 is free play', mechanicFor(SEED_CONFIG) === MATCH3_RULES_MECHANIC);
	check(
		'8. free play: no spin, no RGS session, no wallet, board input, playable',
		!MATCH3_RULES_MECHANIC.spins &&
			!MATCH3_RULES_MECHANIC.rgsSession &&
			!MATCH3_RULES_MECHANIC.wallet &&
			MATCH3_RULES_MECHANIC.boardInput &&
			MATCH3_RULES_MECHANIC.unplayable === undefined,
	);
	const { outcome: _outcome, ...rgsDoc } = SEED_CONFIG;
	check(
		'8. an RGS match-3 never takes the free-play branch, and plays its interactive round (P10.6)',
		mechanicFor(rgsDoc as GameConfigDoc) === MATCH3_RGS_MECHANIC &&
			MATCH3_RGS_MECHANIC.rgsSession &&
			MATCH3_RGS_MECHANIC.bets &&
			MATCH3_RGS_MECHANIC.interactiveRound &&
			MATCH3_RGS_MECHANIC.unplayable === undefined,
	);
	check(
		'8. an RGS-decided arcade config refuses to boot (a rules one plays since P10.8)',
		!!mechanicFor({ ...SEED_CONFIG, family: 'arcade', outcome: undefined } as GameConfigDoc)
			.unplayable &&
			!mechanicFor({ ...SEED_CONFIG, family: 'arcade', outcome: 'rules' } as GameConfigDoc)
				.unplayable,
	);
}

// ── 9. the free-play branch sends no RGS request ───────────────────────────────────────────────
{
	const auth = read('packages/components-shared/src/components/Authenticate.svelte');
	const freePlay = auth.indexOf('if (props.freePlay)');
	const firstRequest = auth.indexOf('await authenticate()');
	const branch = auth.slice(freePlay, auth.indexOf('if (stateUrlDerived.replay())'));
	check(
		'9. <Authenticate freePlay> returns before authenticate, replay and the balance poll',
		freePlay > 0 &&
			freePlay < firstRequest &&
			freePlay < auth.indexOf('startBalancePolling();\n\t});') &&
			/authenticated = true;\s*return;/.test(branch) &&
			!/request(Authenticate|Balance|Replay)/.test(branch),
	);
	check(
		'9. …and refuses under any delivery profile',
		/getDeliveryProfileSource\(\) !== 'default'/.test(branch) &&
			/refusal =/.test(branch) &&
			/\{:else if refusal\}\s*<p class="refusal"/.test(auth),
	);
	check(
		'9. the runtime layout passes the mechanic',
		/<Authenticate freePlay=\{!gameMechanic\(\)\.rgsSession\}>/.test(
			read('apps/lines/src/routes/+layout.svelte'),
		),
	);
	const game = read('apps/lines/src/components/Game.svelte');
	check(
		'9. Game.svelte: no spin hotkey, no hold-to-spin and no coded HUD without a bet',
		/\{#if mechanic\.bets && \(HUD_BUTTON_INSTANCES \|\| suppressCodedHud\)\}/.test(game) &&
			/\{#if mechanic\.bets &&\s*!mechanic\.interactiveRound &&\s*!codedHudMounted &&\s*stateUi\.config\.features\.spaceHold\}/.test(
				game,
			) &&
			/codedHudMounted = \$derived\(\s*mechanic\.bets &&/.test(game),
	);
	check(
		'9. a free-play board runs no wager intent; a slot runs every one',
		WAGER_INTENTS.every((intent) => !runsIntent(MATCH3_RULES_MECHANIC, intent)) &&
			WAGER_INTENTS.every((intent) => runsIntent(REELS_MECHANIC, intent)) &&
			['menu', 'settings', 'soundToggle', 'gameRules'].every((intent) =>
				runsIntent(MATCH3_RULES_MECHANIC, intent),
			),
	);
	check(
		'9. Game.svelte: every wager body (button, hotkey, flow intent) goes through runsIntent',
		/const wager =[\s\S]{0,80}runsIntent\(mechanic, intent\)/.test(game) &&
			/const doSpinBetOrStop = wager\('spin'/.test(game) &&
			/const doIncreaseBet = wager\('increase'/.test(game) &&
			/const doDecreaseBet = wager\('decrease'/.test(game) &&
			/const doAutoSpin = wager\('autoSpin'/.test(game) &&
			/const codedOpenBuyModal = wager\('buyBonus'/.test(game) &&
			/intent === 'buyBonus'\) doOpenBuyModal\(\)/.test(game) &&
			!/runSpinOrSlamStop\(/.test(
				game.replace(/const doSpinBetOrStop = wager\('spin', \(\) =>\s*runSpinOrSlamStop\(/, ''),
			),
	);
	const actor = read('apps/lines/src/components/EnableGameActor.svelte');
	check(
		'9. EnableGameActor starts no round (BET / AUTO_BET) for a mechanic with no bet, and no autoplay for an interactive round',
		/const \{ bets, interactiveRound \} = gameMechanic\(\);/.test(actor) &&
			(actor.match(/gameActor\.send\(\{ type: '(AUTO_)?BET' \}\)/g) ?? []).length === 2 &&
			/if \(bets && !stateBet\.betToResume\?\.active\) gameActor\.send\(\{ type: 'BET' \}\)/.test(
				actor,
			) &&
			/if \(bets && !interactiveRound && !stateBet\.betToResume\?\.active\)\s*gameActor\.send\(\{ type: 'AUTO_BET' \}\)/.test(
				actor,
			),
	);
	check(
		'9. Game.svelte mounts <Match3Input /> only for board input',
		/\{#if mechanic\.boardInput\}\s*<Match3Input \/>/.test(game),
	);
	const runtime = read('apps/lines/src/game/flowV2Runtime.svelte.ts');
	check(
		'9. the Flow runtime reaches the board actions through the registry, not the match-3 module',
		/flowEffect\(name\) \?\? boardEffect\(name\)/.test(runtime) && !/match3/.test(runtime),
	);
}

// ── 10. the vocabulary ─────────────────────────────────────────────────────────────────────────
{
	const issues = validateFlowDoc(
		MATCH3_DRIVEN_SEED_DOC,
		MATCH3_VOCAB,
		EMPTY_LIBRARY,
		undefined,
		undefined,
		undefined,
		undefined,
		'rules',
	);
	check(
		'10. the starter flow validates clean as a rules game',
		issues.length === 0,
		JSON.stringify(issues),
	);
	const game = playGame(SEED_CONFIG, 1);
	check(
		'10. every board action has a driver effect, and nothing else does',
		JSON.stringify(Object.keys(game.driver.effects).sort()) ===
			JSON.stringify([...MATCH3_BOARD_ACTIONS].sort()),
	);
	check(
		'10. the rules-only actions are board actions',
		MATCH3_RULES_ONLY_ACTIONS.every((a) => MATCH3_BOARD_ACTIONS.includes(a)),
	);
	check(
		'10. select / hint are offered to a match-3 project only',
		MATCH3_SYMBOL_STATES.every((s) => symbolStatesForKind('match3').includes(s)) &&
			['lines', 'ways', 'cluster', 'scatter', 'bookOf', 'holdAndWin'].every(
				(kind) => !MATCH3_SYMBOL_STATES.some((s) => symbolStatesForKind(kind).includes(s)),
			),
	);
}

if (fails) {
	console.error(`\ncheck:match3-rules — ${fails} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`\ncheck:match3-rules — all ${passes} passed`);
