<script lang="ts" module>
	import type {
		HoldAndWinCell,
		HoldAndWinCellAmount,
		HoldAndWinCoinChange,
		HoldAndWinJackpotSource,
		Position,
	} from 'engine-game';
	import type { HoldAndWinSpecial } from 'game-config';

	/**
	 * The Hold and Win respin board's cues — NOTIFICATIONS of a beat that has happened, for authored
	 * listeners (sound, FX). The beats themselves are `holdAndWinPresentation.ts`, run by the coded
	 * handlers and by the flow effects (`showRespinBoard`, `spinRespin`, `stickCoins`,
	 * `setRespinCounter`, `restoreRespinBoard`, `hideRespinBoard`, `payCoins`, `boostCoins`,
	 * `turnSpecialIntoCoin`, `collectCoins`, `revealMystery`, `clearRespinCells`, `showJackpotWin`);
	 * broadcasting a cue does not move the board. `respinCollectStep` fires once per collected coin,
	 * as its moment starts — the hook a per-coin sound (and, later, a flight) hangs on.
	 */
	export type EmitterEventRespinBoard =
		| { type: 'respinBoardShow' }
		| { type: 'respinBoardHide' }
		| { type: 'respinBoardSpin'; cells: HoldAndWinCell[] }
		| { type: 'respinCoinsLand'; cells: HoldAndWinCell[] }
		| { type: 'respinCounterUpdate'; left: number; start: number; reset: boolean }
		| { type: 'respinCoinPay'; payer: HoldAndWinCell; value: number; cells: HoldAndWinCoinChange[] }
		| {
				type: 'respinCoinBoost';
				source: 'special' | 'wheel';
				booster?: HoldAndWinCell;
				multiplier: number;
				cells: HoldAndWinCoinChange[];
		  }
		| { type: 'respinSpecialBecomesCoin'; cell: HoldAndWinCell; from: string }
		| {
				type: 'respinCoinCollect';
				collector: HoldAndWinCell;
				level: number;
				cells: HoldAndWinCellAmount[];
				value: number;
		  }
		| { type: 'respinCollectStep'; cell: HoldAndWinCell; collector: HoldAndWinCell; index: number }
		| {
				type: 'respinMysteryReveal';
				cells: (HoldAndWinCell & { becomes: string })[];
				activates: HoldAndWinSpecial[];
		  }
		| { type: 'respinModifierUnlock'; activates: HoldAndWinSpecial[] }
		| { type: 'respinCellsCleared'; cells: Position[] }
		| {
				type: 'respinJackpotWin';
				tier: string;
				amount: number;
				source: HoldAndWinJackpotSource;
				banked: boolean;
		  };
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { BoardContainer, respinCellKey } from 'engine-game';

	import RespinCell from './RespinCell.svelte';
	import RespinCounter from './RespinCounter.svelte';
	import RespinHeldSymbol from './RespinHeldSymbol.svelte';
	import { getContext } from '../game/context';
	import { currentRespinBoard, stateRespinBoard } from '../game/stateRespinBoard.svelte';

	/**
	 * THE RESPIN BOARD (design §4.2 of `docs/design/hold-and-win.md`) — the per-cell board a Hold and
	 * Win feature plays on, drawn over the SAME seats as the reel board, which it replaces while the
	 * feature runs (`boardHide` / `boardShow`). Three layers, bottom to top: the one-cell reels, the
	 * held coins, the counter.
	 *
	 * MOUNTED FOR EVERY GAME, DRAWS NOTHING UNTIL A FEATURE. The outer `Container` is unconditional so
	 * its seat in the board stack is fixed at mount — pixi-svelte freezes child order then, and an
	 * `{#if}` that remounted it in the shared parent would append it above whatever mounted since.
	 * Inside it, nothing exists until `stateRespinBoard.shown`, and the reels themselves are not even
	 * built until the first feature (`stateRespinBoard.svelte.ts`). A game that never receives a Hold
	 * and Win event pays one empty container and one `stopButtonClick` subscription.
	 */

	const context = getContext();

	const board = $derived(stateRespinBoard.shown ? currentRespinBoard() : null);
	const heldKeys = $derived(
		stateRespinBoard.held.map((cell) => respinCellKey(cell.reel, cell.row)),
	);

	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => currentRespinBoard()?.stop(),
	});
</script>

<Container>
	{#if board}
		<BoardContainer>
			<Container>
				{#each board.cells.flat() as cell (cell)}
					<RespinCell {cell} held={heldKeys.includes(respinCellKey(cell.reel, cell.row))} />
				{/each}
			</Container>
			<Container>
				{#each stateRespinBoard.held as cell (respinCellKey(cell.reel, cell.row))}
					<RespinHeldSymbol {cell} />
				{/each}
			</Container>
			<RespinCounter />
		</BoardContainer>
	{/if}
</Container>
