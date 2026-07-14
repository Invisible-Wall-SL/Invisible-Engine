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
import {
	stateBet,
	stateUi,
	showMessage as showGameMessage,
	type GameMessageKind,
} from 'state-shared';
import { waitForTimeout, waitForResolve } from 'utils-shared/wait';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
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

/**
 * Coerce a sequential-stop knob payload into a PER-REEL override array (or null). A `list<float>`
 * from the Flow node is used as-is (indexed by reel); a lone number is broadcast to every reel; a
 * short array leaves later reels on the coded constant (the getter falls back per index). Anything
 * else ⇒ null ⇒ every reel uses the constant.
 */
const toReelOverrides = (value: unknown): number[] | null => {
	if (Array.isArray(value)) return value.length ? (value as number[]) : null;
	if (typeof value === 'number') return Array(BOARD_DIMENSIONS.x).fill(value);
	return null;
};

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
			forceSequentialStop: stateGame.sequentialReelStop,
		});
	},

	/**
	 * Enable free-spin sequential reel stop — each reel stops consecutively (`sequentialReelStop`).
	 * `gaps` (`reelPaddingMultiplierSequential`, higher = longer beat before that reel stops) and
	 * `speeds` (`reelSpinSpeedSequential`, higher = faster that reel spins) are PER-REEL arrays
	 * indexed by reel (entry 0 = leftmost reel); a missing/short entry falls back to the coded
	 * SPIN_OPTIONS constant, so `speeds: [2, 3, 4, 5, 6]` gives an accelerating cascade. A lone
	 * number is accepted too (broadcast to every reel). Omit both ⇒ the uniform coded constants.
	 */
	enableSequentialReelStop: (payload) => {
		stateGame.sequentialReelStop = true;
		stateGame.sequentialGapOverrides = toReelOverrides(payload.gaps ?? payload.gap);
		stateGame.sequentialSpeedOverrides = toReelOverrides(payload.speeds ?? payload.speed);
	},

	/** Disable free-spin sequential reel stop + clear the per-reel overrides (`sequentialReelStop`). */
	disableSequentialReelStop: () => {
		stateGame.sequentialReelStop = false;
		stateGame.sequentialGapOverrides = null;
		stateGame.sequentialSpeedOverrides = null;
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

	/**
	 * Generic transient-message ("toast") effect. Fires `state-shared` `showMessage`, which
	 * populates `stateMessage.current` — the feed the Info Bar's `message` value + `messageShow`
	 * gate read (Game.svelte). Any FlowDoc can invoke it; it is NOT winInfo-specific.
	 *
	 * The bounded accessor model can't template a string (§11.4), so the TEXT is assembled HERE
	 * from the structured payload: an `amount` (a book-event amount, e.g. a `winInfo` win's `win`)
	 * formats through the SAME currency formatter the win-meter uses (`bookEventAmountToCurrencyString`,
	 * so it matches the game's formatting), and a `kind` appends the "N of a kind" tail. So a
	 * `winInfo` win renders "Win $1.00 — 2 of a kind"; with only `amount` it shows "Win $1.00".
	 * Auto-clears via the state timer (`messageKind` selects the toast style, default `info`;
	 * `durationMs` overrides the default hold).
	 */
	showMessage: (payload) => {
		const parts: string[] = [];
		if (typeof payload.amount === 'number') {
			parts.push(`Win ${bookEventAmountToCurrencyString(payload.amount)}`);
		}
		if (typeof payload.kind === 'number') {
			parts.push(`${payload.kind} of a kind`);
		}
		const text = parts.join(' — ');
		if (!text) return;
		showGameMessage(text, {
			kind: (payload.messageKind as GameMessageKind) ?? 'info',
			durationMs: payload.durationMs as number | undefined,
		});
	},

	/**
	 * Flow v2 `stopReel(index)` command — settle one reel by index. The reference book-of board
	 * spins whole-board (via `revealBoard`), so per-reel stop is exposed as a real `reelStop` emitter
	 * broadcast: a reel component binds it to land that column (the hook the `StaggerStop` function
	 * drives). Backs the `stopReel` command declared in `BOOK_OF_VOCAB` so an authored per-reel stagger
	 * fires a real signal rather than a silent no-op (Phase 4c — the template implements its vocabulary).
	 */
	stopReel: (payload) => {
		eventEmitter.broadcast({ type: 'reelStop', index: payload.index as number });
	},
};

/** The effect resolver the runtime injects (`FlowRuntime.effect` / v2 `FlowV2Env.effect`). Unknown
 *  name ⇒ no-op. */
export const flowEffect = (name: string): FlowEffect | undefined => effects[name];

/** The names of every implemented effect/command (v2 vocabulary coverage — the runtime asserts every
 *  declared `BOOK_OF_VOCAB` action resolves here). */
export const flowEffectNames: readonly string[] = Object.keys(effects);
