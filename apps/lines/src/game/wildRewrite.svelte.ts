import { Tween } from 'svelte/motion';
import { resolveExpandingWilds } from 'game-config';
import { roundSkip } from 'utils-shared/skipToken';
import { SECOND } from 'constants-shared/time';
import type { ReelSymbol } from 'engine-game';

import { playWildExplodeSound } from './soundBindings';
import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from './symbolBeat';
import { stackedPictureRuns, stateGame } from './stateGame.svelte';
import { boardDimensions, getActiveGameConfig } from './gameConfig';
import type { Position, RawSymbol, SymbolName } from './types';

/**
 * Wilds that rewrite the board after it lands (`docs/design/expanding-and-growing-wilds.md` §4):
 * the expanding wild (`expandWild`) and the growing wild (`growWild`). ONE presentation, called by
 * the coded handler and by the Flow effect alike, so the two paths cannot drift.
 *
 * Every presenter ends on the FINAL board — each rewritten cell holds the wild — whether it played
 * out, was slammed (`roundSkip`) or threw: the `winInfo` that follows reads its positions off that
 * board. Rows are engine rows (the reveal's top padding is row 0), like `winInfo`'s.
 */

const MORPH_STAGGER_MS = 0.12 * SECOND;
const STACKED_GROW_MS = 0.5 * SECOND;

/** A window of board rows, `top` inclusive to `bottom` exclusive. */
type RowWindow = { top: number; bottom: number };

/**
 * A stacked picture growing over its reel: from the slice the landed wild showed (`from`, with the
 * picture box's top row `fromBoxTop`) to the whole visible reel (`to`). `StackedPicture` reads it
 * through {@link stackedGrowthFor}; absent ⇒ the picture draws exactly as its run says.
 */
export type StackedGrowth = {
	originRow: number;
	fromBoxTop: number;
	from: RowWindow;
	to: RowWindow;
	progress: Tween<number>;
};

const growth = $state<Record<number, StackedGrowth>>({});

export const stackedGrowthFor = (reel: number): StackedGrowth | undefined => growth[reel];

const cellAt = ({ reel, row }: Position): ReelSymbol | undefined =>
	stateGame.board[reel]?.reelState.symbols[row];

/** The wild as the landed cell carries it, so a rewritten cell is that symbol and nothing of what
 *  it overwrote (a multiplier, a coin value) lingers on it. */
const wildRawSymbol = (origin: ReelSymbol | undefined, symbol: SymbolName): RawSymbol =>
	origin?.rawSymbol.name === symbol ? { ...origin.rawSymbol } : { name: symbol };

/** Put the wild on every listed cell that does not hold it yet — the instant final state. */
const settle = (cells: Position[], raw: RawSymbol): void => {
	for (const position of cells) {
		const cell = cellAt(position);
		if (!cell || cell.rawSymbol.name === raw.name) continue;
		cell.rawSymbol = { ...raw };
		cell.symbolState = 'static';
	}
};

/** Await one cell's one-shot beat, bounded by the transit cap and released by a slam. */
const cellBeat = (cell: ReelSymbol) =>
	roundSkip.race(awaitSymbolBeat((resolve) => (cell.oncomplete = resolve), TRANSIT_BEAT_CAP_MS));

/**
 * The Book-of column morph, one cell at a time in `cells` order: the old symbol explodes, the cell
 * swaps to the wild and plays its land.
 */
const morphCells = async (cells: Position[], raw: RawSymbol): Promise<void> => {
	for (const position of cells) {
		if (roundSkip.isSkipped()) return;
		const cell = cellAt(position);
		if (!cell || cell.rawSymbol.name === raw.name) continue;
		playWildExplodeSound();
		cell.symbolState = 'explosion';
		await cellBeat(cell);
		cell.rawSymbol = { ...raw };
		cell.symbolState = 'land';
		await roundSkip.wait(MORPH_STAGGER_MS);
	}
};

/** Rows the reveal pads above the visible grid — the facade's `BOARD_PADDING_ROWS`. */
const BOARD_PADDING_ROWS = 1;

/** The visible rows of `reel` ordered outwards from `row` — nearest first, above before below. */
const rowsOutward = (row: number, rows: number): number[] =>
	Array.from({ length: rows }, (_, i) => i + BOARD_PADDING_ROWS).sort(
		(a, b) => Math.abs(a - row) - Math.abs(b - row) || a - b,
	);

