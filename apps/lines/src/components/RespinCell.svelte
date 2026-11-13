<script lang="ts">
	import { Container, Rectangle } from 'pixi-svelte';
	import { respinCellKey, SYMBOL_SIZE, type RespinBoardCell, type SymbolState } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { respinCellStopState } from '../game/respinLanding';
	import { symbolDrawsNothing } from '../game/symbolDraws';
	import { cellWindow, getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';
	import {
		completeCellLanding,
		respinCellLook,
		respinSeatRow,
	} from '../game/stateRespinBoard.svelte';
	import { createShownViews } from '../game/reelViewPool';

	type Props = {
		cell: RespinBoardCell;
		/** A held cell's reel is not drawn — the held layer draws the cell instead. */
		held: boolean;
		/** The board is put away between features (`respinBoardKeep.ts`): the window shows nothing,
		 *  so every view is vacant and its art put away. */
		away?: boolean;
		/** Its paint order among the cells, the order a board mounted for this feature appended them
		 *  in (`createVisitOrder`). */
		order?: number;
	};

	const props: Props = $props();

	/**
	 * ONE CELL of the respin board: its one-cell reel's strip, clipped to the cell by its OWN mask —
	 * the strip rolls through a window one row tall, so the board-wide mask the reel board uses would
	 * let it run over the cells above and below.
	 */
	props.cell.cellReel.readyToSpinEffect();

	const seat = $derived(getSymbolSeat(props.cell.reel, respinSeatRow(props.cell.row)));
	const cellBox = $derived(cellWindow(props.cell.reel, respinSeatRow(props.cell.row)));
	/** The column pitch — the mask's width, so art drawn to its cell's width is never clipped sideways. */
	const columnPitch = $derived(SYMBOL_SIZE + stateGameDerived.boardGeometry().columnExtraLocal);
	const rolling = $derived(props.cell.cellReel.reelState.motion !== 'stopped');
	/**
	 * The mask is the cell while the strip rolls — less the authored gap (`respinCells`), so the cells
	 * read as separate windows on their tiles; at rest it opens to three cells, so a landed
	 * symbol's art draws whole like the reel board's (only the window's symbol exists at rest —
	 * see `shown` — so nothing else can show through).
	 */
	const spread = $derived(rolling ? 1 - (respinCellLook()?.gap ?? 0) : 3);
	/** A flat seat leaves the container's scale untouched (see `SymbolWrap`). */
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);

	/**
	 * Under perspective the RESTING symbol (strip index 1, the window) sits on its SEAT, as on the reel
	 * board (`ReelSymbol`); while the strip rolls, and always on a flat board, every symbol sits where
	 * the strip puts it.
	 */
	const yOf = (reelSymbol: { symbolIndex: number; symbolY: () => number }) =>
		stateGameDerived.boardPerspective() && !rolling && reelSymbol.symbolIndex === 1
			? seat.y
			: reelSymbol.symbolY();

	/**
	 * Only the symbols near the window are drawn — a rolling strip runs twenty cells long, and giving
	 * every one of them its own block on every cell of the board, the frame a respin starts, cost a
	 * 50–80 ms hitch. Recomputed each frame the strip moves; a symbol is drawn as it nears the window.
	 * At rest only the window's symbol (strip index 1) is, which the opened mask relies on. A symbol
	 * that draws nothing in its state (`symbolDrawsNothing`: the blanks most of a strip is made of) is
	 * not drawn at all, rolling or at rest.
	 */
	const near = (y: number) => Math.abs(y - (cellBox.top + cellBox.height / 2)) < cellBox.height;
	const shown = $derived(
		props.away
			? []
			: props.cell.cellReel.reelState.symbols.filter(
					(symbol) =>
						(rolling ? near(yOf(symbol)) : symbol.symbolIndex === 1) &&
						!symbolDrawsNothing(symbol.rawSymbol, shownState(symbol)),
				),
	);

	/**
	 * The cell's reel lands on `land`, but by default a respin cell does not play it: a landed coin
	 * plays its land as it STICKS, in the held layer (`coinStick`), and an empty cell has nothing to
	 * celebrate. It plays `coinLand` instead — the stop, which unauthored inherits `static`. Under
	 * Invisible Symbols → "Play Land as each cell stops" the stop plays `land` itself
	 * (`respinCellStopState`). While it rolls it plays the reel's own `spin` (the blur), as a reel
	 * cell does.
	 */
	const shownState = (symbol: { symbolState: SymbolState; rawSymbol: { name: string } }) =>
		symbol.symbolState === 'land' ? respinCellStopState(symbol.rawSymbol.name) : symbol.symbolState;
	const key = $derived(respinCellKey(props.cell.reel, props.cell.row));

	/**
	 * The shown symbols through views (`createShownViews`): a symbol keeps one view for as long as it
	 * is shown, and the views the last ones left draw the next, so a respin mounts no `Symbol` per
	 * symbol that rolls past; a cell has as many views as its window ever showed symbols at once (two).
	 * A view starts each symbol's art as a new mount would (an entry), keeps its sprite, and is hidden
	 * and left where it was while vacant. Its entry is its paint order, as a symbol mounted later was
	 * appended over the others.
	 */
	const shownViews = createShownViews<(typeof shown)[number]>();
	const views = $derived(shownViews(shown));
</script>

<Container visible={!props.held} zIndex={props.order}>
	<Rectangle
		isMask
		x={seat.x - (columnPitch * spread) / 2}
		y={cellBox.top - (cellBox.height * (spread - 1)) / 2}
		width={columnPitch * spread}
		height={cellBox.height * spread}
	/>
	{#each views as view (view.id)}
		<Container
			x={seat.x}
			y={view.entry === undefined ? undefined : yOf(view.cell)}
			{scale}
			zIndex={view.entry}
			visible={view.entry !== undefined}
		>
			<Symbol
				state={shownState(view.cell)}
				rawSymbol={view.cell.rawSymbol}
				instanceKey={view.entry}
				vacant={view.entry === undefined}
				oncomplete={() => {
					const reelSymbol = view.cell;
					if (reelSymbol.symbolState !== 'land') return;
					reelSymbol.symbolState = 'static';
					completeCellLanding(key);
				}}
			/>
		</Container>
	{/each}
</Container>
