<script lang="ts">
	import { Container } from 'pixi-svelte';
	import type { OverlayDropCell } from 'engine-game';

	import Symbol from './Symbol.svelte';
	import { getSymbolSeat } from '../game/stateGame.svelte';
	import {
		completeTokenBeat,
		overlayTokenKey,
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
	const rawSymbol = $derived({
		name: props.token.token,
		...(props.token.jackpot !== undefined ? { jackpot: props.token.jackpot } : {}),
		...(props.token.value !== undefined ? { value: props.token.value } : {}),
	});
</script>

<Container x={seat.x} y={seat.y} {scale}>
	<Symbol
		state={stateOverlayTokens.state[key] ?? TOKEN_REST}
		{rawSymbol}
		oncomplete={() => completeTokenBeat(key)}
	/>
</Container>
