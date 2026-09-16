import _ from 'lodash';

import { type BookEventHandlerMap } from 'utils-book';
import { stateBet, stateUi, showMessage } from 'state-shared';
import { sequence } from 'utils-shared/sequence';
import { waitForResolve } from 'utils-shared/wait';
import { roundSkip } from 'utils-shared/skipToken';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { SECOND } from 'constants-shared/time';

import { eventEmitter } from './eventEmitter';
import { broadcastMusicCue, playWildExplodeSound } from './soundBindings';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { awaitCue, slamHold, SLAM_MESSAGE_HOLD_MS } from './unskippablePresentation';
import { playBookEvent } from './utils';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { tumbleBoardCombined } from './stateTumble.svelte';
import {
	presentReveal,
	winLevelSoundsPlay,
	winLevelSoundsStop,
	animateSymbols,
	winningPositionsOf,
	winLineEnabledForWin,
	winLineFullPointsFor,
	winLinePointsFor,
	winLineShapeFor,
	winLineTextFor,
	winLineColorFor,
	showWinInfoMessage,
	cueBigWinCountUp,
} from './flowEffects';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';
import { activeWinLevelData, boardDimensions } from './gameConfig';
import { bakedWinLineConfig } from '../editor-scenes';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	/**
	 * The reveal — the bonus-game record, the game type, the cleared expansion and the board itself,
	 * all through the SHARED {@link presentReveal}. Its twin, the flow-v2 `revealBoard` effect, calls
	 * the identical function: whether the board rolls or drops in (swap-in-place mode) is decided in
	 * ONE place, so a flow-driven game and a coded one cannot disagree about it.
	 *
	 * `soundScatterCounterClear` stays HERE rather than moving inside, because the flow path does not
	 * broadcast it — it authors that cue as a Broadcast node. It is the one part of the reveal the two
	 * paths were never meant to share.
	 */
	reveal: async (bookEvent: BookEventOfType<'reveal'>, { bookEvents }: BookEventContext) => {
		await presentReveal({ bookEvent, bookEvents });
		eventEmitter.broadcast({ type: 'soundScatterCounterClear' });
	},
	winInfo: async (bookEvent: BookEventOfType<'winInfo'>) => {
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_winlevel_small' });
		// ALL-AT-ONCE MODE (Symbols State Machine → "Show all win lines at once"): every paying line of
		// this event was already drawn together, up front, by `dispatchBookEvent` — the seam every
		// dispatch path crosses — and must STAY on screen while the symbols celebrate. So the per-win
		// show/hide below stands down and this handler only lights the symbols; nothing clears the set
		// until the next spin (`clearWinPresentation`).
		const allAtOnce = bakedWinLineConfig().line.allAtOnce;
		await sequence(bookEvent.wins, async (win) => {
			// The win-line geometry + gate live in `flowEffects` so the coded handler and the
			// `showWinLine` / `hideWinLine` flow effects are one source of truth (parity by
			// construction). `winningPositions` traces ONLY the leftmost `kind` paying symbols;
			// `winLineEnabledForWin` skips a scatter win / a disabled overlay.
			const winningPositions = winningPositionsOf(win);

			const showWinLine = !allAtOnce && winLineEnabledForWin(win);
			if (showWinLine) {
				// Awaited: when the line is configured to animate, WinLine.svelte resolves this
				// only after the line has drawn first→last and the amount is revealed, so the
				// symbol glow follows. Non-animated draws resolve immediately, keeping the
				// original timing (line + amount instant, symbols animate alongside). Unreachable on
				// a slammed spin — `winLineEnabledForWin` is false there, since the line and its
				// stamped amount are exactly what the press asked to skip.
				await roundSkip.race(
					eventEmitter.broadcastAsync({
						type: 'winLineShow',
						points: winLinePointsFor(winningPositions),
						shape: winLineShapeFor(winningPositions),
						fullPoints: winLineFullPointsFor(win),
						color: winLineColorFor(win.meta?.lineIndex),
						...winLineTextFor({
							symbol: win.symbol,
							kind: win.kind,
							amount: win.win,
							line: win.meta?.lineIndex,
						}),
					}),
				);
			}

			await animateSymbols({
				positions: winningPositions,
				// Same colour fed to the line draw above (line 75) — reused so a `winLine`-tinted
				// highlight frame glows in this paying line's colour; undefined ⇒ untinted.
				color: winLineColorFor(win.meta?.lineIndex),
			});

			if (showWinLine) eventEmitter.broadcast({ type: 'winLineHide' });

			// SLAM MINIMUM DISPLAY — slammed spins only, so the unslammed coded path is untouched.
			// `animateSymbols` has just held on the lit symbols (`SLAM_MINIMUM_DISPLAY_CUES`); this
			// adds the per-win info message, which the coded path otherwise never shows at all (it is
			// authored as a `showMessage` node in both reference choreographies, and those flows keep
			// owning it — this handler does not run when a flow owns `winInfo`). Held on a bare timer
			// so several wins read one after another instead of overwriting each other in one frame.
			if (roundSkip.isSkipped()) {
				const shown = showWinInfoMessage({
					amount: win.win,
					kind: win.kind,
					// Names the paying symbol in the message ("4 Bananas") — the coded path has the whole
					// win in hand, so it never needs the flow's remembered-symbol fallback.
					symbol: win.symbol,
					messageKind: 'win',
				});
				if (shown) await slamHold(SLAM_MESSAGE_HOLD_MS);
			}
		});
	},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		stateBet.winBookEventAmount = bookEvent.amount;
	},
	setExpandingSymbol: async (bookEvent: BookEventOfType<'setExpandingSymbol'>) => {
		stateGame.specialSymbol = bookEvent.symbol;
		// Await the reveal (shuffle → land → intro spine) so the next book event — the first
		// free-spin `reveal` — only fires once the book symbol has been chosen AND revealed.
		// UNSKIPPABLE (`unskippablePresentation.ts`): a slam used to release this while the reveal
		// rig kept playing, so the free spins started underneath a reveal still on screen.
		await awaitCue(
			'specialBookReveal',
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
		// The fact the win text needs: this spin's wins on `special` are REEL counts, not icon counts.
		stateGame.expandedSymbol = special;
		eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });

		// Visible rows only: the reveal pads the reel top+bottom by one row, so the
		// on-screen cells are symbol indices 1..boardDimensions().y. For each cell the
		// OLD symbol first plays its `explosion` spine (every symbol carries one); once
		// that completes the cell swaps to the special and plays its `land` spine — so
		// it reads as "symbol explodes → book appears". Staggered one cell at a time.
		for (const reelIndex of bookEvent.reels) {
			const reel = stateGame.board[reelIndex];
			if (!reel) continue;
			const symbols = reel.reelState.symbols;
			for (let row = 1; row <= boardDimensions().y && row < symbols.length - 1; row++) {
				const reelSymbol = symbols[row];
				if (!reelSymbol || reelSymbol.rawSymbol.name === special) continue;
				// 1. Explode the existing symbol and wait for the spine to finish. A slammed round
				//    stops waiting for the spine — the swap below still runs for EVERY cell, so the
				//    expanded board still lands at its final state, just instantly.
				playWildExplodeSound();
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

		// Info-bar note: the scatter/book match is the TRIGGER for the feature (it no longer pays out),
		// so tell the player what it awarded — "N Scatters award N Free Spins". This is the CODED /
		// non-flow path; a v2 flow that owns `freeSpinTrigger` suppresses this whole handler and instead
		// rides the award on the scatter's `winInfo` toast (`showWinInfoMessage`), because the flow mounts
		// the intro container on `freeSpinTrigger` and a toast there would never be seen.
		const scatterCount = bookEvent.positions.length;
		const freeSpins = bookEvent.totalFs;
		showMessage(
			`${scatterCount} ${scatterCount === 1 ? 'Scatter' : 'Scatters'} award ${freeSpins} Free ${
				freeSpins === 1 ? 'Spin' : 'Spins'
			}`,
			{ kind: 'info' },
		);

		if (presentIntro) {
			// animate scatters
			eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });
			await animateSymbols({ positions: bookEvent.positions });
			// show free spin intro
			eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_superfreespin' });
			await awaitCue('uiHide', eventEmitter.broadcastAsync({ type: 'uiHide' }));
			await awaitCue('transition', eventEmitter.broadcastAsync({ type: 'transition' }));
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
		// intro), so it switches whether or not the coded intro celebration runs. The TRACK is the
		// project's `freeSpinMusic` slot rather than a literal, so a game with its own audio sounds
		// like itself in the feature too.
		broadcastMusicCue('freeSpinMusic');
		if (presentIntro) {
			// PLAYER-GATED (`PLAYER_GATED_CUES`): `FreeSpinIntroGate` holds this until a
			// press-to-continue, so it stays released-on-skip even though the intro is otherwise
			// unskippable — after a slam the spin button is inert and swallows that very tap.
			await awaitCue(
				'freeSpinIntroUpdate',
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
			await awaitCue('uiShow', eventEmitter.broadcastAsync({ type: 'uiShow' }));
		}
		await awaitCue('drawerButtonShow', eventEmitter.broadcastAsync({ type: 'drawerButtonShow' }));
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
	freeSpinRetrigger: async (bookEvent: BookEventOfType<'freeSpinRetrigger'>) => {
		// Retrigger (3+ scatters during a free spin → +extraFs spins). This game shows NO
		// retrigger celebration by design, so there is no "+N free spins" overlay. We still
		// register a handler — a bare `bookEventHandlerMap` miss logs a console ERROR on every
		// retrigger (`utils-book/createPlayBookUtils`) and drops the event. Consume it cleanly:
		// keep the counter total in sync (the following `updateFreeSpin` also carries it) and
		// present nothing.
		stateUi.freeSpinCounterTotal = bookEvent.total;
	},
	freeSpinEnd: async (bookEvent: BookEventOfType<'freeSpinEnd'>) => {
		const winLevelData = activeWinLevelData(bookEvent.winLevel);

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
		stateGame.expandedSymbol = null;
		stateUi.freeSpinCounterShow = false;
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'transition' }));
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'uiShow' }));
		await roundSkip.race(eventEmitter.broadcastAsync({ type: 'drawerUnfold' }));
		eventEmitter.broadcast({ type: 'drawerButtonHide' });
	},
	setWin: async (bookEvent: BookEventOfType<'setWin'>) => {
		const winLevelData = activeWinLevelData(bookEvent.winLevel);

		// The optional big-win RUN-UP: the round total counted up to the tier threshold, as the cue
		// that the overlay is coming. Awaited BEFORE the overlay shows, so the count stops exactly
		// where the overlay's own count-up picks the number up. A no-op unless the project authored
		// it AND this round reached a big tier (see `cueBigWinCountUp`).
		await cueBigWinCountUp({ amount: bookEvent.amount, winLevelData });
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
	/**
	 * One cascade step, in the order the player sees it: hide the reels, mount the tumble overlay,
	 * blow up the winners, bring the board back together, then hand the settled result back to the
	 * ordinary board and unmount.
	 *
	 * That fourth beat is the one that varies. A rolling board — and every swap style but one —
	 * SLIDES: survivors and refills fall together into their seats. An `emerge` board APPEARS its
	 * refills in place instead, so a game whose symbols surface on the spin also has them surface on
	 * a win rather than dropping in from the top.
	 *
	 * The explode and slide are AWAITED because each is a real animation with a completion the
	 * Symbols tool authors; running them unawaited would cascade the next step over the top of the
	 * one still playing. `boardSettle` re-seats the reel board on the combined result so that when
	 * the overlay goes away the reels already show what the cascade left behind — the swap back is
	 * invisible.
	 */
	tumbleBoard: async (bookEvent: BookEventOfType<'tumbleBoard'>) => {
		eventEmitter.broadcast({ type: 'boardHide' });
		eventEmitter.broadcast({ type: 'tumbleBoardShow' });
		eventEmitter.broadcast({ type: 'tumbleBoardInit', addingBoard: bookEvent.newSymbols });
		await eventEmitter.broadcastAsync({
			type: 'tumbleBoardExplode',
			explodingPositions: bookEvent.explodingSymbols,
		});
		eventEmitter.broadcast({ type: 'tumbleBoardRemoveExploded' });
		// HOW THE REFILLS ARRIVE follows the board's own swap style, so a game does not roll one way
		// on the spin and another way on a win. Under `emerge` the new symbols appear on their seats
		// and play their authored `intro`; the SURVIVORS still slide, because they are relocating
		// rather than arriving (see the cue's doc in `TumbleBoard.svelte`). Every other style — and
		// every board that does not swap at all — reaches the slide exactly as it always has.
		const emerges =
			stateGameDerived.boardSwapsInPlace() && stateGameDerived.boardSwapStyle() === 'emerge';
		await eventEmitter.broadcastAsync({
			type: emerges ? 'tumbleBoardAppear' : 'tumbleBoardSlideDown',
		});
		eventEmitter.broadcast({
			type: 'boardSettle',
			board: tumbleBoardCombined().map((tumbleReel) =>
				tumbleReel.map((tumbleSymbol) => tumbleSymbol.rawSymbol),
			),
		});
		eventEmitter.broadcast({ type: 'tumbleBoardReset' });
		eventEmitter.broadcast({ type: 'tumbleBoardHide' });
		eventEmitter.broadcast({ type: 'boardShow' });
	},

	/**
	 * The running cascade total. Routed through the SAME win meter the rest of the game uses rather
	 * than a tumble-specific readout, so a project that authored its win text/meter gets the cascade
	 * for free. `amount` of 0 means the chain paid nothing this step and there is nothing to show.
	 */
	updateTumbleWin: async (bookEvent: BookEventOfType<'updateTumbleWin'>) => {
		if (bookEvent.amount <= 0) return;
		eventEmitter.broadcast({ type: 'winShow' });
		eventEmitter.broadcast({
			type: 'winUpdate',
			amount: bookEvent.amount,
			winLevel: 0,
		});
	},

	/**
	 * The cascade multiplier. A value of 1 is the chain RESETTING, not a x1 step — so it clears the
	 * running win rather than announcing a multiplier, which is the one place this event is easy to
	 * get backwards.
	 */
	updateGlobalMult: async (bookEvent: BookEventOfType<'updateGlobalMult'>) => {
		if (bookEvent.globalMult === 1) {
			eventEmitter.broadcast({ type: 'winHide' });
			stateUi.winShow = false;
		}
	},

	/**
	 * The multiplier-COLLECT beat: show the running cascade total, mount the collect overlay, let each
	 * multiplier play in place, then fly them to the board centre and announce the combined total.
	 *
	 * The two animated steps are AWAITED for the same reason the cascade's are — each is a real
	 * animation whose completion the Symbols tool authors, and not waiting would run the flight over
	 * the top of a win state still playing.
	 *
	 * The totals ride the game's ORDINARY win meter rather than a bespoke readout, so a project that
	 * authored its win text gets this beat for free. That is a deliberate simplification of the
	 * reference, which carried a second `tumbleWinAmount`/`multiplierTotal` display stack of its own.
	 */
	boardMultiplierInfo: async (bookEvent: BookEventOfType<'boardMultiplierInfo'>) => {
		eventEmitter.broadcast({ type: 'winShow' });
		eventEmitter.broadcast({
			type: 'winUpdate',
			amount: bookEvent.winInfo.tumbleWin,
			winLevel: 0,
		});

		eventEmitter.broadcast({ type: 'multiplierBoardShow' });
		eventEmitter.broadcast({ type: 'multiplierBoardInit' });
		await eventEmitter.broadcastAsync({ type: 'multiplierBoardAnimate' });
		await eventEmitter.broadcastAsync({ type: 'multiplierBoardMove' });
		eventEmitter.broadcast({ type: 'multiplierBoardReset' });
		eventEmitter.broadcast({ type: 'multiplierBoardHide' });

		eventEmitter.broadcast({
			type: 'winUpdate',
			amount: bookEvent.winInfo.totalWin,
			winLevel: 0,
		});
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
