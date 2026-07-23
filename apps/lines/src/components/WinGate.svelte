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
	import WinCoins from './WinCoins.svelte';
	import WinStatePublisher from './WinStatePublisher.svelte';
	import { winState } from '../game/winState.svelte';

	// The full-screen GATE of the WIN overlay (big-win presentation): the `winShow/winHide/winUpdate`
	// book-event subscription, the count-up driver (`WinCountUpProvider` + `OnMount startCountUp`),
	// the big-win `CanvasSizeRectangle` dim scrim, the board-centred `WinCoins` particles, the
	// press-to-continue — and it OWNS the round-blocking await. Publishes the win level + final
	// amount + the live count-up amount to `winState` so the positionable VISUAL (`WinVisual`)
	// renders the spine + count number. Stays full-screen (`canvas`), never editor-positioned.
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
		winShow: () => (show = true),
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
				{#if isBigWin}
					<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />
				{/if}

				<OnMount
					onmount={async () => {
						await startCountUp();
						await roundSkip.wait(300);
						oncomplete();
					}}
				/>

				<!-- Publish the live count-up amount to the positionable VISUAL's count text. -->
				<WinStatePublisher {countUpAmount} />

				<WinCoins emit={!countUpCompleted} levelAlias={winLevelData?.alias} />

				{#if codedPressOwned}
					<PressToContinue onpress={() => (countUpCompleted ? oncomplete() : finishCountUp())} />
				{/if}
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
