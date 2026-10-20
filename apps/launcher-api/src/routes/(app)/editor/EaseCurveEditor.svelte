<script lang="ts">
	/**
	 * Linear / Cubic for an `ease` value, with the curve editor (two draggable handles) and the typed
	 * `x1, y1, x2, y2` field — the same widget, geometry and parsing as the Timeline's Interpolation
	 * panel (Rive plan Phase 9b, `$lib/timeline/timeline.js`), for the state machine's transition
	 * blend (Phase 9c). A blend has no Hold: a stepped mix is a blend of 0.
	 */
	import { DEFAULT_CUBIC, cubicText, parseCubic } from '$lib/timeline/easeCurve';

	type Cubic = [number, number, number, number];
	interface Props {
		/** The cubic, or `undefined` for linear. */
		value: Cubic | undefined;
		/** `live`: a handle mid-drag (the host may skip its heavier work until the release). */
		onChange: (value: Cubic | null, live: boolean) => void;
	}
	let { value, onChange }: Props = $props();

	/** x 0..1 → 20..140, y 0..1 → 160..40: room to overshoot both ways. */
	const CURVE = { x0: 20, w: 120, y0: 160, h: 120, vw: 160, vh: 200 };
	const cx = (x: number): number => CURVE.x0 + CURVE.w * x;
	const cy = (y: number): number => CURVE.y0 - CURVE.h * y;
	const n3 = (n: number): number => +n.toFixed(3);

	/** The curve while a handle is dragged (the prop follows on each `onChange`). */
	let dragging = $state<Cubic | null>(null);
	const c = $derived<Cubic>(dragging ?? value ?? DEFAULT_CUBIC);
	const p = (x: number, y: number): string => `${cx(x).toFixed(1)},${cy(y).toFixed(1)}`;

	let svg: SVGSVGElement | undefined = $state();
	function grab(e: PointerEvent, which: 0 | 2): void {
		e.preventDefault();
		const handle = e.currentTarget as SVGCircleElement;
		handle.setPointerCapture(e.pointerId);
		const next: Cubic = [...c];
		let moved = false;
		const move = (ev: PointerEvent): void => {
			if (!svg) return;
			const r = svg.getBoundingClientRect();
			const sx = ((ev.clientX - r.left) / r.width) * CURVE.vw;
			const sy = ((ev.clientY - r.top) / r.height) * CURVE.vh;
			next[which] = n3(Math.min(Math.max((sx - CURVE.x0) / CURVE.w, 0), 1));
			next[which + 1] = n3(
				Math.min(
					Math.max((CURVE.y0 - sy) / CURVE.h, -(CURVE.vh - CURVE.y0) / CURVE.h),
					CURVE.y0 / CURVE.h,
				),
			);
			moved = true;
			dragging = [...next];
			onChange([...next], true);
		};
		const up = (): void => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
			dragging = null;
			if (moved) onChange([...next], false);
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
	}
</script>

<div class="kinds">
	<button
		type="button"
		class:on={!value}
		title="An even mix over the blend"
		onclick={() => value && onChange(null, false)}>Linear</button
	>
	<button
		type="button"
		class:on={!!value}
		title="A curve with two handles"
		onclick={() => !value && onChange([...DEFAULT_CUBIC], false)}>Cubic</button
	>
</div>
{#if value}
	<svg
		bind:this={svg}
		class="curve"
		viewBox="0 0 {CURVE.vw} {CURVE.vh}"
		width={CURVE.vw}
		height={CURVE.vh}
		role="img"
		aria-label="Cubic curve {cubicText(c)}"
	>
		<rect x={CURVE.x0} y={cy(1)} width={CURVE.w} height={CURVE.h} class="box" />
		<line class="arm" x1={cx(0)} y1={cy(0)} x2={cx(c[0])} y2={cy(c[1])} />
		<line class="arm" x1={cx(1)} y1={cy(1)} x2={cx(c[2])} y2={cy(c[3])} />
		<path class="path" d="M{p(0, 0)} C{p(c[0], c[1])} {p(c[2], c[3])} {p(1, 1)}" />
		<circle
			class="handle"
			cx={cx(c[0])}
			cy={cy(c[1])}
			r="6"
			role="slider"
			aria-label="First handle"
			aria-valuenow={c[0]}
			tabindex="-1"
			onpointerdown={(e) => grab(e, 0)}
		/>
		<circle
			class="handle"
			cx={cx(c[2])}
			cy={cy(c[3])}
			r="6"
			role="slider"
			aria-label="Second handle"
			aria-valuenow={c[2]}
			tabindex="-1"
			onpointerdown={(e) => grab(e, 2)}
		/>
	</svg>
	<label class="typed">
		<span>x1, y1, x2, y2</span>
		<input
			type="text"
			spellcheck="false"
			title="The cubic-bezier's two handles: x in 0..1, y may overshoot"
			value={cubicText(c)}
			onchange={(e) => {
				const parsed = parseCubic(e.currentTarget.value);
				if (parsed) onChange(parsed, false);
				else e.currentTarget.value = cubicText(c);
			}}
		/>
	</label>
{/if}

<style>
	.kinds {
		display: flex;
		gap: 4px;
		margin: 4px 0;
	}
	.kinds button.on {
		border-color: var(--accent, #6aa7ff);
		color: var(--accent, #6aa7ff);
	}
	.curve {
		display: block;
		touch-action: none;
	}
	.box {
		fill: rgba(255, 255, 255, 0.03);
		stroke: var(--line, #2a2f3a);
	}
	.arm {
		stroke: #8a93a6;
		stroke-width: 1;
	}
	.path {
		fill: none;
		stroke: var(--accent, #6aa7ff);
		stroke-width: 2;
	}
	.handle {
		fill: #fff;
		stroke: var(--accent, #6aa7ff);
		stroke-width: 2;
		cursor: grab;
	}
	.typed {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11px;
	}
</style>
