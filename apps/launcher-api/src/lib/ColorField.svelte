<script lang="ts" module>
	/** Shared Photoshop-style colour picker. Drop-in replacement for `<input type="color">`.
	 *
	 * Why this exists: the native `<input type="color">` opens the OS picker, which closes on
	 * the first click, can't be click-dragged, and looks different on every platform. This gives
	 * one consistent picker across the whole pipeline (config / editor / symbols / fx / fonts):
	 *   - the popover stays open while you pick;
	 *   - the SV square + hue slider are click-drag, and dragging keeps tracking even when the
	 *     pointer leaves the picker (pointer capture);
	 *   - it commits & closes on click-away; Esc reverts to the colour it had when opened.
	 *
	 * Values are `#rrggbb` strings, exactly like the native input — callers that store a NUMBER
	 * keep their existing `hexFrom()` / `fromColorInput()` conversions around the boundary.
	 */

	function clamp(n: number, lo: number, hi: number): number {
		return n < lo ? lo : n > hi ? hi : n;
	}

	function normalizeHex(hex: string | undefined | null): string {
		if (!hex) return '#000000';
		let s = hex.trim().replace(/^#/, '');
		if (/^[0-9a-fA-F]{3}$/.test(s)) {
			s = s
				.split('')
				.map((c) => c + c)
				.join('');
		}
		if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#000000';
		return '#' + s.toLowerCase();
	}

	function hexToRgb(hex: string): [number, number, number] {
		const n = parseInt(normalizeHex(hex).slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	function rgbToHex(r: number, g: number, b: number): string {
		return (
			'#' +
			[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
		);
	}

	/** h in [0,360), s/v in [0,1]. */
	function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h = 0;
		if (d !== 0) {
			if (max === r) h = ((g - b) / d) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
			if (h < 0) h += 360;
		}
		const s = max === 0 ? 0 : d / max;
		return [h, s, max];
	}

	function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
		const c = v * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = v - c;
		let r = 0;
		let g = 0;
		let b = 0;
		if (h < 60) [r, g, b] = [c, x, 0];
		else if (h < 120) [r, g, b] = [x, c, 0];
		else if (h < 180) [r, g, b] = [0, c, x];
		else if (h < 240) [r, g, b] = [0, x, c];
		else if (h < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];
		return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
	}
</script>

<script lang="ts">
	interface Props {
		/** `#rrggbb` colour string. Two-way bindable, like the native input. */
		value?: string;
		disabled?: boolean;
		title?: string;
		/** Extra class on the swatch button. */
		class?: string;
		/** Fires on every change while picking (drag / hex entry) — matches native `input`. */
		oninput?: (hex: string) => void;
		/** Fires once on commit (close) — matches native `change`. */
		onchange?: (hex: string) => void;
	}

	let {
		value = $bindable('#ffffff'),
		disabled = false,
		title,
		class: className = '',
		oninput,
		onchange,
	}: Props = $props();

	let open = $state(false);
	let swatchEl: HTMLButtonElement | undefined = $state();
	let popoverEl: HTMLDivElement | undefined = $state();
	let popStyle = $state('');

	// Working HSV while open — kept separate so hue survives when s or v hit 0
	// (hex→hsv→hex would otherwise forget the hue at pure black / greyscale).
	let hue = $state(0);
	let sat = $state(0);
	let val = $state(1);
	let hexDraft = $state('#ffffff');
	let snapshot = ''; // value at open, for Esc-revert

	const currentHex = $derived(rgbToHex(...hsvToRgb(hue, sat, val)));

	function seedFrom(hex: string) {
		const [h, s, v] = rgbToHsv(...hexToRgb(hex));
		// Preserve a sensible hue when the colour is greyscale (s===0 → h undefined).
		if (s > 0) hue = h;
		sat = s;
		val = v;
		hexDraft = normalizeHex(hex);
	}

	function commitLive() {
		value = currentHex;
		hexDraft = currentHex;
		oninput?.(currentHex);
	}

	function openPicker() {
		if (disabled) return;
		snapshot = normalizeHex(value);
		seedFrom(value);
		open = true;
		queueMicrotask(positionPopover);
	}

	function closePicker(commit: boolean) {
		if (!open) return;
		open = false;
		if (commit) onchange?.(normalizeHex(value));
	}

	function cancelPicker() {
		if (!open) return;
		if (value !== snapshot) {
			value = snapshot;
			oninput?.(snapshot);
		}
		open = false;
	}

	function positionPopover() {
		if (!swatchEl || !popoverEl) return;
		const r = swatchEl.getBoundingClientRect();
		const pw = popoverEl.offsetWidth;
		const ph = popoverEl.offsetHeight;
		const margin = 6;
		let left = r.left;
		let top = r.bottom + margin;
		if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
		if (left < 8) left = 8;
		if (top + ph > window.innerHeight - 8) top = r.top - ph - margin; // flip above
		if (top < 8) top = 8;
		popStyle = `left:${Math.round(left)}px;top:${Math.round(top)}px;`;
	}

	// --- drag handling (pointer capture keeps tracking outside the element) ---
	function dragSV(e: PointerEvent, el: HTMLElement) {
		const rect = el.getBoundingClientRect();
		sat = clamp((e.clientX - rect.left) / rect.width, 0, 1);
		val = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
		commitLive();
	}

	function dragHue(e: PointerEvent, el: HTMLElement) {
		const rect = el.getBoundingClientRect();
		hue = clamp((e.clientX - rect.left) / rect.width, 0, 1) * 360;
		commitLive();
	}

	function startDrag(e: PointerEvent, kind: 'sv' | 'hue') {
		e.preventDefault();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => (kind === 'sv' ? dragSV(ev, el) : dragHue(ev, el));
		const up = (ev: PointerEvent) => {
			el.releasePointerCapture(ev.pointerId);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		move(e); // jump to click point immediately
	}

	function onHexInput(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value;
		hexDraft = raw;
		if (/^#?[0-9a-fA-F]{6}$/.test(raw.trim()) || /^#?[0-9a-fA-F]{3}$/.test(raw.trim())) {
			seedFrom(raw);
			value = normalizeHex(raw);
			oninput?.(value);
		}
	}

	// Click-away commits & closes; a scroll/resize repositions the popover.
	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node;
			if (popoverEl?.contains(t) || swatchEl?.contains(t)) return;
			closePicker(true);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				cancelPicker();
			} else if (e.key === 'Enter') {
				closePicker(true);
			}
		};
		const onReflow = () => positionPopover();
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('keydown', onKey);
		window.addEventListener('resize', onReflow);
		window.addEventListener('scroll', onReflow, true);
		return () => {
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('resize', onReflow);
			window.removeEventListener('scroll', onReflow, true);
		};
	});

	const svBg = $derived(
		`linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${hue} 100% 50%)`,
	);

	// Render the popover on <body>, not inline. Many callers place this field inside a
	// <label>; a click on the SV square (a plain <div>) would otherwise be forwarded by the
	// label to its control — the swatch button — toggling the picker shut on every release.
	// A body portal also lets position:fixed escape any transformed/overflow ancestor.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<button
	bind:this={swatchEl}
	type="button"
	class="cf-swatch {className}"
	class:cf-open={open}
	{disabled}
	{title}
	style="--cf-color:{normalizeHex(value)}"
	aria-label={title ?? 'Pick colour'}
	onclick={() => (open ? closePicker(true) : openPicker())}
