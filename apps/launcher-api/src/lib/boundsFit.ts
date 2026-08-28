/**
 * The art→screen mapping every BOUNDS BOX surface shares — `/flipbook`'s clip box and the Scene
 * Editor's region box (`$lib/BoundsBox.svelte` consumes the result).
 *
 * Dependency-free on purpose, for the `pickSheets.ts` reason: this app's `build` is a bare
 * `vite build` that strips types without checking them, so a green build proves nothing about
 * geometry. Kept importable by an offline fixture instead.
 *
 * **The invariant this exists to protect.** The numbers below are expressed against the
 * THUMBNAIL's own box — an element of exactly `size × size` — and are only correct if the overlay
 * is positioned inside that element and pointer positions are measured against it. Both surfaces
 * draw the thumbnail inside a larger centring stage, and positioning the overlay against the STAGE
 * instead put it `(stageWidth − size) / 2` px away from the art it was describing, with every drag
 * inheriting the same offset. That shipped once: 562px of drift on a wide window, which reads as
 * "the box is somewhere else entirely and I can't place it". Hence one function, one contract, and
 * `boundsFit.fixture.ts` asserting both halves.
 */

export interface FitBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface BoxFit {
	/** Art pixels → screen pixels. */
	scale: number;
	/** Screen x of art x = 0, relative to the THUMBNAIL's top-left. */
	originX: number;
	originY: number;
}

/**
 * The centred contain-fit of `view` into a `size × size` thumbnail — the same fit `RegionThumb`
 * performs on the box it is given, so an overlay built from this lands exactly on the art.
 *
 * `null` for a degenerate view or size: there is no meaningful mapping, and every caller would
 * otherwise divide by zero.
 */
export function boxFit(size: number, view: FitBox | undefined | null): BoxFit | null {
	if (!view || !(view.w > 0) || !(view.h > 0) || !(size > 0)) return null;
	const scale = Math.min(size / view.w, size / view.h);
	return {
		scale,
		originX: (size - view.w * scale) / 2 - view.x * scale,
		originY: (size - view.h * scale) / 2 - view.y * scale,
	};
}

/**
 * Where a box lands on screen, relative to the thumbnail's top-left — what the overlay's `left`,
 * `top`, `width`, `height` are set to, and what a fixture can compare against the art.
 */
export function boxRect(
	fit: BoxFit,
	box: FitBox,
): { left: number; top: number; width: number; height: number } {
	return {
		left: fit.originX + box.x * fit.scale,
		top: fit.originY + box.y * fit.scale,
		width: box.w * fit.scale,
		height: box.h * fit.scale,
	};
}

/**
 * A pointer position (relative to the thumbnail's top-left) back to ART pixels — the inverse of
 * {@link boxRect}, and what a drag reads. Round-tripping these two is the whole correctness
 * condition for dragging a box.
 */
export function artAtOffset(
	fit: BoxFit,
	offsetX: number,
	offsetY: number,
): { x: number; y: number } {
	return { x: (offsetX - fit.originX) / fit.scale, y: (offsetY - fit.originY) / fit.scale };
}
