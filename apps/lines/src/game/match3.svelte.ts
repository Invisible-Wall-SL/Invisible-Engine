import {
	createMatch3Driver,
	createMatch3Session,
	paddedBoard,
	type Match3Driver,
	type Match3Presenter,
	type Match3Session,
} from 'engine-game';
import type { Cell } from 'engine-mechanics';
import { normalizeGameConfigDoc } from 'game-config';
import { stateModal } from 'state-shared';

import { bakedGameConfig } from '../editor-scenes';
import { eventEmitter } from './eventEmitter';
import { flyTo } from './flights.svelte';
import { registerBoardEffects } from './flowBoardEffects';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { stateGame } from './stateGame.svelte';
import type { RawSymbol } from './types';
import { playBookEvents } from './utils';

/**
 * THE MATCH-3 RUNTIME (`docs/design/game-families.md` §4.1, §6.4) — the shared runtime's family
 * branch for a rules-decided match-3 game.
 *
 * The slot board stays mounted and never spins. `engine-game`'s driver decides every move
 * (`createMatch3Driver` over a seeded `createMatch3Session`); this module shows it with what the
 * runtime already has: the swap on the flight layer, each cascade step through the coded
 * `tumbleBoard` handler (`playBookEvents`), a dealt or shuffled board seated with `boardSettle`,
 * `select` / `hint` as symbol states. The board's Flow signals go to the v2 flow, which keeps the
 * score and spends the moves (the starter flow).
 *
 * A slot game never starts it: `startMatch3` is called only by `<Match3Input />`, which
 * `Game.svelte` mounts only for a mechanic that takes board input.
 *
 * Cells are the board's own (`{ reel, row }`, row 0 the top VISIBLE row); a reel's symbol at that
 * cell is `symbols[row + 1]`, behind its top pad.
 */

/** The flight kind a swapped gem flies as; authorable in Invisible Symbols → Flights. */
export const SWAP_FLIGHT = 'swap';

/** The URL parameter that pins the board's seed (the playtester and the screen scripts use it). */
export const MATCH3_SEED_PARAM = 'm3seed';

export const stateMatch3 = $state({
	/** A session is running. */
	active: false,
	busy: false,
	/** The flow's `boardSetInput`. Closed until the flow's first `boardReady` chain opens it, when a
	 *  flow drives the game; open from the start without one. */
	inputEnabled: true,
	selected: undefined as Cell | undefined,
	moves: 0,
	/** The seed the board was dealt from, and the shortest run that matches, for the probe. */
	seed: '',
	minRun: 0,
});

let driver: Match3Driver | undefined;

const seedOf = (): string => {
	const pinned =
		typeof window === 'undefined'
			? null
			: new URLSearchParams(window.location.search).get(MATCH3_SEED_PARAM);
	// Under `?ie_determinism=` `Math.random` is seeded, so an unpinned board still replays.
	return pinned || String(Math.floor(Math.random() * 2 ** 32));
};

const reelSymbolAt = (cell: Cell) => stateGame.board[cell.reel]?.reelState.symbols[cell.row + 1];

const present: Match3Presenter = {
	seat: (board) =>
		eventEmitter.broadcast({ type: 'boardSettle', board: paddedBoard(board) as RawSymbol[][] }),
	swap: async (from, to, back) => {
		const gemA = reelSymbolAt(from);
		const gemB = reelSymbolAt(to);
		if (!gemA || !gemB) return;
		const fly = (a: Cell, b: Cell, symbol: RawSymbol, onStart?: () => void) =>
			flyTo(a, b, SWAP_FLIGHT, {
				symbol,
				symbolState: 'static',
				trailless: true,
				...(onStart ? { onStart } : {}),
			});
		// Both gems leave their cells as the flight lifts them, and the board under them shows the
		// gaps until the swapped board is seated.
		const lift = () => {
			gemA.removed = true;
			gemB.removed = true;
		};
		await Promise.all([fly(from, to, gemA.rawSymbol, lift), fly(to, from, gemB.rawSymbol)]);
		if (!back) return;
		await Promise.all([fly(to, from, gemA.rawSymbol), fly(from, to, gemB.rawSymbol)]);
		gemA.removed = false;
		gemB.removed = false;
	},
	step: (step) => playBookEvents([{ index: step.step, ...step.event }]),
	mark: (cells, state) => {
		for (const cell of cells) {
			const reelSymbol = reelSymbolAt(cell);
			if (reelSymbol && !reelSymbol.removed) reelSymbol.symbolState = state;
		}
	},
};

/** Raise one of the board's Flow signals and wait for its chain. Without a flow, nothing listens. */
const signal = async (name: string, payload: Record<string, unknown>): Promise<void> => {
	await getFlowV2()?.dispatch(name, payload);
};

export const swapCells = (from: Cell, to: Cell) => driver?.swapCells(from, to);
export const selectCell = (cell: Cell) => driver?.selectCell(cell);

/** Input reaches the board: a session is running, nothing is playing and the flow allows it. */
export const match3TakesInput = () => stateMatch3.active && !!driver?.takesInput();

/** Board work that failed is shown to the player: a board that cannot be dealt is not playable. */
const fail = (error: unknown) => {
	console.error('[match3] board work failed:', error);
	stateModal.modal = { name: 'error', error };
};

/**
 * Start the session, once per page: deal the first board from the config's strips and seed, seat
 * it, and raise `boardReady`. Without a flow driving the game, input is open from the start.
 *
 * The session outlives the board's mount: when a screen change remounts the board, this only seats
 * the board the session already has — the round goes on, nothing is re-dealt.
 */
export const startMatch3 = async () => {
	if (stateMatch3.active) return;
	if (driver) {
		stateMatch3.active = true;
		driver.reseat();
		return;
	}
	const doc = normalizeGameConfigDoc(bakedGameConfig());
	if (!doc) return;
	const seed = seedOf();
	stateMatch3.seed = seed;
	stateMatch3.moves = 0;
	stateMatch3.selected = undefined;
	stateMatch3.inputEnabled = !getFlowV2();
	let session: Match3Session;
	try {
		session = createMatch3Session(doc, seed);
	} catch (error) {
		fail(error);
		return;
	}
	stateMatch3.minRun = session.board.minRun;
	stateMatch3.active = true;
	driver = createMatch3Driver({ session, state: stateMatch3, signal, present, onError: fail });
	registerBoardEffects(driver.effects);
	await driver.start();
};

/** The board unmounted: it takes no input until it mounts again. The session is kept. */
export const detachMatch3 = () => {
	stateMatch3.active = false;
	stateMatch3.selected = undefined;
};
