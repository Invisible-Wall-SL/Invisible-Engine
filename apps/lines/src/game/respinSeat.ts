import { expansionSeatRow } from 'game-config';

import { activeRespinRules } from './activeRespinMode.svelte';
import { boardDimensions } from './gameConfig';
import { cellSymbolLead, cellWindow, getSymbolSeat } from './stateGame.svelte';

/**
 * WHERE THE RESPIN BOARD SEATS A CELL. An expanding board opens rows `B…M-1` in DATA (B = the base
 * rows) — the wire, the reducer and a held cell keep that row — and draws them where the active
 * respin mode's `expansion.grow` says (`expansionSeatRow`): below the base rows, above them, or
 * alternating. Every respin-board seat goes through here — the cells' reels, tiles, locked cells,
 * held coins and the flights to and from a cell. A base row, and every row without a `grow`, is its
 * own seat: the SAME number reaches `getSymbolSeat`, so the base board and every game that sets no
 * `grow` seat exactly as before.
 */
export const respinSeatRow = (row: number): number => {
	const baseRows = boardDimensions().y;
	if (row < baseRows) return row;
	return expansionSeatRow(row, baseRows, activeRespinRules()?.expansion?.grow);
};

/** Cell `(reel, row)`'s seat on the respin board — {@link respinSeatRow} through `getSymbolSeat`. */
export const respinCellSeat = (reel: number, row: number) =>
	getSymbolSeat(reel, respinSeatRow(row));

/** Cell `(reel, row)`'s window on the respin board (what its one-cell reel's mask clips at). */
export const respinCellWindow = (reel: number, row: number) => cellWindow(reel, respinSeatRow(row));

/** The resting lead of the one-cell reel at `(reel, row)`, so its symbol rests on its seat. */
export const respinCellLead = (reel: number, row: number) =>
	cellSymbolLead(reel, respinSeatRow(row));

/**
 * The seat row of the respin board's TOP edge: `0`, or the highest row an expanding board opens
 * above its base rows — where the coded counter and dials stand clear of. `0` for every board that
 * does not grow above.
 */
export const respinTopSeatRow = (): number => {
	const expansion = activeRespinRules()?.expansion;
	const grow = expansion?.grow;
	if (!expansion || grow === undefined || grow === 'below') return 0;
	const baseRows = boardDimensions().y;
	let top = 0;
	for (let row = baseRows; row < expansion.maxRows; row += 1) {
		top = Math.min(top, expansionSeatRow(row, baseRows, grow));
	}
	return top;
};
