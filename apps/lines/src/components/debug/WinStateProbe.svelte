<script lang="ts">
	import { stateBet, stateBetDerived } from 'state-shared';
	import {
		numberToCurrencyString,
		bookEventAmountToCurrencyString,
		bookEventAmountToBetAmountMultiplier,
	} from 'utils-shared/amount';

	const rows = $derived([
		{ label: 'balance', value: numberToCurrencyString(stateBet.balanceAmount) },
		{ label: 'bet', value: numberToCurrencyString(stateBetDerived.betCost()) },
		{ label: 'win', value: bookEventAmountToCurrencyString(stateBet.winBookEventAmount) },
		{
			label: 'win ×bet',
			value: `${bookEventAmountToBetAmountMultiplier(stateBet.winBookEventAmount).toFixed(2)}×`,
		},
		{ label: 'mode', value: stateBet.activeBetModeKey },
		{ label: 'turbo', value: stateBet.isTurbo ? 'on' : 'off' },
		{ label: 'autoSpins', value: String(stateBet.autoSpinsCounter) },
	]);
</script>

<div class="win-probe">
	<div class="win-probe__title">Win-state</div>
	{#each rows as row (row.label)}
		<div class="win-probe__row">
			<span class="win-probe__key">{row.label}</span>
			<span class="win-probe__val">{row.value}</span>
		</div>
	{/each}
</div>

<style lang="scss">
	.win-probe {
		position: absolute;
		left: 12px;
		bottom: 12px;
		min-width: 180px;
		padding: 8px 10px;
		color: #fff;
		background: rgba(10, 10, 18, 0.92);
		border: 1px solid #3a3a4a;
		border-radius: 8px;
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 12px;
	}

	.win-probe__title {
		padding-bottom: 6px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #9fd3ff;
	}

	.win-probe__row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 2px 0;
	}

	.win-probe__key {
		opacity: 0.6;
	}
</style>
