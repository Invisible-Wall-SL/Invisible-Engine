<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container, Rectangle } from 'pixi-svelte';
	import { getContextBoard } from 'components-shared';
	import { SYMBOL_SIZE } from 'engine-game';

	import { getContext } from '../game/context';
	import { boardDimensions } from '../game/gameConfig';

	type Props = {
		reelIndex: number;
		children: Snippet;
	};

	const props: Props = $props();
	const context = getContext();
	const boardContext = getContextBoard();

	/**
	 * ONE COLUMN's clip window. A stepped board cannot be clipped by the single board-wide rectangle
	 * `BoardMask` draws: that rectangle is the BOUNDING BOX, so a short column's symbols would scroll
	 * visibly above and below the window it is supposed to occupy — the reel would roll through the
	 * empty space its neighbours fill. Each column therefore carries its own mask, and
	 * `boardWindowForReel` is where its two edges come from, the same accessor `SymbolWrap` culls
	 * against so the clip and the cull cannot drift.
	 */
	const window = $derived(context.stateGameDerived.boardWindowForReel(props.reelIndex));

	/**
	 * HORIZONTALLY this is `BoardMask`'s rectangle verbatim, including its `SYMBOL_SIZE` of slack on
	 * each side. Only the VERTICAL edges differ per column, so a symbol that overhangs its cell
	 * sideways (a spine wider than its seat) is clipped exactly where it is today. The slack makes
	 * neighbouring columns' masks overlap, which costs nothing: each one only ever clips its own
	 * container's children.
	 */
	const windowWidth = $derived(
		context.stateGameDerived.boardLayout().width +
			(boardDimensions().x - 1) * context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
</script>

<Container>
	<!--
		The ANIMATE layer carries no mask, exactly as it carries no `BoardMask` today: a winning
		symbol moves onto it precisely so it can draw in full, outside the board window. It is culled
		instead, per column, by `SymbolWrap`.
	-->
	{#if !boardContext.animate}
		<Rectangle
			isMask
			x={-SYMBOL_SIZE}
			y={window.top}
			width={windowWidth + SYMBOL_SIZE * 2}
			height={window.height}
		/>
	{/if}
	{@render props.children()}
</Container>
