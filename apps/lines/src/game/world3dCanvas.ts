/**
 * The 3D world's canvas, put on the page when the `arcade3d` seam loads — before the Pixi
 * application exists (`families/arcade3d.ts` calls {@link reserveWorld3dCanvas} at import, and
 * `+layout.ts` imports the seam before `<InitialiseApplication>` mounts).
 *
 * Why so early: `pixi-svelte` decides ONCE, when it creates its WebGL context, whether its canvas
 * may be opaque (`renderOptions.ts` `measurePageBackdrop`): only when the page under it is provably
 * one solid colour, i.e. nothing but the canvas's own ancestors is painted there. A context created
 * opaque has no alpha channel, so a world mounted later under it shows black. With this canvas in
 * place — fixed, full-window, under the page's content (`z-index: -1`) and hit-testable — the
 * existing rule finds an element that is not an ancestor under the Pixi canvas and answers
 * "transparent". No shared file changes, so the four 2D runtimes keep their bytes.
 *
 * It paints nothing until the play field mounts a world into it. The Pixi canvas covers it, so it
 * never receives a pointer event itself; the stage forwards what the HUD does not take.
 */

let reserved: HTMLCanvasElement | undefined;

export function reserveWorld3dCanvas(): HTMLCanvasElement | undefined {
	if (typeof document === 'undefined') return undefined;
	if (reserved?.isConnected) return reserved;
	const canvas = document.createElement('canvas');
	canvas.dataset.ieWorld3d = '';
	Object.assign(canvas.style, {
		position: 'fixed',
		left: '0',
		top: '0',
		width: '100vw',
		height: '100vh',
		zIndex: '-1',
		display: 'block',
	});
	document.body.prepend(canvas);
	reserved = canvas;
	return canvas;
}

/** The reserved canvas as it is now (a world's `destroy()` swaps in a fresh copy). */
export const world3dCanvas = (): HTMLCanvasElement | undefined => {
	const found = document.querySelector<HTMLCanvasElement>('canvas[data-ie-world3d]');
	if (found) reserved = found;
	return found ?? reserveWorld3dCanvas();
};
