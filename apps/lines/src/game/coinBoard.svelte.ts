import { untrack } from 'svelte';
import { SYMBOL_SIZE, type Position } from 'engine-game';
import {
	activePaylineIds,
	coinBoardOverlay,
	normalizeCoinBoard,
	payingCells,
	type CoinBoard,
	type CoinBoardOverlay,
} from 'game-config';
import { stateBet, stateConfig } from 'state-shared';

import {
	coinBoardBetPerLine,
	coinBoardLadder,
	coinBoardResumedLines,
	coinBoardStake,
} from './coinBoardStake';
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
	 *  before the first round, when the board's own default lines are shown. Under `player`, also
	 *  the lines the player just picked, so the board shows them before the next spin. */
	playedIds: null as string[] | null,
	/** The line count the player picked (`player` boards the server lets pick); `null` otherwise. */
	lineCount: null as number | null,
});

type Globals = { __IE_COIN_BOARD_PICKS_LINES__?: unknown; __IE_COIN_BOARD_LINE_COUNT__?: unknown };

/** Does the player pick the line count? A `player` board, and a server that takes the count on the
 *  wire (the facade says so at boot: a bet-option table plays the default count). */
export const coinBoardPicksLines = (): boolean =>
	coinBoardConfig()?.lines.selection === 'player' &&
	(globalThis as Globals).__IE_COIN_BOARD_PICKS_LINES__ === true;

/** The ladder `<Authenticate>` set, read as the bet PER LINE (`coinBoardStake.ts`). */
let perLineLadder: { options: number[]; menu: number[] } | null = null;

/**
 * Play `count` lines from the next spin: the one place the selection is set. Writes the facade's line
 * count (`__IE_COIN_BOARD_LINE_COUNT__`), shows the first `count` of the board's `order` (the Line
 * Overlay and the locked cells follow), and keeps the bet per line while the stake becomes
 * `count` × it, the bet ladder with it. Ignored unless the board lets the player pick `count`.
 */
export const setCoinBoardLineCount = (count: number): void => {
	const board = coinBoardConfig();
	if (!perLineLadder || board?.lines.selection !== 'player') return;
	if (!board.lines.choices.includes(count)) return;
	const betPerLine = coinBoardBetPerLine(stateBet.betAmount, stateCoinBoard.lineCount ?? 1);
	(globalThis as Globals).__IE_COIN_BOARD_LINE_COUNT__ = count;
	stateCoinBoard.lineCount = count;
	stateCoinBoard.playedIds = activePaylineIds(board, getActiveGameConfig().paylines, count);
	stateConfig.betAmountOptions = coinBoardLadder(perLineLadder.options, count);
	stateConfig.betMenuOptions = coinBoardLadder(perLineLadder.menu, count);
	// Raw, as the bet menu writes it: the balance clamp would leave a stake that is no multiple of
	// the lines. A stake the balance cannot cover greys the spin button instead.
	stateBet.betAmount = coinBoardStake(betPerLine, count);
};

/**
 * At boot (after `<Authenticate>`): read its ladder as the bet per line and play the default count,
 * or the count a resumed round was staked on — whose stake is already the total, so it is not
 * multiplied again. A remounted game whose ladder is still the scaled one keeps its count. A no-op
 * unless the player picks the lines.
 */
export const startCoinBoardLines = (): void => {
	const board = coinBoardConfig();
	if (!coinBoardPicksLines() || board?.lines.selection !== 'player') return;
	const count = stateCoinBoard.lineCount;
	const scaled = perLineLadder && count && coinBoardLadder(perLineLadder.options, count);
	if (scaled && JSON.stringify(scaled) === JSON.stringify(stateConfig.betAmountOptions)) return;
	perLineLadder = {
		options: [...stateConfig.betAmountOptions],
		menu: [...stateConfig.betMenuOptions],
	};
	const resumed = coinBoardResumedLines(stateBet.betToResume?.state, board.lines.choices);
	stateCoinBoard.lineCount = resumed ?? 1;
	setCoinBoardLineCount(resumed ?? board.lines.default);
};

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

/**
 * How the Line Overlay draws (`docs/design/hold-and-win-coin-board.md` §1.4): line width (px) and
 * opacity, one colour for every line (absent ⇒ each line's own), the tabs and their number colour.
 */
export type LineOverlayLook = {
	lineWidth: number;
	lineAlpha: number;
	lineColor?: number | string;
	showTabs: boolean;
	tabScale: number;
	tabTextFill: number | string;
};

/** The coded look — what a project that placed no Line Overlay sees, and the component's defaults. */
export const CODED_LINE_OVERLAY_LOOK: LineOverlayLook = {
	lineWidth: SYMBOL_SIZE * 0.035,
	lineAlpha: 0.8,
	showTabs: true,
	tabScale: 1,
	tabTextFill: 0x111111,
};

const HEX = /^#[0-9a-f]{6}$/i;
const colourOf = (value: unknown): number | string | undefined =>
	(typeof value === 'number' && Number.isFinite(value)) ||
	(typeof value === 'string' && HEX.test(value))
		? value
		: undefined;
const numberOf = (value: unknown, fallback: number, min: number, max: number): number =>
	typeof value === 'number' && Number.isFinite(value)
		? Math.min(Math.max(value, min), max)
		: fallback;

/** A placed Line Overlay's look from its params; a missing or invalid one keeps the coded value. */
export const lineOverlayLookFrom = (params: Record<string, unknown>): LineOverlayLook => {
	const coded = CODED_LINE_OVERLAY_LOOK;
	const lineColor = colourOf(params.lineColor);
	return {
		lineWidth: numberOf(params.lineWidth, coded.lineWidth, 0, SYMBOL_SIZE),
		lineAlpha: numberOf(params.lineAlpha, coded.lineAlpha, 0, 1),
		...(lineColor !== undefined ? { lineColor } : {}),
		showTabs: typeof params.showTabs === 'boolean' ? params.showTabs : coded.showTabs,
		tabScale: numberOf(params.tabScale, coded.tabScale, 0, 4),
		tabTextFill: colourOf(params.tabTextFill) ?? coded.tabTextFill,
	};
};

/**
 * The look a mounted Line Overlay (`LineOverlayPart`) hands the board. Each instance holds its own
 * entry; the most recently published one draws, and unmounting one hands back to the one before it.
 */
let overlayLooks = $state.raw<{ id: number; look: LineOverlayLook }[]>([]);
let nextOverlayLookId = 1;

/** The placed Line Overlay's look, or `null` with none placed (or only a stand-in). */
export const lineOverlayLook = (): LineOverlayLook | null => overlayLooks.at(-1)?.look ?? null;

/** Start publishing a look; returns its setter and its release. */
export const claimLineOverlayLook = () => {
	const id = nextOverlayLookId++;
	return {
		// `untrack`: a component calls these from its effects, which must not come to depend on the
		// list they write.
		set: (look: LineOverlayLook) => {
			const others = untrack(() => overlayLooks.filter((entry) => entry.id !== id));
			overlayLooks = [...others, { id, look }];
		},
		release: () => {
			overlayLooks = untrack(() => overlayLooks.filter((entry) => entry.id !== id));
		},
	};
};
