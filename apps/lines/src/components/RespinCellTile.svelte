<script lang="ts">
	import { Container, Sprite } from 'pixi-svelte';
	import { CELL_TILE_SIZE, type ComponentInstanceNode, type ReelGridTileArt } from 'engine-layout';
	import { ComponentInstance } from 'engine-layout/svelte';

	import { SYMBOL_SIZE } from 'engine-game';

	import { getContext } from '../game/context';
	import { cellWindow, getSymbolSeat } from '../game/stateGame.svelte';
	import { markInsideRespinCellTile } from '../game/stateRespinBoard.svelte';

	type Props = {
		reel: number;
		row: number;
		art?: ReelGridTileArt;
		/** A component the cell draws on instead of `art` (a Cell Tile copy). */
		tile?: string;
		/** Whether a coin holds the cell — the tile component's `held`. */
		held?: boolean;
		tint?: string;
		gap: number;
	};

	const props: Props = $props();
	const context = getContext();
	markInsideRespinCellTile();

	/**
	 * ONE respin cell's authored tile, stamped at the cell's seat (the seat the cell's symbol rests
	 * on, so they never drift apart) over the SAME box the cell's rolling window masks (`RespinCell`:
	 * the column pitch by the cell window's height), both shrunk by the gap, so a window's edges sit on
	 * its tile's. The row scale of a perspective board is applied once, by the container, as a reel
	 * cell applies it.
	 *
	 * A `tile` component (Phase 12c) is authored on one cell's box (`CELL_TILE_SIZE` square) and
	 * scaled to this one, fed its `reel`, `row` and `held`.
	 */
	const seat = $derived(getSymbolSeat(props.reel, props.row));
	const columnPitch = $derived(
		SYMBOL_SIZE + context.stateGameDerived.boardGeometry().columnExtraLocal,
	);
	const cellHeight = $derived(cellWindow(props.reel, props.row).height);
	const scale = $derived(seat.scale === 1 ? undefined : seat.scale);
	const shrink = $derived(1 - props.gap);
	const fit = $derived({
		x: (columnPitch * shrink) / CELL_TILE_SIZE,
		y: (cellHeight * shrink) / CELL_TILE_SIZE,
	});

	const tileNode = (componentId: string): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: `respinCell-tile-${props.reel}-${props.row}`,
		componentId,
		x: 0,
		y: 0,
		params: { reel: props.reel, row: props.row },
	});
	const engineValues = {
		get held() {
			return props.held ? 1 : 0;
		},
	};
</script>

<Container x={seat.x} y={seat.y} {scale}>
	{#if props.tile}
		{#key props.tile}
			<Container scale={fit}>
				<ComponentInstance node={tileNode(props.tile)} {engineValues} />
			</Container>
		{/key}
	{:else if props.art}
		<Sprite
			key={props.art.key}
			fallbackKey={props.art.fallbackKey}
			anchor={0.5}
			width={columnPitch * shrink}
			height={cellHeight * shrink}
			tint={props.tint ?? 0xffffff}
		/>
	{/if}
</Container>
