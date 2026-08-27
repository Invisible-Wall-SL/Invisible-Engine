/**
 * The Symbols State-Machine stage's screen geometry, as pure functions.
 *
 * WHY THIS IS A MODULE. The stage draws rigs into a raw-WebGL canvas and their bound FX into a
 * SEPARATE Pixi canvas laid over it. Those two only line up if both use the same width — and for
 * months they did not: the backing store and the mirror axis came from the scroll container's
 * `clientWidth` (short by a scrollbar) while the canvas was displayed across the full `.grid-area`
 * width. Everything drawn was stretched ~1.7% to the right, growing with x, and the FX overlay was
 * not, so a burst pulled away from its symbol the further right it sat.
 *
 * The bug was invisible because the relationship lived inline in a `requestAnimationFrame` callback
 * inside a Svelte component, where nothing could assert it. Here it can:
 * `scripts/check-symbol-stage-geometry.ts` holds `boneScreenX` (where we TELL the overlay the bone
 * is) against `drawnScreenX` (where the browser actually paints it), across a sweep of scrollbar
 * widths and device pixel ratios.
 */

/** The one box every number on this stage is derived from: the canvas's OWN CSS box. */
export interface StageGeometry {
	/** CSS px the canvas is displayed across. */
	cssWidth: number;
	cssHeight: number;
	/** Backing-store size — must be this box × dpr, or the browser rescales everything we draw. */
	backingWidth: number;
	backingHeight: number;
	dpr: number;
}

/**
 * Derive the stage geometry from the canvas's own layout box.
 *
 * MUST be the canvas, never a scrolling ancestor: a `clientWidth` that excludes a scrollbar
 * produces a backing store narrower than the box it is painted across, and the browser stretches
 * the difference across everything drawn.
 */
export function stageGeometry(
	box: { clientWidth: number; clientHeight: number },
	dpr: number,
): StageGeometry {
	const cssWidth = box.clientWidth;
	const cssHeight = box.clientHeight;
	return {
		cssWidth,
		cssHeight,
		backingWidth: Math.floor(cssWidth * dpr),
		backingHeight: Math.floor(cssHeight * dpr),
		dpr,
	};
}

/**
 * The stage camera has `up = (0,-1,0)`, which mirrors X about the viewport centre. `drawCell`
 * compensates by placing the skeleton origin at `mirror(x)` with a negative `scaleX`, and the FX
 * projection undoes the same mirror — so both must mirror about the SAME axis, which is the width
 * the canvas is displayed across.
 */
export const mirrorX = (geo: StageGeometry, x: number): number => geo.cssWidth - x;

/**
 * Where we TELL the FX overlay a bone is, in CSS px from the canvas's left edge. The overlay is its
 * own correctly-sized Pixi canvas over the same box, so this is taken at face value.
 */
export const boneScreenX = (geo: StageGeometry, worldX: number): number => mirrorX(geo, worldX);

/**
 * Where the browser ACTUALLY paints that bone, in CSS px — the ground truth `boneScreenX` has to
 * match.
 *
 * Two steps the stage cannot skip: the camera maps world→backing px across its own visible width
 * (`backingWidth / dpr`, which is the floor of the CSS width and so may be a hair short), and the
 * browser then scales the backing store onto the CSS box. When the backing store was derived from a
 * DIFFERENT width than the box, that second step is where the drift came from.
 */
export function drawnScreenX(geo: StageGeometry, worldX: number): number {
	const visibleWorldWidth = geo.backingWidth / geo.dpr; // what the camera actually spans
	const backingX = (visibleWorldWidth - worldX) * geo.dpr; // camera mirror, in backing px
	return (backingX / geo.backingWidth) * geo.cssWidth; // browser scales backing → CSS box
}

/**
 * `drawCell`'s horizontal placement: the skeleton origin that puts the art's centre at the cell's
 * centre, already mirrored for the camera. `artCentreX` is the fit-scaled centre of the rig's
 * measured bounds. Exported so the gate drives the REAL formula rather than a copy of it.
 */
export function cellSkeletonX(
	geo: StageGeometry,
	cellX: number,
	cellWidth: number,
	fitScale: number,
	artCentreX: number,
): number {
	const preX = cellX + cellWidth / 2 - fitScale * artCentreX;
	return mirrorX(geo, preX);
}
