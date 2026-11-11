<script lang="ts">
	import ReelSymbol from './ReelSymbol.svelte';
	import { getContext } from '../game/context';
	import { getSymbolSeat, stateGame, type ReelSymbol as Cell } from '../game/stateGame.svelte';
	import { activeGrid } from '../game/gameConfig';
	import type { ReelStripView } from '../game/reelStripView.svelte';
	import {
		createPoolViews,
		placeCells,
		shownCellsByIndex,
		shownCellsByY,
	} from '../game/reelViewPool';

	type Props = {
		reelIndex: number;
		/** The reel's strip, as `BoardBase` reads it. Only its `padding` cells are drawn here. */
		column: readonly Cell[];
		/** This layer's view of the reel, on a flat board (`BoardBase`). */
		strip?: ReelStripView;
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * A ROLLING reel's filler, drawn through a fixed set of views instead of one component per cell.
	 *
	 * A spin streams cells through the window: every lap of the pre-spin loop makes a fresh strip of
	 * them, and the slide to the result adds more. Each used to get its own `ReelSymbol`, built when
	 * the strip was made and drawn as it entered the window, then destroyed, in the flush before the
	 * Pixi tick of nearly every rolling frame. Filler never rests, wins or is held by anything, so it
	 * needs no identity of its own: these `slots` views are built once, kept, and handed one filler
	 * cell after another (`game/reelViewPool.ts`), vacant at rest and between rolls.
	 *
	 * WHICH VIEW DRAWS WHICH CELL. Strip neighbours are one pitch apart, so a cell's place in the
	 * strip modulo `slots` picks its view. There are `rows + 2` views, so cells of one view are
	 * `rows + 2` pitches apart and no two of them are ever in the window together. A view takes its
	 * next cell on the frame that cell enters the window — the frame its own `ReelSymbol` would have
	 * drawn it — and starts its art there as a new mount's would: a sprite is handed the new texture,
	 * anything else starts again (a rig on frame 0, a state's Element FX and its beat gate fresh).
	 * What is kept is the view itself: its `ReelSymbol`, its `SymbolWrap` (mounted, hidden outside the
	 * window), the `Symbol`'s band containers and a bound sprite.
	 *
	 * The reel engine renumbers the strip each lap (the cells stay where they are on screen), so the
	 * place is carried across renumbering by an ordinal fixed when a cell is first seen.
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

	/**
	 * Each view's cell now: of the cells it serves that have entered the window (its row touching the
	 * top edge — the strip moves down), the most recent one. Flat: the strip view says from which
	 * index the rows have touched the top edge (the same test at the same `y`), so nothing here reads
	 * the moving position. Recomputed as cells cross, so it holds the cells themselves: a view's item
	 * changes only when its cell or its vacancy does (`createPoolViews`).
	 */
	const shown = $derived(
		props.strip
			? shownCellsByIndex(placed, slots, props.strip.enteredFrom)
			: shownCellsByY(placed, slots, yOf, enterAt),
	);
	const poolViews = createPoolViews<Cell>();
	const views = $derived(poolViews(shown));
</script>

{#each views as view, slot (slot)}
	{#if view.cell}
		<ReelSymbol
			view="filler"
			vacant={view.vacant}
			reelIndex={props.reelIndex}
			row={rowOf.get(view.cell) ?? 0}
			reelSymbol={view.cell}
			strip={props.strip}
		/>
	{/if}
{/each}
