<script lang="ts">
	import type { Snippet } from 'svelte';

	import { Container } from 'pixi-svelte';
	import { getContextBoard } from 'components-shared';

	import { getContext } from '../game/context';
	import { activeGrid } from '../game/gameConfig';

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
		/** Which column this cell belongs to. Only read on a STEPPED board, where the cull window is
		 *  per column rather than board-wide — see `bottom` below. */
		reelIndex?: number;
		children: Snippet;
	};

	const props: Props = $props();
	const context = getContext();
	const boardContext = getContextBoard();
	const show = $derived(
		(boardContext.animate && props.animating) || (!boardContext.animate && !props.animating),
	);
	// Frame bound is the SAME quantity BoardMask clips at, so it comes from the same
	// place: `boardWindowHeight()`, the engine's one definition. Flat, that is still
	// rows × the reel's ACTUAL row pitch (the editor reel-grid override's
	// cellHeight+gapY) — a fixed SYMBOL_SIZE bound lets the bottom padding row's
	// symbol leak onto the unmasked animate layer when the override pitch is shorter
	// than SYMBOL_SIZE, the phantom spine "4th row" below the window. Computing it
	// here as well as in the mask is how the two drift apart the first time one of
	// them learns about perspective and the other does not.
	//
	// On a STEPPED board the window is per COLUMN, and that is not a refinement — it is load-bearing.
	// A short column is pushed DOWN into the bounding box, so its padding row (the buffer cell above
	// the visible window) lands at a y that is still inside the board-wide window. Culled against the
	// board it would therefore be drawn: a phantom symbol sitting above a short column on the unmasked
	// animate layer. `boardWindowForReel` is the same accessor `ReelColumn` masks with, so the cull
	// and the clip stay one answer. A uniform board answers `{ top: 0, height: boardWindowHeight() }`
	// by CALLING `boardWindowHeight()`, so this reads exactly as it did before the branch existed.
	const steppedWindow = $derived(
		props.reelIndex !== undefined && activeGrid().stepped
			? context.stateGameDerived.boardWindowForReel(props.reelIndex)
			: undefined,
	);
	const top = $derived(steppedWindow ? steppedWindow.top : 0);
	const bottom = $derived(
		steppedWindow
			? steppedWindow.top + steppedWindow.height
			: context.stateGameDerived.boardWindowHeight(),
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
