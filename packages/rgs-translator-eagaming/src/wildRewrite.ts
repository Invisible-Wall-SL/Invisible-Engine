/**
 * EXPANDING and GROWING WILDS on the wire (`docs/design/expanding-and-growing-wilds.md` §3): the
 * reference game's `expandedWild` / `growingWild`, each followed by the `symbolSetInMatrix` cells it
 * changed, become the book events `expandWild` and `growWild`. They are presented after the spin's
 * `reveal` (the LANDED board, `playedSpin`) and before its wins, which are the final board's.
 *
 * A server may send them before or after `playedSpin` (the two-pass rule), so each spin's are
 * collected up front, by the index of its `playedSpin`, and presented with it — the way the pots
 * overlay's drop is.
 *
 * Each `expandWild` says whether a paying line of its spin crosses the reel (`paid`): the client
 * draws an expansion no win uses only when the game asks for it (`expandingWilds.show`).
 */

import type { Play4FunBookEvent } from './types';

/** One changed cell, in VISIBLE-grid rows (server rows). */
type Cell = { reel: number; row: number };

/** One expansion or growth of a spin, with the cells it changed, in wire order. */
export type WildRewrite = {
	kind: 'expand' | 'grow';
	wild: string;
	origin: Cell;
	cells: (Cell & { symbol: string; oldSymbol?: string })[];
};

/** One spin's rewrites and the reels its paying wins cross. */
export type SpinWildRewrites = { rewrites: WildRewrite[]; paidReels: Set<number> };

/** The wire events this module owns; the facade's main loop skips them. */
export const WILD_REWRITE_EVENTS = new Set(['expandedWild', 'growingWild', 'symbolSetInMatrix']);

const cellOf = (context: unknown): (Cell & { wild?: string; symbol?: string }) | null => {
	const c = context as { reel?: unknown; row?: unknown; wild?: unknown; symbol?: unknown } | null;
	if (!c || !Number.isInteger(c.reel) || !Number.isInteger(c.row)) return null;
	return {
		reel: c.reel as number,
		row: c.row as number,
		...(typeof c.wild === 'string' ? { wild: c.wild } : {}),
		...(typeof c.symbol === 'string' ? { symbol: c.symbol } : {}),
	};
};

/** The reels a `spinWin` pays across: a line's leftmost `occurs` reels, or the reels of its
 *  cells. The scatter's own pay crosses none. */
const reelsPaidBy = (context: unknown): number[] => {
	const win = context as { what?: string; mode?: string; occurs?: number; context?: unknown };
	if (!win || (win.mode === 'scatter' && win.what === 'SCAT')) return [];
	const ctx = win.context as { payline?: number[] } | Cell[] | undefined;
	if (Array.isArray(ctx)) return ctx.map((c) => c.reel);
	const payline = ctx?.payline;
	return Array.isArray(payline) ? payline.slice(0, win.occurs ?? 0).map((_row, reel) => reel) : [];
};

/**
 * Every spin's rewrites, by the index of the `playedSpin` they belong to. A spin runs from its
 * `spinStart` to the next one; a `symbolSetInMatrix` belongs to the `expandedWild` or `growingWild`
 * before it. Empty when the wire carries none, which is every game without these features.
 */
export const wildRewritesBySpin = (events: Play4FunBookEvent[]): Map<number, SpinWildRewrites> => {
	const out = new Map<number, SpinWildRewrites>();
	let pending: WildRewrite[] = [];
	let paidReels = new Set<number>();
	let spin: number | undefined;
	const flush = () => {
		if (spin !== undefined && pending.length) out.set(spin, { rewrites: pending, paidReels });
		pending = [];
		paidReels = new Set();
		spin = undefined;
	};
	events.forEach((e, at) => {
		if (e.event === 'spinStart') flush();
		else if (e.event === 'playedSpin') spin = at;
		else if (e.event === 'spinWin') for (const reel of reelsPaidBy(e.context)) paidReels.add(reel);
		else if (e.event === 'expandedWild' || e.event === 'growingWild') {
			const origin = cellOf(e.context);
			if (origin?.wild) {
				pending.push({
					kind: e.event === 'expandedWild' ? 'expand' : 'grow',
					wild: origin.wild,
					origin: { reel: origin.reel, row: origin.row },
					cells: [],
				});
			}
		} else if (e.event === 'symbolSetInMatrix') {
			const cell = cellOf(e.context);
			const oldSymbol = (e.context as { oldSymbol?: unknown } | null)?.oldSymbol;
			if (cell?.symbol && pending.length) {
				pending[pending.length - 1].cells.push({
					reel: cell.reel,
					row: cell.row,
					symbol: cell.symbol,
					...(typeof oldSymbol === 'string' ? { oldSymbol } : {}),
				});
			}
		}
	});
	flush();
	return out;
};

/**
 * The book events for one spin's rewrites, and the board they leave. `board` is the landed board
 * (server names, visible rows); `map` names a symbol for the engine; `padding` is the rows the reveal
 * adds above the grid. An expansion's `cells` leave out its origin, which already holds the wild; a
 * cell off the board is dropped. `drift` counts the cells whose `oldSymbol` disagrees with the board,
 * which means the server and the client no longer read the same board.
 */
export const translateWildRewrites = (
	{ rewrites, paidReels }: SpinWildRewrites,
	board: string[][],
	map: (name: string) => string,
	padding: number,
): { bookEvents: Record<string, unknown>[]; board: string[][]; drift: number } => {
	const final = board.map((reel) => [...reel]);
	let drift = 0;
	const engineCell = ({ reel, row }: Cell) => ({ reel, row: row + padding });
	const bookEvents = rewrites.map(({ kind, wild, origin, cells }) => {
		const changed = cells.filter(
			(c) => c.row >= 0 && c.row < (final[c.reel]?.length ?? 0) && c.symbol === wild,
		);
		for (const c of changed) {
			if (c.oldSymbol !== undefined && c.oldSymbol !== final[c.reel][c.row]) drift += 1;
			final[c.reel][c.row] = c.symbol;
		}
		const moved = changed
			.filter((c) => !(c.reel === origin.reel && c.row === origin.row))
			.map(engineCell);
		const symbol = map(wild);
		return kind === 'expand'
			? {
					type: 'expandWild',
					reel: origin.reel,
					row: origin.row + padding,
					symbol,
					cells: moved,
					paid: paidReels.has(origin.reel),
				}
			: { type: 'growWild', origin: engineCell(origin), symbol, cells: moved };
	});
	return { bookEvents, board: final, drift };
};
