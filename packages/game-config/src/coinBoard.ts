/**
 * The COIN BOARD — a Hold and Win whose base game is the respin board itself, with no line game
 * (`docs/design/hold-and-win-coin-board.md`). Every spin deals coins and blanks onto the board; the
 * coins that land on PAYING cells trigger, stick and pay.
 *
 * A cell is paying when at least one ACTIVE payline passes through it (§1.1). The active lines are
 * the designer's fixed list, or the first N of the designer's order for the line count the player
 * picks (§1.3). Every consumer — the validator, the mock and the runtime — reads the paying cells
 * through {@link activePaylineIds} and {@link payingCells}, so the three agree by construction.
 *
 * SPARSE like every Invisible-Engine block: absent ⇒ a lines base game, byte-identical to every
 * config authored before it existed. Its presence is what puts the base game on the respin board
 * (`resolveGameModes`).
 */

import { primaryRespinMode } from './bonusGames';
import { overlayDropsTokens } from './coinOverlay';
import { isHoldAndWinSymbol } from './holdAndWin';
import { symbolsInPlayForGameType } from './inPlay';
import { BASE_GAME_MODE, gameModeById, gameTypeForMode } from './modes';
import { hexColor, isObject, num } from './normalizeParts';
import type { GameConfigDoc, Paylines } from './types';
import type { GameConfigIssue } from './validate';

/** How the held coins pay when the feature ends (§1.2). */
export const COIN_BOARD_PAY_RULES = ['coinsOnLines', 'lineFill', 'perLine'] as const;
export type CoinBoardPayRule = (typeof COIN_BOARD_PAY_RULES)[number];

/** Who picks the active lines (§1.3). */
export type CoinBoardLines =
	| {
			selection: 'fixed';
			/** The active payline ids. */
			active: string[];
	  }
	| {
			selection: 'player';
			/** The line counts the player can pick from. */
			choices: number[];
			default: number;
			/** The payline ids in the order they switch on: N lines are the first N. */
			order: string[];
	  };

export type CoinBoardOverlay = { color: string; alpha: number };

export type CoinBoard = {
	lines: CoinBoardLines;
	payRule: CoinBoardPayRule;
	/** `lineFill` only. Absent ⇒ {@link DEFAULT_LINE_FILL_MIN}. */
	lineFill?: { min: number };
	/** Fewest coins on paying cells that start the respins, per line count (the key). A `fixed`
	 *  board has one entry, its active line count. */
	triggerMin: Record<string, number>;
	/** The colour over the non-paying cells. Absent ⇒ {@link DEFAULT_INACTIVE_OVERLAY}. */
	inactiveOverlay?: CoinBoardOverlay;
};

export const DEFAULT_LINE_FILL_MIN = 3;

export const DEFAULT_INACTIVE_OVERLAY: CoinBoardOverlay = { color: '#000000', alpha: 0.6 };

/** The trigger minimum a new line choice starts with — the plain template's, capped by the cells
 *  that choice can pay on. */
const DEFAULT_TRIGGER_MIN = 6;

const ids = (raw: unknown): string[] =>
	Array.isArray(raw)
		? raw
				.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
				.map((id) => id.trim())
		: [];

const ints = (raw: unknown): number[] =>
	Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n)) : [];

const normalizeLines = (raw: unknown): CoinBoardLines => {
	if (isObject(raw) && raw.selection === 'player') {
		const choices = ints(raw.choices);
		const fallback = Number.isInteger(raw.default) ? (raw.default as number) : choices[0];
		return {
			selection: 'player',
			choices,
			default: fallback ?? 1,
			order: ids(raw.order),
		};
	}
	return { selection: 'fixed', active: isObject(raw) ? ids(raw.active) : [] };
};

/**
 * Canonicalize a coin board, or `undefined` when there is none. Any object is a coin board, as any
 * object is a Hold and Win block: its presence moves the base game onto the respin board, and the
 * validator names what it is missing. Structural only — a line id the paylines lack, a duplicate, a
 * minimum above the paying cells are kept for the validator to report.
 */
export function normalizeCoinBoard(raw: unknown): CoinBoard | undefined {
	if (!isObject(raw)) return undefined;
	const payRule = COIN_BOARD_PAY_RULES.find((r) => r === raw.payRule) ?? 'coinsOnLines';
	const triggerMin: Record<string, number> = {};
	if (isObject(raw.triggerMin)) {
		for (const [key, value] of Object.entries(raw.triggerMin)) {
			const min = num(value);
			if (key && min !== undefined && Number.isInteger(min)) triggerMin[key] = min;
		}
	}
	const board: CoinBoard = { lines: normalizeLines(raw.lines), payRule, triggerMin };
	const fillMin = isObject(raw.lineFill) ? num(raw.lineFill.min) : undefined;
	if (payRule === 'lineFill' && fillMin !== undefined && Number.isInteger(fillMin)) {
		board.lineFill = { min: fillMin };
	}
	if (isObject(raw.inactiveOverlay)) {
		const color = hexColor(raw.inactiveOverlay.color);
		const alpha = num(raw.inactiveOverlay.alpha);
		if (color && alpha !== undefined) board.inactiveOverlay = { color, alpha };
	}
	return board;
}

