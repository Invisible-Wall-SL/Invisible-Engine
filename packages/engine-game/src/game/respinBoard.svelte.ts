import type { ReelSpinProfile } from 'engine-layout';
import { stateBet } from 'state-shared';
import { createReelForSpinning } from 'utils-slots';

import { INITIAL_SYMBOL_STATE, SPIN_OPTIONS_DEFAULT, SPIN_OPTIONS_FAST } from './constants';
import type { RespinSpin } from './respinBoard';
import type { RawSymbol, SymbolState } from './types';

export type RespinBoardDeps = {
	reels: number;
	rows: number;
	/** The row pitch — the same getter the base reels spin on, so a cell rolls at the board's pitch. */
	symbolHeight: () => number;
	/**
	 * Cell `(reel, row)`'s resting LEAD in pitch fractions — the base reel's lead plus the row's seat
	 * index — so the one visible symbol of its strip comes to rest on exactly the seat the base board
	 * draws that cell at.
	 */
	symbolLead: (reel: number, row: number) => number;
	/** What each cell shows at mount, `[reel][row]`. */
	initial: RawSymbol[][];
	/** The empty cell's symbol name — the strip's padding when there is nothing else to roll. */
	blank: () => string;
	/** One cell's strip settled — the board's per-cell stop cue. */
	onCellStopping?: (reel: number, row: number) => void;
	/** The authored spin feel merged over the coded options, as the board's reels merge it. */
	spinProfile?: (which: 'normal' | 'fast') => ReelSpinProfile | undefined;
};

/**
 * THE RESPIN BOARD'S REELS — `reels × rows` ONE-CELL reels, each the ordinary
 * `createReelForSpinning` with a one-row window (design §4.2). A respin spins only the cells it is
 * handed and lands each on its own symbol; the held layer above draws the stuck coins, so nothing
 * here knows what a coin is. The column-strip board is untouched — this is a second, independent
 * set of reels that exists only while a Hold and Win feature does.
 *
 * Each strip is `[padding, cell, padding]`, the shape the reel already assumes (its home is one
 * pitch above the strip's top, so index 1 is the window). The padding rows are what bounce into
 * view at the stop, so they are drawn from the same strip the cell rolls through.
 */
export function createRespinBoard(deps: RespinBoardDeps) {
	const blankSymbol = (): RawSymbol => ({ name: deps.blank() });
	const strip = (symbol: RawSymbol): RawSymbol[] => [blankSymbol(), symbol, blankSymbol()];

	const cells = Array.from({ length: deps.reels }, (_r, reel) =>
		Array.from({ length: deps.rows }, (_c, row) => {
			const cellReel = createReelForSpinning<RawSymbol, SymbolState>({
				reelIndex: reel,
				symbolHeight: deps.symbolHeight,
				symbolLead: () => deps.symbolLead(reel, row),
				initialSymbols: strip(deps.initial[reel]?.[row] ?? blankSymbol()),
				initialSymbolState: INITIAL_SYMBOL_STATE,
				onReelStopping: () => deps.onCellStopping?.(reel, row),
				onSymbolLand: () => {},
			});
			cellReel.reelState.spinOptions = () => {
				const isFast = cellReel.reelState.spinType === 'fast';
				const base = isFast ? SPIN_OPTIONS_FAST : SPIN_OPTIONS_DEFAULT;
				const override = deps.spinProfile?.(isFast ? 'fast' : 'normal');
				return override ? { ...base, ...override } : base;
			};
			return { reel, row, cellReel };
		}),
	);

	const cellAt = (reel: number, row: number) => cells[reel]?.[row];

	/**
	 * Spin the given cells and resolve when every one has landed. Columns stop left to right: each
	 * column's cells roll for the padding the previous spinning column rolled plus their own, the
	 * same accumulation the base board staggers its reels with. Turbo lands every cell at once, as
	 * it does on the base board.
	 *
	 * NOT raced against the slam token, and it does not need to be: a slam lands every reel that has
	 * not started rolling and interrupts every one that has (`createReelForSpinning`), so the spin
	 * still settles on its own — and it must, because a held cell is only correct once its reel has
	 * actually stopped on the symbol the server named.
	 */
	const spin = async ({
		spins,
		padding,
	}: {
		spins: RespinSpin[];
		/** The strip a column's cells roll through (the config's respin strip). Empty ⇒ the blank. */
		padding: (reel: number) => RawSymbol[];
	}) => {
		const spinType = stateBet.isTurbo ? 'fast' : 'normal';
		const columns = spins
			.map((spin) => spin.order)
			.filter((order, index, orders) => orders.indexOf(order) === index)
			.sort((a, b) => a - b);
		let previousPaddingSize = 0;
		for (const column of columns) {
			let columnPadding = previousPaddingSize;
			for (const target of spins.filter((spin) => spin.order === column)) {
				const cell = cellAt(target.reel, target.row);
				if (!cell) continue;
				const rolled = padding(target.reel);
				const paddingReel = rolled.length > 0 ? rolled : [blankSymbol()];
				const paddingPosition = Math.floor(Math.random() * paddingReel.length);
				columnPadding = cell.cellReel.prepareToSpin({
					noStop: false,
					spinType,
					symbols: [
						paddingReel[(paddingPosition + paddingReel.length - 1) % paddingReel.length],
						target.symbol,
						paddingReel[(paddingPosition + 1) % paddingReel.length],
					],
					paddingPosition,
					paddingReel,
					onSpinFinishing: () => cell.cellReel.onReelStopping(),
					previousPaddingSize,
				});
			}
			previousPaddingSize = columnPadding;
		}
		await Promise.all(
			spins.map(async (target) => {
				await cellAt(target.reel, target.row)?.cellReel.spin();
			}),
		);
	};

	/** Land every rolling cell now — the slam. */
	const stop = () => cells.forEach((column) => column.forEach((cell) => cell.cellReel.stop()));

	/** Put one cell at rest on `symbol`, with no roll — a released cell going back to the blank. */
	const settleCell = (reel: number, row: number, symbol: RawSymbol) =>
		cellAt(reel, row)?.cellReel.setSymbolsWithRawSymbols(strip(symbol));

	/** Put the whole board at rest on `board` (`[reel][row]`), with no roll — a mount or a resume. */
	const settle = (board: RawSymbol[][]) =>
		cells.forEach((column) =>
			column.forEach((cell) =>
				settleCell(cell.reel, cell.row, board[cell.reel]?.[cell.row] ?? blankSymbol()),
			),
		);

	return { reels: deps.reels, rows: deps.rows, cells, cellAt, spin, stop, settle, settleCell };
}

export type RespinBoard = ReturnType<typeof createRespinBoard>;
export type RespinBoardCell = RespinBoard['cells'][number][number];
