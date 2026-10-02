<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { respinCellKey, type HoldAndWinCell } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { coinLabelPops, type CoinLabelPopCue } from '../game/coinLabel';
	import { boardDimensions } from '../game/gameConfig';
	import { getSymbolSeat } from '../game/stateGame.svelte';
	import { completeHeldBeat, HELD_REST, stateRespinBoard } from '../game/stateRespinBoard.svelte';

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
	/** A count-up in flight on this cell's label (a payer, a multiplier, a collector collecting), or
	 *  a jackpot tier an upgrade has not reached yet. */
	const display = $derived(stateRespinBoard.heldDisplay[key]);
	const labelOverride = $derived(
		display
			? display.field === 'jackpot'
				? { jackpot: display.jackpot }
				: { [display.field]: display.tween.current }
			: undefined,
	);
	const cellState = $derived(stateRespinBoard.heldState[key] ?? HELD_REST);

	/**
	 * The authored label pops (`coinLabel.animation`): one as the coin sticks (`coinStick`), one each
	 * time a count-up lands on its new value. Off unless authored, so an unauthored label never pops.
	 */
	const pops = coinLabelPops();
	let labelPop = $state<CoinLabelPopCue>();
	let cues = 0;
	let counting = false;
	$effect(() => {
		if (pops.land && cellState === 'coinStick') labelPop = { id: ++cues, ...pops.land };
	});
	$effect(() => {
		const now = display !== undefined;
		if (counting && !now && pops.boost) labelPop = { id: ++cues, ...pops.boost };
		counting = now;
	});
</script>

<Container x={seat.x} y={seat.y} {scale} {zIndex}>
	<Symbol
		state={cellState}
		rawSymbol={props.cell.symbol}
		{labelOverride}
		{labelPop}
		oncomplete={() => completeHeldBeat(key)}
	/>
</Container>
