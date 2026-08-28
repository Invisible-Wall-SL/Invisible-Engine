/**
 * The pan/zoom arithmetic behind a preview VIEWPORT — a positioned square pane inside a clipping
 * window, zoomed by redrawing at a new pixel size rather than by a CSS scale.
 *
 * Dependency-free, for the `pickSheets.ts` / `boundsFit.ts` reason: this app's `build` is a bare
 * `vite build` that strips types without checking them, so a green build proves nothing about
 * geometry. Pinned by `panZoom.fixture.ts`.
 *
 * **Why the pane's SIZE and not a CSS transform.** The bounds-box overlay lives inside the pane and
 * is positioned in the pane's own pixels; a CSS `scale` on an ancestor would silently multiply
 * every one of those numbers and every pointer offset a drag reads, so the box would drift from its
 * art at any zoom but 100%. Redrawing the thumbnail at the zoomed size keeps the pane unscaled —
 * `boxFit` needs no zoom term, `BoundsBox` needs no change, and the canvas is sharp instead of
 * upscaled.
 *
 * **Why a cap.** A thumbnail is a real bitmap; zoom without a ceiling is one allocation away from
 * taking a browser tab down.
 */

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 8;
/** Hard ceiling on the redrawn thumbnail, in pixels per side. */
export const SIZE_MAX = 4096;
/** Floor, so a tiny viewport still shows something grabbable. */
export const SIZE_MIN = 48;

export interface PanZoom {
	zoom: number;
	/** The pane's top-left inside the viewport, in viewport pixels. */
	x: number;
	y: number;
}

export const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** The pane's pixel size at a given zoom, against the size that fits the viewport at 100%. */
export function paneSize(fitSize: number, zoom: number): number {
	return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(fitSize * clampZoom(zoom))));
}

/**
 * Zoom about a point in VIEWPORT coordinates: whatever sits under `(cx, cy)` stays under it.
 *
 * Expressed as the ratio of the pane's size before and after, so it needs no art coordinates and
 * cannot disagree with the fit — the pane is the only thing that moves, and the art is painted
 * inside it. Clamping happens through {@link paneSize}, so a zoom pinned at the cap is a no-op
 * rather than a slow drift of the pane under a scrolling wheel.
 */
export function zoomAbout(
	current: PanZoom,
	fitSize: number,
	nextZoom: number,
	cx: number,
	cy: number,
): PanZoom {
	const z = clampZoom(nextZoom);
	const before = paneSize(fitSize, current.zoom);
	const after = paneSize(fitSize, z);
	if (after === before) return { ...current, zoom: z };
	const k = after / before;
	return { zoom: z, x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k };
}

/** The pane centred in a viewport of this size — what "Fit" and an untouched view both use. */
export function centrePane(viewW: number, viewH: number, size: number): { x: number; y: number } {
	return { x: Math.round((viewW - size) / 2), y: Math.round((viewH - size) / 2) };
}

/**
 * A viewport point → the pane's own pixels. The pane is never CSS-scaled, so this is a plain
 * translation — which is exactly the property that lets the bounds overlay keep working unchanged
 * at any zoom.
 */
export function toPane(view: PanZoom, cx: number, cy: number): { x: number; y: number } {
	return { x: cx - view.x, y: cy - view.y };
}
