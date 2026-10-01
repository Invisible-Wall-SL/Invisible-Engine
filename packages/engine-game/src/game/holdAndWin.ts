import type { HoldAndWinSpecial, Stickiness } from 'game-config';

import type { Position, RawSymbol, SymbolName } from './types';

/**
 * THE HOLD AND WIN BOOK-EVENT CONTRACT — design §4.3 of `docs/design/hold-and-win.md`. The payloads
 * the facade builds from the wire, the flow vocabulary (Phase 5) names, and the respin board reads.
 * Nothing here knows the wire: `docs/reference/hold-and-win-wire.md` is OUR mock's format, a swap
 * seam the facade alone translates.
 *
 * Units, once for every payload below:
 * - a position is the VISIBLE 0-based `{reel, row}` — no padding row, because the respin board has
 *   none. A consumer drawing on the padded base-game reels adds the padding itself.
 * - a coin's `value` (on its {@link RawSymbol}) is × the base total bet, decimals allowed.
 * - an `amount` / `total` / `banked` is book-event units (`BOOK_AMOUNT_MULTIPLIER` × bet multiple),
 *   the unit every other win amount in the engine uses.
 */

/** A board cell and what it shows. Coin value, jackpot label and factor ride on the symbol. */
export type HoldAndWinCell = Position & { symbol: RawSymbol };

/** A cell with the credits it is worth (book-event units). */
export type HoldAndWinCellAmount = HoldAndWinCell & { amount: number };

/** A value that changed. For a jackpot coin `from`/`to` are its factor, for a cash coin its value. */
export type HoldAndWinCoinChange = Position & { from: number; to: number; jackpot?: string };

/** Why the feature started. A meter cause names the meters in `HoldAndWinEntry.meters`. */
export type HoldAndWinCause = 'count' | 'pattern' | 'meter' | 'luckySpin' | 'randomMetre' | 'buy';

/** Where a jackpot came from. `banked` sources add money; the rest present money already counted. */
export type HoldAndWinJackpotSource =
	| 'coin'
	| 'collect'
	| 'column'
	| 'instantCollect'
	| 'wheel'
	| 'letters'
	| 'fullBoard';

export type HoldAndWinWheelPrize =
	| { type: 'coinBoost'; multiplier: number }
	| { type: 'extraCollect'; count: number }
	| { type: 'jackpot'; jackpot: string };

export type HoldAndWinMeterLevel = { id: string; level: number; max: number };

/** What `holdAndWinTrigger` carries as its mode payload (§4.5 `modeEnter.payload`). */
export type HoldAndWinEntry = {
	/** What sticks at entry. */
	cells: HoldAndWinCell[];
	respins: number;
	stickiness: Stickiness;
	activeModifiers: HoldAndWinSpecial[];
	meters?: string[];
};

/** What `holdAndWinEnd` carries as its mode payload (§4.5 `modeExit`): the per-coin tally. */
export type HoldAndWinTally = { cells: HoldAndWinCellAmount[]; banked: number };

/**
 * An open feature, whole — what a resume rebuilds the respin board from without replaying an intro.
 * The facade restates it after every respin as `holdAndWinState`; the resume snapshot keeps the last.
 */
export type HoldAndWinSnapshot = {
	cells: HoldAndWinCell[];
	start: number;
	left: number;
	played: number;
	banked: number;
	/** `banked` + every held cell's worth, book-event units. */
	total: number;
	stickiness: Stickiness;
	activeModifiers: HoldAndWinSpecial[];
	collectorLevel: number;
	coinBoost: number;
	/** Reels whose column letter is lit. */
	lettersLit: number[];
};

/**
 * Every Hold and Win book event's fields, keyed by type. A game declares its union arms from this
 * (`{ index; type: K } & HoldAndWinEventFields[K]`), so the payloads have one home.
 *
 * Order matters where the wire's does: `holdAndWinTrigger` opens the feature (resetting its picture)
 * before any `holdAndWinWheel` or entry effect, and a respin's `coinsLand` precedes the specials
 * applying to it. The facade keeps the wire's order.
 */
