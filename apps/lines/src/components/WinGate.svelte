<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { CanvasSizeRectangle } from 'components-layout';
	import { OnMount } from 'components-shared';
	import type { WinLevelData } from '../game/winLevelMap';

	import { getContext } from '../game/context';
	import { flowV2DrivesScreens } from '../game/flowV2Runtime.svelte';
	import CountUpInteraction from './CountUpInteraction.svelte';
	import PressToContinue from './PressToContinue.svelte';
	import WinStatePublisher from './WinStatePublisher.svelte';
	import { winState } from '../game/winState.svelte';

	// The full-screen GATE of the WIN overlay (big-win presentation): the `winShow/winHide/winUpdate`
	// book-event subscription, the count-up driver (`WinCountUpProvider` + `OnMount startCountUp`),
	// the big-win `CanvasSizeRectangle` dim scrim, the press-to-continue — and it OWNS the
	// round-blocking await. Publishes the win level + final amount + the live count-up amount + the
	// coin-fountain emit signal (`coinsEmit`) to `winState` so the positionable VISUAL (`WinVisual`)
	// renders the spine + count number + the now-authorable `WinCoins` fountain. Stays full-screen
	// (`canvas`), never editor-positioned.
	//
	// `headless` (design doc §14, the win-overlay twin of the FS-7 outro) — when an authored `bigWin`
	// container rebuilds the overlay from primitives (`resolveWinMount` ⇒ `'driver'`) the engine mounts
	// this gate WITHOUT its big-win dim scrim, so it keeps only the LOAD-BEARING core (count-up +
	// `winState` publish + round-block self-resolve) and the authored container owns dim / tap / art.
	// The coded press already self-suppresses under v2 (`codedPressOwned`), so a headless mount adds no
	// visible surface. Default `false` ⇒ the full gate (driven seed / today) — byte-identical.
	const { headless = false }: { headless?: boolean } = $props();

	const context = getContext();

	// Under a v2 flow that DRIVES the screens, the authored container's `tapToContinue` overlay is
	// the SOLE tap surface (a `showContainer{awaitComplete}` node owns any round-block hold), so
	// this coded full-screen press steps aside exactly as the free-spin gates do in `Game.svelte`
	// — otherwise a v2 game carries a second, un-authored `OnPressFullScreen` + `MM_pressanywhere`
	// prompt the author never asked for and cannot see in either editor. The count-up still
	// self-resolves via `OnMount` below (the tap only ever SKIPPED it), so dropping the press
	// cannot hang the round. No v2 doc / a book-events-only flow ⇒ `false` ⇒ parity.
	const codedPressOwned = !flowV2DrivesScreens();

	// COUNT-UP INTERACTION (the big-win twin of the free-spin OUTRO driver's) — the shared authorable
	// `<CountUpInteraction>` surface drives `interactionSpeedScale` (hold-to-fast-forward) and fires
	// `finishCountUp` (tap-to-skip). PER-INSTANCE: the two toggles are authored on the `winUpdate`
	// action node and arrive in that event's payload (below), NOT a global setting. Enabled ONLY on the
	// authored/flow path (`!codedPressOwned`): the coded fallback keeps its byte-identical single-tween
	// count-up + tap-to-slam `PressToContinue`, exactly as the coded `FreeSpinOutroGate` fallback does.
	let holdToSpeedUp = $state(false);
	let tapToSkip = $state(false);
	let interactionSpeedScale = $state(1);
	// `undefined` — the provider's original single fixed-duration tween — on the coded path OR when
	// hold-to-speed-up is off (a pure tap-to-skip surface never accelerates); the dynamic scale only
	// when hold is authored on. A slam (`roundSkip`) still snaps to the total independently either way.
	const speedScale = $derived(
		codedPressOwned || !holdToSpeedUp ? undefined : interactionSpeedScale,
	);

	let show = $state(false);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData | undefined>();
	let oncomplete = $state(() => {});
	// Guards `concludePresentation` against a double conclusion (OnMount + a post-count-up tap both
	// route through it). Reset per win alongside the count-up latch.
	let concluded = false;

	/**
	 * Conclude the WIN presentation — resolve the round-blocking `winUpdate` await. On the SEQUENTIAL-
	 * ESCALATION path (`winState.escalationActive`) it FIRST waits for the final tier's OUTRO to finish
	 * ({@link winState.escalationOutroComplete}), so a fast-forward / tap-to-skip of the count-up
	 * collapses the chain to the final tier and plays its outro cleanly instead of the overlay
	 * concluding mid-chain. Un-escalating ⇒ resolves immediately (byte-identical). Idempotent.
	 */
	async function concludePresentation() {
		if (concluded) return;
		concluded = true;
		if (winState.escalationActive) await waitForEscalationOutro();
		oncomplete();
	}

	/** A promise that resolves when the escalation outro completes (`WinAnimation` sets the latch).
	 *  Reactive→promise bridge via a disposable root effect; resolves immediately if already complete. */
	function waitForEscalationOutro(): Promise<void> {
		if (winState.escalationOutroComplete) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const stop = $effect.root(() => {
				$effect(() => {
					if (winState.escalationOutroComplete) {
						resolve();
						stop();
					}
				});
			});
		});
	}

	context.eventEmitter.subscribeOnMount({
		winShow: () => {
			show = true;
			// Belt-and-suspenders reset (the real reset is on `winHide` below): under the CODED path
			// `winShow` precedes the presentation, so clearing here keeps the first win clean too.
			winState.countUpComplete = false;
			winState.escalationOutroComplete = false;
			concluded = false;
		},
		winHide: () => {
			show = false;
			winState.escalationOutroComplete = false;
			concluded = false;
			// Reset the count-up-complete latch when the win DISMISSES — the load-bearing reset for a
			// REPEAT win. Under an authored flow the win container (and its `tapArmAfterSignal:
			// 'winCountUpComplete'` tap) is mounted by `showContainer` BEFORE that win's `winShow`
			// fires, so a `winShow`-only reset is too late: the second win's tap would seed off the
			// FIRST win's stale `true` and arm instantly, before its own count-up. Clearing on the
			// prior win's hide guarantees the next `showContainer` mounts a `false` latch. Sequential
			// setWin events (each awaits its chain) mean this always runs before the next win shows.
			winState.countUpComplete = false;
		},
		winUpdate: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
			// PER-INSTANCE count-up interaction — authored on the `winUpdate` action node, carried here.
			// Unset ⇒ off (a plain count-up); the author ticks either/both in the node's inspector.
			holdToSpeedUp = emitterEvent.holdToSpeedUp ?? false;
			tapToSkip = emitterEvent.tapToSkip ?? false;
			winState.amount = emitterEvent.amount;
			winState.winLevelData = emitterEvent.winLevelData;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

<FadeContainer {show}>
	{#if winLevelData}
		{@const isBigWin = winLevelData.type === 'big'}
		{@const duration = winLevelData.presentDuration}
		<WinCountUpProvider {amount} {duration} {speedScale}>
			{#snippet children({ countUpAmount, startCountUp, finishCountUp, countUpCompleted })}
				{#if isBigWin && !headless}
					<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />
				{/if}

				<OnMount
					onmount={async () => {
						await startCountUp();
						// The count-up has finished (natural or slammed). Fire `winCountUpComplete` ONCE per
						// win, so an authored `bigWin` container's `tapToContinue` / prompt with
						// `tapArmAfterSignal: 'winCountUpComplete'` arms only now (never before the count).
						// Un-authored ⇒ nothing subscribes ⇒ inert (parity). Latch it FIRST (before the
						// broadcast) so a container that subscribes late — a zero/instant count-up finishes
						// in the same tick it mounts — seeds from the latch and still arms (the emitter has
						// no replay, so a fire-before-subscribe would otherwise be lost). Mirrors the outro
						// driver (`FreeSpinOutroDriver`).
						winState.countUpComplete = true;
						context.eventEmitter.broadcast({ type: 'winCountUpComplete' });
						await roundSkip.wait(300);
						// On the escalation path this waits for the collapsed chain's final outro before
						// resolving; un-escalating ⇒ resolves now, exactly as before (byte-identical).
						await concludePresentation();
					}}
				/>

				<!-- Publish the live count-up amount + the coin-fountain emit signal (emit while the
					count-up runs) to the positionable VISUAL, which draws the count text + `WinCoins`. -->
				<WinStatePublisher {countUpAmount} coinsEmit={!countUpCompleted} />

				{#if codedPressOwned}
					<!-- Post-count-up tap concludes via `concludePresentation` so an escalation's outro is
						awaited (not cut). Pre-completion tap still slams the count-up (`finishCountUp`), then
						OnMount concludes. Un-escalating ⇒ concludes immediately (byte-identical tap-to-slam). -->
					<PressToContinue
						onpress={() => (countUpCompleted ? void concludePresentation() : finishCountUp())}
					/>
				{:else if !countUpCompleted}
					<!-- Authorable count-up interaction (hold-to-fast-forward and/or tap-to-skip), mounted ONLY
						 while the count-up runs (flow path) so it never intercepts the authored `bigWin`
						 container's tap-to-continue that arms on `winCountUpComplete`. Skip fires the provider's
						 `finishCountUp` slam. Renders nothing when both toggles are off. Shared with the outro
						 driver via `<CountUpInteraction>`. -->
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
