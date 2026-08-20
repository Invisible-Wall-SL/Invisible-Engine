import type { BetType } from 'rgs-requests';

import type { SymbolName, RawSymbol, GameType, Position } from './types';

// book events shared with scatter game
type BookEventReveal = {
	index: number;
	type: 'reveal';
	board: RawSymbol[][];
	paddingPositions: number[];
	gameType: GameType;
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
};

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
	| BookEventFinalWin
	| BookEventSetWin
	| BookEventFreeSpinEnd
	| BookEventSetExpandingSymbol
	| BookEventExpandBookColumns
	| BookEventFreeSpinRetrigger
	// customised
	| BookEventCreateBonusSnapshot;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };
