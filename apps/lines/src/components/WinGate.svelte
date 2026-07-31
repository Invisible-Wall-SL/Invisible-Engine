<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { roundSkip } from 'utils-shared/skipToken';
	import { CanvasSizeRectangle } from 'components-layout';
	import { OnMount } from 'components-shared';
	import type { WinLevelData } from '../game/winLevelMap';

	import { getContext } from '../game/context';
	import { flowV2DrivesScreens } from '../game/flowV2Runtime.svelte';
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

	let show = $state(false);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData>();
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		winShow: () => {
			show = true;
			// Reset the count-up-complete latch at the EARLIEST win signal — before the authored
			// container subscribes — so a stale `true` from a prior win can't pre-arm this one's tap.
			winState.countUpComplete = false;
		},
		winHide: () => (show = false),
		winUpdate: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
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
		<WinCountUpProvider {amount} {duration}>
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
						oncomplete();
					}}
				/>

				<!-- Publish the live count-up amount + the coin-fountain emit signal (emit while the
					count-up runs) to the positionable VISUAL, which draws the count text + `WinCoins`. -->
				<WinStatePublisher {countUpAmount} coinsEmit={!countUpCompleted} />

				{#if codedPressOwned}
					<PressToContinue onpress={() => (countUpCompleted ? oncomplete() : finishCountUp())} />
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
