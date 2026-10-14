<script lang="ts">
	import { Container } from 'pixi-svelte';
	import type { OverlayDropCell } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { getActiveGameConfig } from '../game/gameConfig';
	import { getSymbolSeat, stateGame } from '../game/stateGame.svelte';
	import {
		completeTokenBeat,
		overlayTokenKey,
		overlayTokenSymbol,
		stateOverlayTokens,
		TOKEN_REST,
	} from '../game/stateOverlay.svelte';

	type Props = { token: OverlayDropCell };

	const props: Props = $props();

	/**
	 * ONE DROPPED TOKEN, drawn over its cell's seat through the same `Symbol` as every reel cell, so
	 * its art and states come from `/symbols` and a value coin draws the coin label (`coinLabelFor`).
	 * `row` is the VISIBLE row; the seat maths takes it as is, as the respin board's do.
	 */
	const key = $derived(overlayTokenKey(props.token.reel, props.token.row));
	const seat = $derived(getSymbolSeat(props.token.reel, props.token.row));
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
	const rawSymbol = $derived(overlayTokenSymbol(props.token));
	/** Under `withReel` timing the token rides its reel's cell until the reel comes to rest
	 *  (`ReelSymbol`), so it lands here only then — its land beat starting as the reel's does. */
	const riding = $derived(
		getActiveGameConfig().coinOverlay?.timing === 'withReel' &&
			!!stateGame.board[props.token.reel]?.reelState.rolling,
	);
</script>

{#if !riding}
	<Container x={seat.x} y={seat.y} {scale}>
		<Symbol
			state={stateOverlayTokens.state[key] ?? TOKEN_REST}
			{rawSymbol}
			oncomplete={() => completeTokenBeat(key)}
		/>
	</Container>
{/if}