// ─── read helpers ─────────────────────────────────────────────────────────────────────────────

/** The line counts the board can play: the player's choices, or the fixed board's one count. */
export function coinBoardLineCounts(coinBoard: CoinBoard): number[] {
	return coinBoard.lines.selection === 'player'
		? coinBoard.lines.choices
		: [new Set(coinBoard.lines.active).size];
}

/** The line count a round plays when nobody picks one: the player's default, or the fixed count. */
export function coinBoardDefaultLineCount(coinBoard: CoinBoard): number {
	return coinBoard.lines.selection === 'player'
		? coinBoard.lines.default
		: new Set(coinBoard.lines.active).size;
}

/**
 * The payline ids that pay, in order, each once and only those the paylines define. Under `player`,
 * the first `lineCount` of the order (absent ⇒ the default); a `fixed` board ignores `lineCount`.
 */
export function activePaylineIds(
	coinBoard: CoinBoard,
	paylines: Paylines,
	lineCount?: number,
): string[] {
	const lines = coinBoard.lines;
	const listed =
		lines.selection === 'player'
			? lines.order.slice(0, Math.max(0, lineCount ?? lines.default))
			: lines.active;
	return [...new Set(listed)].filter((id) => paylines[id] !== undefined);
}

/**
 * Which cells pay, as `[reel][row]`: a cell pays when at least one of `activeIds` passes through it.
 * A payline row off its column is ignored, as the validator reports it.
 */
export function payingCells(
	paylines: Paylines,
	activeIds: readonly string[],
	grid: { numRows: readonly number[] },
): boolean[][] {
	const cells = grid.numRows.map((rows) => Array.from({ length: rows }, () => false));
	for (const id of activeIds) {
		paylines[id]?.forEach((row, reel) => {
			if (cells[reel] && row < cells[reel].length) cells[reel][row] = true;
		});
	}
	return cells;
}

/** How many cells pay for `lineCount` lines (absent ⇒ the default count). */
export function payingCellCount(
	doc: Pick<GameConfigDoc, 'paylines' | 'numRows'>,
	coinBoard: CoinBoard,
	lineCount?: number,
): number {
	return payingCells(doc.paylines, activePaylineIds(coinBoard, doc.paylines, lineCount), doc)
		.flat()
		.filter(Boolean).length;
}

/** The trigger minimum for `lineCount` lines (absent ⇒ the default count), or `undefined` when the
 *  board states none for it. */
export function coinBoardTriggerMin(coinBoard: CoinBoard, lineCount?: number): number | undefined {
	return coinBoard.triggerMin[String(lineCount ?? coinBoardDefaultLineCount(coinBoard))];
}

/** A `lineFill` run's minimum length. */
export const coinBoardLineFillMin = (coinBoard: CoinBoard): number =>
	coinBoard.lineFill?.min ?? DEFAULT_LINE_FILL_MIN;

/** The overlay over the non-paying cells. */
export const coinBoardOverlay = (coinBoard: CoinBoard): CoinBoardOverlay =>
	coinBoard.inactiveOverlay ?? DEFAULT_INACTIVE_OVERLAY;

/** A trigger minimum for `lineCount` lines that the board can reach: the default, capped by the
 *  cells that count pays on. */
export function defaultCoinBoardTriggerMin(
	doc: Pick<GameConfigDoc, 'paylines' | 'numRows'>,
	coinBoard: CoinBoard,
	lineCount: number,
): number {
	return Math.max(1, Math.min(DEFAULT_TRIGGER_MIN, payingCellCount(doc, coinBoard, lineCount)));
}

/** The coin board `/config` starts from: every payline active, chosen by the designer, every held
 *  coin paying once. */
export function defaultCoinBoard(doc: Pick<GameConfigDoc, 'paylines' | 'numRows'>): CoinBoard {
	const board: CoinBoard = {
		lines: { selection: 'fixed', active: Object.keys(doc.paylines) },
		payRule: 'coinsOnLines',
		triggerMin: {},
	};
	const count = coinBoardDefaultLineCount(board);
	board.triggerMin[String(count)] = defaultCoinBoardTriggerMin(doc, board, count);
	return board;
}

// ─── validate ─────────────────────────────────────────────────────────────────────────────────

/**
 * The coin board's own rules (design §2): the lines name real paylines, once each; the player's
 * choices are line counts the paylines can fill, with a default among them and an order long enough
 * for the largest; every line count has exactly one trigger minimum, reachable on the cells it pays;
 * a `lineFill` run fits the reels; and the overlay is a colour with an alpha. Around it: the board
 * plays a Hold and Win respin mode, deals no line symbol and takes no dropped token.
 */
