<script lang="ts">
	/**
	 * The SHARED resizable-sidebar handles for the editor-family tools (Scene
	 * Editor, Component Editor): two draggable vertical separators that resize the
	 * left/right panels of a `grid-template-columns: {left}px 1fr {right}px`
	 * layout, persisting the widths to localStorage under `storageKey`. One
	 * implementation — handle look, drag behaviour and persistence — inherited by
	 * every tool that mounts it, so a change here propagates to all of them.
	 *
	 * The PARENT owns the bound `leftWidth`/`rightWidth`/`resizing` state and
	 * applies them (grid columns + a `resizing` class that sets the col-resize
	 * cursor and disables canvas pointer events); this component owns the drag,
	 * the clamping, and the persistence. Mount it INSIDE the `position: relative`
	 * grid container, AFTER the panels (the handles overlay the panel edges).
	 */
	interface Props {
		/** localStorage key for the persisted widths (per tool, e.g. per-project). */
		storageKey: string;
		leftWidth: number;
		rightWidth: number;
		resizing: 'left' | 'right' | null;
		leftMin?: number;
		leftMax?: number;
		rightMin?: number;
		rightMax?: number;
	}
	let {
		storageKey,
		leftWidth = $bindable(),
		rightWidth = $bindable(),
		resizing = $bindable(),
		leftMin = 200,
		leftMax = 560,
		rightMin = 220,
		rightMax = 640,
	}: Props = $props();

	const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

	// Restore persisted widths once at init (synchronous, so the first paint uses
	// them — no visible jump). Corrupt/absent prefs keep the parent's defaults.
	let loaded = false;
	if (typeof localStorage !== 'undefined') {
		try {
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const s = JSON.parse(raw) as { leftWidth?: number; rightWidth?: number };
				if (typeof s.leftWidth === 'number') leftWidth = clamp(s.leftWidth, leftMin, leftMax);
				if (typeof s.rightWidth === 'number') rightWidth = clamp(s.rightWidth, rightMin, rightMax);
			}
		} catch {
			/* corrupt prefs — ignore */
		}
	}
	loaded = true;

	$effect(() => {
		const snapshot = JSON.stringify({ leftWidth, rightWidth });
		if (!loaded || typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(storageKey, snapshot);
		} catch {
			/* quota / disabled — ignore */
		}
	});

	/** Drag a panel edge. Listeners live on `window` so the drag tracks even over
	 * the canvas; the parent's `resizing` class disables canvas pointer events. */
	function beginResize(e: PointerEvent, side: 'left' | 'right'): void {
		e.preventDefault();
		resizing = side;
		const startX = e.clientX;
		const startLeft = leftWidth;
		const startRight = rightWidth;
		const onMove = (ev: PointerEvent): void => {
			const dx = ev.clientX - startX;
			if (side === 'left') leftWidth = clamp(startLeft + dx, leftMin, leftMax);
			else rightWidth = clamp(startRight - dx, rightMin, rightMax);
		};
		const onUp = (): void => {
			resizing = null;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

<div
	class="resizer resizer-l"
	class:active={resizing !== null}
	style="left: {leftWidth}px"
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize left panel"
	onpointerdown={(e) => beginResize(e, 'left')}
></div>
<div
	class="resizer resizer-r"
	class:active={resizing !== null}
	style="right: {rightWidth}px"
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize right panel"
	onpointerdown={(e) => beginResize(e, 'right')}
></div>

<style>
	.resizer {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 8px;
		z-index: 20;
		cursor: col-resize;
		touch-action: none;
	}
	.resizer-l {
		transform: translateX(-50%);
	}
	.resizer-r {
		transform: translateX(50%);
	}
	.resizer:hover,
	.resizer.active {
		background: rgba(123, 140, 255, 0.28);
	}
</style>
