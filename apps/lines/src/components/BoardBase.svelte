<script lang="ts">
	import ReelSymbol from './ReelSymbol.svelte';
	import { getContext } from '../game/context';
	import { stateTumble, tumbleBoardCombined } from '../game/stateTumble.svelte';

	const context = getContext();

	/**
	 * THE ONE MOUNT SITE for the board's cells, whoever is driving them.
	 *
	 * The reels drive the strips; a cascade drives its own two layers over the same cells
	 * (`stateTumble`). It used to be two component trees that never coexisted — the reel board and
	 * the cascade overlay — and a cell drawn by a different component is a cell whose clip starts
	 * again at frame one, which is why every symbol restarted board-wide each time the board changed
	 * hands (`docs/design/board-cell-continuity.md`).
	 */
	const columns = $derived(
		stateTumble.active
			? tumbleBoardCombined()
			: context.stateGame.board.map((reel) => reel.reelState.symbols),
	);

	/**
	 * Under PERSPECTIVE the board reads as ground, so a front-row character has to paint OVER the row
	 * behind it, and this list is emitted ROW-major: back row first, front row last.
	 *
	 * PAINT ORDER NO LONGER RIDES ON IT. It used to: a `pixi-svelte` child is `addChild`-ed once in
	 * `onMount` and nothing re-derived the order, so the emit order WAS the stacking — until a cell
	 * mounted late (a cascade's refills, the in-frame cull) and was appended to the end of the
	 * container, in front of everything. Each cell now carries a seat-derived `zIndex`
	 * (`ReelSymbol`), which is the single statement of who draws over whom; this ordering only breaks
	 * ties between equal indices, and there are none.
	 *
	 * The branch stays because it is still load-bearing for IDENTITY — see the flat-board note below.
	 *
	 * ONE FLAT LIST rather than nested row/reel loops, and that is what keeps the identity keying
	 * honest: a cell whose row shifts (a cascade filters survivors and splices refills above them)
	 * would MOVE BETWEEN nested row blocks, which destroys and rebuilds it — exactly what keying by
	 * identity exists to prevent. In one block Svelte moves it instead.
	 *
	 * It is a BRANCH, not a straight swap, because a FLAT board must keep today's exact child order.
	 * Reordering the loops reorders Pixi's children for every game, flat ones included, and symbols
	 * can already overlap today (a spine symbol may overhang its cell) — so an unconditional swap
	 * would silently repaint every online game running the shared `_runtime/lines` bundle, with no
	 * authored change to blame. Perspective is authored per project, so the branch is decided once,
	 * when the layout doc loads, and never flips during play.
	 */
	const perspective = $derived(!!context.stateGameDerived.boardPerspective());
	const rowOrder = $derived.by(() => {
		const depth = columns.reduce((max, column) => Math.max(max, column.length), 0);
		const ordered = [];
		for (let row = 0; row < depth; row += 1) {
			for (let reelIndex = 0; reelIndex < columns.length; reelIndex += 1) {
				const reelSymbol = columns[reelIndex]?.[row];
				if (reelSymbol) ordered.push({ reelIndex, row, reelSymbol });
			}
		}
		return ordered;
	});
</script>

<!--
	Keyed by the CELL, not by its index. A cascade filters its survivor layer and splices the step's
	refills in above them, so a surviving symbol's index shifts mid-step; keyed by index it would be
	handed to a different component and torn down, discarding the very Tween the slide is animating.
	Identity is stable across both, so Svelte moves it and the fall stays continuous — and it is
	stable across the seam into and out of a cascade too, because the cascade drives the board's own
	cells and hands them back rather than cloning them.
-->
{#if perspective}
	{#each rowOrder as seat (seat.reelSymbol)}
		<ReelSymbol reelIndex={seat.reelIndex} row={seat.row} reelSymbol={seat.reelSymbol} />
	{/each}
{:else}
	{#each columns as column, reelIndex (reelIndex)}
		{#each column as reelSymbol, row (reelSymbol)}
			<ReelSymbol {reelIndex} {row} {reelSymbol} />
		{/each}
	{/each}
{/if}
