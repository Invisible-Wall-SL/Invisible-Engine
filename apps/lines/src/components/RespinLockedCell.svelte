<script lang="ts">
	import { Container, Rectangle, Sprite, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';

	import { getContext } from '../game/context';
	import { cellWindow, getSymbolSeat } from '../game/stateGame.svelte';
	import {
		respinLockedLook,
		respinUnlockFade,
		stateRespinBoard,
	} from '../game/stateRespinBoard.svelte';

	type Props = { reel: number; row: number };

	const props: Props = $props();
	const context = getContext();

	/**
	 * ONE LOCKED cell of an expanding respin board (design §7 11b) — a row below the open ones. It
	 * holds nothing and never spins; it shows the authored `lockedRow` art (`respinLockedLook`), or the
	 * coded overlay: a dark panel marked LOCKED. Sized to the cell's own box, at its seat, like a
	 * respin cell's tile. While its row is opening (`stateRespinBoard.unlockingTo`) it fades out.
	 */
	const seat = $derived(getSymbolSeat(props.reel, props.row));
	const columnPitch = $derived(
		SYMBOL_SIZE + context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
	const cellHeight = $derived(cellWindow(props.reel, props.row).height);
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
	const look = $derived(respinLockedLook());
	const alpha = $derived(props.row < stateRespinBoard.unlockingTo ? respinUnlockFade.current : 1);
	const INSET = 0.06;
</script>

<Container x={seat.x} y={seat.y} {scale} {alpha}>
	{#if look?.art}
		<Sprite
			key={look.art.key}
			fallbackKey={look.art.fallbackKey}
			anchor={0.5}
			width={columnPitch}
			height={cellHeight}
			tint={look.tint ?? 0xffffff}
		/>
	{:else}
		<Rectangle
			anchor={0.5}
			width={columnPitch * (1 - INSET)}
			height={cellHeight * (1 - INSET)}
			borderRadius={12}
			backgroundColor={0x000000}
			backgroundAlpha={0.55}
			borderColor={0xffffff}
			borderWidth={2}
			alpha={0.9}
		/>
		<Text
			anchor={0.5}
			text="LOCKED"
			style={{
				fontFamily: 'Arial',
				fontWeight: 'bold',
				fontSize: Math.round(cellHeight * 0.15),
				fill: 0xffffff,
			}}
		/>
	{/if}
</Container>
