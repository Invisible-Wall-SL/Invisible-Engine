<script lang="ts">
	import TumbleSymbol from './TumbleSymbol.svelte';
	import { tumbleBoardCombined } from '../game/stateTumble.svelte';
</script>

{#each tumbleBoardCombined() as tumbleSymbols, reelIndex (reelIndex)}
	<!-- Keyed by the symbol OBJECT, not its index. `tumbleBoardRemoveExploded` filters the column
	     mid-cascade, so every surviving symbol's index shifts; keying by index would tear down and
	     rebuild them, discarding the very `symbolY` Tween the slide-down is about to animate. Object
	     identity is stable across the filter, so Svelte moves them and the fall stays continuous. -->
	{#each tumbleSymbols as tumbleSymbol (tumbleSymbol)}
		<TumbleSymbol {reelIndex} {tumbleSymbol} />
	{/each}
{/each}
