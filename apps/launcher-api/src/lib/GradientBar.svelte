<script lang="ts">
	/** Photoshop-style gradient editor: a ramp with draggable colour stops.
	 *
	 * Click the rail under the bar to add a stop (it inherits the colour the ramp already
	 * shows there), drag a stop to move it, drag it away from the rail — or press Delete —
	 * to remove it. The small diamond between two stops is Photoshop's midpoint: where the
	 * 50/50 blend lands. Each stop carries its own opacity, so the bar sits on a chequer.
	 *
	 * The ramp is horizontal; `startLabel`/`endLabel` name what its ends mean in the
	 * caller's space (the Font Maker maps left→right onto the glyph top→bottom).
	 */
	import ColorField from '$lib/ColorField.svelte';
	import {
		cssGradient,
		reverseStops,
		sortStops,
		stopAt,
		stopCss,
		type GradientStop,
	} from '$lib/gradient';

	interface Props {
		/** The ramp, two-way bound. Never left with fewer than two stops. */
		stops: GradientStop[];
		startLabel?: string;
		endLabel?: string;
		disabled?: boolean;
	}

	let {
		stops = $bindable(),
		startLabel = 'Start',
		endLabel = 'End',
		disabled = false,
	}: Props = $props();

	/** Drop distance (px) below the rail at which a dragged stop is discarded. */
	const DROP_AWAY = 30;
	const MIN_STOPS = 2;
	const MID_MIN = 0.05;
	const MID_MAX = 0.95;

	let railEl: HTMLDivElement | undefined = $state();
	let selected = $state(0);
	/** Set while a drag has pulled the stop far enough off the rail to delete it. */
	let dropping = $state(false);

	const ramp = $derived(cssGradient(stops));
	const current = $derived(stops[Math.min(selected, stops.length - 1)]);
	const ordered = $derived(sortStops(stops));
	/** Midpoint handles, one per gap, in ramp order — `mid` lives on the gap's LEFT stop. */
	const mids = $derived(
		ordered.slice(0, -1).map((left, i) => ({
			left,
			at: left.at + (ordered[i + 1].at - left.at) * clamp(left.mid, MID_MIN, MID_MAX),
		})),
	);

	function clamp(n: number, lo: number, hi: number): number {
		if (!Number.isFinite(n)) return lo;
		return n < lo ? lo : n > hi ? hi : n;
	}

	function posFromEvent(e: PointerEvent): number {
		if (!railEl) return 0;
		const r = railEl.getBoundingClientRect();
		return clamp((e.clientX - r.left) / Math.max(r.width, 1), 0, 1);
	}

	/** Drag a stop (or a midpoint) with pointer capture so it keeps tracking off-element. */
	function startDrag(e: PointerEvent, move: (ev: PointerEvent) => void, end?: () => void): void {
		e.preventDefault();
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const onMove = (ev: PointerEvent) => move(ev);
		const onUp = (ev: PointerEvent) => {
			el.releasePointerCapture(ev.pointerId);
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
			el.removeEventListener('pointercancel', onUp);
			end?.();
		};
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', onUp);
		el.addEventListener('pointercancel', onUp);
	}

	function onRailDown(e: PointerEvent): void {
		if (disabled) return;
		addStopAt(posFromEvent(e));
	}

	function addStopAt(at: number): void {
		const seed = stopAt(stops, at);
		// Append rather than splice: the markers render in array order, so a live drag never
		// sees its own index move. `sortAfterDrag()` re-orders once the pointer is released.
		stops = [...stops, { at, color: seed.color, alpha: seed.alpha, mid: 0.5 }];
		selected = stops.length - 1;
	}

	function onStopDown(e: PointerEvent, index: number): void {
		// The rail below adds a stop on pointerdown — a hit on a marker is never that.
		e.stopPropagation();
		if (disabled) return;
		selected = index;
		const railTop = railEl?.getBoundingClientRect().top ?? 0;
		startDrag(
			e,
			(ev) => {
				stops[index].at = posFromEvent(ev);
				dropping = stops.length > MIN_STOPS && ev.clientY - railTop > DROP_AWAY;
			},
			() => {
				if (dropping) removeStop(index);
				else sortAfterDrag(index);
				dropping = false;
			},
		);
	}

	function onMidDown(e: PointerEvent, left: GradientStop): void {
		e.stopPropagation();
		if (disabled) return;
		const right = ordered[ordered.indexOf(left) + 1];
		if (!right) return;
		startDrag(e, (ev) => {
			const span = right.at - left.at;
			const t = span <= 0 ? 0.5 : (posFromEvent(ev) - left.at) / span;
			left.mid = clamp(t, MID_MIN, MID_MAX);
		});
	}

	/** Re-order the array once a drag ends, keeping the dragged stop selected. */
	function sortAfterDrag(index: number): void {
		const moved = stops[index];
		const ordered = sortStops(stops);
		stops = ordered;
		selected = Math.max(0, ordered.indexOf(moved));
	}

	function removeStop(index: number): void {
		if (stops.length <= MIN_STOPS) return;
		stops = stops.filter((_, i) => i !== index);
		selected = Math.min(selected, stops.length - 1);
	}

	function nudge(index: number, delta: number): void {
		stops[index].at = clamp(stops[index].at + delta, 0, 1);
	}

	function onStopKey(e: KeyboardEvent, index: number): void {
		const step = e.shiftKey ? 0.1 : 0.01;
		if (e.key === 'ArrowLeft') nudge(index, -step);
		else if (e.key === 'ArrowRight') nudge(index, step);
		else if (e.key === 'Delete' || e.key === 'Backspace') removeStop(index);
		else return;
		e.preventDefault();
		selected = index;
	}

	function setField(field: 'at' | 'alpha', percent: number): void {
		// An emptied input reads back NaN — leave the stop alone rather than snapping it to 0.
		if (!current || !Number.isFinite(percent)) return;
		current[field] = clamp(percent / 100, 0, 1);
	}
