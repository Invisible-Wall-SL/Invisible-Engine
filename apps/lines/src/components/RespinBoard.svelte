<script lang="ts" module>
	import type {
		HoldAndWinCell,
		HoldAndWinCellAmount,
		HoldAndWinCoinChange,
		HoldAndWinJackpotSource,
		HoldAndWinUpgradeChange,
		HoldAndWinWheelPrize,
		Position,
	} from 'engine-game';
	import type { ExpansionRule, HoldAndWinSpecial, UpgradeTarget } from 'game-config';

	/**
	 * The Hold and Win respin board's cues — NOTIFICATIONS of a beat that has happened, for authored
	 * listeners (sound, FX). The beats themselves are `holdAndWinPresentation.ts`, run by the coded
	 * handlers and by the flow effects (`showRespinBoard`, `spinRespin`, `stickCoins`,
	 * `setRespinCounter`, `restoreRespinBoard`, `hideRespinBoard`, `payCoins`, `addRespins`,
	 * `upgradeCoins`, `boostCoins`, `turnSpecialIntoCoin`, `collectCoins`, `revealMystery`,
	 * `clearRespinCells`, `showJackpotWin`, `fillMeter`, `playLuckySpinIntro`, `fireRandomMetre`,
	 * `lightLetter`, `instantCollect`, `spinWheel`); broadcasting a cue does not move the board.
	 * `respinCollectStep` fires once per collected coin, as it takes off for the collector (its
	 * landing is a `flightArrive` with flight `toCollector`).

	 * `respinCounterAward` fires as the feature opens and the counter shows the respins awarded.
	 * `respinAddRespins` fires as an add-respins special applies (its "+N" landing in the counter is a
	 * `flightArrive` with flight `toCounter`), `respinCoinUpgrade` as an upgrade applies (each beam's
	 * landing is a `flightArrive` with flight `upgradeBeam`).
	 *
	 * A collector bonus's enhancements (Phase 14b), each scoped by its enhancement: `enhancementOn` as
	 * a drawn one's dial lights at entry, `respinEnhancementHit` as a boost or multiply hits landing
	 * coins (each beam's landing is a `flightArrive` with flight `enhancementBeam`),
	 * `respinEnhancementMiss` as one misses; `superBonusEnter` as the super bonus opens.
	 *
	 * The pots and the Lucky Spin (base game) and the feature's celebrations:
	 * - `potFill` as a meter's specials take off (each landing is a `flightArrive` with flight
	 *   `toMeter:<id>`), `potLevelUp` as each landing raises its level, `potStageUp` when a rise
	 *   reaches one of its size stages, `potFull` when the update filled it;
	 * - `potsConsume` as a `meter` trigger drains the meters it consumed, with what they activate;
	 * - `luckySpinIntro` as the Lucky Spin banner goes up;
	 * - `randomMetreFire` as the random metre's banner goes up, with the coins it added;
	 * - `jackpotCelebration` for a banked jackpot (full board, letters, the wheel);
	 * - `respinTallyStep` each time the Total Win bar steps in the feature end's tally — `total` is
	 *   what the bar now reads; the last step (`index` = the coin count) adds the banked part.
	 *
	 * SCOPE (Phase 12a): the cues about ONE pot, tier or column carry it as `scope` — the meter id,
	 * the jackpot tier, the reel — so a component or effect placed on that part hears its own only.
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
		| { type: 'respinCounterAward'; left: number }
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
		| { type: 'enhancementOn'; kind: string; scope?: string }
		| {
				type: 'respinEnhancementHit';
				kind: 'boost' | 'multiply';
				by: number;
				cells: HoldAndWinCoinChange[];
				scope?: string;
		  }
		| { type: 'respinEnhancementMiss'; kind: 'boost' | 'multiply'; scope?: string }
		| { type: 'superBonusEnter' }
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
		| { type: 'respinCellsCleared'; reason: 'collected' | 'applied'; cells: Position[] }
		| {
				type: 'respinRowsUnlocked';
				from: number;
				rows: number;
				cause: ExpansionRule;
				unlockers: HoldAndWinCell[];
		  }
		| {
				type: 'respinJackpotWin';
				tier: string;
				amount: number;
				source: HoldAndWinJackpotSource;
				banked: boolean;
				scope?: string;
		  }
		| {
				type: 'potFill';
				meter: string;
				level: number;
				max: number;
				full: boolean;
				cells: HoldAndWinCell[];
				scope?: string;
		  }
		| { type: 'potLevelUp'; meter: string; level: number; max: number; scope?: string }
		| { type: 'potStageUp'; meter: string; stage: number; level: number; scope?: string }
		| { type: 'potFull'; meter: string; scope?: string }
		| {
				type: 'potsConsume';
				meters: string[];
				activates: HoldAndWinSpecial[];
				scope?: string[];
		  }
		| { type: 'luckySpinIntro' }
		| { type: 'randomMetreFire'; name: string; cells: HoldAndWinCell[] }
		| {
				type: 'jackpotCelebration';
				tier: string;
				amount: number;
				source: HoldAndWinJackpotSource;
				scope?: string;
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
				scope?: string;
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

	import CoinBoardLineOverlay from './CoinBoardLineOverlay.svelte';
	import CoinBoardLockedCells from './CoinBoardLockedCells.svelte';
	import EnhancementDials from './EnhancementDials.svelte';
	import HoldAndWinLetters from './HoldAndWinLetters.svelte';
	import HoldAndWinPots from './HoldAndWinPots.svelte';
	import RespinCell from './RespinCell.svelte';
	import RespinCellTile from './RespinCellTile.svelte';
	import RespinCounter from './RespinCounter.svelte';
	import RespinHeldSymbol from './RespinHeldSymbol.svelte';
	import RespinLockedCell from './RespinLockedCell.svelte';
	import { isCoinBoard } from '../game/coinBoard.svelte';
	import { getContext } from '../game/context';
	import { createSeatViews, createVisitOrder } from '../game/respinBoardKeep';
	import {
		currentRespinBoard,
		respinCellLook,
		stateRespinBoard,
	} from '../game/stateRespinBoard.svelte';

	/**
	 * THE RESPIN BOARD (design §4.2 of `docs/design/hold-and-win.md`) — the per-cell board a Hold and
	 * Win feature plays on, drawn over the SAME seats as the reel board, which it replaces while the
	 * feature runs (`boardHide` / `boardShow`). Five layers, bottom to top: the authored cell tiles,
	 * the one-cell reels, an expanding board's locked cells, the held coins, the counter.
	 *
	 * MOUNTED FOR EVERY GAME, DRAWS NOTHING UNTIL A FEATURE. The outer `Container` is unconditional so
	 * its seat in the board stack is fixed at mount — pixi-svelte freezes child order then, and an
	 * `{#if}` that remounted it in the shared parent would append it above whatever mounted since.
	 * Inside it, nothing exists until the first feature shows the board, and the reels themselves are
	 * not even built until then (`stateRespinBoard.svelte.ts`). A game that never receives a Hold and
	 * Win event pays one empty container and one `stopButtonClick` subscription.
	 *
	 * KEPT FROM THE FIRST FEATURE ON (`respinBoardKeep.ts`): hidden between features instead of
	 * destroyed, its cells and held coins keeping their components, every view vacant and its art put
	 * away, so a hidden board neither updates nor draws. The tiles, the locked cells, the counter and
	 * the dials are mounted per feature, as before.
	 *
	 * The persistent meters' pots (`HoldAndWinPots`) share this container: they sit above the board in
	 * the base game and the feature alike, and draw nothing — mount nothing — for a game whose config
	 * declares no meters. So do the column letters (`HoldAndWinLetters`), mounted only while the
	 * board is up on a config whose board ends on letters.
	 */

	const context = getContext();
	/** A coin board's base game is this board: its locked cells and its Line Overlay draw on it. */
	const coinBoard = isCoinBoard();

	const board = $derived(stateRespinBoard.shown ? currentRespinBoard() : null);
	/** The board the kept layers were mounted for: the shown one, else the last one shown. */
	let keptBoard: typeof board = null;
	const kept = $derived.by(() => {
		if (board) keptBoard = board;
		return keptBoard;
	});
	const look = $derived(respinCellLook());
	const tileArt = $derived(look?.art);
	const tileComponent = $derived(look?.tile);
	const heldKeys = $derived(
		stateRespinBoard.held.map((cell) => respinCellKey(cell.reel, cell.row)),
	);
	/** An expanding board's rows below the open ones are locked: no reel, a locked overlay instead. */
	const openRows = $derived(stateRespinBoard.rows || (board?.rows ?? 0));
	const openCells = $derived(board ? board.cells.flat().filter((c) => c.row < openRows) : []);
	const drawnRows = $derived(stateRespinBoard.drawnRows || Infinity);
	const lockedCells = $derived(
		board ? board.cells.flat().filter((c) => c.row >= openRows && c.row < drawnRows) : [],
	);
	/** The cells drawn: the open ones while shown, else the ones the board was last shown with. */
	let keptCells: typeof openCells = [];
	const cells = $derived.by(() => {
		if (board) keptCells = openCells;
		return keptCells;
	});
	const cellOrders = createVisitOrder<(typeof openCells)[number]>();
	const cellOrder = $derived(cellOrders(board !== null, cells));
	const seatViews = createSeatViews((cell: (typeof stateRespinBoard.held)[number]) =>
		respinCellKey(cell.reel, cell.row),
	);
	/** The held coins drawn: none while the board is put away, as no board was mounted then. */
	const heldViews = $derived(seatViews(board ? stateRespinBoard.held : []));

	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => currentRespinBoard()?.stop(),
	});
