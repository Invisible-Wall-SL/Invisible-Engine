import type { Position } from 'engine-game';
import {
	activePaylineIds,
	coinBoardOverlay,
	normalizeCoinBoard,
	payingCells,
	type CoinBoard,
	type CoinBoardOverlay,
} from 'game-config';

import { getActiveGameConfig } from './gameConfig';
import { getSymbolSeat } from './stateGame.svelte';

/**
 * THE COIN BOARD as this game plays it (`docs/design/hold-and-win-coin-board.md`) — a Hold and Win
 * whose base game is the respin board itself. The board is up from boot and never swaps out, every
 * base spin spins its paying cells, and a cell no active payline crosses is LOCKED: it never spins and
 * draws as the blank under the inactive overlay (§1.1).
 *
 * The block is the Game Config's, else the one the server declared at boot (the facade's
 * `__IE_COIN_BOARD__`). Its absence is every other game, and every read here is then inert.
 */

const declared = new WeakMap<object, CoinBoard | null>();

/** The coin board this game plays, or `undefined` for every game with a lines base game. */
export const coinBoardConfig = (): CoinBoard | undefined => {
	const config = getActiveGameConfig();
	if (config.coinBoard) return config.coinBoard;
	let board = declared.get(config);
	if (board === undefined) {
		const published = (globalThis as { __IE_COIN_BOARD__?: unknown }).__IE_COIN_BOARD__;
		board = normalizeCoinBoard(published) ?? null;
		if (published !== undefined) declared.set(config, board);
	}
	return board ?? undefined;
};

/** Is the base game the coin board? */
export const isCoinBoard = (): boolean => coinBoardConfig() !== undefined;

export const stateCoinBoard = $state({
	/** The lines the server played the last round on (its `bet` echo, on the base reveal); `null`
	 *  before the first round, when the board's own default lines are shown. */
	playedIds: null as string[] | null,
});

/** The active payline ids, in the board's order — what the Line Overlay draws (reactive). */
export const coinBoardPaylineIds = (): string[] => {
	const board = coinBoardConfig();
	if (!board) return [];
	return stateCoinBoard.playedIds ?? activePaylineIds(board, getActiveGameConfig().paylines);
};

/** The cells no active payline crosses (reactive) — never spun, drawn under the overlay. */
export const coinBoardLockedCells = (): Position[] => {
	if (!isCoinBoard()) return [];
	const config = getActiveGameConfig();
	return payingCells(config.paylines, coinBoardPaylineIds(), config).flatMap((column, reel) =>
		column.flatMap((pays, row) => (pays ? [] : [{ reel, row }])),
	);
};

/** The colour over the locked cells. */
export const coinBoardInactiveOverlay = (): CoinBoardOverlay | undefined => {
	const board = coinBoardConfig();
	return board ? coinBoardOverlay(board) : undefined;
};

/** A line's colour when the Game Config gives it none, by its place in the paylines — distinct
 *  enough that five lines on one board read apart. */
const UNCOLOURED_LINES = ['#ffd23f', '#3fc1ff', '#ff5c7a', '#7be36b', '#c18cff', '#ff9f43'];

/** A payline's colour on the coin board: its Game Config `paylineColors` entry, else the fallback. */
export const coinBoardLineColor = (id: string): string => {
	const config = getActiveGameConfig();
	const at = Math.max(0, Object.keys(config.paylines).indexOf(id));
	return config.paylineColors?.[id] ?? UNCOLOURED_LINES[at % UNCOLOURED_LINES.length];
};

/** The board-local centre of every cell a payline crosses, reel by reel — the path a line draws. */
export const coinBoardLinePoints = (id: string): { x: number; y: number }[] =>
	(getActiveGameConfig().paylines[id] ?? []).map((row, reel) => {
		const seat = getSymbolSeat(reel, row);
		return { x: seat.x, y: seat.y };
	});
