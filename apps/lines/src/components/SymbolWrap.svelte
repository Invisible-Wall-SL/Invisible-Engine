<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';
	import { getContextBoard } from 'components-shared';

	import { getContext } from '../game/context';
	import { boardDimensions } from '../game/gameConfig';

	type Props = {
		debug?: boolean;
		x: number;
		y: number;
		animating: boolean;
		/** Multiplied down to every child (sprite / spine / flipbook) by Pixi v8's cascading
		 *  `Container.tint`. Drives the win-celebration dim; `0xffffff` (the default) is untouched. */
		tint?: number;
		/** The SEAT's row scale (`getSymbolSeat`). Perspective gives each row its own size; a flat
		 *  board gives every row `1`. Applied to the container the symbol art already sizes itself
		 *  inside, so the art's own contain-fit is untouched and the scale multiplies once. */
		scale?: number;
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
		boardDimensions().y * context.stateGameDerived.boardGeometry().rowPitchLocal,
	);
	const inFrame = $derived(props.y >= top && props.y <= bottom);
	// A flat seat passes `undefined`, NOT 1, because `1` is not a no-op in Pixi v8: assigning
	// `container.scale` swaps the shared `defaultScale` singleton for an owned `ObservablePoint` and
	// dirties the transform. `pixi-svelte`'s `propsSyncEffect` skips undefined props, so an unscaled
	// symbol's container is left exactly as it was before this prop existed (byte-parity).
	const scale = $derived(props.scale === 1 ? undefined : props.scale);
</script>

{#if props.debug || (show && inFrame)}
	<Container x={props.x} y={props.y} {scale} tint={props.tint ?? 0xffffff}>
		{@render props.children()}
	</Container>
{/if}
