<script lang="ts" module>
	import type {
		HoldAndWinCell,
		HoldAndWinCellAmount,
		HoldAndWinCoinChange,
		HoldAndWinUpgradeChange,
		HoldAndWinJackpotSource,
		HoldAndWinWheelPrize,
		Position,
	} from 'engine-game';
	import type { HoldAndWinSpecial, UpgradeTarget } from 'game-config';

	/**
	 * The Hold and Win respin board's cues — NOTIFICATIONS of a beat that has happened, for authored
	 * listeners (sound, FX). The beats themselves are `holdAndWinPresentation.ts`, run by the coded
	 * handlers and by the flow effects (`showRespinBoard`, `spinRespin`, `stickCoins`,
	 * `setRespinCounter`, `restoreRespinBoard`, `hideRespinBoard`, `payCoins`, `addRespins`,
	 * `upgradeCoins`, `boostCoins`,
	 * `turnSpecialIntoCoin`, `collectCoins`, `revealMystery`, `clearRespinCells`, `showJackpotWin`,
	 * `fillMeter`, `playLuckySpinIntro`, `fireRandomMetre`, `lightLetter`, `instantCollect`,
	 * `spinWheel`); broadcasting a cue does not move the board. `respinCollectStep` fires once per collected coin, as it takes
	 * off for the collector (its landing is a `flightArrive` with flight `toCollector`).
	 * `respinAddRespins` fires as an add-respins special applies (its "+N" landing in the counter is a
	 * `flightArrive` with flight `toCounter`), `respinCoinUpgrade` as an upgrade applies (each beam's
	 * landing is a `flightArrive` with flight `upgradeBeam`).
	 *
	 * The pots and the Lucky Spin (base game) and the feature's celebrations:
	 * - `potFill` as a meter's specials take off (each landing is a `flightArrive` with flight
	 *   `toMeter:<id>`), `potFull` when the update filled it;
	 * - `potsConsume` as a `meter` trigger drains the meters it consumed, with what they activate;
	 * - `luckySpinIntro` as the Lucky Spin banner goes up;
	 * - `randomMetreFire` as the random metre's banner goes up, with the coins it added;
	 * - `jackpotCelebration` for a banked jackpot (full board, letters, the wheel);
	 * - `respinTallyStep` each time the Total Win bar steps in the feature end's tally — `total` is
	 *   what the bar now reads; the last step (`index` = the coin count) adds the banked part.
	 *
	 * Grand's letters, Hotfire's wheel and the base-game instant collect:
	 * - `respinColumnComplete` as a full column's letter lights (`lightLetter`), and
	 *   `respinColumnStep` each time a swept coin lands in the Total Win bar (`total` = the bar now);
	 * - `wheelShow` as the wheel pops up, `wheelSpin` as it starts turning, `wheelLand` as it stops
	 *   on the server's prize (`spinWheel`);
	 * - `instantCollectWin` as a base-game instant collect's coins take off for their special
	 *   (`instantCollect`; each landing is a `flightArrive` with flight `toCollector`).
	 */
	export type EmitterEventRespinBoard =
		| { type: 'respinBoardShow' }
		| { type: 'respinBoardHide' }
		| { type: 'respinBoardSpin'; cells: HoldAndWinCell[] }
		| { type: 'respinCoinsLand'; cells: HoldAndWinCell[] }
		| { type: 'respinCounterUpdate'; left: number; start: number; reset: boolean }
		| { type: 'respinCoinPay'; payer: HoldAndWinCell; value: number; cells: HoldAndWinCoinChange[] }
		| { type: 'respinAddRespins'; cell: HoldAndWinCell; added: number; left: number; total: number }
		| {
				type: 'respinCoinUpgrade';
				upgrader: HoldAndWinCell;
				target: UpgradeTarget;
				step: number;
				cells: HoldAndWinUpgradeChange[];
		  }
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
		  }
		| {
				type: 'potFill';
				meter: string;
				level: number;
				max: number;
				full: boolean;
				cells: HoldAndWinCell[];
		  }
		| { type: 'potFull'; meter: string }
		| { type: 'potsConsume'; meters: string[]; activates: HoldAndWinSpecial[] }
		| { type: 'luckySpinIntro' }
		| { type: 'randomMetreFire'; name: string; cells: HoldAndWinCell[] }
		| {
				type: 'jackpotCelebration';
				tier: string;
				amount: number;
				source: HoldAndWinJackpotSource;
		  }
		| { type: 'respinTallyStep'; index: number; amount: number; total: number }
		| {
				type: 'respinColumnComplete';
				reel: number;
				letter: string;
				newlyLit: boolean;
				cleared: boolean;
				amount: number;
				cells: Position[];
		  }
		| { type: 'respinColumnStep'; reel: number; index: number; total: number }
		| { type: 'wheelShow'; prizes: HoldAndWinWheelPrize[] }
		| { type: 'wheelSpin'; segment: number; prize: HoldAndWinWheelPrize }
		| { type: 'wheelLand'; segment: number; prize: HoldAndWinWheelPrize }
		| {
				type: 'instantCollectWin';
				specials: HoldAndWinCell[];
				multiplier: number;
				times: number;
				cells: HoldAndWinCellAmount[];
				amount: number;
		  };
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { BoardContainer, respinCellKey } from 'engine-game';

	import HoldAndWinLetters from './HoldAndWinLetters.svelte';
	import HoldAndWinPots from './HoldAndWinPots.svelte';
	import RespinCell from './RespinCell.svelte';
	import RespinCellTile from './RespinCellTile.svelte';
	import RespinCounter from './RespinCounter.svelte';
	import RespinHeldSymbol from './RespinHeldSymbol.svelte';
	import { getContext } from '../game/context';
	import {
		currentRespinBoard,
		respinCellLook,
		stateRespinBoard,
	} from '../game/stateRespinBoard.svelte';

	/**
	 * THE RESPIN BOARD (design §4.2 of `docs/design/hold-and-win.md`) — the per-cell board a Hold and
	 * Win feature plays on, drawn over the SAME seats as the reel board, which it replaces while the
	 * feature runs (`boardHide` / `boardShow`). Four layers, bottom to top: the authored cell tiles,
	 * the one-cell reels, the held coins, the counter.
	 *
	 * MOUNTED FOR EVERY GAME, DRAWS NOTHING UNTIL A FEATURE. The outer `Container` is unconditional so
	 * its seat in the board stack is fixed at mount — pixi-svelte freezes child order then, and an
	 * `{#if}` that remounted it in the shared parent would append it above whatever mounted since.
	 * Inside it, nothing exists until `stateRespinBoard.shown`, and the reels themselves are not even
	 * built until the first feature (`stateRespinBoard.svelte.ts`). A game that never receives a Hold
	 * and Win event pays one empty container and one `stopButtonClick` subscription.
	 *
	 * The persistent meters' pots (`HoldAndWinPots`) share this container: they sit above the board in
	 * the base game and the feature alike, and draw nothing — mount nothing — for a game whose config
	 * declares no meters. So do the column letters (`HoldAndWinLetters`), mounted only while the
	 * board is up on a config whose board ends on letters.
	 */

	const context = getContext();

	const board = $derived(stateRespinBoard.shown ? currentRespinBoard() : null);
	const look = $derived(respinCellLook());
	const tileArt = $derived(look?.art);
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
			<!-- The authored cell tiles (`respinCells`), under everything. An unconditional container, so
				 tiles that arrive after the board mounted still draw beneath the cells. -->
			<Container>
				{#if tileArt}
					{#each board.cells.flat() as cell (cell)}
						<RespinCellTile
							reel={cell.reel}
							row={cell.row}
							art={tileArt}
							tint={look?.tint}
							gap={look?.gap ?? 0}
						/>
					{/each}
				{/if}
			</Container>
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
	<HoldAndWinPots />
	<HoldAndWinLetters />
</Container>