export type HoldAndWinEventFields = {
	luckySpin: Record<never, never>;
	meterUpdate: {
		meter: string;
		level: number;
		max: number;
		full: boolean;
		from: HoldAndWinCell[];
		forced?: boolean;
	};
	meterLevels: { meters: HoldAndWinMeterLevel[] };
	coinInstantCollect: {
		specials: HoldAndWinCell[];
		multiplier: number;
		times: number;
		cells: HoldAndWinCellAmount[];
		amount: number;
	};
	randomMetreTrigger: { name: string; cells: HoldAndWinCell[] };
	holdAndWinTrigger: { mode: 'holdAndWin'; cause: HoldAndWinCause; payload: HoldAndWinEntry };
	holdAndWinWheel: { index: number; prize: HoldAndWinWheelPrize };
	respinReveal: { cells: HoldAndWinCell[] };
	coinsLand: { cells: HoldAndWinCell[] };
	mysteryReveal: {
		cells: (HoldAndWinCell & { becomes: 'coin' | 'jackpot' | HoldAndWinSpecial })[];
		activates: HoldAndWinSpecial[];
	};
	coinPay: { payer: HoldAndWinCell; value: number; cells: HoldAndWinCoinChange[] };
	coinBoost: {
		source: 'special' | 'wheel';
		booster?: HoldAndWinCell;
		multiplier: number;
		cells: HoldAndWinCoinChange[];
	};
	specialBecomesCoin: HoldAndWinCell & { from: SymbolName };
	coinCollect: {
		collector: HoldAndWinCell;
		level: number;
		cells: HoldAndWinCellAmount[];
		/** The collector's value after collecting, × total bet. */
		value: number;
	};
	cellsCleared: { reason: 'collected'; cells: Position[] };
	columnComplete: {
		reel: number;
		letter: string;
		newlyLit: boolean;
		cleared: boolean;
		value: number;
		amount: number;
		cells: Position[];
	};
	jackpotWin: {
		tier: string;
		amount: number;
		source: HoldAndWinJackpotSource;
		banked: boolean;
		cell?: Position;
	};
	respinUpdate: { left: number; played: number; start: number; reset: boolean };
	holdAndWinState: { snapshot: HoldAndWinSnapshot };
	holdAndWinEnd: { mode: 'holdAndWin'; total: number; payload: HoldAndWinTally };
};

export type HoldAndWinEventType = keyof HoldAndWinEventFields;

/**
 * Every Hold and Win book-event type, at runtime — typed against {@link HoldAndWinEventFields}, so a
 * new arm is a compile error here until it is listed.
 */
const HOLD_AND_WIN_EVENT_TYPES: Record<HoldAndWinEventType, true> = {
	luckySpin: true,
	meterUpdate: true,
	meterLevels: true,
	coinInstantCollect: true,
	randomMetreTrigger: true,
	holdAndWinTrigger: true,
	holdAndWinWheel: true,
	respinReveal: true,
	coinsLand: true,
	mysteryReveal: true,
	coinPay: true,
	coinBoost: true,
	specialBecomesCoin: true,
	coinCollect: true,
	cellsCleared: true,
	columnComplete: true,
	jackpotWin: true,
	respinUpdate: true,
	holdAndWinState: true,
	holdAndWinEnd: true,
};

/** Is this book event one of the Hold and Win family (what {@link applyHoldAndWinEvent} reads)? */
export const isHoldAndWinEvent = (event: { type: string }): event is HoldAndWinEvent =>
	Object.hasOwn(HOLD_AND_WIN_EVENT_TYPES, event.type);

export type HoldAndWinEvent = {
	[K in HoldAndWinEventType]: { type: K } & HoldAndWinEventFields[K];
}[HoldAndWinEventType];

/**
 * The book events a resume keeps by name: the open-feature snapshots, the meter levels, and the
 * feature's end — so a resume that lands after the end does not re-open a closed feature.
 */
export const HOLD_AND_WIN_SNAPSHOT_EVENTS = [
	'holdAndWinState',
	'meterLevels',
	'holdAndWinEnd',
] as const;

/**
 * The client's picture of the feature. `active` is false in the base game. `meters` live across both
 * and have their own events (`meterUpdate`, `meterLevels`), so no snapshot carries or replaces them.
 */
export type HoldAndWinState = HoldAndWinSnapshot & {
	active: boolean;
	luckySpin: boolean;
	meters: HoldAndWinMeterLevel[];
};

export const emptyHoldAndWinState = (): HoldAndWinState => ({
	active: false,
	luckySpin: false,
	cells: [],
	start: 0,
	left: 0,
	played: 0,
	banked: 0,
	total: 0,
	stickiness: 'allCoins',
	activeModifiers: [],
	collectorLevel: 1,
	coinBoost: 1,
	lettersLit: [],
	meters: [],
});

const samePosition = (a: Position) => (b: Position) => a.reel === b.reel && a.row === b.row;

/** One cell per position — the last one named wins, so a payload that repeats a position cannot
 *  put two cells on one seat (the held layer is keyed by position). */
