<script lang="ts">
	import MultiplierSymbol from './MultiplierSymbol.svelte';
	import { stateGame } from '../game/stateGame.svelte';
</script>

{#each stateGame.multiplierBoard as multiplierSymbols, reelIndex (reelIndex)}
	<!-- Keyed by the symbol OBJECT: these fly to the board centre on their own Tweens, so an index
	     key would rebuild them (and reset the flight) the moment the column's shape changed. The
	     board is sparse — a cell with no multiplier is `undefined` — hence the guard. -->
	{#each multiplierSymbols as multiplierSymbol (multiplierSymbol)}
		{#if multiplierSymbol}
			<MultiplierSymbol {multiplierSymbol} />
		{/if}
	{/each}
{/each}