</script>

<Container>
	{#if kept}
		<BoardContainer visible={board !== null}>
			<!-- The authored cell tiles (`respinCells`: a Cell Tile component, else the tile image), under
				 everything. An unconditional container, so tiles that arrive after the board mounted
				 still draw beneath the cells. -->
			<Container>
				{#if board && (tileComponent || tileArt)}
					{#each openCells as cell (cell)}
						<RespinCellTile
							reel={cell.reel}
							row={cell.row}
							art={tileArt}
							tile={tileComponent}
							held={heldKeys.includes(respinCellKey(cell.reel, cell.row))}
							tint={look?.tint}
							gap={look?.gap ?? 0}
						/>
					{/each}
				{/if}
			</Container>
			<Container>
				{#each cells as cell (cell)}
					<RespinCell
						{cell}
						held={heldKeys.includes(respinCellKey(cell.reel, cell.row))}
						away={!board}
						order={cellOrder.get(cell)}
					/>
				{/each}
			</Container>
			<Container>
				{#each lockedCells as cell (cell)}
					<RespinLockedCell reel={cell.reel} row={cell.row} />
				{/each}
			</Container>
			<Container>
				{#if coinBoard}
					<CoinBoardLockedCells />
					<CoinBoardLineOverlay />
				{/if}
			</Container>
			<Container>
				{#each heldViews as view (view.id)}
					<RespinHeldSymbol cell={view.cell} entry={view.entry} />
				{/each}
			</Container>
			{#if board}
				<RespinCounter />
				<EnhancementDials />
			{/if}
		</BoardContainer>
	{/if}
	<HoldAndWinPots />
	<HoldAndWinLetters />
</Container>
