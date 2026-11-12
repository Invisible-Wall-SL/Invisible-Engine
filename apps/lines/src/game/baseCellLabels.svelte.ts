import { Tween } from 'svelte/motion';
import type { Position, RawSymbol } from 'engine-game';

import { stateGame } from './stateGame.svelte';

type BaseCellLabel = { rawSymbol: RawSymbol; tween: Tween<number> };

/**
 * A count-up on a BASE board cell's value label — a base-game collect's collectors climbing as each
 * coin lands in them (the collector game where every collector takes every coin's full value), by
 * PADDED reel row (`ReelSymbol`'s `row`). Each one is tied to the symbol it was started on, so it
 * reads only while that cell still holds it: the next spin deals new symbols and the cell prints its
 * own value again. Empty for every other game, whose cells therefore read exactly as before.
 */
let labels = $state.raw<Record<string, BaseCellLabel>>({});

const keyOf = (reel: number, paddedRow: number) => `${reel}:${paddedRow}`;

/**
 * Start a count-up on each of these base cells (visible rows) at `from`, replacing any earlier
 * collect's; a cell with no symbol on the board gets no tween. The caller moves each with `set`.
 */
export const holdBaseCellLabels = (
	cells: readonly (Position & { from: number })[],
): (Tween<number> | undefined)[] => {
	const next: Record<string, BaseCellLabel> = {};
	const tweens = cells.map(({ reel, row, from }) => {
		const symbol = stateGame.board[reel]?.reelState.symbols[row + 1];
		if (!symbol) return undefined;
		const tween = new Tween(from);
		next[keyOf(reel, row + 1)] = { rawSymbol: symbol.rawSymbol, tween };
		return tween;
	});
	labels = next;
	return tweens;
};

/** What a base cell's label reads instead of `rawSymbol`'s own value, while a count-up holds it. */
export const baseCellLabel = (
	reel: number,
	paddedRow: number,
	rawSymbol: RawSymbol,
): Pick<RawSymbol, 'value'> | undefined => {
	const label = labels[keyOf(reel, paddedRow)];
	return label && label.rawSymbol === rawSymbol ? { value: label.tween.current } : undefined;
};
