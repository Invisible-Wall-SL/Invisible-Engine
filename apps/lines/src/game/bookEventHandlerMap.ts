import _ from 'lodash';

import { recordBookEvent, checkIsMultipleRevealEvents, type BookEventHandlerMap } from 'utils-book';
import { stateBet, stateUi } from 'state-shared';
import { sequence } from 'utils-shared/sequence';
import { waitForTimeout, waitForResolve } from 'utils-shared/wait';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { SECOND } from 'constants-shared/time';

import { eventEmitter } from './eventEmitter';
import { playBookEvent } from './utils';
import { winLevelMap, type WinLevel } from './winLevelMap';
import { stateGame, stateGameDerived, getSymbolX } from './stateGame.svelte';
import { winLevelSoundsPlay, winLevelSoundsStop, animateSymbols } from './flowEffects';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';
import { PADDING_REELS, BOARD_DIMENSIONS } from './constants';
import { bakedWinLineEnabled } from '../editor-scenes';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	reveal: async (bookEvent: BookEventOfType<'reveal'>, { bookEvents }: BookEventContext) => {
		const isBonusGame = checkIsMultipleRevealEvents({ bookEvents });
		if (isBonusGame) {
			eventEmitter.broadcast({ type: 'stopButtonEnable' });
			recordBookEvent({ bookEvent });
		}

		stateGame.gameType = bookEvent.gameType;
		await stateGameDerived.enhancedBoard.spin({
			revealEvent: bookEvent,
			paddingBoard: PADDING_REELS[bookEvent.gameType],
			forceSequentialStop: stateGame.sequentialReelStop,
		});
		eventEmitter.broadcast({ type: 'soundScatterCounterClear' });
	},
	winInfo: async (bookEvent: BookEventOfType<'winInfo'>) => {
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_winlevel_small' });
		await sequence(bookEvent.wins, async (win) => {
			// The server reports the FULL payline path in `win.positions`, but only the
			// leftmost `kind` symbols form the paying combination — a left-to-right line
			// win always starts on reel 1 and stops at the first non-matching reel. Trace
			// just those, so non-winning tail symbols (and the scatter the line happens to
			// cross) don't light. Scatter wins already have positions.length === kind, so
			// sorting by reel + slicing is a harmless no-op for them.
			const winningPositions = [...win.positions]
				.sort((a, b) => a.reel - b.reel)
				.slice(0, win.kind);

			// Trace the win line through ONLY the paying symbols and stamp the pay amount
			// below its end. Scatter ('S') pays "anywhere" — not a line — so it's skipped,
			// keeping its symbol glow. The whole overlay is gated by the Symbol-State-Machine
			// toggle (defaults on, so an un-baked game keeps drawing it).
			const showWinLine = win.symbol !== 'S' && bakedWinLineEnabled();
			if (showWinLine) {
				// Board-local centres: getSymbolX(reel) + the live symbol centre Y. Mounted
				// inside WinLine's <BoardContainer> so these align with the rendered reels.
				const points = winningPositions.map((position) => ({
					x: getSymbolX(position.reel),
					y: stateGame.board[position.reel].reelState.symbols[position.row].symbolY(),
				}));
				// Awaited: when the line is configured to animate, WinLine.svelte resolves this
				// only after the line has drawn first→last and the amount is revealed, so the
				// symbol glow follows. Non-animated draws resolve immediately, keeping the
				// original timing (line + amount instant, symbols animate alongside).
				await eventEmitter.broadcastAsync({
					type: 'winLineShow',
					points,
					amount: bookEventAmountToCurrencyString(win.win),
				});
			}

			await animateSymbols({ positions: winningPositions });

			if (showWinLine) eventEmitter.broadcast({ type: 'winLineHide' });
		});
	},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		stateBet.winBookEventAmount = bookEvent.amount;
	},
	setExpandingSymbol: async (bookEvent: BookEventOfType<'setExpandingSymbol'>) => {
		stateGame.specialSymbol = bookEvent.symbol;
		// Await the reveal (shuffle → land → intro spine) so the next book event — the first
		// free-spin `reveal` — only fires once the book symbol has been chosen AND revealed,
		// instead of racing the reveal animation.
		await eventEmitter.broadcastAsync({ type: 'specialBookReveal', symbol: bookEvent.symbol });
	},
	expandBookColumns: async (bookEvent: BookEventOfType<'expandBookColumns'>) => {
		// Book-of mechanic (Book of Thermopylae): the natural free-spin board has
		// just landed with 3+ of the special symbol. For each flagged reel, morph
		// every non-special VISIBLE cell into the special symbol ONE AT A TIME —
		// re-using the per-symbol land plumbing so each converted cell plays the
		// special's land spine. Awaited in full so the wins (`winInfo`) that follow
		// only animate AFTER the columns finish transforming.
		const special = bookEvent.symbol;
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });

		// Visible rows only: the reveal pads the reel top+bottom by one row, so the
		// on-screen cells are symbol indices 1..BOARD_DIMENSIONS.y. For each cell the
		// OLD symbol first plays its `explosion` spine (every symbol carries one); once
		// that completes the cell swaps to the special and plays its `land` spine — so
		// it reads as "symbol explodes → book appears". Staggered one cell at a time.
		for (const reelIndex of bookEvent.reels) {
			const reel = stateGame.board[reelIndex];
			if (!reel) continue;
			const symbols = reel.reelState.symbols;
			for (let row = 1; row <= BOARD_DIMENSIONS.y && row < symbols.length - 1; row++) {
				const reelSymbol = symbols[row];
				if (!reelSymbol || reelSymbol.rawSymbol.name === special) continue;
				// 1. Explode the existing symbol and wait for the spine to finish.
				eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_wild_explode' });
				reelSymbol.symbolState = 'explosion';
				await waitForResolve((resolve) => (reelSymbol.oncomplete = resolve));
				// 2. Swap to the special and play its land spine in the cleared cell.
				reelSymbol.rawSymbol = { ...reelSymbol.rawSymbol, name: special };
				reelSymbol.symbolState = 'land';
				await waitForTimeout(0.12 * SECOND);
			}
		}
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		// animate scatters
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });
		await animateSymbols({ positions: bookEvent.positions });
		// show free spin intro
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_superfreespin' });
		await eventEmitter.broadcastAsync({ type: 'uiHide' });
		await eventEmitter.broadcastAsync({ type: 'transition' });
		// Set the awarded-count BEFORE the intro shows, so a `freeSpinsWon`-bound readout in
		// an authored intro screen has the total while the intro is on screen (the counter
		// total is otherwise set further down, after the intro hides).
		stateUi.freeSpinCounterTotal = bookEvent.totalFs;
		eventEmitter.broadcast({ type: 'freeSpinIntroShow' });
		stateUi.freeSpinIntroShow = true;
		eventEmitter.broadcast({ type: 'soundOnce', name: 'jng_intro_fs' });
		eventEmitter.broadcast({ type: 'soundMusic', name: 'bgm_freespin' });
		await eventEmitter.broadcastAsync({
			type: 'freeSpinIntroUpdate',
			totalFreeSpins: bookEvent.totalFs,
		});
		stateGame.gameType = 'freegame';
		eventEmitter.broadcast({ type: 'freeSpinIntroHide' });
		stateUi.freeSpinIntroShow = false;
		eventEmitter.broadcast({ type: 'boardFrameGlowShow' });
		eventEmitter.broadcast({ type: 'freeSpinCounterShow' });
		stateUi.freeSpinCounterShow = true;
		eventEmitter.broadcast({
			type: 'freeSpinCounterUpdate',
			current: undefined,
			total: bookEvent.totalFs,
		});
		stateUi.freeSpinCounterTotal = bookEvent.totalFs;
		await eventEmitter.broadcastAsync({ type: 'uiShow' });
		await eventEmitter.broadcastAsync({ type: 'drawerButtonShow' });
		eventEmitter.broadcast({ type: 'drawerFold' });
	},
	updateFreeSpin: async (bookEvent: BookEventOfType<'updateFreeSpin'>) => {
		eventEmitter.broadcast({ type: 'freeSpinCounterShow' });
		stateUi.freeSpinCounterShow = true;
		eventEmitter.broadcast({
			type: 'freeSpinCounterUpdate',
			current: bookEvent.amount + 1,
			total: bookEvent.total,
		});
		stateUi.freeSpinCounterCurrent = bookEvent.amount + 1;
		stateUi.freeSpinCounterTotal = bookEvent.total;
	},
	freeSpinEnd: async (bookEvent: BookEventOfType<'freeSpinEnd'>) => {
		const winLevelData = winLevelMap[bookEvent.winLevel as WinLevel];

		await eventEmitter.broadcastAsync({ type: 'uiHide' });
		stateGame.gameType = 'basegame';
		eventEmitter.broadcast({ type: 'boardFrameGlowHide' });
		eventEmitter.broadcast({ type: 'freeSpinOutroShow' });
		stateUi.freeSpinOutroShow = true;
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_youwon_panel' });
		winLevelSoundsPlay({ winLevelData });
		await eventEmitter.broadcastAsync({
			type: 'freeSpinOutroCountUp',
			amount: bookEvent.amount,
			winLevelData,
		});
		winLevelSoundsStop();
		eventEmitter.broadcast({ type: 'freeSpinOutroHide' });
		stateUi.freeSpinOutroShow = false;
		eventEmitter.broadcast({ type: 'freeSpinCounterHide' });
		eventEmitter.broadcast({ type: 'specialBookHide' });
		stateGame.specialSymbol = null;
		stateUi.freeSpinCounterShow = false;
		await eventEmitter.broadcastAsync({ type: 'transition' });
		await eventEmitter.broadcastAsync({ type: 'uiShow' });
		await eventEmitter.broadcastAsync({ type: 'drawerUnfold' });
		eventEmitter.broadcast({ type: 'drawerButtonHide' });
	},
	setWin: async (bookEvent: BookEventOfType<'setWin'>) => {
		const winLevelData = winLevelMap[bookEvent.winLevel as WinLevel];

		eventEmitter.broadcast({ type: 'winShow' });
		stateUi.winShow = true;
		stateUi.bigWinShow = winLevelData?.type === 'big';
		winLevelSoundsPlay({ winLevelData });
		await eventEmitter.broadcastAsync({
			type: 'winUpdate',
			amount: bookEvent.amount,
			winLevelData,
		});
		winLevelSoundsStop();
		eventEmitter.broadcast({ type: 'winHide' });
		stateUi.winShow = false;
		stateUi.bigWinShow = false;
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		// Do nothing
	},
	// customised
	createBonusSnapshot: async (bookEvent: BookEventOfType<'createBonusSnapshot'>) => {
		const { bookEvents } = bookEvent;

		function findLastBookEvent<T>(type: T) {
			return _.findLast(bookEvents, (bookEvent) => bookEvent.type === type) as
				| BookEventOfType<T>
				| undefined;
		}

		const lastFreeSpinTriggerEvent = findLastBookEvent('freeSpinTrigger' as const);
		const lastUpdateFreeSpinEvent = findLastBookEvent('updateFreeSpin' as const);
		const lastSetTotalWinEvent = findLastBookEvent('setTotalWin' as const);
		const lastUpdateGlobalMultEvent = findLastBookEvent('updateGlobalMult' as const);

		if (lastFreeSpinTriggerEvent) await playBookEvent(lastFreeSpinTriggerEvent, { bookEvents });
		if (lastUpdateFreeSpinEvent) playBookEvent(lastUpdateFreeSpinEvent, { bookEvents });
		if (lastSetTotalWinEvent) playBookEvent(lastSetTotalWinEvent, { bookEvents });
		if (lastUpdateGlobalMultEvent) playBookEvent(lastUpdateGlobalMultEvent, { bookEvents });
	},
};
