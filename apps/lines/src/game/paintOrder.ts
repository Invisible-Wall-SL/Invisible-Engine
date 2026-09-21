/**
 * WHO DRAWS OVER WHOM ON THE BOARD — the one statement of it, so the rule can be tested without a
 * renderer (`scripts/verify-board-paint-order.mjs`) rather than only observed in a browser.
 *
 * It exists because `pixi-svelte` adds a child to its parent once, inside `onMount`, and nothing
 * ever re-derives the order (`packages/pixi-svelte/src/lib/context.svelte.ts`). A component's markup
 * order therefore fixes the stacking of the children that mount TOGETHER and nothing else: anything
 * that unmounts and remounts is appended to the END of its parent and paints over every sibling
 * until the parent itself is rebuilt. A cascade does that on every step — `combineTumbleReel`
 * splices the step's refills ABOVE the survivors as NEW cells — so the refilled top rows drew over
 * the board beneath them. Measured on a live board by reading the container's real child order off
 * `globalThis.__PIXI_APP__`.
 *
 * A `zIndex` fixes it where it breaks: PixiJS v8 sorts a parent as soon as a child carries a
 * non-zero one, so order follows the SEAT however late the cell arrived.
 */

/**
 * The ceiling the whole board stays under.
 *
 * Symbols occupy a band STRICTLY between the board container's two existing neighbours: the ground
 * layers at Pixi's default `0` (`BoardMask`, `BoardTiles`) and `BookVfx`'s foreground at `+1`.
 * `BookVfx`'s background at `-1` is below both, unchanged, and `StackedPicture` states its own
 * `0.75` above the band. Both branches below divide INTO this band rather than clamping into it, so
 * no board size can climb over `BookVfx` and no two cells are forced into a tie at the ceiling.
 */
export const SYMBOL_Z_MAX = 0.5;

/**
 * A row index squashed into `[0.5, 1)`, strictly increasing and with NO upper bound to get wrong.
 *
 * That unboundedness is load-bearing, not defensive. A cell's row is its index in
 * `reelState.symbols`, which is the RESTING strip only while the reel is at rest: mid-roll
 * `addPadding` replaces it with `[...targetSymbols, ...paddingSymbols, ...prevSymbols]` and
 * renumbers every cell, and the padding ACCUMULATES per reel to make the left-to-right stagger
 * (`createReelForSpinning`). A plain 5×3 board therefore runs columns 16 cells deep on reel 0 and 40
 * deep on reel 4 for the whole spin. Any fixed "rows per column" budget is blown by that, and the
 * cost is not a tie that falls back to mount order — it is one column's ranks spilling into the
 * next column's range and ordering the board WRONG, on every spin, on every board.
 *
 * `1 - 1/(row + 3)` has no budget to blow. `-1` (the padding row above the window) maps to `0.5` and
 * every deeper row crowds toward 1 without reaching it, so one column's whole strip always fits
 * strictly inside one unit interval. The gaps shrink quadratically with depth (~1/row²) and stay far
 * above double precision at these magnitudes.
 */
export const depthOf = (row: number): number => 1 - 1 / (row + 3);

/**
 * This cell's place in the board container's paint order.
 *
 * The ordering KEY is whichever order the board is meant to read in — the same branch `BoardBase`
 * makes for its markup, for the same reason:
 *
 * - PERSPECTIVE ⇒ row-major by SEAT ROW, so a front-row character paints over the row behind it.
 *   The seat row (not the raw row index) is what folds in a stepped column's fractional offset, so a
 *   3-row column centred in a 4-row box interleaves with its neighbours instead of stacking as a
 *   block.
 * - FLAT ⇒ column-major, which is exactly the order `BoardBase` mounts a flat board in. A flat board
 *   that has not drifted therefore draws exactly as it always did; what changes is that it can no
 *   longer drift.
 *
 * KNOWN BOUND, stated rather than papered over: under perspective the key is the seat row, so while
 * a reel is actually ROLLING its cells rank by strip index and sort above the settled columns. A
 * perspective board is not meant to roll — that is what `swapInPlace` is for, and perspective
 * spinning reels are out of scope — but a doc may author one, and this is what it would look like.
 */
export const symbolZIndex = (args: {
	/** Column index. */
	reelIndex: number;
	/** Index in the (padded) strip — `-1` is the buffer row above the visible window. */
	rowIndex: number;
	/** `rowIndex` plus a stepped column's fractional offset. Only read under perspective. */
	seatRow: number;
	perspective: boolean;
	/** Columns on the board — the divisor that keeps a flat board inside the band. */
	reels: number;
}): number => {
	if (args.perspective) return SYMBOL_Z_MAX * depthOf(args.seatRow);
	return (SYMBOL_Z_MAX * (args.reelIndex + depthOf(args.rowIndex))) / (Math.max(1, args.reels) + 1);
};
