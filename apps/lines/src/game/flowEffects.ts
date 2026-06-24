/**
 * Invisible Flow — apps/lines game-side EFFECT registry (Phase 5, design doc §3, §9 row 5,
 * §11.4).
 *
 * The choreography vocabulary (Broadcast / Sequence / Parallel / Delay / Branch / ForEach)
 * expresses the emitter timeline of a book event, but a coded `bookEventHandlerMap` handler
 * also does NON-emitter work the bounded vocabulary deliberately cannot express: state
 * mutations (`stateGame.gameType = …`, `stateBet.winBookEventAmount = …`, the `stateUi.*`
 * flags), board operations (`enhancedBoard.spin(…)`, the Book-of column morph), and the
 * conditional win-level sound clusters (which read LIVE state, not the trigger payload).
 *
 * Each such leaf is lifted VERBATIM from `bookEventHandlerMap.ts` into a NAMED effect here —
 * the `declare ≠ implement` bridge (design doc §3), the exact analogue of
 * `registerComponentActions`. The FlowDoc *declares* `{ kind: 'effect', name, payload }`; this
 * module *implements* it. Because the bodies are the coded leaves unchanged, an effect is
 * byte-identical to its coded counterpart BY CONSTRUCTION — the migration reproduces, never
 * re-derives. This is NOT a scripting VM (§11.4): a CLOSED map of named effects whose code
 * lives in the game, never authored in the doc.
 *
 * Parity (§7): an effect is only invoked when the FlowDoc authors it; with no FlowDoc the
 * coded handler map runs unchanged. The effect bodies and the coded handler share the same
 * helpers below, so there is one source of truth for each leaf.
 */

import { recordBookEvent, checkIsMultipleRevealEvents } from 'utils-book';
import { stateBet, stateUi } from 'state-shared';
import { waitForTimeout, waitForResolve } from 'utils-shared/wait';
import { SECOND } from 'constants-shared/time';
import type { FlowEffect } from 'engine-flow';

import { eventEmitter } from './eventEmitter';
import { winLevelMap, type WinLevel, type WinLevelData } from './winLevelMap';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import type { BookEvent, BookEventOfType } from './typesBookEvent';
import type { Position, SymbolName } from './types';
import { PADDING_REELS, BOARD_DIMENSIONS } from './constants';

// ---------------------------------------------------------------------------
// Shared leaves — the SAME helpers the coded handlers use. The coded
// `bookEventHandlerMap` and these effects both call into these, so each leaf has a
// single source of truth (parity by construction).
// ---------------------------------------------------------------------------

export const winLevelSoundsPlay = ({ winLevelData }: { winLevelData: WinLevelData }) => {
	if (winLevelData?.alias === 'max') eventEmitter.broadcastAsync({ type: 'uiHide' });
	if (winLevelData?.sound?.sfx) {
		eventEmitter.broadcast({ type: 'soundOnce', name: winLevelData.sound.sfx });
	}
	if (winLevelData?.sound?.bgm) {
		eventEmitter.broadcast({ type: 'soundMusic', name: winLevelData.sound.bgm });
	}
	if (winLevelData?.type === 'big') {
		eventEmitter.broadcast({ type: 'soundLoop', name: 'sfx_bigwin_coinloop' });
	}
};

export const winLevelSoundsStop = () => {
	eventEmitter.broadcast({ type: 'soundStop', name: 'sfx_bigwin_coinloop' });
	if (stateBet.activeBetModeKey === 'SUPERSPIN' || stateGame.gameType === 'freegame') {
		// check if SUPERSPIN, when finishing a bet.
		eventEmitter.broadcast({ type: 'soundMusic', name: 'bgm_freespin' });
	} else {
		eventEmitter.broadcast({ type: 'soundMusic', name: 'bgm_main' });
	}
	eventEmitter.broadcastAsync({ type: 'uiShow' });
};

/** The awaited symbol-spine animation — the `winInfo` / `freeSpinTrigger` leaf. */
export const animateSymbols = async ({ positions }: { positions: Position[] }) => {
	eventEmitter.broadcast({ type: 'boardShow' });
	await eventEmitter.broadcastAsync({
		type: 'boardWithAnimateSymbols',
		symbolPositions: positions,
	});
};

const winLevelDataOf = (winLevel: number): WinLevelData => winLevelMap[winLevel as WinLevel];

// ---------------------------------------------------------------------------
// The named-effect map — the implementation side of every `effect` node in the
// apps/lines FlowDoc (`flowDoc.ts`). Bodies are the coded handler leaves, verbatim.
// ---------------------------------------------------------------------------

