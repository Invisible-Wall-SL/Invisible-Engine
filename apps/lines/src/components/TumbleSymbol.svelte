<script lang="ts">
	import Symbol from './Symbol.svelte';
	import SymbolWrap from './SymbolWrap.svelte';
	import { getSymbolSeat } from '../game/stateGame.svelte';
	import { getSymbolInfo } from '../game/utils';
	import type { TumbleSymbol } from '../game/stateTumble.svelte';

	type Props = {
		reelIndex: number;
		/** The lattice row this symbol is falling INTO — its target seat, not where it currently is.
		 *  Handed down by `TumbleBoardBase` because a cascade symbol has no reel to ask; see there. */
		row: number;
		tumbleSymbol: TumbleSymbol;
	};

	const props: Props = $props();
	// Same resolver the reel symbols use, so a tumbling symbol renders through the SAME authored
	// state art — including `tumbleExplosion`, the cascade's own pop, which the Invisible Symbols
	// tool authors as a first-class state next to the on-reel `explosion`. That is why the cascade
	// needs no symbol tooling of its own.
	const symbolInfo = $derived(
		getSymbolInfo({
			rawSymbol: props.tumbleSymbol.rawSymbol,
			state: props.tumbleSymbol.symbolState,
		}),
	);
	// `y` stays the live fall Tween — the seat only says where the symbol is HEADED, which is exactly
	// the seat `tumbleBoardSlideDown` tweens it to.
	const seat = $derived(getSymbolSeat(props.reelIndex, props.row));
</script>

<SymbolWrap
	x={seat.x}
	y={props.tumbleSymbol.symbolY.current}
	scale={seat.scale}
	animating={symbolInfo.type === 'spine'}
>
	<Symbol
		state={props.tumbleSymbol.symbolState}
		rawSymbol={props.tumbleSymbol.rawSymbol}
		oncomplete={props.tumbleSymbol.oncomplete}
	/>
</SymbolWrap>
