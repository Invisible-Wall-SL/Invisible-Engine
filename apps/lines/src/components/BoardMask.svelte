<script lang="ts">
	import { Rectangle } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE, BOARD_DIMENSIONS } from '../game/constants';

	type Props = { debug?: boolean };

	const props: Props = $props();
	const context = getContext();

	// Visible window height = rows × the reel's ACTUAL row pitch. The symbols are
	// pitched at `boardGeometry().rowPitchLocal` (driven by the editor reel-grid
	// override's cellHeight+gapY); the mask must use the same pitch or a shorter
	// pitch lets a padding row leak through. No override ⇒ rowPitchLocal ===
	// SYMBOL_SIZE ⇒ identical to `boardLayout().height` (byte-parity).
	const windowHeight = $derived(
		BOARD_DIMENSIONS.y * context.stateGameDerived.boardGeometry().rowPitchLocal,
	);

	// Visible window width = the flush board width GROWN by the horizontal gap spread.
	// The symbol cluster is pushed rightward by `columnExtraLocal` per reel index
	// (non-square cellWidth + gapX), so the rightmost reels sit past the flush width;
	// the mask must include `(cols − 1) × columnExtraLocal` or a horizontal gap clips
	// them. No override ⇒ columnExtraLocal === 0 ⇒ identical to `boardLayout().width`
	// (byte-parity). This is the horizontal analogue of `windowHeight` above.
	const windowWidth = $derived(
		context.stateGameDerived.boardLayout().width +
			(BOARD_DIMENSIONS.x - 1) * context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
</script>

{#if props.debug}
	<Rectangle alpha={0.5} backgroundColor={0xffffff} width={windowWidth} height={windowHeight} />
{/if}

<Rectangle isMask x={-SYMBOL_SIZE} width={windowWidth + SYMBOL_SIZE * 2} height={windowHeight} />
