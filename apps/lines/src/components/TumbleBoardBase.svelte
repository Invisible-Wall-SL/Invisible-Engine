<script lang="ts">
	import TumbleSymbol from './TumbleSymbol.svelte';
	import ReelColumn from './ReelColumn.svelte';
	import { tumbleBoardCombined } from '../game/stateTumble.svelte';
	import { stateGameDerived } from '../game/stateGame.svelte';
	import { activeGrid } from '../game/gameConfig';

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
	 * Does the board have columns of differing height (docs/design/stepped-grid.md)? A stepped
	 * cascade needs the SAME per-column clip window the resting reel board grew, for the same two
	 * reasons and then one of its own:
	 *
	 *  - the resting cascade layer is clipped by the board-wide `BoardMask` rectangle, which is the
	 *    BOUNDING BOX — so a short column's replacements, which are stacked deliberately ABOVE its
	 *    window waiting to fall, sit at a y that is still inside that rectangle and would simply be
	 *    DRAWN, hanging above the column;
	 *  - a DRAIN slides a column's symbols out through the bottom of its own window, which on a short
	 *    column is likewise still inside the board — they would fall a little way and then just sit
	 *    there instead of leaving.
	 *
	 * The columns are already the outer loop below, so this is a wrapper rather than a restructure.
	 * Not combined with `perspective`, which needs the row-major flat list — the same mutually
	 * exclusive paint orders as `BoardBase`, resolved the same way and warned about in the editor.
	 */
	const stepped = $derived(!perspective && activeGrid().stepped);

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
{:else if stepped}
	{#each tumbleBoardCombined() as tumbleSymbols, reelIndex (reelIndex)}
		<!-- The column wrapper carries this column's own clip window. A symbol never changes COLUMN
		     during a cascade — it only moves up and down within one — so grouping by column cannot
		     move a symbol between keyed blocks, and the object keying below is as stable as it is in
		     the flat branch. (Grouping by ROW would not be: that is what the perspective branch's
		     one flat list exists to avoid.) -->
		<ReelColumn {reelIndex}>
			{#each tumbleSymbols as tumbleSymbol, symbolIndex (tumbleSymbol)}
				<TumbleSymbol {reelIndex} row={symbolIndex + PADDING_ROW} {tumbleSymbol} />
			{/each}
		</ReelColumn>
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