const putCells = (cells: HoldAndWinCell[], incoming: HoldAndWinCell[]): HoldAndWinCell[] => {
	const unique = incoming.filter((cell, i) => !incoming.slice(i + 1).some(samePosition(cell)));
	return [
		...cells.filter((cell) => !unique.some(samePosition(cell))),
		...unique.map(({ reel, row, symbol }) => ({ reel, row, symbol })),
	];
};

const withChanges = (cells: HoldAndWinCell[], changes: HoldAndWinCoinChange[]): HoldAndWinCell[] =>
	cells.map((cell) => {
		const change = changes.find(samePosition(cell));
		if (!change) return cell;
		const symbol =
			change.jackpot === undefined
				? { ...cell.symbol, value: change.to }
				: { ...cell.symbol, factor: change.to };
		return { ...cell, symbol };
	});

const union = <T>(a: T[], b: T[]): T[] => [...a, ...b.filter((item) => !a.includes(item))];

const putMeter = (meters: HoldAndWinMeterLevel[], meter: HoldAndWinMeterLevel) => [
	...meters.filter((m) => m.id !== meter.id),
	meter,
];

/**
 * What one Hold and Win event does to the client's picture of the feature — state only, no
 * presentation. Pure, so the same function drives the coded handlers, a resume and the fixtures.
 * The server stays the source of truth: `holdAndWinState` replaces the picture wholesale after
 * every respin, so a step this misreads is corrected one respin later rather than compounding.
 * `total` is the server's alone — the facade restates it on every `holdAndWinState`, so nothing
 * here sums cell values into it.
 */
export const applyHoldAndWinEvent = (
	state: HoldAndWinState,
	event: HoldAndWinEvent,
): HoldAndWinState => {
	switch (event.type) {
		case 'luckySpin':
			return { ...state, luckySpin: true };
		case 'meterUpdate':
			return {
				...state,
				meters: putMeter(state.meters, { id: event.meter, level: event.level, max: event.max }),
			};
		case 'meterLevels':
			return { ...state, meters: event.meters };
		case 'holdAndWinTrigger':
			return {
				...emptyHoldAndWinState(),
				// A `meter` cause names the full meters it consumed, which the server has emptied (wire
				// doc); its `meterLevels` restates them only after the play, and the pots read empty now.
				meters: state.meters.map((meter) =>
					event.payload.meters?.includes(meter.id) ? { ...meter, level: 0 } : meter,
				),
				luckySpin: state.luckySpin,
				active: true,
				cells: putCells([], event.payload.cells),
				start: event.payload.respins,
				left: event.payload.respins,
				stickiness: event.payload.stickiness,
				activeModifiers: event.payload.activeModifiers,
			};
		case 'holdAndWinWheel': {
			const { prize } = event;
			if (prize.type === 'coinBoost') return { ...state, coinBoost: prize.multiplier };
			if (prize.type === 'extraCollect')
				return { ...state, collectorLevel: state.collectorLevel + prize.count };
			return state;
		}
		case 'coinsLand':
			return { ...state, cells: putCells(state.cells, event.cells) };
		case 'mysteryReveal':
			return {
				...state,
				cells: putCells(state.cells, event.cells),
				activeModifiers: union(state.activeModifiers, event.activates),
			};
		case 'coinPay':
		case 'coinBoost':
			return { ...state, cells: withChanges(state.cells, event.cells) };
		case 'specialBecomesCoin':
			return { ...state, cells: putCells(state.cells, [event]) };
		case 'coinCollect': {
			const collector = event.collector;
			return {
				...state,
				cells: putCells(state.cells, [
					{ ...collector, symbol: { ...collector.symbol, value: event.value } },
				]),
			};
		}
		case 'cellsCleared':
			return {
				...state,
				cells: state.cells.filter((cell) => !event.cells.some(samePosition(cell))),
			};
		case 'columnComplete':
			return {
				...state,
				lettersLit: union(state.lettersLit, [event.reel]),
				banked: state.banked + (event.cleared ? event.amount : 0),
				cells: event.cleared
					? state.cells.filter((cell) => !event.cells.some(samePosition(cell)))
					: state.cells,
			};
		case 'jackpotWin':
			return event.banked ? { ...state, banked: state.banked + event.amount } : state;
		case 'respinUpdate':
			return { ...state, left: event.left, played: event.played, start: event.start };
		case 'holdAndWinState':
			return {
				...event.snapshot,
				cells: putCells([], event.snapshot.cells),
				active: true,
				luckySpin: state.luckySpin,
				meters: state.meters,
			};
		case 'holdAndWinEnd':
			return { ...emptyHoldAndWinState(), meters: state.meters, total: event.total };
		case 'coinInstantCollect':
		case 'randomMetreTrigger':
		case 'respinReveal':
			return state;
	}
};
