<script lang="ts">
	import { Container, Rectangle } from 'pixi-svelte';
	import { SYMBOL_SIZE, type RespinBoardCell, type SymbolState } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { cellWindow, getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';
	import { respinCellLook } from '../game/stateRespinBoard.svelte';

	type Props = {
		cell: RespinBoardCell;
		/** A held cell's reel is not drawn — the held layer draws the cell instead. */
		held: boolean;
	};

	const props: Props = $props();

	/**
	 * ONE CELL of the respin board: its one-cell reel's strip, clipped to the cell by its OWN mask —
	 * the strip rolls through a window one row tall, so the board-wide mask the reel board uses would
	 * let it run over the cells above and below.
	 */
	props.cell.cellReel.readyToSpinEffect();

	const seat = $derived(getSymbolSeat(props.cell.reel, props.cell.row));
	const cellBox = $derived(cellWindow(props.cell.reel, props.cell.row));
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
	 * Only the symbols near the window exist — a rolling strip runs twenty cells long, and giving
	 * every one of them its own block on every cell of the board, the frame a respin starts, cost a
	 * 50–80 ms hitch. Recomputed each frame the strip moves; a symbol mounts as it nears the window.
	 * At rest only the window's symbol (strip index 1) exists, which the opened mask relies on.
	 */
	const near = (y: number) => Math.abs(y - (cellBox.top + cellBox.height / 2)) < cellBox.height;
	const shown = $derived(
		props.cell.cellReel.reelState.symbols.filter((symbol) =>
			rolling ? near(yOf(symbol)) : symbol.symbolIndex === 1,
		),
	);

	/**
	 * The cell's reel lands on `land`, but a respin cell does not play it: a landed coin plays its land
	 * as it STICKS, in the held layer (`coinStick`), and an empty cell has nothing to celebrate. It
	 * plays `coinLand` instead — the stop, which unauthored inherits `static`. While it rolls it plays
	 * the reel's own `spin` (the blur), as a reel cell does.
	 */
	const shownState = (state: SymbolState): SymbolState => (state === 'land' ? 'coinLand' : state);
</script>

<Container visible={!props.held}>
	<Rectangle
		isMask
		x={seat.x - (columnPitch * spread) / 2}
		y={cellBox.top - (cellBox.height * (spread - 1)) / 2}
		width={columnPitch * spread}
		height={cellBox.height * spread}
	/>
	{#each shown as reelSymbol (reelSymbol)}
		<Container x={seat.x} y={yOf(reelSymbol)} {scale}>
			<Symbol
				state={shownState(reelSymbol.symbolState)}
				rawSymbol={reelSymbol.rawSymbol}
				oncomplete={() => {
					if (reelSymbol.symbolState === 'land') reelSymbol.symbolState = 'static';
				}}
			/>
		</Container>
	{/each}
</Container>
