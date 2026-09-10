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
	// state art — including `clearReel`, the cascade's own pop, which the Invisible Symbols
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

<!--
	A symbol whose explosion has played out draws nothing — it blew up, it is gone. It stays in
	`base` until the step's board-wide removal (see `TumbleSymbol.exploded` for why those two cannot
	be the same moment), and drawing it through that wait is what made an early column re-play its
	explosion two or three times while the columns to its right were still popping.

	Unmounting the cell is the whole mechanism, and it is safe precisely because `SymbolWrap` already
	mounts conditionally (`show && inFrame`) — a seat that draws nothing is the ordinary case here,
	not a new one. It moves no index, so the survivors below it do not budge.
-->
{#if !props.tumbleSymbol.exploded}
	<SymbolWrap
		x={seat.x}
		y={props.tumbleSymbol.symbolY.current}
		reelIndex={props.reelIndex}
		scale={seat.scale}
		animating={symbolInfo.type === 'spine'}
	>
		<Symbol
			state={props.tumbleSymbol.symbolState}
			rawSymbol={props.tumbleSymbol.rawSymbol}
			oncomplete={props.tumbleSymbol.oncomplete}
		/>
	</SymbolWrap>
{/if}
