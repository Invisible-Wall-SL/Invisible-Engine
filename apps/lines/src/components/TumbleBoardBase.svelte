<script lang="ts">
	import TumbleSymbol from './TumbleSymbol.svelte';
	import { tumbleBoardCombined } from '../game/stateTumble.svelte';

	/** Row index of the padding row above the visible board — the combined column starts there, which
	 *  is the same mapping `tumbleBoardSlideDown` tweens each symbol's target seat with. */
	const PADDING_ROW = -1;
</script>

{#each tumbleBoardCombined() as tumbleSymbols, reelIndex (reelIndex)}
	<!-- Keyed by the symbol OBJECT, not its index. `tumbleBoardRemoveExploded` filters the column
	     mid-cascade, so every surviving symbol's index shifts; keying by index would tear down and
	     rebuild them, discarding the very `symbolY` Tween the slide-down is about to animate. Object
	     identity is stable across the filter, so Svelte moves them and the fall stays continuous. -->
	{#each tumbleSymbols as tumbleSymbol, symbolIndex (tumbleSymbol)}
		<!-- The index SHIFTS as exploded symbols are filtered out, so the row a symbol is given is its
		     current TARGET seat — which is what the slide-down is about to move it to. -->
		<TumbleSymbol {reelIndex} row={symbolIndex + PADDING_ROW} {tumbleSymbol} />
	{/each}
{/each}
