<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';
	import { getContextBoard } from 'components-shared';

	import { getContext } from '../game/context';
	import { BOARD_DIMENSIONS } from '../game/constants';

	type Props = {
		debug?: boolean;
		x: number;
		y: number;
		animating: boolean;
		children: Snippet;
	};

	const props: Props = $props();
	const context = getContext();
	const boardContext = getContextBoard();
	const show = $derived(
		(boardContext.animate && props.animating) || (!boardContext.animate && !props.animating),
	);
	// Frame bound must track the reel's ACTUAL row pitch (the editor reel-grid
	// override's cellHeight+gapY), same as BoardMask. A fixed SYMBOL_SIZE bound lets
	// the bottom padding row's symbol leak onto the unmasked animate layer when the
	// override pitch is shorter than SYMBOL_SIZE — the phantom spine "4th row" below
	// the window. No override ⇒ rowPitchLocal === SYMBOL_SIZE (byte-parity).
	const top = 0;
	const bottom = $derived(
		BOARD_DIMENSIONS.y * context.stateGameDerived.boardGeometry().rowPitchLocal,
	);
	const inFrame = $derived(props.y >= top && props.y <= bottom);
</script>

{#if props.debug || (show && inFrame)}
	<Container x={props.x} y={props.y}>
		{@render props.children()}
	</Container>
{/if}
