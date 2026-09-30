<script lang="ts">
	import {
		singleWinLimitOptions,
		selectedSingleWinLimitOption,
		setAutoSpinsSingleWinLimitOption,
	} from 'state-shared';
	import { OptionsGrid } from 'components-shared';

	import BaseIcon from './BaseIcon.svelte';
	import BaseButtonContent from './BaseButtonContent.svelte';
	import { i18nDerived } from '../i18n/i18nDerived';

	const selected = $derived(selectedSingleWinLimitOption());
</script>

<span class="title">{i18nDerived.singleWinLimit()}</span>

<OptionsGrid
	miniSize
	value={selected}
	options={singleWinLimitOptions()}
	onchange={(value) => setAutoSpinsSingleWinLimitOption(value)}
>
	{#snippet option({ option })}
		<BaseIcon
			width="100%"
			height="2rem"
			border={option === selected ? '2px white solid' : '2px black solid'}
		/>
		<BaseButtonContent>
			<span
				style="font-size: 1rem;"
				class:infinity={option === '∞'}
				class="option-wrap"
				data-test="single-win-limit-options"
			>
				{option}
			</span>
		</BaseButtonContent>
	{/snippet}
</OptionsGrid>

<style lang="scss">
	.title {
		line-height: 2rem;
	}

	.option-wrap {
		white-space: nowrap;
	}

	.infinity {
		font-size: 1.5rem;
		line-height: 1rem;
		margin-top: 0.3rem;
		vertical-align: middle;
	}
</style>
