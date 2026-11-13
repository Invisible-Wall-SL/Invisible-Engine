<script lang="ts">
	import { Container, Text } from 'pixi-svelte';
	import { respinCellKey, SYMBOL_SIZE, type HoldAndWinCell } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { coinLabelPops, type CoinLabelPopCue } from '../game/coinLabel';
	import { boardDimensions } from '../game/gameConfig';
	import { respinHeldState } from '../game/respinLanding';
	import { getSymbolSeat } from '../game/stateGame.svelte';
	import {
		completeHeldBeat,
		HELD_REST,
		respinSeatRow,
		stateRespinBoard,
	} from '../game/stateRespinBoard.svelte';

	type Props = {
		cell: HoldAndWinCell;
		/** The seat's entry (`createSeatViews`): a new number each time a cell comes to be held here,
		 *  `undefined` while the seat is empty. */
		entry: number | undefined;
	};

	const props: Props = $props();

	/**
	 * A STUCK cell — a coin, a jackpot or a special held on the respin board. Drawn through the same
	 * `Symbol` as every reel cell, so its art, layers and value label (`coinLabelFor`) come with it,
	 * and a value a payer raises is redrawn in place: the cell is keyed by its position, not its value.
	 *
	 * A SEAT'S VIEW, kept from the first cell held there (`respinBoardKeep.ts`): each cell coming to be
	 * held is an entry, which starts the `Symbol`'s art as a newly mounted one would, and while the
	 * seat is empty it draws nothing, its art put away. What the cell's own component started at its
	 * mount (a label pop) is started at its entry.
	 */
	const vacant = $derived(props.entry === undefined);
	const key = $derived(respinCellKey(props.cell.reel, props.cell.row));
	const seat = $derived(getSymbolSeat(props.cell.reel, respinSeatRow(props.cell.row)));
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
		!display || display.field === 'text'
			? undefined
			: display.field === 'jackpot'
				? { jackpot: display.jackpot }
				: { [display.field]: display.tween.current },
	);
	/** An enhancement hit's readout ("×3", "+$5.00"), printed in place of the value. */
	const labelText = $derived(display?.field === 'text' ? display.text : undefined);
	const cellState = $derived(stateRespinBoard.heldState[key] ?? HELD_REST);
	/** What the beat DRAWS: a stick whose `land` already played as the cell stopped draws the rest
	 *  (`respinHeldState`); `cellState` still drives everything keyed on the beat. */
	const drawnState = $derived(
		respinHeldState(cellState, props.cell.symbol.name, stateRespinBoard.landed.includes(key)),
	);
	/** A coin board's tally: a coin that pays nothing dims, and a `perLine` coin shows its ×N. */
	const DIMMED_ALPHA = 0.35;
	const alpha = $derived(stateRespinBoard.dimmed.includes(key) ? DIMMED_ALPHA : 1);
	const mark = $derived(stateRespinBoard.marks[key]);

	/**
	 * The authored label pops (`coinLabel.animation`): one as the coin sticks (`coinStick`), one each
	 * time a count-up lands on its new value — off unless authored, so an unauthored label never pops —
	 * and one as an enhancement hit's readout appears (on unless authored off).
	 */
	const pops = coinLabelPops();
	let labelPop = $state<CoinLabelPopCue>();
	let cues = 0;
	let counting = false;
	$effect(() => {
		void props.entry;
		if (!vacant && pops.land && cellState === 'coinStick') labelPop = { id: ++cues, ...pops.land };
	});
	$effect(() => {
		void props.entry;
		if (vacant) {
			counting = false;
			return;
		}
		const now = display !== undefined;
		if (counting && !now && pops.boost) labelPop = { id: ++cues, ...pops.boost };
		counting = now;
	});
	$effect(() => {
		void props.entry;
		if (!vacant && pops.hit && labelText !== undefined) labelPop = { id: ++cues, ...pops.hit };
	});
</script>

<Container x={seat.x} y={seat.y} {scale} {zIndex} {alpha} visible={!vacant}>
	<Symbol
		state={drawnState}
		rawSymbol={props.cell.symbol}
		{labelOverride}
		{labelText}
		{labelPop}
		instanceKey={props.entry}
		{vacant}
		oncomplete={() => completeHeldBeat(key)}
	/>
	{#if mark && !vacant}
		<Container x={SYMBOL_SIZE * 0.32} y={-SYMBOL_SIZE * 0.32}>
			<Text
				anchor={0.5}
				text={mark}
				style={{
					fontFamily: 'Arial',
					fontWeight: 'bold',
					fontSize: Math.round(SYMBOL_SIZE * 0.2),
					fill: 0xffe14d,
					stroke: { color: 0x000000, width: 4 },
				}}
			/>
		</Container>
	{/if}
</Container>
