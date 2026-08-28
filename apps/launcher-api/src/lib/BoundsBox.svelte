<script lang="ts" module>
	/** A declared box in ART PIXELS, top-left relative to the art's origin (its centre) — the same
	 * shape as `engine-flipbook`'s `FlipbookBounds`, restated here so this component is usable for
	 * a sprite region's box too. */
	export interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
	}

	/** Art pixels → thumbnail pixels: the centred contain-fit the host already performed. Build it
	 * with `$lib/boundsFit`'s `boxFit`, never by hand — see the parenting rule on `stage` below. */
	export interface BoxFit {
		scale: number;
		originX: number;
		originY: number;
	}

	type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

	const HANDLES: Handle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
</script>

<script lang="ts">
	/**
	 * The draggable BOUNDS BOX — the launcher's twin of the Rigger's on-canvas size frame, shared
	 * by every surface that declares one (an Invisible Flipbook clip's box, a sprite region's box).
	 *
	 * Owns ONLY the overlay and the drag arithmetic; the host owns the art underneath, the fit that
	 * maps art pixels to stage pixels, and where the box is stored. That split is what keeps the two
	 * callers from growing two subtly different drags — the failure this repo has paid for whenever
	 * a second copy of a UI idiom appeared (see `docs/ui-inventory.md`).
	 *
	 * The host must position this inside an element with `position: relative` whose top-left is the
	 * origin `fit` is expressed against, and pass that element as `stage` so a drag can convert
	 * client coordinates back into art pixels.
	 *
	 * **That element is the THUMBNAIL, not the stage around it.** Both hosts centre a square
	 * thumbnail inside a larger stage, and parenting this to the stage put the box
	 * `(stageWidth − thumbnail) / 2` px away from the art it describes — 562px on a wide window —
	 * with every drag off by the same amount, because the drag measures against whatever it is
	 * handed. Both hosts now wrap the thumbnail and this overlay in ONE exactly-sized element.
	 * Pinned by `node apps/launcher-api/boundsFit.fixture.ts`.
	 */
	interface Props {
		bounds: Box;
		fit: BoxFit;
		/** The positioned host element the overlay sits in — the frame drags are measured against.
		 * Must be the exactly-thumbnail-sized wrapper, never the stage (see above). */
		stage: HTMLElement | null;
		onchange: (b: Box) => void;
		/** Accent colour, so a host can distinguish two kinds of box. Defaults to the brand teal. */
		color?: string;
	}

	let { bounds, fit, stage, onchange, color = '#7ee0c0' }: Props = $props();

	/**
	 * The box as it was when the pointer went down, plus that pointer position in ART pixels. Every
	 * move is computed from the ORIGINAL box rather than the last one, so a slow drag cannot
	 * accumulate rounding drift across dozens of pointer events.
	 */
	let drag: { handle: Handle; start: Box; from: { x: number; y: number } } | null = null;

	function artAt(e: PointerEvent): { x: number; y: number } | null {
		if (!stage) return null;
		const rect = stage.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left - fit.originX) / fit.scale,
			y: (e.clientY - rect.top - fit.originY) / fit.scale,
		};
	}

	function start(e: PointerEvent, handle: Handle): void {
		const from = artAt(e);
		if (!from) return;
		e.preventDefault();
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { handle, start: { ...bounds }, from };
	}

	function move(e: PointerEvent): void {
		const at = drag ? artAt(e) : null;
		if (!drag || !at) return;
		const s = drag.start;
		if (drag.handle === 'move') {
			onchange({ x: s.x + (at.x - drag.from.x), y: s.y + (at.y - drag.from.y), w: s.w, h: s.h });
			return;
		}
		let left = s.x;
		let top = s.y;
		let right = s.x + s.w;
		let bottom = s.y + s.h;
		if (drag.handle.includes('w')) left = at.x;
		if (drag.handle.includes('e')) right = at.x;
		if (drag.handle.includes('n')) top = at.y;
		if (drag.handle.includes('s')) bottom = at.y;
		// Normalised, so dragging an edge PAST its opposite flips the box instead of inverting it
		// into a negative size every consumer would then divide by.
		onchange({
			x: Math.min(left, right),
			y: Math.min(top, bottom),
			w: Math.max(1, Math.abs(right - left)),
			h: Math.max(1, Math.abs(bottom - top)),
		});
	}

	function end(e: PointerEvent): void {
		if (!drag) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		drag = null;
	}
</script>

<div
	class="box"
	role="presentation"
	style:left="{fit.originX + bounds.x * fit.scale}px"
	style:top="{fit.originY + bounds.y * fit.scale}px"
	style:width="{bounds.w * fit.scale}px"
	style:height="{bounds.h * fit.scale}px"
	style:--accent={color}
	onpointerdown={(e) => start(e, 'move')}
	onpointermove={move}
	onpointerup={end}
	onpointercancel={end}
>
	{#each HANDLES as h (h)}
		<span
			class="handle {h}"
			role="presentation"
			onpointerdown={(e) => start(e, h)}
			onpointermove={move}
			onpointerup={end}
			onpointercancel={end}
		></span>
	{/each}
</div>

<style>
	.box {
		position: absolute;
		box-sizing: border-box;
		border: 1px solid var(--accent);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		cursor: move;
		touch-action: none;
	}
	.handle {
		position: absolute;
		width: 9px;
		height: 9px;
		margin: -5px 0 0 -5px;
		border-radius: 50%;
		background: var(--accent);
		touch-action: none;
	}
	.handle.nw {
		left: 0;
		top: 0;
		cursor: nwse-resize;
	}
	.handle.n {
		left: 50%;
		top: 0;
		cursor: ns-resize;
	}
	.handle.ne {
		left: 100%;
		top: 0;
		cursor: nesw-resize;
	}
	.handle.w {
		left: 0;
		top: 50%;
		cursor: ew-resize;
	}
	.handle.e {
		left: 100%;
		top: 50%;
		cursor: ew-resize;
	}
	.handle.sw {
		left: 0;
		top: 100%;
		cursor: nesw-resize;
	}
	.handle.s {
		left: 50%;
		top: 100%;
		cursor: ns-resize;
	}
	.handle.se {
		left: 100%;
		top: 100%;
		cursor: nwse-resize;
	}
</style>
