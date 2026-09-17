import { Tween } from 'svelte/motion';

import type { ReelSymbol } from 'engine-game';
import type { ReelSymbolCascadeSeat } from 'utils-slots';

import { combineTumbleReel } from './tumbleBoardLayout';

/**
 * Cascade (tumble) board state — which of the board's cells the cascade is currently driving.
 *
 * It holds the board's OWN cells, not copies of them. The overlay used to clone the standing board
 * into a parallel set of components, and that clone is what made every symbol restart its clip the
 * moment the board changed hands — board-wide, twice per board change, whether or not anything about
 * the symbol had changed (`docs/design/board-cell-continuity.md`). One cell, one component, drawn by
 * `BoardBase` whoever is driving it.
 *
 * What stays the cascade's own is the MOTION model: a settled reel is a strip addressed by one
 * scroll offset, and a cascade positions each symbol individually — winners pop out, survivors fall
 * into the gaps, replacements drop in from above. That is what `ReelSymbolCascadeSeat` is, and it is
 * attached only for the length of a step. The strip, the roll and the pre-spin are untouched.
 *
 * Lives in `apps/lines` rather than `engine-game` because `apps/lines` IS the shared runtime bundle
 * (`_runtime/lines`), and because the mechanic components it feeds depend on the game's own symbol
 * renderer (`Symbol`/`SymbolWrap`), which is one of the Phase A slices still to be extracted. The
 * Book-of mechanic sits here for the same reason — see `SpecialBook.svelte`.
 */

/** A board cell with the cascade's seat attached — every cell in {@link stateTumble} has one, which
 *  is what lets the steps below drive a y without asking whether there is one to drive. */
export type CascadingCell = ReelSymbol & { cascade: ReelSymbolCascadeSeat };

/**
 * Two layers, because a cascade always has both:
 *  - `base` — what is already on the board, minus whatever this step has swept out.
 *  - `adding` — the replacements queued ABOVE the board, waiting to fall in.
 *
 * They are kept apart rather than merged so a removal can filter the base without touching symbols
 * that have not landed yet, and so a symbol's index within its column is stable while it falls.
 *
 * `base` holds cells ADOPTED from the reels; `adding` holds cells minted through the reel's own
 * factory, so the board the step settles can be handed back as objects rather than rebuilt from raw
 * symbols. Filtering `base` is safe precisely because `BoardBase` keys by cell identity: a survivor
 * whose index shifts is MOVED, not re-created.
 */
export const stateTumble = $state({
	base: [] as CascadingCell[][],
	adding: [] as CascadingCell[][],
	/**
	 * Is the cascade DRIVING the board right now — i.e. does `BoardBase` read these two layers
	 * instead of the reel strips?
	 *
	 * Set by `tumbleBoardInit` and cleared by `tumbleBoardReset`, not by the overlay's show/hide:
	 * `tumbleBoardShow` only puts the overlay's transition layer on screen, and between it and the
	 * first init there is a frame where the layers are still empty and the reels are still the truth.
	 */
	active: false,
	/**
	 * How many symbol MOVEMENTS are in flight — the board mask's answer to the one question it needs
	 * before it may let art spill past the reel window.
	 *
	 * The reel board's own answer is meaningless during a cascade: `reelState.motion` and `rolling`
	 * are written only by a reel's spin loop, and a swap-in-place board never spins, so every reel
	 * reads "settled" for the whole step — mid-fall included.
	 *
	 * A COUNTER, not a boolean, because the beats overlap by design: `columnCascade` runs one drain +
	 * slide per column on independent staggered timers, so two columns are routinely moving at once
	 * and a boolean would be cleared by whichever finished first.
	 */
	transiting: 0,
});

/**
 * Hand a cell to the cascade: from here until the step ends, its y is the Tween rather than its
 * strip's scroll. Seeded at wherever the cell is sitting NOW, so attaching one moves nothing.
 */
export const attachCascadeSeat = (reelSymbol: ReelSymbol, y: number): CascadingCell => {
	reelSymbol.cascade = { y: new Tween(y) };
	return reelSymbol as CascadingCell;
};

/**
 * The two layers as one column-major board — see `combineTumbleReel`, which owns the rule and the
 * padding contract it turns on. The combined index is what each symbol's target seat is derived
 * from during the slide, what `BoardBase` seats it by, and what is broadcast as the settled board
 * once the cascade finishes.
 */
export const tumbleBoardCombined = (): CascadingCell[][] =>
	stateTumble.base.map((reel, reelIndex) =>
		combineTumbleReel(reel, stateTumble.adding[reelIndex] ?? []),
	);

/**
 * Hand cells back to their strips mid-step — the drain's column, the sweep's popped symbols, a
 * column whose survivors a scoped init has declared gone.
 *
 * Detaching the seat is the point: a cell the cascade has dropped is no longer in `stateTumble`, so
 * the reset at the end of the step will not find it, and a Tween left attached would pin it wherever
 * the step abandoned it for the rest of the round.
 */
export const releaseCascadeCells = (cells: CascadingCell[]) => {
	for (const reelSymbol of cells as ReelSymbol[]) reelSymbol.cascade = null;
};

/**
 * Drop both layers — the cascade is over and the reels take the board back.
 *
 * The seats are DETACHED rather than left to fall out of scope, because these are the board's own
 * cells: a Tween still attached would pin the symbol to wherever the step left it for the rest of
 * the round. `setSymbolsWithReelSymbols` detaches them too when the board is settled by adoption;
 * this is the path for a step that ends without one (a slam, a skipped round).
 */
export const resetTumbleBoard = () => {
	const driven: ReelSymbol[] = [...stateTumble.base, ...stateTumble.adding].flat();
	for (const reelSymbol of driven) reelSymbol.cascade = null;
	stateTumble.base = [];
	stateTumble.adding = [];
	stateTumble.active = false;
	stateTumble.transiting = 0;
};
