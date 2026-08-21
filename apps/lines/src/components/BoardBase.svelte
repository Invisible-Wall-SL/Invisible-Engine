<script lang="ts">
	import ReelSymbol from './ReelSymbol.svelte';
	import { getContext } from '../game/context';

	const context = getContext();

	/**
	 * Under PERSPECTIVE the board reads as ground, so a front-row character has to paint OVER the row
	 * behind it. A `pixi-svelte` child's paint order is its MOUNT order (`addToParent` does
	 * `addChild` + `sortChildren()` on mount), which is the order these `{#each}` blocks emit — so
	 * back-to-front is bought by iterating ROW-major: back row first, front row last. Deterministic,
	 * with no per-frame sort and no z-index bookkeeping to fall out of step with the seats.
	 *
	 * It is a BRANCH, not a straight swap, because a FLAT board must keep today's exact child order.
	 * Reordering the loops reorders Pixi's children for every game, flat ones included, and symbols
	 * can already overlap today (a spine symbol may overhang its cell) — so an unconditional swap
	 * would silently repaint every online game running the shared `_runtime/lines` bundle, with no
	 * authored change to blame. Perspective is authored per project, so the branch is decided once,
	 * when the layout doc loads, and never flips during play.
	 */
	const perspective = $derived(!!context.stateGameDerived.boardPerspective());
	/** Longest reel strip. The rows are the OUTER loop now, so they need a count of their own; taken
	 *  from the real strips rather than from the board's row count because a strip carries padding
	 *  rows (and grows while it spins), and a missing cell is skipped below. */
	const stripLength = $derived(
		context.stateGame.board.reduce((max, reel) => Math.max(max, reel.reelState.symbols.length), 0),
	);
</script>

{#if perspective}
	{#each { length: stripLength }, row (row)}
		{#each context.stateGame.board as reel, reelIndex (reelIndex)}
			{@const reelSymbol = reel.reelState.symbols[row]}
			{#if reelSymbol}
				<ReelSymbol {reelIndex} {row} {reelSymbol} />
			{/if}
		{/each}
	{/each}
{:else}
	{#each context.stateGame.board as reel, reelIndex (reelIndex)}
		{#each reel.reelState.symbols as reelSymbol, row}
			<ReelSymbol {reelIndex} {row} {reelSymbol} />
		{/each}
	{/each}
{/if}
