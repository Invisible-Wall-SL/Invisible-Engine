<script lang="ts">
	import TumbleSymbol from './TumbleSymbol.svelte';
	import { tumbleBoardCombined } from '../game/stateTumble.svelte';
	import { stateGameDerived } from '../game/stateGame.svelte';

	/** Row index of the padding row above the visible board — the combined column starts there, which
	 *  is the same mapping `tumbleBoardSlideDown` tweens each symbol's target seat with. */
	const PADDING_ROW = -1;

	/**
	 * Same back-to-front problem as `BoardBase`, same answer — under perspective a cascading symbol
	 * must paint over the row behind it, and a `pixi-svelte` child's paint order is its MOUNT order.
	 * Branch, so a flat cascade keeps today's exact child order (see `BoardBase` for why that is
	 * non-negotiable).
	 */
	const perspective = $derived(!!stateGameDerived.boardPerspective());

	/**
	 * The cascade's symbols emitted back row first — as ONE flat list, not nested row/reel loops.
	 * That is the only shape that keeps the identity keying honest: a symbol whose column index
	 * shifts (`tumbleBoardRemoveExploded` filters mid-cascade) would MOVE BETWEEN nested row blocks,
	 * which destroys and rebuilds it — exactly what keying by object identity exists to prevent. In
	 * one block Svelte moves it instead, so the fall stays continuous and the Pixi children keep the
	 * back-to-front order they mounted in (survivors keep their relative order across a filter, and
	 * `tumbleBoardInit` rebuilds every symbol at the start of each step anyway).
	 */
	const rowOrder = $derived.by(() => {
		const columns = tumbleBoardCombined();
		const depth = columns.reduce((max, column) => Math.max(max, column.length), 0);
		const ordered = [];
		for (let symbolIndex = 0; symbolIndex < depth; symbolIndex += 1) {
			for (let reelIndex = 0; reelIndex < columns.length; reelIndex += 1) {
				const tumbleSymbol = columns[reelIndex]?.[symbolIndex];
				// The index SHIFTS as exploded symbols are filtered out, so the row a symbol is given is
				// its current TARGET seat — which is what the slide-down is about to move it to.
				if (tumbleSymbol) ordered.push({ reelIndex, row: symbolIndex + PADDING_ROW, tumbleSymbol });
			}
		}
		return ordered;
	});
</script>

{#if perspective}
	{#each rowOrder as seat (seat.tumbleSymbol)}
		<TumbleSymbol reelIndex={seat.reelIndex} row={seat.row} tumbleSymbol={seat.tumbleSymbol} />
	{/each}
{:else}
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
{/if}