></button>

{#if open}
	<div bind:this={popoverEl} use:portal class="cf-pop" style={popStyle} role="dialog">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="cf-sv" style="background:{svBg}" onpointerdown={(e) => startDrag(e, 'sv')}>
			<div class="cf-sv-thumb" style="left:{sat * 100}%;top:{(1 - val) * 100}%"></div>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="cf-hue" onpointerdown={(e) => startDrag(e, 'hue')}>
			<div class="cf-hue-thumb" style="left:{(hue / 360) * 100}%"></div>
		</div>
		<div class="cf-foot">
			<span class="cf-preview" style="background:{currentHex}"></span>
			<input
				class="cf-hex"
				spellcheck="false"
				value={hexDraft}
				oninput={onHexInput}
				onkeydown={(e) => e.key === 'Enter' && closePicker(true)}
			/>
		</div>
	</div>
{/if}

<style>
	.cf-swatch {
		width: 34px;
		height: 22px;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 4px;
		background: var(--cf-color);
		cursor: pointer;
		vertical-align: middle;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35);
	}
	.cf-swatch:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.cf-swatch.cf-open {
		outline: 2px solid #7ee0c0;
		outline-offset: 1px;
	}

	.cf-pop {
		position: fixed;
		z-index: 10000;
		width: 208px;
		padding: 10px;
		background: #1c1c22;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 8px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
		user-select: none;
	}

	.cf-sv {
		position: relative;
		width: 188px;
		height: 132px;
		border-radius: 4px;
		cursor: crosshair;
		touch-action: none;
	}
	.cf-sv-thumb {
		position: absolute;
		width: 12px;
		height: 12px;
		transform: translate(-50%, -50%);
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.cf-hue {
		position: relative;
		margin-top: 10px;
		width: 188px;
		height: 12px;
		border-radius: 6px;
		cursor: ew-resize;
		touch-action: none;
		background: linear-gradient(
			to right,
			#f00 0%,
			#ff0 17%,
			#0f0 33%,
			#0ff 50%,
			#00f 67%,
			#f0f 83%,
			#f00 100%
		);
	}
	.cf-hue-thumb {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 16px;
		transform: translate(-50%, -50%);
		border: 2px solid #fff;
		border-radius: 3px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.cf-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
	}
	.cf-preview {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		flex: 0 0 auto;
	}
	.cf-hex {
		flex: 1 1 auto;
		min-width: 0;
		padding: 4px 6px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		text-transform: lowercase;
		color: #e8e8ee;
		background: #101014;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 4px;
	}
	.cf-hex:focus {
		outline: none;
		border-color: #7ee0c0;
	}
</style>
