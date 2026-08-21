<script lang="ts">
	import type { ReelGridTileArt } from 'engine-layout';

	import { boardDimensions } from '../game/gameConfig';
	import BoardTile from './BoardTile.svelte';

	/**
	 * The board's GROUND TILE layer (docs/design/perspective-board-mode.md §"The tiles") — one tile
	 * stamped per visible cell, drawn from the SAME lattice that seats the symbols. That is the whole
	 * argument for it: a tile grid painted into the ground art has to be hand-matched to pixels and
	 * drifts the first time a per-ratio override moves the board, while these read `getSymbolSeat`
	 * and therefore re-fit per aspect ratio, per row scale and per authored knob for free.
	 *
	 * Mounted only when the author bound tile art (the parent guards on `boardTileArt()`), so a board
	 * with none adds NO Pixi children — byte-parity, which is not optional here: `apps/lines` is the
	 * shared `_runtime/lines` bundle every online game runs.
	 */
	const props: { art: ReelGridTileArt } = $props();

	const dimensions = $derived(boardDimensions());
</script>

<!-- ROW-MAJOR, back row first. Tiles are coplanar so this is invisible on a flat board, but under
	 perspective a compressed back row's art can overlap the row in front of it, and the ground reads
	 correctly only when the NEARER tile wins. `pixi-svelte` paints in mount order, so emitting the
	 rows back-to-front buys that with no per-frame sort — the same argument `BoardBase` makes for its
	 perspective branch. Unconditional here because this layer is new: there is no existing child
	 order to preserve. -->
{#each { length: dimensions.y }, row (row)}
	{#each { length: dimensions.x }, reelIndex (reelIndex)}
		<BoardTile {reelIndex} {row} art={props.art} />
	{/each}
{/each}
