<script lang="ts" module>
	import type { WinLevelData } from 'engine-game';

	export type EmitterEventFreeSpinOutro =
		| { type: 'freeSpinOutroShow' }
		| { type: 'freeSpinOutroHide' }
		// `holdToSpeedUp`/`tapToSkip` — the PER-INSTANCE count-up interaction toggles, authored on the
		// `freeSpinOutroCountUp` action node (its inspector) and carried here in the broadcast payload.
		// Unset ⇒ off (the driver defaults them false). See `CountUpInteraction`.
		| {
				type: 'freeSpinOutroCountUp';
				amount: number;
				winLevelData: WinLevelData | undefined;
				holdToSpeedUp?: boolean;
				tapToSkip?: boolean;
		  }
		// Broadcast by the driver the moment its count-up finishes (natural, slammed, or
		// hold-fast-forwarded). Drives the `freeSpinOutroCountUpComplete` component signal so an
		// authored tap/prompt arms only after the count. Payload-less.
		| { type: 'freeSpinOutroCountUpComplete' };
</script>

<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { OnMount } from 'components-shared';

	import { getContext } from '../game/context';
	import { CountUpInteraction } from 'engine-game';
	import OutroStatePublisher from './OutroStatePublisher.svelte';
	import { freeSpinOutroState } from '../game/freeSpinOutroState.svelte';

	// The HEADLESS free-spin OUTRO driver — the engine's only part in the outro. It subscribes
	// `freeSpinOutro*`, runs the `WinCountUpProvider` count-up and publishes the win level + live
	// count-up amount to `freeSpinOutroState`; it draws NO dim, NO sprites, NO coin fountain and NO
	// press. The flow's `freeSpinOutro` screen owns all of that: its dim / tap (`tapToContinue`, armed
	// after `freeSpinOutroCountUpComplete`) / hold (`showContainer{awaitComplete}`) / count text (the
	// `freeSpinOutroTotalWin` value source, or the coded `FreeSpinOutroVisual`) / big-small art (the
	// `freeSpinOutroBigWin`/`freeSpinOutroSmallWin` signals).
	//
	// It is the SOLE `freeSpinOutroCountUp` subscriber (two would each hold the round), and it
	// SELF-RESOLVES that hold once the count-up completes (mirrors `<WinGate>` under v2) — the wait
	// for the player's tap belongs to the authored screen's `showContainer{awaitComplete}`, not here.
	// Slam-safe: the self-resolve is raced with `roundSkip`.
	const context = getContext();

	let show = $state(true);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData | undefined>();
	let releaseRoundBlock: (() => void) | undefined;

	// COUNT-UP INTERACTION (PER-INSTANCE authorable) — the shared `<CountUpInteraction>` surface
	// drives `interactionSpeedScale` (hold-to-fast-forward) and fires `finishCountUp` (tap-to-skip).
	// The two toggles are authored on the `freeSpinOutroCountUp` action node and arrive in that
	// event's payload (below), NOT a global setting. A slam (`roundSkip`) still snaps to the total
	// independently. `undefined` — the provider's original single fixed-duration tween — when
	// hold-to-speed-up is off (a pure tap-to-skip surface never accelerates).
	let holdToSpeedUp = $state(false);
	let tapToSkip = $state(false);
	let interactionSpeedScale = $state(1);
	const speedScale = $derived(holdToSpeedUp ? interactionSpeedScale : undefined);

	context.eventEmitter.subscribeOnMount({
		freeSpinOutroShow: () => {
			show = true;
			// Reset the count-up-complete latch at the EARLIEST outro signal — before the authored
			// screen subscribes — so a stale `true` from a prior outro can't pre-arm this one's tap.
			freeSpinOutroState.countUpComplete = false;
		},
		freeSpinOutroHide: () => (show = false),
		freeSpinOutroCountUp: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
			holdToSpeedUp = emitterEvent.holdToSpeedUp ?? false;
			tapToSkip = emitterEvent.tapToSkip ?? false;
			freeSpinOutroState.winLevelData = emitterEvent.winLevelData;
			await waitForResolve((resolve) => (releaseRoundBlock = resolve));
		},
	});
</script>

<FadeContainer {show}>
	{#if winLevelData}
		{@const duration = winLevelData.presentDuration}
		<WinCountUpProvider {amount} {duration} {speedScale}>
			{#snippet children({ countUpAmount, startCountUp, finishCountUp, countUpCompleted })}
				<OnMount
					onmount={async () => {
						await startCountUp();
						// The count-up has finished (natural, slammed, or hold-fast-forwarded: completion is
						// completion). Fire the component-scoped `freeSpinOutroCountUpComplete` signal ONCE
						// per outro, so an authored `tapToContinue` / prompt with
						// `tapArmAfterSignal: 'freeSpinOutroCountUpComplete'` arms only now. Latch it FIRST
						// (before the broadcast) so a screen that subscribes late — a zero/instant count-up
						// finishes in the same tick it mounts — seeds from the latch and still arms (the
						// emitter has no replay, so a fire-before-subscribe would otherwise be lost).
						freeSpinOutroState.countUpComplete = true;
						context.eventEmitter.broadcast({ type: 'freeSpinOutroCountUpComplete' });
						await roundSkip.wait(300);
						releaseRoundBlock?.();
					}}
				/>

				<!-- Publish the live count-up amount to `freeSpinOutroState` (the authored count text binds
					 the `freeSpinOutroTotalWin` value source, or the coded `FreeSpinOutroVisual` reads it). -->
				<OutroStatePublisher {countUpAmount} />

				<!-- Authorable count-up interaction (hold-to-fast-forward and/or tap-to-skip), mounted ONLY
					 while the count-up runs so it never intercepts the authored tap-to-continue that arms on
					 completion. Skip fires the provider's `finishCountUp` slam. Renders nothing when both
					 toggles are off. Shared with `<WinGate>` via `<CountUpInteraction>`. -->
				{#if !countUpCompleted}
					<CountUpInteraction
						{holdToSpeedUp}
						{tapToSkip}
						bind:speedScale={interactionSpeedScale}
						onSkip={finishCountUp}
					/>
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
