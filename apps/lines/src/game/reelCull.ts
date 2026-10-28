/**
 * Whether a reel cell whose CENTRE is at `y` is drawn in the window `[top, bottom]`.
 *
 * `margin` is how far past the window that centre may be: half a row while the reel rolls
 * (`rollingCullMargin` in `SymbolWrap.svelte`), so every cell that overlaps the window is drawn
 * and the mask clips it at the edge; `0` at rest, where only the cells seated inside the window
 * count. Strict with a margin, so the cells exactly a half row outside (a resting strip's padding
 * rows) stay undrawn.
 */
export const cellDrawn = (y: number, top: number, bottom: number, margin: number): boolean =>
	margin ? y > top - margin && y < bottom + margin : y >= top && y <= bottom;