const effects: Record<string, FlowEffect> = {
	/**
	 * `reveal` leaf — the bonus-game record + the awaited board spin. Mirrors the coded
	 * `reveal` handler exactly: the bonus-game branch records the event (for resume) +
	 * enables stop, sets `gameType`, then spins the board awaited. The `soundScatterCounterClear`
	 * that follows in the coded handler is a plain broadcast — authored as a Broadcast node.
	 */
	revealBoard: async (payload) => {
		const bookEvent = payload.bookEvent as BookEventOfType<'reveal'>;
		const bookEvents = payload.bookEvents as BookEvent[];
		const isBonusGame = checkIsMultipleRevealEvents({ bookEvents });
		if (isBonusGame) {
			eventEmitter.broadcast({ type: 'stopButtonEnable' });
			recordBookEvent({ bookEvent });
		}
		stateGame.gameType = bookEvent.gameType;
		await stateGameDerived.enhancedBoard.spin({
			revealEvent: bookEvent,
			paddingBoard: PADDING_REELS[bookEvent.gameType],
		});
	},

	/** Set the win-meter amount (`setTotalWin`). */
	setWinBookEventAmount: (payload) => {
		stateBet.winBookEventAmount = payload.amount as number;
	},

	/** Set the round's special/expanding symbol (`setExpandingSymbol`). The awaited
	 *  `specialBookReveal` broadcast that follows is authored as an awaited Broadcast node. */
	setSpecialSymbol: (payload) => {
		stateGame.specialSymbol = payload.symbol as SymbolName;
	},

	/**
	 * Book-of column morph (`expandBookColumns`) — the per-cell explode→swap→land sequence,
	 * lifted verbatim. It awaits each symbol's `oncomplete` spine + a staggered `waitForTimeout`,
	 * so the whole effect blocks until the columns finish (the wins only animate after).
	 */
	expandBookColumns: async (payload) => {
		const special = payload.symbol as SymbolName;
		const reels = payload.reels as number[];
		for (const reelIndex of reels) {
			const reel = stateGame.board[reelIndex];
			if (!reel) continue;
			const symbols = reel.reelState.symbols;
			for (let row = 1; row <= BOARD_DIMENSIONS.y && row < symbols.length - 1; row++) {
				const reelSymbol = symbols[row];
				if (!reelSymbol || reelSymbol.rawSymbol.name === special) continue;
				eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_wild_explode' });
				reelSymbol.symbolState = 'explosion';
				await waitForResolve((resolve) => (reelSymbol.oncomplete = resolve));
				reelSymbol.rawSymbol = { ...reelSymbol.rawSymbol, name: special };
				reelSymbol.symbolState = 'land';
				await waitForTimeout(0.12 * SECOND);
			}
		}
	},

	/** Set the awarded free-spin total (`freeSpinTrigger`) — before the intro shows. */
	setFreeSpinCounterTotal: (payload) => {
		stateUi.freeSpinCounterTotal = payload.total as number;
	},

	/** Show the free-spin intro flag (`freeSpinTrigger`). */
	freeSpinIntroShow: () => {
		stateUi.freeSpinIntroShow = true;
	},

	/** Switch to free-game (`freeSpinTrigger`) — `stateGame.gameType = 'freegame'`. */
	setFreeGameType: () => {
		stateGame.gameType = 'freegame';
	},

	/** Hide the intro flag (`freeSpinTrigger`) — `stateUi.freeSpinIntroShow = false`. */
	freeSpinIntroHide: () => {
		stateUi.freeSpinIntroShow = false;
	},

	/** Show the free-spin counter flag (`freeSpinTrigger` / `updateFreeSpin`). */
	freeSpinCounterShow: () => {
		stateUi.freeSpinCounterShow = true;
	},

	/** Track the free-spin counter total (`freeSpinTrigger`). */
	setFreeSpinCounterTotalOnly: (payload) => {
		stateUi.freeSpinCounterTotal = payload.total as number;
	},

	/** Broadcast the live free-spin counter update (`updateFreeSpin`) — `current = amount + 1`
	 *  (the `+1` is arithmetic the bounded accessor model deliberately can't express, §11.4). */
	freeSpinCounterUpdate: (payload) => {
		eventEmitter.broadcast({
			type: 'freeSpinCounterUpdate',
			current: (payload.amount as number) + 1,
			total: payload.total as number,
		});
	},

	/** Update the live free-spin counter current/total state (`updateFreeSpin`). */
	updateFreeSpinCounter: (payload) => {
		stateUi.freeSpinCounterCurrent = (payload.amount as number) + 1;
		stateUi.freeSpinCounterTotal = payload.total as number;
	},

	/** Enter the free-spin OUTRO: hide UI flag was already broadcast; set gameType + outro flag. */
	enterFreeSpinOutro: () => {
		stateGame.gameType = 'basegame';
		stateUi.freeSpinOutroShow = true;
	},

	/** The win-level sound cluster played as the outro/win count-up begins. */
	winLevelSoundsPlay: (payload) => {
		winLevelSoundsPlay({ winLevelData: winLevelDataOf(payload.winLevel as number) });
	},

	/** The win-level sound cluster stopped as the outro/win count-up ends. */
	winLevelSoundsStop: () => {
		winLevelSoundsStop();
	},

	/** Awaited free-spin outro count-up (`freeSpinEnd`). Carries the win-level data the gate reads. */
	freeSpinOutroCountUp: async (payload) => {
		await eventEmitter.broadcastAsync({
			type: 'freeSpinOutroCountUp',
			amount: payload.amount as number,
			winLevelData: winLevelDataOf(payload.winLevel as number),
		});
	},

	/** Clear the outro/counter flags + special symbol at the end of free spins (`freeSpinEnd`). */
	exitFreeSpinOutro: () => {
		stateUi.freeSpinOutroShow = false;
		stateGame.specialSymbol = null;
		stateUi.freeSpinCounterShow = false;
	},

	/** Show the win presentation flags (`setWin`). */
	winShow: (payload) => {
		const winLevelData = winLevelDataOf(payload.winLevel as number);
		stateUi.winShow = true;
		stateUi.bigWinShow = winLevelData?.type === 'big';
	},

	/** Awaited win count-up (`setWin`). Carries the win-level data the win panel reads. */
	winUpdate: async (payload) => {
		await eventEmitter.broadcastAsync({
			type: 'winUpdate',
			amount: payload.amount as number,
			winLevelData: winLevelDataOf(payload.winLevel as number),
		});
	},

	/** Hide the win presentation flags (`setWin`). */
	winHide: () => {
		stateUi.winShow = false;
		stateUi.bigWinShow = false;
	},
};

/** The effect resolver the runtime injects (`FlowRuntime.effect`). Unknown name ⇒ no-op. */
export const flowEffect = (name: string): FlowEffect | undefined => effects[name];
