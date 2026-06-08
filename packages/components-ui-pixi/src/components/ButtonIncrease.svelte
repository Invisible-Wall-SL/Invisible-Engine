<script lang="ts">
	import { stateBet, stateBetDerived, stateConfig } from 'state-shared';

	import UiButton from './UiButton.svelte';
	import { getContext } from '../context';
	import { UI_BASE_SIZE } from '../constants';
	import type { UiButtonArgs } from '../types';

	const props: UiButtonArgs = $props();
	const context = getContext();
	const sizes = { width: UI_BASE_SIZE, height: UI_BASE_SIZE };
	const biggest = $derived(stateConfig.betAmountOptions[stateConfig.betAmountOptions.length - 1]);
	const disabled = $derived(!context.stateXstateDerived.isIdle() || stateBet.betAmount === biggest);

	const onpress = () => {
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });

		const nextBigger = [...stateConfig.betAmountOptions]
			.sort((a, b) => a - b)
			.find((option) => option > stateBet.betAmount);

		stateBetDerived.setBetAmount(nextBigger || biggest);
	};
</script>

<UiButton {...props} {sizes} {onpress} {disabled} icon="increase" />
