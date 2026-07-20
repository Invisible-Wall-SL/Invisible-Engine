<script lang="ts">
	import { FadeContainer, WinCountUpProvider } from 'components-pixi';
	import { waitForResolve } from 'utils-shared/wait';
	import { CanvasSizeRectangle } from 'components-layout';
	import { OnMount } from 'components-shared';
	import type { WinLevelData } from '../game/winLevelMap';

	import { getContext } from '../game/context';
	import PressToContinue from './PressToContinue.svelte';
	import WinCoins from './WinCoins.svelte';
	import OutroStatePublisher from './OutroStatePublisher.svelte';
	import { freeSpinOutroState } from '../game/freeSpinOutroState.svelte';

	// The full-screen GATE of the free-spin outro (§17 Phase 3): the dim, the count-up
	// driver (`WinCountUpProvider`), the board-centred `WinCoins` particles, the
	// press-to-continue (skip the count-up vs resolve the round) — and it OWNS the
	// round-blocking await. Publishes the win level + the live count-up amount to
	// `freeSpinOutroState` so the positionable VISUAL (`FreeSpinOutroVisual`) renders the
	// spine + count. Stays full-screen (`canvas`), never editor-positioned.
	const context = getContext();

	let show = $state(true);
	let amount = $state(0);
	let winLevelData = $state<WinLevelData>();
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		freeSpinOutroShow: () => (show = true),
		freeSpinOutroHide: async () => (show = false),
		freeSpinOutroCountUp: async (emitterEvent) => {
			amount = emitterEvent.amount;
			winLevelData = emitterEvent.winLevelData;
			freeSpinOutroState.winLevelData = emitterEvent.winLevelData;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

<FadeContainer {show}>
	{#if winLevelData}
		{@const duration = winLevelData.presentDuration}
		<WinCountUpProvider {amount} {duration}>
			{#snippet children({ countUpAmount, startCountUp, finishCountUp, countUpCompleted })}
				<OnMount onmount={() => startCountUp()} />

				<CanvasSizeRectangle backgroundColor={0x000000} backgroundAlpha={0.5} />

				<!-- Publish the live count-up amount to the positionable VISUAL's count text. -->
				<OutroStatePublisher {countUpAmount} />

				<WinCoins emit={!countUpCompleted} levelAlias={winLevelData?.alias} />

				<PressToContinue onpress={() => (countUpCompleted ? oncomplete() : finishCountUp())} />
			{/snippet}
		</WinCountUpProvider>
	{/if}
</FadeContainer>
