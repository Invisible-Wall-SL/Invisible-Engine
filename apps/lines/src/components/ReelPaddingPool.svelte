<script lang="ts" module>
	/** A number per cell for the pooled view's `{#key}`: `{#key}` treats every object as new. */
	const instanceIds = new WeakMap<object, number>();
	let nextInstanceId = 1;
	const instanceIdOf = (cell: object): number => {
		let id = instanceIds.get(cell);
		if (id === undefined) {
			id = nextInstanceId++;
			instanceIds.set(cell, id);
		}
		return id;
	};
</script>

<script lang="ts">
	import ReelSymbol from './ReelSymbol.svelte';
	import { getContext } from '../game/context';
	import { getSymbolSeat, stateGame, type ReelSymbol as Cell } from '../game/stateGame.svelte';
	import { activeGrid } from '../game/gameConfig';

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
	 * rolling reel's frame (Svelte creating and tearing down effects, ~40% of spin CPU on a phone-class
	 * CPU). Filler never rests, wins or is held by anything, so it needs no identity of its own: these
	 * `slots` views are handed one filler cell after another.
	 *
	 * WHICH VIEW DRAWS WHICH CELL. Strip neighbours are one pitch apart, so a cell's place in the
	 * strip modulo `slots` picks its view; with one view more than the window can show plus one, no two
	 * cells of a view are ever in the window together. A view takes its next cell on the frame that
	 * cell enters the window — the frame its own `ReelSymbol` would have drawn it — and everything
	 * inside the view is keyed on the cell (`instanceKey`), so the art starts there as a new mount's
	 * would: a rig on frame 0, a state's Element FX and its beat gate fresh. What is kept is the view
	 * itself: its `ReelSymbol`, its `SymbolWrap` (mounted, hidden outside the window) and the
	 * `Symbol`'s band containers.
	 *
	 * The reel engine renumbers the strip each lap (the cells stay where they are on screen), so the
	 * place is carried across renumbering by an ordinal fixed when a cell is first seen.
	 */
	const slots = $derived(activeGrid().rowsForReel(props.reelIndex) + 2);

	const ordinals = new WeakMap<object, number>();
	const placed = $derived.by(() => {
		const column = props.column;
		let base = 0;
		for (let row = 0; row < column.length; row++) {
			const known = ordinals.get(column[row]);
			if (known !== undefined) {
				base = known - row;
				break;
			}
		}
		return column.map((cell, row) => {
			let ordinal = ordinals.get(cell);
			if (ordinal === undefined) {
				ordinal = row + base;
				ordinals.set(cell, ordinal);
			}
			return { cell, row, slot: ((ordinal % slots) + slots) % slots };
		});
	});

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
	 * Each view's cell now: of the cells it serves that have entered the window (y at or below its
	 * top edge — the strip moves down), the most recent one. A board cell in that place means the
	 * view has nothing to draw: that cell is drawn as board cells are.
	 */
	const shown = $derived.by(() => {
		const best: ({ cell: Cell; row: number; y: number } | undefined)[] = Array(slots);
		for (const { cell, row, slot } of placed) {
			const y = yOf(cell, row);
			if (y < top) continue;
			const current = best[slot];
			if (!current || y < current.y) best[slot] = { cell, row, y };
		}
		return Array.from(best, (entry) => (entry?.cell.padding ? entry : undefined));
	});
</script>

{#each shown as entry, slot (slot)}
	{#if entry}
		<ReelSymbol
			reelIndex={props.reelIndex}
			row={entry.row}
			reelSymbol={entry.cell}
			instanceKey={instanceIdOf(entry.cell)}
		/>
	{/if}
{/each}
