<script lang="ts">
	import Symbol from './Symbol.svelte';
	import SymbolWrap from './SymbolWrap.svelte';
	import { getSymbolInfo } from '../game/utils';
	import {
		getSymbolSeat,
		stateGame,
		stackedCoverage,
		winDimCellKey,
		type ReelSymbol,
	} from '../game/stateGame.svelte';
	import { SYMBOL_DIM_TINT } from 'engine-game';

	type Props = {
		reelIndex: number;
		row: number;
		reelSymbol: ReelSymbol;
	};

	const props: Props = $props();

	/** Row index of the padding row above the visible board — `props.row` indexes the PADDED strip. */
	const PADDING_ROW = -1;

	/**
	 * This cell's seat on the board lattice. Only `x` (and the row `scale`) are taken from it: `y`
	 * stays the LIVE `symbolY()` off the spinning reel, which is the whole point of a rolling board —
	 * the seat's y is where the symbol comes to REST, and mid-spin it is somewhere else entirely.
	 * The two agree at rest by construction (`createReelForSpinning` is handed the same getters).
	 */
	const seat = $derived(getSymbolSeat(props.reelIndex, props.row + PADDING_ROW));

	const symbolInfo = $derived(
		getSymbolInfo({ rawSymbol: props.reelSymbol.rawSymbol, state: props.reelSymbol.symbolState }),
	);
	// Win-celebration dim: this symbol is darkened while the dim is active AND it is not one of the
	// round's paying cells. Off / no wins ⇒ `active` is false ⇒ full-bright (byte-parity).
	const dimmed = $derived(
		stateGame.winDim.active && !stateGame.winDim.cells[winDimCellKey(props.reelIndex, props.row)],
	);
	// Stacked-picture mode: hide the single-cell art under a run, so the one tall picture drawn by
	// `StackedPictures` doesn't double with the icons it replaces. Empty set when the mode is off ⇒
	// every cell renders ⇒ byte-parity (docs/design/stacked-picture-mode.md).
	const covered = $derived(stackedCoverage().has(winDimCellKey(props.reelIndex, props.row)));
</script>

{#if !covered}
	<SymbolWrap
		x={seat.x}
		y={props.reelSymbol.symbolY()}
		scale={seat.scale}
		tint={dimmed ? SYMBOL_DIM_TINT : 0xffffff}
		animating={symbolInfo.type === 'spine' &&
			(props.reelSymbol.symbolState === 'land' ||
				props.reelSymbol.symbolState === 'win' ||
				props.reelSymbol.symbolState === 'explosion')}
	>
		<Symbol
			state={props.reelSymbol.symbolState}
			rawSymbol={props.reelSymbol.rawSymbol}
			winLineColor={props.reelSymbol.winLineColor}
			oncomplete={() => {
				if (props.reelSymbol.symbolState === 'win') props.reelSymbol.oncomplete();
				if (props.reelSymbol.symbolState === 'explosion') props.reelSymbol.oncomplete();
				if (props.reelSymbol.symbolState === 'land') props.reelSymbol.symbolState = 'static';
			}}
		/>
	</SymbolWrap>
{/if}
