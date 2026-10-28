import type {
	HoldAndWinEventFields,
	ImplementsEngineBookEvents,
	ModeEntryCause,
	PotsOverlayEventFields,
} from 'engine-game';
import type { BetType } from 'rgs-requests';

import type { SymbolName, RawSymbol, GameType, Position } from './types';

// book events shared with scatter game
type BookEventReveal = {
	index: number;
	type: 'reveal';
	board: RawSymbol[][];
	paddingPositions: number[];
	gameType: GameType;
	/** A coin board's base spin: the lines the server played it on (its `bet` echo). */
	paylineIds?: string[];
};

type BookEventSetTotalWin = {
	index: number;
	type: 'setTotalWin';
	amount: number;
};

type BookEventFinalWin = {
	index: number;
	type: 'finalWin';
	amount: number;
};

type BookEventFreeSpinTrigger = {
	index: number;
	type: 'freeSpinTrigger';
	totalFs: number;
	positions: Position[];
	/** A reels mode of the project's own these free spins play in (an imported bonus); absent ⇒ the
	 *  built-in `freeSpins`. */
	mode?: string;
} & ModeEntryCause;

type BookEventUpdateFreeSpin = {
	index: number;
	type: 'updateFreeSpin';
	amount: number;
	total: number;
};

// 3+ scatters landed DURING a free spin → +extraFs more spins (facade emits it on
// the `retrigger` event). `total` = the new played+left total. This game shows NO
// retrigger celebration (owner decision) — the handler exists only so the event is
// consumed cleanly instead of throwing "Missing bookEventHandler". See
// bookEventHandlerMap.freeSpinRetrigger.
type BookEventFreeSpinRetrigger = {
	index: number;
	type: 'freeSpinRetrigger';
	extraFs: number;
	total: number;
};

type BookEventSetWin = {
	index: number;
	type: 'setWin';
	amount: number;
	winLevel: number;
};

type BookEventFreeSpinEnd = {
	index: number;
	type: 'freeSpinEnd';
	amount: number;
	winLevel: number;
	/** The mode its `freeSpinTrigger` named, if any. */
	mode?: string;
};

type BookEventWinInfo = {
	index: number;
	type: 'winInfo';
	totalWin: number;
	wins: {
		symbol: SymbolName;
		kind: number;
		win: number;
		positions: Position[];
		meta: {
			lineIndex: number;
			multiplier: number;
			winWithoutMult: number;
			globalMult: number;
			lineMultiplier: number;
		};
	}[];
};

type BookEventSetExpandingSymbol = {
	index: number;
	type: 'setExpandingSymbol';
	symbol: SymbolName;
};

// Book-of mechanic (Book of Thermopylae): after the natural free-spin board
// lands, if 3+ of the special symbol are on the board, the server flags which
// reel indices contain the special so the client morphs every non-special cell
// in those reels into the special symbol — ONE cell at a time — before the wins
// pay out. `symbol` is the morph target (the round's special symbol). Emitted
// after the `reveal` and before `winInfo`; absent below 3 specials.
type BookEventExpandBookColumns = {
	index: number;
	type: 'expandBookColumns';
	reels: number[];
	symbol: SymbolName;
};

// Expanding and growing wilds (`docs/design/expanding-and-growing-wilds.md` §3). After the `reveal`
// and before the spin's `winInfo`: each expanding wild that landed fills its reel (`cells` = the
// cells that become `symbol`, never the origin or a cell left alone), then at most one growing wild
// copies itself onto `cells`, in that order. Rows are engine rows, like `winInfo`'s. `paid`: a paying
// line of the spin crosses that reel.
type BookEventExpandWild = {
	index: number;
	type: 'expandWild';
	reel: number;
	row: number;
	symbol: SymbolName;
	cells: Position[];
	paid: boolean;
};

type BookEventGrowWild = {
	index: number;
	type: 'growWild';
	origin: Position;
	symbol: SymbolName;
	cells: Position[];
};

// --- cascade (tumble) --------------------------------------------------------------------------
// The three events a tumbling game adds. They are DECLARED here — in the shared runtime's union —
// rather than in a separate game, because `_runtime/lines` is the one bundle every online game runs;
// a mechanic that is not in this union cannot reach a published project at all. A game whose RGS
// never sends them is unaffected: the handlers below only run on an event that arrives.

// One cascade step: the winning cells blow up, the survivors fall, and `newSymbols` drop in from
// above. Sent repeatedly — once per tumble — until a step produces no win.
type BookEventTumbleBoard = {
	index: number;
	type: 'tumbleBoard';
	explodingSymbols: Position[];
	newSymbols: RawSymbol[][];
};

// The match-3 board's own events (`docs/reference/match3-wire.md`, "Engine book events"): an
// RGS-decided round's board, each swap and what it leaves, and the round's end. The cascade between
// a swap and its moves left is the existing `tumbleBoard` + `updateTumbleWin`.
type BookEventBoardInit = {
	index: number;
	type: 'boardInit';
	/** The round's board, visible rows only, column-major. */
	board: RawSymbol[][];
	movesLeft: number;
	/** The server's shortest matching run; absent ⇒ the config's. */
	minRun?: number;
};

