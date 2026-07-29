<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { CanvasSizeRectangle } from 'components-layout';
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { OnMount, OnHotkey } from 'components-shared';
	import type { WinLevelData } from '../game/winLevelMap';

	import { getContext } from '../game/context';
	import { FREE_SPIN_STEPS } from '../game/freeSpinOwnership';
	import { getFlowInterpreter } from '../game/flowInterpreterHolder';
	import OutroStatePublisher from './OutroStatePublisher.svelte';
	import { freeSpinOutroState } from '../game/freeSpinOutroState.svelte';

	// FS-7 (design doc §14, outro step) — the HEADLESS free-spin OUTRO driver: the LOAD-BEARING core
	// of `<FreeSpinOutroGate>` (subscribe `freeSpinOutro*`, run the `WinCountUpProvider` count-up,
	// publish the win level + live count-up amount to `freeSpinOutroState`) with NO dim, NO coded
	// sprites, NO coin fountain and NO full-screen `PressToContinue`. Mounted in place of the full gate
	// WHEN the authored `freeSpinOutro` screen owns the outro (full primitive parity, decision 1): the
	// author supplies the dim / tap / hold / count text (bound to the `freeSpinOutroTotalWin` value
	// source) / big-small art (gated on the `freeSpinOutroBigWin`/`freeSpinOutroSmallWin` signals) —
	// and their OWN coin fountain (FX / particle / spine) if they want one; the driver never emits coins.
	// `<FreeSpinOutroGate>` stays intact as the un-authored FALLBACK (dim + fountain + press + two-stage
	// tap), so a non-authored game is byte-identical (§7).
	//
	// EXACTLY-ONE `freeSpinOutroCountUp` SUBSCRIBER (decision B) — this driver is that subscriber
	// whenever an authored screen owns the outro; the coded `<FreeSpinOutroGate>` is suppressed at the
	// mount site so the two never both hold the round. It FINISHES the count-up, then releases by one
	// of two modes:
	//   - `holdUntilComplete` FALSE (v2, the shipped path) — SELF-RESOLVES the `freeSpinOutroCountUp`
	//     hold the moment the count-up completes (mirrors `<WinGate>` under v2). The authored
	//     container's `tapToContinue` + `showContainer{awaitComplete}` owns the wait-for-tap — the SAME
	//     model the free-spin INTRO already uses under v2. Slam-safe: the self-resolve is raced with
	//     `roundSkip`.
	//   - `holdUntilComplete` TRUE (v1 `ownsOutro`) — HOLDS the `freeSpinOutroCountUp` block and
	//     releases it when the authored `freeSpinOutro` screen LEAVES the interpreter's active set
	//     (`outroScreenActive` true→false — its Complete pin, the tap), and EARLY-MOUNTS that screen on
	//     `freeSpinOutroShow`. Mirrors `<FreeSpinIntroFlowGate>` beat-for-beat.
	type Props = {
		/** v1 `ownsOutro`: hold the round-block until the authored screen completes (else self-resolve
		 *  on count-up completion — the v2 default). */
		holdUntilComplete?: boolean;
		/** v1 only: whether the authored `freeSpinOutro` screen is in the interpreter's active set. Its
		 *  true→false edge (the tap) releases the held block. */
		outroScreenActive?: boolean;
	};
	const { holdUntilComplete = false, outroScreenActive = false }: Props = $props();

	const context = getContext();

	let show = $state(true);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData>();
	// The pending round-block resolver, set while `freeSpinOutroCountUp` holds. A plain `let` (NOT
	// reactive), so the release `$effect` below tracks only `outroScreenActive` — mirroring
	// `FreeSpinIntroFlowGate` so a spurious re-run can never resolve early.
	let releaseRoundBlock: (() => void) | undefined;

	// HOLD-TO-FAST-FORWARD (CHANGE 3) — while the player HOLDS a pointer (the canvas-space surface
	// below) OR the Space key (via the engine's global keyboard broadcast, `<EnableHotkey>`), the
	// count-up runs `HOLD_SPEED_SCALE`× faster; on release it eases back to normal speed. Continuous
	// acceleration, NOT an instant skip — a slam (`roundSkip`) still snaps to the total independently.
	const HOLD_SPEED_SCALE = 6;
	let pointerHeld = $state(false);
	let keyHeld = $state(false);
	const speedScale = $derived(pointerHeld || keyHeld ? HOLD_SPEED_SCALE : 1);

	context.eventEmitter.subscribeOnMount({
		freeSpinOutroShow: () => {
			show = true;
			// EARLY MOUNT (v1 only) — activate the authored outro overlay the instant its `*Show`
			// broadcasts, before the round-block below (the choreography shows THEN counts up). Only the
			// macro `bookEvent` transition, never the presentation, so the running choreography is not
			// re-dispatched. Fire-and-forget; no-op when un-owned / interpreter absent.
			if (holdUntilComplete) {
				void getFlowInterpreter()?.activateForBookEvent({ type: FREE_SPIN_STEPS.outro.event });
			}
		},
		freeSpinOutroHide: () => (show = false),
		freeSpinOutroCountUp: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
			freeSpinOutroState.winLevelData = emitterEvent.winLevelData;
			await waitForResolve((resolve) => (releaseRoundBlock = resolve));
		},
	});

	// ROUND-BLOCK TRANSFER (v1) — release the held block when the authored `freeSpinOutro` screen
	// leaves the active set (its Complete pin fired via tap-to-continue). Reads `outroScreenActive` so
	// this re-runs on every active-set change; releases only on the true→false edge while a block is
	// pending. No-op in the v2 self-resolve mode.
	$effect(() => {
		if (holdUntilComplete && !outroScreenActive && releaseRoundBlock) {
			const resolve = releaseRoundBlock;
			releaseRoundBlock = undefined;
			resolve();
		}
	});