/**
 * `expandWild`: the wild at (`reel`, `row`) fills its reel. `cells` are the cells that become it —
 * never the origin, never a cell the server leaves alone (a scatter).
 *
 * Drawn only when it matters: under the Game Config's `expandingWilds.show: 'onWin'` (the default) an
 * expansion no paying line crosses (`paid` false) is not drawn at all — the wild stays its landed
 * cell and the reel keeps its landed symbols, which is all the wins read. `'always'` draws every one.
 *
 * STACKED (the stacked-picture mode is on, the landed wild shows a slice of its tall picture, and
 * the expansion covers every visible row): the other cells clear together, then the picture grows
 * from that slice over the whole reel. Otherwise each cell morphs in turn, outwards from the origin.
 */
export const presentExpandWild = async ({
	reel,
	row,
	symbol,
	cells,
	paid,
}: {
	reel: number;
	row: number;
	symbol: SymbolName;
	cells: Position[];
	paid: boolean;
}): Promise<void> => {
	if (!paid && (resolveExpandingWilds(getActiveGameConfig())?.show ?? 'onWin') === 'onWin') return;
	const raw = wildRawSymbol(cellAt({ reel, row }), symbol);
	const rows = boardDimensions().y;
	const order = rowsOutward(row, rows);
	const targets = cells
		.filter((cell) => cell.reel === reel)
		.sort((a, b) => order.indexOf(a.row) - order.indexOf(b.row));
	try {
		if (roundSkip.isSkipped()) return;
		const slice = stackedPictureRuns().find(
			(run) =>
				run.reel === reel &&
				run.name === symbol &&
				run.topRow <= row &&
				row < run.topRow + run.visibleCells,
		);
		const covered = [row, ...targets.map((cell) => cell.row)];
		const fillsReel = order.every((visibleRow) => covered.includes(visibleRow));
		if (slice && fillsReel) {
			await growStacked({ reel, row, raw, targets, rows, slice });
		} else {
			await morphCells(targets, raw);
		}
	} finally {
		settle(targets, raw);
		delete growth[reel];
	}
};

const growStacked = async ({
	reel,
	row,
	raw,
	targets,
	rows,
	slice,
}: {
	reel: number;
	row: number;
	raw: RawSymbol;
	targets: Position[];
	rows: number;
	slice: { topRow: number; visibleCells: number; hiddenAbove: number };
}): Promise<void> => {
	const clearing = targets.flatMap((position) => {
		const cell = cellAt(position);
		return cell && cell.rawSymbol.name !== raw.name ? [cell] : [];
	});
	if (clearing.length) {
		playWildExplodeSound();
		for (const cell of clearing) cell.symbolState = 'explosion';
		await roundSkip.race(Promise.all(clearing.map(cellBeat)));
	}
	if (roundSkip.isSkipped()) return;
	const progress = new Tween(0);
	growth[reel] = {
		originRow: row,
		fromBoxTop: slice.topRow - slice.hiddenAbove,
		from: { top: slice.topRow, bottom: slice.topRow + slice.visibleCells },
		to: { top: BOARD_PADDING_ROWS, bottom: rows + BOARD_PADDING_ROWS },
		progress,
	};
	settle(targets, raw);
	await roundSkip.race(progress.set(1, { duration: STACKED_GROW_MS }));
};

/**
 * `growWild`: the wild at `origin` bursts, then copies itself onto `cells` one at a time, in the
 * order given (outwards). A copy may overwrite an expanded wild.
 */
export const presentGrowWild = async ({
	origin,
	symbol,
	cells,
}: {
	origin: Position;
	symbol: SymbolName;
	cells: Position[];
}): Promise<void> => {
	const source = cellAt(origin);
	const raw = wildRawSymbol(source, symbol);
	try {
		if (roundSkip.isSkipped()) return;
		if (source) {
			playWildExplodeSound();
			source.symbolState = 'win';
			await cellBeat(source);
			if (source.symbolState === 'win') source.symbolState = 'static';
		}
		await morphCells(cells, raw);
	} finally {
		settle(cells, raw);
	}
};
