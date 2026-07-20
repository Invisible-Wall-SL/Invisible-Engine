import _ from 'lodash';

import { recordBookEvent, checkIsMultipleRevealEvents, type BookEventHandlerMap } from 'utils-book';
import { stateBet, stateUi } from 'state-shared';
import { sequence } from 'utils-shared/sequence';
import { waitForResolve } from 'utils-shared/wait';
import { roundSkip } from 'utils-shared/skipToken';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { SECOND } from 'constants-shared/time';

import { eventEmitter } from './eventEmitter';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { playBookEvent } from './utils';
import { winLevelMap, type WinLevel } from './winLevelMap';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import {
	winLevelSoundsPlay,
	winLevelSoundsStop,
	animateSymbols,
	winningPositionsOf,
	winLineEnabledForWin,
	winLinePointsFor,
	winLineTextFor,
} from './flowEffects';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';
import { PADDING_REELS, BOARD_DIMENSIONS } from './constants';

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
			// The win-line geometry + gate live in `flowEffects` so the coded handler and the
			// `showWinLine` / `hideWinLine` flow effects are one source of truth (parity by
			// construction). `winningPositions` traces ONLY the leftmost `kind` paying symbols;
			// `winLineEnabledForWin` skips a scatter win / a disabled overlay.
			const winningPositions = winningPositionsOf(win);

			const showWinLine = winLineEnabledForWin(win);
			if (showWinLine) {
				// Awaited: when the line is configured to animate, WinLine.svelte resolves this
				// only after the line has drawn first→last and the amount is revealed, so the
				// symbol glow follows. Non-animated draws resolve immediately, keeping the
				// original timing (line + amount instant, symbols animate alongside). Raced against
				// the slam token: a slammed round shows the line COMPLETE (WinLine skips its draw
				// tween) instead of waiting for it to trace.
				await roundSkip.race(
					eventEmitter.broadcastAsync({
						type: 'winLineShow',
						points: winLinePointsFor(winningPositions),
						...winLineTextFor({
							symbol: win.symbol,
							kind: win.kind,
							amount: win.win,
							line: win.meta?.lineIndex,
						}),
					}),
				);
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
		await roundSkip.race(
			eventEmitter.broadcastAsync({ type: 'specialBookReveal', symbol: bookEvent.symbol }),
		);
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
				// 1. Explode the existing symbol and wait for the spine to finish. A slammed round
				//    stops waiting for the spine — the swap below still runs for EVERY cell, so the
				//    expanded board still lands at its final state, just instantly.
				eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_wild_explode' });
				reelSymbol.symbolState = 'explosion';
				await roundSkip.race(waitForResolve((resolve) => (reelSymbol.oncomplete = resolve)));
				// 2. Swap to the special and play its land spine in the cleared cell.
				reelSymbol.rawSymbol = { ...reelSymbol.rawSymbol, name: special };
				reelSymbol.symbolState = 'land';
				await roundSkip.wait(0.12 * SECOND);
			}
		}
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		// Flow-is-sole-authority (owner direction 2026-07-14). When a v2 flow DRIVES the game's
		// screens (`ownsEvent('load')` — the SAME signal Game.svelte reads as `flowV2DrivesScreens`)
		// the flow owns ALL presentation. A free-spin intro is then EITHER authored — v2 owns
		// `freeSpinTrigger`, so this coded handler never runs (`game/utils.ts`) — OR deliberately
		// removed from the flow, in which case this coded handler runs but must NOT paint the coded
		// intro: under a screen-driving v2 flow the coded intro gate + visual are BOTH suppressed
		// (`flowV2DrivesScreens` in Game.svelte), so the intro half-executes (transition wipe +
		// jingles + a `freeSpinIntroUpdate` round-block with no gate) and reads as broken. So when the
		// flow drives screens we run STATE-ONLY — enter free-game (`gameType`), arm the counter, and
		// the free-game ambiance that PERSISTS through the feature (board glow, music, drawer) — and
		// skip every momentary intro-celebration broadcast. A non-v2 / book-events-only flow leaves
		// `presentIntro` true ⇒ every block below runs in its original order, byte-identical to
		// before (parity §7).
		const presentIntro = !(getFlowV2()?.ownsEvent('load') ?? false);

		if (presentIntro) {
			// animate scatters
			eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });
			await animateSymbols({ positions: bookEvent.positions });
			// show free spin intro
			eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_superfreespin' });
			await roundSkip.race(eventEmitter.broadcastAsync({ type: 'uiHide' }));
			await roundSkip.race(eventEmitter.broadcastAsync({ type: 'transition' }));
		}
		// Set the awarded-count BEFORE the intro shows, so a `freeSpinsWon`-bound readout in
		// an authored intro screen has the total while the intro is on screen (the counter
		// total is otherwise set further down, after the intro hides).
		stateUi.freeSpinCounterTotal = bookEvent.totalFs;
		if (presentIntro) {
			eventEmitter.broadcast({ type: 'freeSpinIntroShow' });
			stateUi.freeSpinIntroShow = true;
			eventEmitter.broadcast({ type: 'soundOnce', name: 'jng_intro_fs' });
		}
		// Free-game background music plays THROUGH the whole feature (not part of the momentary
		// intro), so it switches whether or not the coded intro celebration runs.
		eventEmitter.broadcast({ type: 'soundMusic', name: 'bgm_freespin' });
		if (presentIntro) {
			await roundSkip.race(
				eventEmitter.broadcastAsync({
					type: 'freeSpinIntroUpdate',
					totalFreeSpins: bookEvent.totalFs,
				}),
			);
		}
		stateGame.gameType = 'freegame';
		if (presentIntro) {
			eventEmitter.broadcast({ type: 'freeSpinIntroHide' });
			stateUi.freeSpinIntroShow = false;
		}
		eventEmitter.broadcast({ type: 'boardFrameGlowShow' });
		eventEmitter.broadcast({ type: 'freeSpinCounterShow' });
		stateUi.freeSpinCounterShow = true;
		eventEmitter.broadcast({
			type: 'freeSpinCounterUpdate',
			current: undefined,
			total: bookEvent.totalFs,
		});
		stateUi.freeSpinCounterTotal = bookEvent.totalFs;
		if (presentIntro) {
			await roundSkip.race(eventEmitter.broadcastAsync({ type: 'uiShow' }));
		}
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'drawerButtonShow' }));
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

		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'uiHide' }));
		stateGame.gameType = 'basegame';
		eventEmitter.broadcast({ type: 'boardFrameGlowHide' });
		eventEmitter.broadcast({ type: 'freeSpinOutroShow' });
		stateUi.freeSpinOutroShow = true;
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_youwon_panel' });
		winLevelSoundsPlay({ winLevelData });
		// The outro gate is PLAYER-GATED (it only resolves on a press-to-continue), so the race is
		// what releases the round on a slam; the count-up itself has already jumped to the final
		// total via `WinCountUpProvider`'s own skip hook, so nothing is lost.
		await roundSkip.race(
			eventEmitter.broadcastAsync({
				type: 'freeSpinOutroCountUp',
				amount: bookEvent.amount,
				winLevelData,
			}),
		);
		winLevelSoundsStop();
		eventEmitter.broadcast({ type: 'freeSpinOutroHide' });
		stateUi.freeSpinOutroShow = false;
		eventEmitter.broadcast({ type: 'freeSpinCounterHide' });
		eventEmitter.broadcast({ type: 'specialBookHide' });
		stateGame.specialSymbol = null;
		stateUi.freeSpinCounterShow = false;
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'transition' }));
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'uiShow' }));
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'drawerUnfold' }));
		eventEmitter.broadcast({ type: 'drawerButtonHide' });
	},
	setWin: async (bookEvent: BookEventOfType<'setWin'>) => {
		const winLevelData = winLevelMap[bookEvent.winLevel as WinLevel];

		eventEmitter.broadcast({ type: 'winShow' });
		stateUi.winShow = true;
		stateUi.bigWinShow = winLevelData?.type === 'big';
		winLevelSoundsPlay({ winLevelData });
		await roundSkip.race(
			eventEmitter.broadcastAsync({
				type: 'winUpdate',
				amount: bookEvent.amount,
				winLevelData,
			}),
		);
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
