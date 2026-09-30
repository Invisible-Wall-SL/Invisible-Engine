<script lang="ts">
	import { getContextLayout } from 'utils-layout';
	import {
		stateOperator,
		autoSpinsOptions,
		selectedAutoSpinsOption,
		setAutoSpinsOption,
	} from 'state-shared';
	import { OptionsGrid } from 'components-shared';

	import BaseIcon from './BaseIcon.svelte';
	import BaseButtonContent from './BaseButtonContent.svelte';

	const { stateLayoutDerived } = getContextLayout();

	// The landscape grid drops `1000` from the DEFAULT ladder only: an operator's list is offered
	// exactly as declared, so trimming it would hide an option their licence asked for.
	const options = $derived(
		stateLayoutDerived.layoutType() === 'landscape' && !stateOperator.autoplaySpins
			? autoSpinsOptions().filter((value) => value !== '1000')
			: autoSpinsOptions(),
	);
	const selected = $derived(selectedAutoSpinsOption());
</script>

<OptionsGrid value={selected} {options} onchange={(value) => setAutoSpinsOption(value)}>
	{#snippet option({ option })}
		<BaseIcon
			width="100%"
			height="2rem"
			border={option === selected ? '2px white solid' : '2px black solid'}
		/>
		<BaseButtonContent>
			<span style="font-size: 1rem;" class:infinity={option === '∞'} data-test="round-options">
				{option}
			</span>
		</BaseButtonContent>
	{/snippet}
</OptionsGrid>

<style lang="scss">
	.infinity {
		font-size: 1.5rem;
		line-height: 1rem;
		margin-top: 0.3rem;
	}
</style>
