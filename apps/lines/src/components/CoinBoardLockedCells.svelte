<script lang="ts">
	import { Graphics } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';

	import { coinBoardInactiveOverlay, coinBoardLockedCells } from '../game/coinBoard.svelte';
	import { cellWindow, getSymbolSeat, stateGameDerived } from '../game/stateGame.svelte';

	/**
	 * A COIN BOARD's locked cells (`docs/design/hold-and-win-coin-board.md` §1.4) — the cells no
	 * active payline crosses, which never spin and stay blank, under the inactive overlay's colour.
	 * One fill for the lot, redrawn when the active lines change.
	 */
	const overlay = $derived(coinBoardInactiveOverlay());
	const cells = $derived(coinBoardLockedCells());
	const columnPitch = $derived(SYMBOL_SIZE + stateGameDerived.boardGeometry().columnExtraLocal);
</script>

{#if overlay && cells.length > 0}
	<Graphics
		draw={(graphics) => {
			for (const { reel, row } of cells) {
				const seat = getSymbolSeat(reel, row);
				const box = cellWindow(reel, row);
				graphics.rect(seat.x - columnPitch / 2, box.top, columnPitch, box.height);
			}
			graphics.fill({ color: overlay.color, alpha: overlay.alpha });
		}}
	/>
{/if}
