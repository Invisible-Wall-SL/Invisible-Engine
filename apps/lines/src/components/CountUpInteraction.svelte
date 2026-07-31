<script lang="ts">
	import { CanvasSizeRectangle } from 'components-layout';
	import { OnHotkey } from 'components-shared';

	// The shared, authorable INPUT SURFACE for a count-up (the WIN overlay + the free-spin OUTRO).
	// Extracted from the byte-identical hold-to-fast-forward blocks that used to live inline in both
	// `<WinGate>` and `<FreeSpinOutroDriver>`, and extended with an independent TAP-TO-SKIP mode. Two
	// toggles, authored per game via the flow doc's `settings.countUp` and read by the engine:
	//
	//  - `holdToSpeedUp` — while the player HOLDS a pointer (this canvas-space rectangle) OR the Space
	//    key (the engine's global keyboard broadcast), drive `speedScale` up to `holdSpeedScale`×; on
	//    release it returns to 1. Continuous acceleration, NOT a jump. Owns `bind:speedScale`.
	//  - `tapToSkip` — a QUICK press (pointer or Space) fires `onSkip` once, which the driver wires to
	//    the provider's `finishCountUp` slam (lands on the final total, never drops it).
	//
	// They COMPOSE. With both on, a press-and-hold speeds up while a quick tap skips — distinguished by
	// press duration (`TAP_MAX_MS`): a release within the window that never actually accelerated counts
	// as a tap. With only `tapToSkip` on, any press skips immediately (no hold gesture to disambiguate).
	// With neither on this component renders nothing (an inert count-up), so it is always safe to mount.
	type Props = {
		/** Hold pointer/Space to fast-forward. */
		holdToSpeedUp?: boolean;
		/** Quick tap/press jumps to the final total. */
		tapToSkip?: boolean;
		/** The hold multiplier applied while a pointer/Space is held (only when `holdToSpeedUp`). */
		holdSpeedScale?: number;
		/** Bindable: the live count-up speed multiplier (1 = normal). The driver feeds it to
		 *  `WinCountUpProvider`. Stays 1 unless `holdToSpeedUp` is on and a hold is active. */
		speedScale?: number;
		/** Fired once per gesture when a quick tap/press should skip to the final total. */
		onSkip?: () => void;
	};
	let {
		holdToSpeedUp = false,
		tapToSkip = false,
		holdSpeedScale = 6,
		speedScale = $bindable(1),
		onSkip,
	}: Props = $props();

	// A press shorter than this (and that never entered a sustained hold) is a TAP, not a hold — the
	// only disambiguation needed when both modes are on. When ONLY `tapToSkip` is on we skip on press
	// down instead, so a plain click responds instantly with no wait to classify the gesture.
	const TAP_MAX_MS = 200;

	const enabled = $derived(holdToSpeedUp || tapToSkip);

	let pointerHeld = $state(false);
	let keyHeld = $state(false);
	// When a hold speeds things up, `speedScale` follows the held state; otherwise it stays at 1 so a
	// pure tap-to-skip surface never accelerates the count.
	$effect(() => {
		speedScale = holdToSpeedUp && (pointerHeld || keyHeld) ? holdSpeedScale : 1;
	});

	// Press timestamps, per input, so a release can be classified as tap-vs-hold. Plain `let` (not
	// reactive) — only read at release time.
	let pointerDownAt = 0;
	let keyDownAt = 0;

	const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

	const press = (setHeld: (v: boolean) => void, stampDownAt: (t: number) => void) => {
		stampDownAt(now());
		if (holdToSpeedUp) setHeld(true);
		// Tap-only surface: nothing distinguishes a hold, so skip on the down edge for instant response.
		else if (tapToSkip) onSkip?.();
	};

	const release = (setHeld: (v: boolean) => void, downAt: number) => {
		setHeld(false);
		// With hold enabled, a QUICK release that never really accelerated is a tap → skip. A sustained
		// hold (the player watched it speed up) just eases back to normal and does NOT skip.
		if (holdToSpeedUp && tapToSkip && now() - downAt <= TAP_MAX_MS) onSkip?.();
	};
</script>

{#if enabled}
	<CanvasSizeRectangle
		eventMode="static"
		cursor="pointer"
		backgroundColor={0xffffff}
		backgroundAlpha={0.001}
		onpointerdown={() =>
			press(
				(v) => (pointerHeld = v),
				(t) => (pointerDownAt = t),
			)}
		onpointerup={() => release((v) => (pointerHeld = v), pointerDownAt)}
		onpointerupoutside={() => (pointerHeld = false)}
	/>
	<OnHotkey
		hotkey="Space"
		onpress={() =>
			press(
				(v) => (keyHeld = v),
				(t) => (keyDownAt = t),
			)}
		onpressend={() => release((v) => (keyHeld = v), keyDownAt)}
		onholdend={() => (keyHeld = false)}
	/>
{/if}
