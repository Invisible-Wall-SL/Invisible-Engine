<script lang="ts">
	import Symbol from './Symbol.svelte';
	import SymbolWrap from './SymbolWrap.svelte';
	import { getSymbolInfo } from '../game/utils';
	import type { MultiplierSymbol } from '../game/stateGame.svelte';

	type Props = {
		multiplierSymbol: MultiplierSymbol;
	};

	const props: Props = $props();

	/**
	 * Rendered through the ordinary `Symbol` state machine, exactly like a reel or tumble symbol, so a
	 * multiplier's win art is whatever `/symbols` authored for its `win` state.
	 *
	 * The reference scatter game drew these through a bespoke `SymbolSpineMain` + `SymbolSpineBackground`
	 * pair instead, which meant a second art path with its own background layer that no tool authors.
	 * Dropping it costs nothing a project cannot express in the symbol's own state — and gains it the
	 * sprite/flipbook/spine handling `Symbol` already does.
	 *
	 * Both axes read `.current` because a multiplier symbol MOVES: it flies from its cell to the board
	 * centre, where a reel symbol only ever travels vertically.
	 */
	const symbolInfo = $derived(
		getSymbolInfo({
			rawSymbol: props.multiplierSymbol.rawSymbol,
			state: props.multiplierSymbol.symbolState,
		}),
	);
</script>

<SymbolWrap
	x={props.multiplierSymbol.symbolX.current}
	y={props.multiplierSymbol.symbolY.current}
	animating={symbolInfo.type === 'spine'}
>
	<Symbol
		state={props.multiplierSymbol.symbolState}
		rawSymbol={props.multiplierSymbol.rawSymbol}
		oncomplete={props.multiplierSymbol.oncomplete}
	/>
</SymbolWrap>