type BookEventSwap = {
	index: number;
	type: 'swap';
	from: Position;
	to: Position;
	accepted: boolean;
};

type BookEventMovesLeft = {
	index: number;
	type: 'movesLeft';
	count: number;
	/** The board the server settled on after the move, visible rows only. */
	board: RawSymbol[][];
};

type BookEventRoundEnd = {
	index: number;
	type: 'match3RoundEnd';
	totalWin: number;
	reason: 'movesUsed' | 'noMoves';
};

// The running total ACROSS the cascade chain, which is not the same number as `setWin`: a tumble
// round pays once at the end, but the player watches it climb step by step.
type BookEventUpdateTumbleWin = {
	index: number;
	type: 'updateTumbleWin';
	amount: number;
};

// The cascade multiplier as it escalates. `1` means the chain has reset, which is why the handler
// treats that value as "clear the running total" rather than "multiply by one".
type BookEventUpdateGlobalMult = {
	index: number;
	type: 'updateGlobalMult';
	globalMult: number;
};

// Multiplier COLLECT — the scatter family's second mechanic, on top of the cascade. Sent when a step
// landed multiplier symbols: they play in place, fly to the board centre, and their values combine
// into `boardMult`. `winInfo` carries the three amounts that beat displays.
//
// Note the upstream sample typed these three as LITERALS (`tumbleWin: 400`), which is a
// paste-the-example-values slip rather than a contract — they are ordinary numbers.
type BookEventBoardMultiplierInfo = {
	index: number;
	type: 'boardMultiplierInfo';
	multInfo: {
		positions: (Position & { multiplier: number })[];
	};
	winInfo: {
		tumbleWin: number;
		boardMult: number;
		totalWin: number;
	};
};

// --- hold and win --------------------------------------------------------------------------------
// Design §4.3 of `docs/design/hold-and-win.md`. The payloads live in `engine-game` (`holdAndWin.ts`,
// one home); each arm is spelled out here so the flow vocabulary codegen reads its `type`. Declared
// in the shared runtime's union for the reason the cascade's are: a mechanic missing here cannot
// reach a published project. A game whose RGS never sends them is unaffected.
type BookEventHwLuckySpin = {
	index: number;
	type: 'luckySpin';
} & HoldAndWinEventFields['luckySpin'];
type BookEventHwMeterUpdate = {
	index: number;
	type: 'meterUpdate';
} & HoldAndWinEventFields['meterUpdate'];
type BookEventHwMeterLevels = {
	index: number;
	type: 'meterLevels';
} & HoldAndWinEventFields['meterLevels'];
/** The operator platform jackpot hit this round (any kind) — the facade places it after the round's
 *  own wins. `amount` is book units like every win; `tier` is the platform's own name. */
type BookEventPlatformJackpotWin = {
	index: number;
	type: 'platformJackpotWin';
	tier: string;
	amount: number;
};
type BookEventHwJackpotLevels = {
	index: number;
	type: 'jackpotLevels';
} & HoldAndWinEventFields['jackpotLevels'];
type BookEventHwCoinInstantCollect = {
	index: number;
	type: 'coinInstantCollect';
} & HoldAndWinEventFields['coinInstantCollect'];
type BookEventHwRandomMetreTrigger = {
	index: number;
	type: 'randomMetreTrigger';
} & HoldAndWinEventFields['randomMetreTrigger'];
type BookEventHwHoldAndWinTrigger = {
	index: number;
	type: 'holdAndWinTrigger';
} & HoldAndWinEventFields['holdAndWinTrigger'];
type BookEventHwHoldAndWinWheel = {
	index: number;
	type: 'holdAndWinWheel';
} & HoldAndWinEventFields['holdAndWinWheel'];
type BookEventHwRespinReveal = {
	index: number;
	type: 'respinReveal';
} & HoldAndWinEventFields['respinReveal'];
type BookEventHwCoinsLand = {
	index: number;
	type: 'coinsLand';
} & HoldAndWinEventFields['coinsLand'];
type BookEventHwMysteryReveal = {
	index: number;
	type: 'mysteryReveal';
} & HoldAndWinEventFields['mysteryReveal'];
type BookEventHwCoinPay = { index: number; type: 'coinPay' } & HoldAndWinEventFields['coinPay'];
type BookEventHwRespinsAdded = {
	index: number;
	type: 'respinsAdded';
} & HoldAndWinEventFields['respinsAdded'];
type BookEventHwCoinUpgrade = {
	index: number;
	type: 'coinUpgrade';
} & HoldAndWinEventFields['coinUpgrade'];
type BookEventHwCoinBoost = {
	index: number;
	type: 'coinBoost';
} & HoldAndWinEventFields['coinBoost'];
type BookEventHwSpecialBecomesCoin = {
	index: number;
	type: 'specialBecomesCoin';
} & HoldAndWinEventFields['specialBecomesCoin'];
type BookEventHwCoinCollect = {
	index: number;
	type: 'coinCollect';
} & HoldAndWinEventFields['coinCollect'];
type BookEventHwRowsUnlocked = {
	index: number;
	type: 'rowsUnlocked';
} & HoldAndWinEventFields['rowsUnlocked'];
type BookEventHwCellsCleared = {
	index: number;
	type: 'cellsCleared';
} & HoldAndWinEventFields['cellsCleared'];
type BookEventHwColumnComplete = {
	index: number;
	type: 'columnComplete';
} & HoldAndWinEventFields['columnComplete'];
type BookEventHwJackpotWin = {
	index: number;
	type: 'jackpotWin';
} & HoldAndWinEventFields['jackpotWin'];
type BookEventHwRespinUpdate = {
	index: number;
	type: 'respinUpdate';
} & HoldAndWinEventFields['respinUpdate'];
type BookEventHwHoldAndWinState = {
	index: number;
	type: 'holdAndWinState';
} & HoldAndWinEventFields['holdAndWinState'];
type BookEventHwHoldAndWinEnd = {
	index: number;
	type: 'holdAndWinEnd';
} & HoldAndWinEventFields['holdAndWinEnd'];

