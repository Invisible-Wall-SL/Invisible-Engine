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
</script>

{#if props.debug}
	<Rectangle
		alpha={0.5}
		backgroundColor={0xffffff}
		width={context.stateGameDerived.boardLayout().width}
		height={windowHeight}
	/>
{/if}

<Rectangle
	isMask
	x={-SYMBOL_SIZE}
	width={context.stateGameDerived.boardLayout().width + SYMBOL_SIZE * 2}
	height={windowHeight}
/>
