import type { ElementFxEntry } from 'constants-shared/elementFx';
import {
	captureStill,
	isFxOverlayCanvas,
	playOnStill,
	stageSource,
} from '../editor/elementFxPreview.client.svelte';

/**
 * The ▶ on a symbol state's Element FX row: the effect plays over the panel's Preview of that symbol
 * and state. The previews are not Pixi (a 2D thumbnail, or the rig preview's own WebGL context), so
 * this is the Scene Editor's capture and overlay (`elementFxPreview.client.svelte.ts`): the preview's
 * canvas is copied into a still, the canvas hides, and the game's runtime plays the effect on the
 * still in a Pixi overlay above it. Nothing else is hidden first: the preview shows only the symbol.
 * A playing rig freezes for the preview; Escape or a press on the preview stops it.
 */

/** How far the overlay reaches past the preview, as a share of its larger side, so what an effect
 *  draws past the symbol's box (a glow, a melt's drips, a crash's shards) shows that far. */
const REACH = 0.6;
/** Above the panel fields the overlay reaches over. */
const OVERLAY_Z = 3;

export interface SymbolFxPreview {
	/** The preview's box (positioned): the overlay is mounted in it. */
	box: HTMLElement;
	/** The canvas the preview draws the symbol on. */
	canvas: HTMLCanvasElement;
	entry: ElementFxEntry;
	/** The canvas's pixels as drawn now; null when they cannot be read. A WebGL canvas that does not
	 *  preserve its drawing buffer has to be copied in its own frame (`SymbolRigPreview.snapshot`). */
	copy: () => Promise<HTMLCanvasElement | null>;
	/** Read every frame: the preview no longer shows what was captured. */
	stale: () => boolean;
	/** The preview ended, however it ended; never before {@link playOnPreview} returns. */
	finished: () => void;
}

/** The canvas the preview in `box` draws on (not an overlay's), or null when it shows none. */
export function previewCanvas(box: HTMLElement | null): HTMLCanvasElement | null {
	if (!box) return null;
	for (const canvas of box.querySelectorAll('canvas')) {
		if (!isFxOverlayCanvas(canvas)) return canvas;
	}
	return null;
}

/** Play `options.entry` over the preview; the returned function stops it at once. */
export function playOnPreview(options: SymbolFxPreview): () => void {
	const { box, canvas } = options;
	const visibility = canvas.style.visibility;
	let over = false;
	let stopOverlay: (() => void) | null = null;
	let mount: HTMLElement | null = null;

	const onKey = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		stop();
	};
	const close = (): void => {
		window.removeEventListener('keydown', onKey, true);
		box.removeEventListener('pointerdown', stop, true);
		mount?.remove();
		canvas.style.visibility = visibility;
		options.finished();
	};
	const stop = (): void => {
		if (over) return;
		over = true;
		stopOverlay?.();
		close();
	};
	window.addEventListener('keydown', onKey, true);
	box.addEventListener('pointerdown', stop, true);

	void options.copy().then((pixels) => {
		if (over) return;
		const frame = box.getBoundingClientRect();
		const origin = new DOMRect(
			frame.left + box.clientLeft,
			frame.top + box.clientTop,
			box.clientWidth,
			box.clientHeight,
		);
		const at = stageSource(canvas, origin);
		if (!pixels || !at) return stop();
		const w = canvas.width / at.scaleX;
		const h = canvas.height / at.scaleY;
		const still = captureStill(
			[{ ...at, canvas: pixels }],
			{ x: at.x, y: at.y, w, h },
			window.devicePixelRatio || 1,
		);
		if (!still) return stop();
		const reach = Math.round(REACH * Math.max(w, h));
		mount = document.createElement('div');
		mount.style.cssText =
			`position:absolute;left:${-reach}px;top:${-reach}px;pointer-events:none;z-index:${OVERLAY_Z};` +
			`width:${origin.width + 2 * reach}px;height:${origin.height + 2 * reach}px`;
		box.appendChild(mount);
		stopOverlay = playOnStill({
			mount,
			still,
			rect: { x: at.x + reach, y: at.y + reach, w, h },
			element: { x: 0, y: 0, w, h },
			entry: options.entry,
			onShown: () => {
				canvas.style.visibility = 'hidden';
			},
			onEnd: () => {
				if (over) return;
				over = true;
				close();
			},
			stale: () => !canvas.isConnected || options.stale(),
		});
	});
	return stop;
}