export function validateCoinBoard(doc: GameConfigDoc): GameConfigIssue[] {
	const board = doc.coinBoard;
	if (!board) return [];
	const issues: GameConfigIssue[] = [];
	const at = (path: string) => (path ? `coinBoard.${path}` : 'coinBoard');
	const error = (path: string, message: string) =>
		issues.push({ severity: 'error', path: at(path), message });
	const warning = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: at(path), message });

	const paylineCount = Object.keys(doc.paylines).length;
	const checkIds = (path: string, list: string[]) => {
		const seen = new Set<string>();
		list.forEach((id, i) => {
			if (!doc.paylines[id]) error(`${path}.${i}`, `Payline "${id}" does not exist.`);
			else if (seen.has(id)) error(`${path}.${i}`, `Payline "${id}" is listed twice.`);
			seen.add(id);
		});
	};

	const lines = board.lines;
	if (!paylineCount) {
		error('lines', 'The coin board pays on paylines, and this config has none.');
	}
	if (lines.selection === 'fixed') {
		if (!lines.active.length) error('lines.active', 'No line is active, so no cell can pay.');
		checkIds('lines.active', lines.active);
	} else {
		if (!lines.choices.length) error('lines.choices', 'The player has no line count to pick.');
		const seen = new Set<number>();
		lines.choices.forEach((n, i) => {
			if (n < 1 || n > paylineCount) {
				error(
					`lines.choices.${i}`,
					`${n} lines is not between 1 and the ${paylineCount} paylines.`,
				);
			} else if (seen.has(n)) error(`lines.choices.${i}`, `${n} lines is listed twice.`);
			seen.add(n);
		});
		if (!lines.choices.includes(lines.default)) {
			error('lines.default', `The default of ${lines.default} lines is not one of the choices.`);
		}
		checkIds('lines.order', lines.order);
		const most = Math.max(0, ...lines.choices);
		if (lines.order.length < most) {
			error(
				'lines.order',
				`The order lists ${lines.order.length} lines, but the player can pick ${most}.`,
			);
		}
	}

	if (!COIN_BOARD_PAY_RULES.includes(board.payRule)) {
		error('payRule', `"${board.payRule}" is not a pay rule.`);
	}
	if (board.lineFill) {
		if (board.payRule !== 'lineFill') {
			warning('lineFill', 'A line-fill run is set, but the pay rule is not line fill.');
		}
		const min = board.lineFill.min;
		if (!Number.isInteger(min) || min < 1 || min > doc.numReels) {
			error('lineFill.min', `A run of ${min} does not fit ${doc.numReels} reels.`);
		}
	}

	const counts = [...new Set(coinBoardLineCounts(board))];
	for (const count of counts) {
		const min = board.triggerMin[String(count)];
		if (min === undefined) {
			error('triggerMin', `No trigger minimum for ${count} line${count === 1 ? '' : 's'}.`);
			continue;
		}
		const cells = payingCellCount(doc, board, count);
		if (!Number.isInteger(min) || min < 1 || min > cells) {
			error(
				`triggerMin.${count}`,
				`${count} line${count === 1 ? ' pays' : 's pay'} on ${cells} cells, so a minimum of ${min} coins can never trigger.`,
			);
		}
	}
	for (const key of Object.keys(board.triggerMin)) {
		if (!counts.some((count) => String(count) === key)) {
			warning(`triggerMin.${key}`, `No line choice plays ${key} lines, so this minimum is unused.`);
		}
	}

	const overlay = board.inactiveOverlay;
	if (overlay) {
		if (!hexColor(overlay.color)) {
			error('inactiveOverlay.color', `"${overlay.color}" is not a #rrggbb colour.`);
		}
		if (!(overlay.alpha >= 0 && overlay.alpha <= 1)) {
			error('inactiveOverlay.alpha', `The alpha ${overlay.alpha} is not between 0 and 1.`);
		}
	}

	if (!primaryRespinMode(doc.modes)) {
		error('', 'The coin board plays the Hold and Win respins, and this config has no respin mode.');
	}
	if (overlayDropsTokens(doc.coinOverlay)) {
		error('', 'Pots and dropped tokens are not built for a coin board.');
	}
	const baseStrips = gameTypeForMode(gameModeById(doc, BASE_GAME_MODE) ?? { id: BASE_GAME_MODE });
	const lineSymbols = symbolsInPlayForGameType(doc, baseStrips).filter(
		(name) => doc.symbols[name] && !isHoldAndWinSymbol(doc.symbols[name]),
	);
	if (lineSymbols.length) {
		warning(
			'',
			`The coin board deals only coins and blanks, but the base strips deal ${lineSymbols.join(', ')}.`,
		);
	}
	return issues;
}
