<script lang="ts">
	import Symbol from './Symbol.svelte';
	import SymbolWrap from './SymbolWrap.svelte';
	import { getSymbolInfo } from '../game/utils';
	import { getSymbolX, stateGame, winDimCellKey, type ReelSymbol } from '../game/stateGame.svelte';
	import { SYMBOL_DIM_TINT } from '../game/constants';

	type Props = {
		reelIndex: number;
		row: number;
		reelSymbol: ReelSymbol;
	};

	const props: Props = $props();
	const symbolInfo = $derived(
		getSymbolInfo({ rawSymbol: props.reelSymbol.rawSymbol, state: props.reelSymbol.symbolState }),
	);
	// Win-celebration dim: this symbol is darkened while the dim is active AND it is not one of the
	// round's paying cells. Off / no wins ⇒ `active` is false ⇒ full-bright (byte-parity).
	const dimmed = $derived(
		stateGame.winDim.active && !stateGame.winDim.cells[winDimCellKey(props.reelIndex, props.row)],
	);
</script>

<SymbolWrap
	x={getSymbolX(props.reelIndex)}
	y={props.reelSymbol.symbolY()}
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
