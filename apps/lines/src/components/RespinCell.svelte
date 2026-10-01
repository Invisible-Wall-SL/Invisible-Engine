<script lang="ts">
	import { Container, Rectangle } from 'pixi-svelte';
	import { SYMBOL_SIZE, type RespinBoardCell, type SymbolState } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { cellWindow, getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';

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

	/** Only the symbols near the window are drawn — a rolling strip runs twenty cells long. */
	const near = (y: number) => Math.abs(y - (cellBox.top + cellBox.height / 2)) < cellBox.height;

	/**
	 * The cell's reel lands on `land`, but a respin cell does not play it: a landed coin plays its land
	 * as it STICKS, in the held layer (`coinsLand`), and an empty cell has nothing to celebrate.
	 */
	const shownState = (state: SymbolState): SymbolState => (state === 'land' ? 'static' : state);
</script>

<Container visible={!props.held}>
	<Rectangle
		isMask
		x={seat.x - columnPitch / 2}
		y={cellBox.top}
		width={columnPitch}
		height={cellBox.height}
	/>
	{#each props.cell.cellReel.reelState.symbols as reelSymbol (reelSymbol)}
		{@const y = yOf(reelSymbol)}
		{#if near(y)}
			<Container x={seat.x} {y} {scale}>
				<Symbol
					state={shownState(reelSymbol.symbolState)}
					rawSymbol={reelSymbol.rawSymbol}
					oncomplete={() => {
						if (reelSymbol.symbolState === 'land') reelSymbol.symbolState = 'static';
					}}
				/>
			</Container>
		{/if}
	{/each}
</Container>
