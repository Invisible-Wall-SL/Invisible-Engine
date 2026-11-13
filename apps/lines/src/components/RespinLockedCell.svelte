<script lang="ts">
	import { Container, Rectangle, Sprite, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import {
		CELL_TILE_SIZE,
		LOCKED_CELL_SCOPE_KIND,
		type ComponentInstanceNode,
	} from 'engine-layout';
	import { ComponentInstance, setComponentSignalScope } from 'engine-layout/svelte';
	import { scopeOf } from 'utils-event-emitter';

	import { getContext } from '../game/context';
	import { cellWindow, getSymbolSeat } from '../game/stateGame.svelte';
	import {
		markInsideRespinLockedCell,
		respinLockedLook,
		respinSeatRow,
		respinUnlockFade,
		stateRespinBoard,
	} from '../game/stateRespinBoard.svelte';

	type Props = { reel: number; row: number };

	const props: Props = $props();
	const context = getContext();

	/**
	 * ONE LOCKED cell of an expanding respin board (design §7 11b) — a row not yet open. It holds
	 * nothing and never spins; it shows the authored `lockedRow` look (`respinLockedLook`): its
	 * `lockedComponent` drawn on the cell, else its art, else the coded overlay — a dark panel marked
	 * LOCKED. Sized to the cell's own box, at its seat (`respinSeatRow`, so a row added above the
	 * base rows sits there), like a respin cell's tile. While its row fades open
	 * (`stateRespinBoard.unlockingTo`) it fades out.
	 *
	 * The component hears signals scoped `row:<data row>` (the cell's own row, as the wire numbers it),
	 * so a component opening plays the `open` of that row's cells only.
	 */
	setComponentSignalScope(scopeOf(LOCKED_CELL_SCOPE_KIND, props.row));
	markInsideRespinLockedCell();

	const seat = $derived(getSymbolSeat(props.reel, respinSeatRow(props.row)));
	const columnPitch = $derived(
		SYMBOL_SIZE + context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
	const cellHeight = $derived(cellWindow(props.reel, respinSeatRow(props.row)).height);
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
	const look = $derived(respinLockedLook());
	const alpha = $derived(props.row < stateRespinBoard.unlockingTo ? respinUnlockFade.current : 1);
	const INSET = 0.06;
	const fit = $derived({ x: columnPitch / CELL_TILE_SIZE, y: cellHeight / CELL_TILE_SIZE });

	const lockedNode = (componentId: string): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: `respinLocked-${props.reel}-${props.row}`,
		componentId,
		x: 0,
		y: 0,
		params: { reel: props.reel, row: props.row },
	});
</script>

<Container x={seat.x} y={seat.y} {scale} {alpha}>
	{#if look?.component}
		{#key look.component}
			<Container scale={fit}>
				<ComponentInstance node={lockedNode(look.component)} />
			</Container>
		{/key}
	{:else if look?.art}
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