</script>

<FadeContainer {show}>
	{#if winLevelData}
		{@const duration = winLevelData.presentDuration}
		<WinCountUpProvider {amount} {duration} {speedScale}>
			{#snippet children({ countUpAmount, startCountUp, countUpCompleted })}
				<OnMount
					onmount={async () => {
						await startCountUp();
						// CHANGE 2 — the count-up has finished (natural, slammed, or hold-fast-forwarded:
						// completion is completion). Fire the component-scoped `freeSpinOutroCountUpComplete`
						// signal ONCE per outro, so an authored `tapToContinue` / prompt with
						// `tapArmAfterSignal: 'freeSpinOutroCountUpComplete'` arms only now (never before the
						// count). Un-authored ⇒ nothing subscribes ⇒ inert (parity).
						context.eventEmitter.broadcast({ type: 'freeSpinOutroCountUpComplete' });
						// v2: the count-up has finished ⇒ release the round; the authored screen's tap owns
						// the wait-for-tap. v1: keep holding until the screen completes (the `$effect` above
						// releases). Raced via `roundSkip` so a slammed round never stalls waiting here.
						if (!holdUntilComplete) {
							await roundSkip.wait(300);
							releaseRoundBlock?.();
						}
					}}
				/>

				<!-- Publish the live count-up amount to `freeSpinOutroState` (the authored count text binds
					 the `freeSpinOutroTotalWin` value source, or the coded `FreeSpinOutroVisual` reads it). -->
				<OutroStatePublisher {countUpAmount} />

				<!-- Hold-to-fast-forward input surfaces (CHANGE 3), mounted ONLY while the count-up runs so
					 they never intercept the authored tap-to-continue that arms on completion. The
					 canvas-space rectangle detects a pointer hold; `<OnHotkey>` detects a Space hold off the
					 engine's global keyboard broadcast. -->
				{#if !countUpCompleted}
					<CanvasSizeRectangle
						eventMode="static"
						cursor="pointer"
						backgroundColor={0xffffff}
						backgroundAlpha={0.001}
						onpointerdown={() => (pointerHeld = true)}
						onpointerup={() => (pointerHeld = false)}
						onpointerupoutside={() => (pointerHeld = false)}
					/>
					<OnHotkey
						hotkey="Space"
						onpress={() => (keyHeld = true)}
						onpressend={() => (keyHeld = false)}
						onholdend={() => (keyHeld = false)}
					/>
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
