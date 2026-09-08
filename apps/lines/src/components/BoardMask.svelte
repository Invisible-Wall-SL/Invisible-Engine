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
		 * Let a `reelGrid` node's authored SYMBOL OVERFLOW grow this mask once the REELS have settled,
		 * so art drawn bigger than its cell is not cut off at the window edge (`boardOverflow`).
		 *
		 * For the reel board only — it is gated on reel motion, which is a question only the reel board
		 * can answer about itself. The cascade overlay passes {@link overlaySettled} instead.
		 */
		allowOverflow?: boolean;
		/**
		 * The CASCADE overlay's own answer to "is anything crossing the window edge right now".
		 *
		 * It needs one because the reel-motion gate is blind to it: `reelState.motion`/`rolling` are
		 * written only by a reel's spin loop, and a swap-in-place board never spins — so every reel
		 * reads settled for the overlay's entire life, mid-fall included. `allowOverflow` there would
		 * be spent 100% of the time and would uncover falling and queued symbols.
		 *
		 * `true` ⇒ every symbol is resting on its seat, so its authored `intro` / `explosion` art may
		 * spill exactly as a landed reel symbol's does. Absent ⇒ the tight window, unchanged.
		 */
		overlaySettled?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * `{ x: 0, y: 0 }` for every board that authored no overflow, for a reel board mid-roll, for an
	 * overlay mid-transit, and for any mount that asked for neither — and that zero is what keeps
	 * every existing board's mask byte-identical.
	 *
	 * The two props are asked in order and never combined: a mount is either the reel board (which
	 * owns the motion gate) or the overlay (which owns its transit counter), never both.
	 */
	const overflow = $derived(
		props.allowOverflow
			? context.stateGameDerived.boardOverflow()
			: props.overlaySettled
				? context.stateGameDerived.boardOverflowAuthored()
				: NO_OVERFLOW,
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
	     same rectangle it has always been.

	     `y` IS ALWAYS A NUMBER, never `undefined`. It was `overflow.y === 0 ? undefined : -overflow.y`
	     for one release, on the theory that skipping the prop was the parity-safe way to leave an
	     un-authored board's container untouched. It is the opposite: `propsSyncEffect` skips an
	     undefined prop (`if (props[key] !== undefined)`), so undefined means KEEP THE PREVIOUS VALUE,
	     not "reset to 0". An authored board therefore latched — the first settle wrote `y = -overflowY`
	     and nothing ever wrote it back, so on the NEXT spin the height shrank to the tight window
	     while y stayed high: the mask sat entirely `overflowY` px too high, cutting that much off the
	     bottom of the reels and uncovering a strip above the top for the strip to show through. Worse
	     than having no overflow at all, and it read exactly like "the spin state still gets cut".
	     Writing a plain `0` costs nothing: `ObservablePoint`'s setter is guarded (`if (this._y !==
	     value)`), so an un-authored board assigns the 0 it already holds and never dirties its
	     transform. -->
	<Rectangle
		isMask
		x={-SYMBOL_SIZE - overflow.x}
		y={overflow.y === 0 ? 0 : -overflow.y}
		width={windowWidth + SYMBOL_SIZE * 2 + overflow.x * 2}
		height={windowHeight + overflow.y * 2}
	/>
{/if}