// --- pots overlay ------------------------------------------------------------------------------
// Design §3.2 of `docs/design/pots-overlay.md`: tokens dropped over the host's own symbols. The pots
// they fill are the Hold and Win meter events above; the payload lives in `engine-game`
// (`potsOverlay.ts`). Declared here for the cascade's reason: the shared runtime's union is the only
// way a mechanic reaches a published project.
type BookEventOverlayDrop = {
	index: number;
	type: 'overlayDrop';
} & PotsOverlayEventFields['overlayDrop'];

// GAME MODES (`docs/design/hold-and-win.md` §4.5): a bonus that switches to a different game mode,
// and back. The mode stack moves at the play seam (`engine-game` `modeController`), so the coded
// handlers have nothing left to do; `freeSpinTrigger` / `freeSpinEnd` and the Hold and Win
// trigger / end are aliases of this pair.
type BookEventModeEnter = {
	index: number;
	type: 'modeEnter';
	mode: string;
	policy?: 'nest' | 'queue';
	payload?: Record<string, unknown>;
} & ModeEntryCause;

type BookEventModeExit = {
	index: number;
	type: 'modeExit';
	mode: string;
	total?: number;
};

// customised
type BookEventCreateBonusSnapshot = {
	index: number;
	type: 'createBonusSnapshot';
	bookEvents: BookEvent[];
};

export type BookEvent =
	| BookEventReveal
	| BookEventWinInfo
	| BookEventSetTotalWin
	| BookEventFreeSpinTrigger
	| BookEventUpdateFreeSpin
	| BookEventCreateBonusSnapshot
	| BookEventTumbleBoard
	| BookEventUpdateTumbleWin
	| BookEventUpdateGlobalMult
	| BookEventBoardMultiplierInfo
	| BookEventFinalWin
	| BookEventSetWin
	| BookEventFreeSpinEnd
	| BookEventSetExpandingSymbol
	| BookEventExpandBookColumns
	| BookEventExpandWild
	| BookEventGrowWild
	| BookEventFreeSpinRetrigger
	| BookEventHwLuckySpin
	| BookEventHwMeterUpdate
	| BookEventHwMeterLevels
	| BookEventHwJackpotLevels
	| BookEventPlatformJackpotWin
	| BookEventHwCoinInstantCollect
	| BookEventHwRandomMetreTrigger
	| BookEventHwHoldAndWinTrigger
	| BookEventHwHoldAndWinWheel
	| BookEventHwRespinReveal
	| BookEventHwCoinsLand
	| BookEventHwMysteryReveal
	| BookEventHwCoinPay
	| BookEventHwRespinsAdded
	| BookEventHwCoinUpgrade
	| BookEventHwCoinBoost
	| BookEventHwSpecialBecomesCoin
	| BookEventHwCoinCollect
	| BookEventHwCellsCleared
	| BookEventHwRowsUnlocked
	| BookEventHwColumnComplete
	| BookEventHwJackpotWin
	| BookEventHwRespinUpdate
	| BookEventHwHoldAndWinState
	| BookEventHwHoldAndWinEnd
	| BookEventOverlayDrop
	| BookEventModeEnter
	| BookEventModeExit
	| BookEventBoardInit
	| BookEventSwap
	| BookEventMovesLeft
	| BookEventRoundEnd
	// customised
	| BookEventCreateBonusSnapshot;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };

/**
 * Hand this game's book-event union to `engine-game`, so the shared play pipeline reads its arms
 * with this game's own typing. `ImplementsEngineBookEvents` admits it only if it carries every arm
 * the engine reads — see `bookEvents.ts` in the package.
 */
declare module 'engine-game' {
	interface BookEventRegistry {
		bookEvent: ImplementsEngineBookEvents<BookEvent>;
	}
}
