<script lang="ts">
	import ReelSymbol from './ReelSymbol.svelte';
	import { getContext } from '../game/context';
	import { getSymbolSeat, stateGame, type ReelSymbol as Cell } from '../game/stateGame.svelte';
	import { activeGrid } from '../game/gameConfig';
	import { createPoolViews, instanceIdOf, placeCells, shownCells } from '../game/reelViewPool';

	type Props = {
		reelIndex: number;
		/** The reel's strip, as `BoardBase` reads it. Only its `padding` cells are drawn here. */
		column: readonly Cell[];
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * A ROLLING reel's filler, drawn through a fixed set of views instead of one component per cell.
	 *
	 * A spin streams cells through the window: every lap of the pre-spin loop makes a fresh strip of
	 * them, and the slide to the result adds more. Each used to get its own `ReelSymbol`, built when
	 * the strip was made and drawn as it entered the window, then destroyed — the largest share of a
	 * rolling reel's frame (Svelte creating and tearing down effects, ~40% of spin CPU on a
	 * phone-class CPU). Filler never rests, wins or is held by anything, so it needs no identity of
	 * its own: these `slots` views are handed one filler cell after another (`game/reelViewPool.ts`),
	 * and each is built once and kept. Handed a cell, a view starts that cell's art as a new mount
	 * would — a rig on frame 0, a state's Element FX and its beat gate fresh — and hands a bound
	 * sprite the new texture; what is kept is the view itself: its `ReelSymbol`, its `SymbolWrap`
	 * (mounted, hidden outside the window) and the `Symbol`'s band containers.
	 */
	const slots = $derived(activeGrid().rowsForReel(props.reelIndex) + 2);

	const ordinals = new WeakMap<object, number>();
	const placed = $derived(placeCells(props.column, slots, ordinals));
	const rowOf = $derived(new Map(placed.map(({ cell, row }) => [cell, row])));

	/** The window a cell is drawn in: the SAME bound `SymbolWrap` culls at. */
	const top = $derived(
		activeGrid().stepped ? context.stateGameDerived.boardWindowForReel(props.reelIndex).top : 0,
	);
	const spinning = $derived(stateGame.board[props.reelIndex]?.reelState.motion === 'spinning');
	/** A cell's y as `ReelSymbol` places it while the reel rolls. */
	const yOf = (cell: Cell, row: number): number =>
		context.stateGameDerived.boardPerspective() && !spinning
			? getSymbolSeat(props.reelIndex, row - 1).y
			: cell.symbolY();

	/**
	 * How far above the window edge a cell counts as entered: half a row, the margin `SymbolWrap`
	 * draws a ROLLING cell at (filler only ever rolls), so a view takes its next cell on the frame
	 * that cell's row first touches the window. A view's cells are `rows + 2` pitches apart and the
	 * widened window is `rows + 1`, so no view is ever owed two at once.
	 */
	const enterAt = (row: number): number =>
		top -
		(context.stateGameDerived.boardGeometry().rowPitchLocal *
			getSymbolSeat(props.reelIndex, row - 1).scale) /
			2;

	/** Each view's cell now (recomputed every frame the reel moves). */
	const shown = $derived(shownCells(placed, slots, yOf, enterAt));

	/**
	 * The views, each with the cell it last drew: a view lives for as long as the board does, VACANT
	 * while its place holds a board cell or nothing — at rest, and at the start and end of every
	 * roll. Vacant, it draws nothing and holds nothing that runs (`ReelSymbol`'s `vacant`); a view
	 * built again every spin would only start its next cell's art the same way.
	 */
	const poolViews = createPoolViews<Cell>();
	const views = $derived(poolViews(shown));
</script>

{#each views as view, slot (slot)}
	{#if view.cell}
		<ReelSymbol
			reelIndex={props.reelIndex}
			row={rowOf.get(view.cell) ?? 0}
			reelSymbol={view.cell}
			instanceKey={instanceIdOf(view.cell)}
			vacant={view.vacant}
		/>
	{/if}
{/each}
