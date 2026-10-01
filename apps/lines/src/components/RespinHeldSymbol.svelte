<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { respinCellKey, type HoldAndWinCell } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { boardDimensions } from '../game/gameConfig';
	import { getSymbolSeat } from '../game/stateGame.svelte';
	import { completeHeldBeat, stateRespinBoard } from '../game/stateRespinBoard.svelte';

	type Props = { cell: HoldAndWinCell };

	const props: Props = $props();

	/**
	 * A STUCK cell — a coin, a jackpot or a special held on the respin board. Drawn through the same
	 * `Symbol` as every reel cell, so its art, layers and value label (`coinLabelFor`) come with it,
	 * and a value a payer raises is redrawn in place: the cell is keyed by its position, not its value.
	 */
	const key = $derived(respinCellKey(props.cell.reel, props.cell.row));
	const seat = $derived(getSymbolSeat(props.cell.reel, props.cell.row));
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
	/**
	 * Paint order by SEAT, never by when the cell stuck: cells join this layer one respin at a time,
	 * and pixi-svelte appends a late child at the end. Column-major, like a flat reel board, and
	 * strictly positive so the parent sorts only once a cell exists.
	 */
	const zIndex = $derived(1 + props.cell.reel * boardDimensions().y + props.cell.row);
</script>

<Container x={seat.x} y={seat.y} {scale} {zIndex}>
	<Symbol
		state={stateRespinBoard.heldState[key] ?? 'static'}
		rawSymbol={props.cell.symbol}
		oncomplete={() => completeHeldBeat(key)}
	/>
</Container>
