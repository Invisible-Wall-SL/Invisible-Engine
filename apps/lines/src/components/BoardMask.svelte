<script lang="ts" module>
	/** The "no spill" pair, shared so a mask that never asks for one allocates nothing per render. */
	const NO_OVERFLOW = Object.freeze({ x: 0, y: 0 });
</script>

<script lang="ts">
	import { Graphics, Rectangle } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from 'engine-game';
	import { boardDimensions } from '../game/gameConfig';

	type Props = {
		debug?: boolean;
		/**
		 * Let a `reelGrid` node's authored SYMBOL OVERFLOW grow this mask once the board settles, so
		 * art drawn bigger than its cell is not cut off at the window edge (`boardOverflow`).
		 *
		 * Opt-in per mount, because only the resting reel board can afford it. The cascade overlay
		 * mounts this component too, and its symbols fall THROUGH the window edge — the same boundary
		 * a rolling strip crosses — so it keeps the tight window and passes nothing.
		 */
		allowOverflow?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	/** `{ x: 0, y: 0 }` for every board that authored no overflow, that is mid-spin, or that did not
	 *  ask for it — and that zero is what keeps every existing board's mask byte-identical. */
	const overflow = $derived(
		props.allowOverflow ? context.stateGameDerived.boardOverflow() : NO_OVERFLOW,
	);

	// Visible window height comes from the engine's ONE definition of it — `boardWindowHeight()`,
	// which `SymbolWrap`'s in-frame cull reads too. The two used to compute the same expression
	// independently, and they must not drift: a symbol culled at a different height than the mask
	// clips at pops instead of sliding under the edge. Flat, it is still rows × the reel's ACTUAL
	// row pitch (the editor reel-grid override's cellHeight+gapY; no override ⇒ rowPitchLocal ===
	// SYMBOL_SIZE ⇒ identical to `boardLayout().height`, byte-parity). Under perspective the rows
	// no longer share a pitch, so it becomes their SUM — but the mask stays a RECTANGLE: in a
	// symmetric one-point projection the far edge is a straight horizontal line, and the mask
	// already over-extends horizontally by SYMBOL_SIZE each side, so the widest (front) row is
	// never clipped.
	const windowHeight = $derived(context.stateGameDerived.boardWindowHeight());

	// Visible window width = the flush board width GROWN by the horizontal gap spread.
	// The symbol cluster is pushed rightward by `columnExtraLocal` per reel index
	// (non-square cellWidth + gapX), so the rightmost reels sit past the flush width;
	// the mask must include `(cols − 1) × columnExtraLocal` or a horizontal gap clips
	// them. No override ⇒ columnExtraLocal === 0 ⇒ identical to `boardLayout().width`
	// (byte-parity). This is the horizontal analogue of `windowHeight` above.
	const windowWidth = $derived(
		context.stateGameDerived.boardLayout().width +
			(boardDimensions().x - 1) * context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
	/**
	 * A STEPPED board's clip shape: one polygon per column, from the engine's
	 * {@link boardMaskColumns} — `undefined` for every uniform board, which takes the single
	 * `Rectangle` below, the same call it has always taken.
	 *
	 * It is ONE mask either way. The alternative — a container per column, each with its own
	 * rectangle — would force the scene graph to be column-major, and perspective needs it row-major
	 * so a front-row character paints over the row behind it. A compound mask needs no grouping, so
	 * the two modes stop being mutually exclusive and the child list stays exactly as flat as it is
	 * today.
	 */
	const maskColumns = $derived(context.stateGameDerived.boardMaskColumns(overflow.x, overflow.y));
</script>

{#if props.debug}
	<Rectangle alpha={0.5} backgroundColor={0xffffff} width={windowWidth} height={windowHeight} />
{/if}

{#if maskColumns}
	<Graphics
		isMask
		draw={(graphics) => {
			// One fill over every column's polygon — the union IS the visible board. The columns tile
			// rather than overlap (see `boardMaskColumns`), so the notch beside a short column is left
			// out of the shape, which is precisely what stops a symbol scrolling through it.
			for (const column of maskColumns) {
				graphics.poly(column.map((point) => ({ x: point.x, y: point.y })));
			}
			graphics.fill({ color: 0xffffff });
		}}
	/>
{:else}
	<!-- The window, grown by the settled board's symbol overflow — `0` on both axes for every board
	     that authored none and for every frame a reel is still moving, which is what keeps this the
	     same rectangle it has always been. -->
	<Rectangle
		isMask
		x={-SYMBOL_SIZE - overflow.x}
		y={overflow.y === 0 ? undefined : -overflow.y}
		width={windowWidth + SYMBOL_SIZE * 2 + overflow.x * 2}
		height={windowHeight + overflow.y * 2}
	/>
{/if}
