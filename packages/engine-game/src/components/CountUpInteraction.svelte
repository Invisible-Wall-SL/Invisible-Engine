<script lang="ts">
	import { onDestroy } from 'svelte';

	import { CanvasSizeRectangle } from 'components-layout';
	import { OnHotkey } from 'components-shared';

	// The shared, authorable INPUT SURFACE for a count-up (the WIN overlay + the free-spin OUTRO).
	// Two INDEPENDENT toggles authored per game on the count-up action node (`winUpdate` /
	// `freeSpinOutroCountUp`) and read by the driver:
	//
	//  - `holdToSpeedUp` — while the player HOLDS a pointer (this canvas-space rectangle) OR the Space
	//    key, drive `speedScale` up to `holdSpeedScale`×; on release it returns to 1. Continuous
	//    acceleration, NOT a jump. Owns `bind:speedScale`.
	//  - `tapToSkip` — a TAP (pointer or Space) fires `onSkip` once, which the driver wires to the
	//    provider's `finishCountUp` slam (lands on the final total, never drops it).
	//
	// GESTURE DISAMBIGUATION (the whole subtlety). When only ONE mode is on there is no ambiguity, so
	// the response is immediate: tap-only skips on press-DOWN (a plain click, instant); hold-only starts
	// accelerating on press-down and stops on release. When BOTH are on they share one surface, so a
	// press is ambiguous — a quick TAP must skip, a sustained PRESS must speed up. We disambiguate by an
	// ACTIVATION DELAY: the hold only STARTS accelerating after `HOLD_ACTIVATE_MS`, so a release BEFORE
	// that is unambiguously a tap (→ skip) and never accelerated, while a press that outlives the delay
	// is a hold (→ speed up; release just returns to normal, no skip). The delay is generous because a
	// deliberate tap can take a couple hundred ms — the earlier "skip only if released < 200ms" was too
	// strict and read most taps as holds, so tap-to-skip never fired. With neither toggle on this renders
	// nothing (an inert count-up), so it is always safe to mount.
	type Props = {
		/** Hold pointer/Space to fast-forward. */
		holdToSpeedUp?: boolean;
		/** Tap pointer/Space to jump to the final total. */
		tapToSkip?: boolean;
		/** The hold multiplier applied while a pointer/Space is held (only when `holdToSpeedUp`). */
		holdSpeedScale?: number;
		/** Bindable: the live count-up speed multiplier (1 = normal). The driver feeds it to
		 *  `WinCountUpProvider`. Stays 1 unless `holdToSpeedUp` is on and a hold is active. */
		speedScale?: number;
		/** Fired once per gesture when a tap should skip to the final total. */
		onSkip?: () => void;
	};
	let {
		holdToSpeedUp = false,
		tapToSkip = false,
		holdSpeedScale = 6,
		speedScale = $bindable(1),
		onSkip,
	}: Props = $props();

	// How long a press must last (both-modes only) before it becomes a HOLD that accelerates. A release
	// before this is treated as a TAP → skip. Generous enough that a normal tap reliably skips.
	const HOLD_ACTIVATE_MS = 300;

	const bothModes = $derived(holdToSpeedUp && tapToSkip);
	const enabled = $derived(holdToSpeedUp || tapToSkip);

	let pointerHeld = $state(false);
	let keyHeld = $state(false);
	// `speedScale` follows the held state only while `holdToSpeedUp`; otherwise it stays 1 so a pure
	// tap-to-skip surface never accelerates the count.
	$effect(() => {
		speedScale = holdToSpeedUp && (pointerHeld || keyHeld) ? holdSpeedScale : 1;
	});

	// Pending hold-activation timers (both-modes only), one per input. `undefined` = not pending (either
	// the press hasn't happened, or the hold already activated / was cancelled).
	let pointerTimer: ReturnType<typeof setTimeout> | undefined;
	let keyTimer: ReturnType<typeof setTimeout> | undefined;

	const clearPointerTimer = () => {
		if (pointerTimer !== undefined) clearTimeout(pointerTimer);
		pointerTimer = undefined;
	};
	const clearKeyTimer = () => {
		if (keyTimer !== undefined) clearTimeout(keyTimer);
		keyTimer = undefined;
	};

	// --- Pointer ---------------------------------------------------------------------------------
	const pointerDown = () => {
		if (bothModes) {
			clearPointerTimer();
			// Wait to see if this becomes a hold; the skip decision is deferred to release.
			pointerTimer = setTimeout(() => {
				pointerTimer = undefined;
				pointerHeld = true;
			}, HOLD_ACTIVATE_MS);
		} else if (holdToSpeedUp) {
			pointerHeld = true;
		} else if (tapToSkip) {
			onSkip?.();
		}
	};
	const pointerUp = () => {
		if (bothModes) {
			if (pointerTimer !== undefined) {
				// Released before the hold activated ⇒ it was a TAP ⇒ skip.
				clearPointerTimer();
				onSkip?.();
			} else {
				// The hold had activated ⇒ end it; do NOT skip.
				pointerHeld = false;
			}
		} else if (holdToSpeedUp) {
			pointerHeld = false;
		}
	};
	const pointerCancel = () => {
		clearPointerTimer();
		pointerHeld = false;
	};

	// --- Keyboard (Space) ------------------------------------------------------------------------
	const keyDown = () => {
		if (bothModes) {
			clearKeyTimer();
			keyTimer = setTimeout(() => {
				keyTimer = undefined;
				keyHeld = true;
			}, HOLD_ACTIVATE_MS);
		} else if (holdToSpeedUp) {
			keyHeld = true;
		} else if (tapToSkip) {
			onSkip?.();
		}
	};
	const keyUp = () => {
		if (bothModes) {
			if (keyTimer !== undefined) {
				clearKeyTimer();
				onSkip?.();
			} else {
				keyHeld = false;
			}
		} else if (holdToSpeedUp) {
			keyHeld = false;
		}
	};
	const keyCancel = () => {
		clearKeyTimer();
		keyHeld = false;
	};

	onDestroy(() => {
		clearPointerTimer();
		clearKeyTimer();
	});
</script>

{#if enabled}
	<CanvasSizeRectangle
		eventMode="static"
		cursor="pointer"
		backgroundColor={0xffffff}
		backgroundAlpha={0.001}
		onpointerdown={pointerDown}
		onpointerup={pointerUp}
		onpointerupoutside={pointerCancel}
	/>
	<OnHotkey hotkey="Space" onpress={keyDown} onpressend={keyUp} onholdend={keyCancel} />
{/if}