</script>

<div class="gb" class:disabled>
	<div class="gb-bar">
		<div class="gb-ramp" style="background-image:{ramp}"></div>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={railEl}
		class="gb-rail"
		onpointerdown={onRailDown}
		title="Click to add a colour stop"
	>
		{#each mids as m (m.left)}
			<button
				type="button"
				class="gb-mid"
				style="left:{m.at * 100}%"
				{disabled}
				aria-label="Blend midpoint"
				title="Midpoint — where the 50/50 blend lands"
				onpointerdown={(e) => onMidDown(e, m.left)}
			></button>
		{/each}
		{#each stops as stop, i (stop)}
			<button
				type="button"
				class="gb-stop"
				class:active={i === selected}
				class:dropping={dropping && i === selected}
				style="left:{stop.at * 100}%; --gb-swatch:{stopCss(stop)}"
				{disabled}
				aria-label="Colour stop at {Math.round(stop.at * 100)}%"
				onpointerdown={(e) => onStopDown(e, i)}
				onkeydown={(e) => onStopKey(e, i)}
			></button>
		{/each}
	</div>

	<div class="gb-ends">
		<span>{startLabel}</span>
		<span>{endLabel}</span>
	</div>

	{#if current}
		<div class="gb-fields">
			<label class="gb-field">
				Color
				<ColorField bind:value={current.color} {disabled} />
			</label>
			<label class="gb-field">
				Opacity
				<span class="gb-num">
					<input
						type="number"
						min="0"
						max="100"
						step="1"
						{disabled}
						value={Math.round(current.alpha * 100)}
						oninput={(e) => setField('alpha', e.currentTarget.valueAsNumber)}
					/>%
				</span>
			</label>
			<label class="gb-field">
				Location
				<span class="gb-num">
					<input
						type="number"
						min="0"
						max="100"
						step="1"
						{disabled}
						value={Math.round(current.at * 100)}
						oninput={(e) => setField('at', e.currentTarget.valueAsNumber)}
					/>%
				</span>
			</label>
			<div class="gb-buttons">
				<button
					type="button"
					class="gb-btn"
					disabled={disabled || stops.length <= MIN_STOPS}
					onclick={() => removeStop(selected)}
				>
					Delete
				</button>
				<button
					type="button"
					class="gb-btn"
					{disabled}
					onclick={() => {
						stops = reverseStops(stops);
						selected = stops.length - 1 - selected;
					}}
				>
					Reverse
				</button>
			</div>
		</div>
	{/if}
	<p class="gb-hint">
		Click the rail to add a stop · drag it off the rail (or press Delete) to remove · drag a diamond
		to shift the blend.
	</p>
</div>

<style>
	.gb {
		display: flex;
		flex-direction: column;
		user-select: none;
	}
	.gb.disabled {
		opacity: 0.5;
	}
	.gb-bar {
		height: 30px;
		border: 1px solid #2a2a33;
		border-radius: 6px 6px 0 0;
		border-bottom: none;
		overflow: hidden;
		background: repeating-conic-gradient(#3a3a44 0% 25%, #22222a 0% 50%) 50% / 12px 12px;
	}
	.gb-ramp {
		width: 100%;
		height: 100%;
	}
	.gb-rail {
		position: relative;
		height: 20px;
		border: 1px solid #2a2a33;
		border-top: none;
		border-radius: 0 0 6px 6px;
		background: #0f0f14;
		cursor: copy;
		touch-action: none;
	}
	.gb-stop {
		position: absolute;
		top: 1px;
		width: 13px;
		height: 15px;
		padding: 0;
		transform: translateX(-50%);
		border: 1px solid #0b0b10;
		border-radius: 0 0 3px 3px;
		/* House-shaped like Photoshop's: a pointed cap over the colour body. */
		clip-path: polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%);
		background:
			linear-gradient(var(--gb-swatch), var(--gb-swatch)),
			repeating-conic-gradient(#888 0% 25%, #fff 0% 50%) 50% / 6px 6px;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
		cursor: ew-resize;
		touch-action: none;
	}
	.gb-stop.active {
		box-shadow:
			0 0 0 1px #fff,
			0 0 0 3px rgba(107, 91, 255, 0.55);
		z-index: 2;
	}
	.gb-stop.dropping {
		opacity: 0.35;
	}
	.gb-mid {
		position: absolute;
		top: 4px;
		width: 9px;
		height: 9px;
		padding: 0;
		transform: translateX(-50%) rotate(45deg);
		border: 1px solid #0b0b10;
		border-radius: 1px;
		background: #b9b9c6;
		cursor: ew-resize;
		touch-action: none;
	}
	.gb-ends {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 11px;
		color: #777;
	}
	.gb-fields {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 10px;
	}
	.gb-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: #999;
	}
	/* Match the swatch to the number inputs so all three labels sit on one line. */
	.gb-field :global(.cf-swatch) {
		width: 46px;
		height: 28px;
	}
	.gb-num {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: #777;
		font-size: 11px;
	}
	.gb-num input {
		width: 54px;
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 5px 6px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
	}
	.gb-num input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.gb-buttons {
		display: flex;
		gap: 6px;
		margin-left: auto;
	}
	.gb-btn {
		background: #1f1f28;
		border: 1px solid #333;
		border-radius: 6px;
		padding: 5px 10px;
		color: #bbb;
		font-size: 12px;
		cursor: pointer;
	}
	.gb-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.gb-hint {
		margin: 8px 0 0;
		font-size: 11px;
		line-height: 1.5;
		color: #666;
	}
</style>
