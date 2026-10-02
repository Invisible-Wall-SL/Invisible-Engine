<script lang="ts">
	import { Container, Sprite } from 'pixi-svelte';
	import type { ReelGridTileArt } from 'engine-layout';

	import { SYMBOL_SIZE } from 'engine-game';

	import { getContext } from '../game/context';
	import { cellWindow, getSymbolSeat } from '../game/stateGame.svelte';

	type Props = { reel: number; row: number; art: ReelGridTileArt; tint?: string; gap: number };

	const props: Props = $props();
	const context = getContext();

	/**
	 * ONE respin cell's authored tile, stamped at the cell's seat (the seat the cell's symbol rests
	 * on, so they never drift apart) over the SAME box the cell's rolling window masks (`RespinCell`:
	 * the column pitch by the cell window's height), both shrunk by the gap, so a window's edges sit on
	 * its tile's. The row scale of a perspective board is applied once, by the container, as a reel
	 * cell applies it.
	 */
	const seat = $derived(getSymbolSeat(props.reel, props.row));
	const columnPitch = $derived(
		SYMBOL_SIZE + context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
	const cellHeight = $derived(cellWindow(props.reel, props.row).height);
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
	const shrink = $derived(1 - props.gap);
</script>

<Container x={seat.x} y={seat.y} {scale}>
	<Sprite
		key={props.art.key}
		fallbackKey={props.art.fallbackKey}
		anchor={0.5}
		width={columnPitch * shrink}
		height={cellHeight * shrink}
		tint={props.tint ?? 0xffffff}
	/>
</Container>
