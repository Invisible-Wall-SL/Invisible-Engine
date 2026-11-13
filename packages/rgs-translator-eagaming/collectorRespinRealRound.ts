/**
 * THREE REAL ROUNDS of the partner's Getting Hot (partner game 8), from their own server log, sent
 * by their developer on 2026-11-13, each at a base bet (betPerLine 1, base total 10 cents). See "Real
 * rounds" in `docs/reference/play4fun-collector-respin-capture.md`.
 *
 * - {@link SURPRISE_ROUND}: a surprise trigger (`state` 16 = `0b10000`, Expand) tops up a board with
 *   no coin and no collector; 13 Expand respins, two collectors, a MINI, `gameEnd 1060`.
 * - {@link NATURAL_ROUND}: a natural trigger into `11010` (Expand + Boost + Multiply); 6 respins,
 *   Boost and Multiply hitting two different coins in one respin, `gameEnd 330`.
 * - {@link FORCE5_ROUND}: Force 5 (`00100`) through a surprise trigger (`state` 4); a 5×5 board, 11
 *   respins, two Boost hits, a MINOR, `gameEnd 890`. Its head (bet, gameStart, the base spinStart)
 *   was not in their paste and is the natural round's.
 *
 * The events are theirs, in their order. Their log abbreviated repeated contexts (a respin's
 * `jackpots` / `spinStart` / `boostsEnabled`, a `playedSpin` equal to its `collectWindow`, the
 * `playedBonusSpin` counters, the quiet respins); those are filled in exactly as the neighbouring
 * full ones read. No session id, round id or token of theirs is in it.
 */

import { NATURAL_BASE_REELS } from './collectorRespinRealRoundStrips.ts';

type WireEvent = { event: string; context?: unknown };
export type RealRound = { stake: number; win: number; answers: WireEvent[][] };

const ev = (event: string, context: unknown): WireEvent => ({ event, context });

const B = 'BLANK';
const BASE = 10;
const PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
];
const JACKPOT_MULTIPLES = { MINI: 25, MINOR: 50, MAJOR: 150, GRAND: 1000 };
type Tier = keyof typeof JACKPOT_MULTIPLES;
const JACKPOTS = ev('jackpots', JACKPOT_MULTIPLES);
const SYMBOLS = [
	'PIC1',
	'PIC2',
	'PIC3',
	'PIC4',
	'PIC5',
	'PIC6',
	'PIC7',
	'PIC8',
	'PIC9',
	'COIN',
	'COLLECT',
	'BLANK',
];
const SPIN_START_TAIL = {
	symbolsPay: { line: SYMBOLS.slice(0, 9) },
	wildSymbols: [],
	lineAlign: 'any',
	lineCoinciding: false,
	gameCost: 10,
	betOptions: [10, 50, 500, 1000],
	betOptionNames: ['Base', 'Powerup', 'BuyCenterCoin', 'goldStrike'],
	maxWinMp: [5000, 5000],
	stops: [],
};
const strip = (length: number, special: string, at: number) =>
	Array.from({ length }, (_, i) => (i === at ? special : B));
const BONUS_RANGES = [15, 15, 30, 15, 15];
/** The bonus's `spinStart`: FILTERED display strips (all blank but one coin or collector). */
const BONUS_SPIN_START = ev('spinStart', {
	symbols: SYMBOLS,
	reels: BONUS_RANGES.map((length, reel) => strip(length, reel === 2 ? 'COLLECT' : 'COIN', 14)),
	...SPIN_START_TAIL,
	ranges: BONUS_RANGES,
});
/** The base game's `spinStart`: the long strips (the natural round's). */
const BASE_SPIN_START = ev('spinStart', {
	symbols: SYMBOLS,
	reels: NATURAL_BASE_REELS,
	...SPIN_START_TAIL,
	ranges: NATURAL_BASE_REELS.map((reel) => reel.length),
});
const head = () => [
	ev('bet', { total: 10, betPerLine: 1, paylines: PAYLINES }),
	ev('gameStart', { totalBet: 10, betPerLine: 1 }),
	JACKPOTS,
];

const flagsOf = (bits: string) => ({
	expand: Number(bits[0]),
	boost: Number(bits[1]),
	powerFive: Number(bits[2]),
	multiply: Number(bits[3]),
	respin: Number(bits[4]),
});

/** A bonus as their `enterBonus` / `playedBonusSpin` / `playedBonusSpins` describe it. */
type Bonus = { bits: string; occurs: number };
const trigger = ({ occurs }: Bonus) => ({ occurs: [occurs], from: '' });
const enterBonus = (bonus: Bonus, left: number) =>
	ev('enterBonus', {
		prob: 1,
		additionalPrice: 0,
		triggers: 1,
		played: 0,
		left,
		multiplier: {},
		bonusTriggers: { [bonus.bits]: 1 },
		bonusPlayed: {},
		spins: [{ spins: left, bonus: bonus.bits, trigger: trigger(bonus) }],
		triggering: { bonus: bonus.bits, trigger: trigger(bonus) },
	});
const bonusState = (bonus: Bonus, played: number, left: number) => ({
	prob: 1,
	additionalPrice: 0,
	triggers: 1,
	played,
	left,
	multiplier: {},
	bonusTriggers: { [bonus.bits]: 1 },
	bonusPlayed: {
		[bonus.bits]: { count: played, base: { count: 0, multiplierCount: 0 }, states: {} },
	},
	spins:
		left > 0 ? [{ spins: left, bonus: bonus.bits, trigger: trigger(bonus), state: 'main' }] : [],
	playing: bonus.bits,
	state: 'main',
	trigger: trigger(bonus),
});

type Board = string[][];
const boardOf = (rows: number, cells: [number, number, string][]): Board => {
	const board = Array.from({ length: 5 }, () => Array.from({ length: rows }, () => B));
	for (const [reel, row, text] of cells) board[reel][row] = text;
	return board;
};

/** A coin that lands: its cell, its value as dealt and, after a Boost or Multiply, as paid. */
type Coin = { reel: number; row: number; n: number | Tier; value?: number };
const payOf = (c: Coin) =>
	typeof c.n === 'string' ? JACKPOT_MULTIPLES[c.n] * BASE : (c.value ?? c.n) * BASE;
const coinEvents = (coins: Coin[]) =>
	coins.map((c) =>
		ev('bonusSymbol', {
			reel: c.reel,
			row: c.row,
			symbol: `COIN_${c.n}`,
			win: typeof c.n === 'string' ? c.n : c.n * BASE,
		}),
	);
const payEvents = (coins: Coin[]) =>
	coins.map((c) =>
		ev('cellPayAmount', {
			reel: c.reel,
			row: c.row,
			original: String(c.n),
			value: typeof c.n === 'string' ? c.n : (c.value ?? c.n),
			pay: payOf(c),
		}),
	);
type Hits = { reel: number; row: number; startingPay: number; by: number }[];

/**
 * One respin as their server answers it. `collectors` — the collectors in view on reel 2, `[row,
 * total before]` (`null`: a bare `COLLECT` landing now); `coins` the coins that land; `totals` each
 * collector's `collect.pay` (its NEW total); `boost` / `multiplier` the enhancement events, absent
 * when the bonus does not roll it (`"X"` a miss); `retrigger` the games added back.
 */
const respin = (
	bonus: Bonus,
	rows: number,
	opts: {
		collectors: [row: number, before: number | null][];
		coins?: Coin[];
		totals?: number[];
		boost?: Hits | 'X';
		multiplier?: Hits | 'X';
		retrigger?: number;
		played: number;
		left: number;
	},
): WireEvent[] => {
	const coins = opts.coins ?? [];
	const totals = opts.totals ?? [];
	const collector = (before: number | null) => (before === null ? 'COLLECT' : `COLLECT_${before}`);
	const dealt = boardOf(rows, [
		...opts.collectors.map(([row, before]): [number, number, string] => [
			2,
			row,
			collector(before),
		]),
		...coins.map((c): [number, number, string] => [c.reel, c.row, `COIN_${c.n}`]),
	]);
	const after = boardOf(rows, [
		...opts.collectors.map(([row], i): [number, number, string] => [
			2,
			row,
			`COLLECT_${totals[i]}`,
		]),
		...coins.map((c): [number, number, string] => [c.reel, c.row, `COIN_${c.value ?? c.n}`]),
	]);
	const hitEvent = (name: 'boost' | 'multiplier', hits: Hits | 'X' | undefined) =>
		hits === undefined
			? []
			: [
					ev(
						name,
						hits === 'X' ? { [name]: 'X' } : hits.map(({ by, ...h }) => ({ ...h, [name]: by })),
					),
				];
	const enhancements = [
		...hitEvent('boost', opts.boost),
		...hitEvent('multiplier', opts.multiplier),
	];
	const gathered = coins.reduce((sum, c) => sum + payOf(c), 0);
	return [
		JACKPOTS,
		BONUS_SPIN_START,
		ev('boostsEnabled', flagsOf(bonus.bits)),
		...coinEvents(coins),
		ev('playWindow', dealt),
		...(coins.length
			? [
					...payEvents(coins),
					...enhancements,
					...opts.collectors.map(([row], i) => ev('collect', { reel: 2, row, pay: totals[i] })),
					ev('bonusWin', {
						bonus: bonus.bits,
						pay: gathered * opts.collectors.length,
						isSpinWin: false,
					}),
					ev('collectWindow', after),
					ev('retrigger', { games: opts.retrigger ?? 1 }),
					ev('playedSpin', after),
				]
			: [...enhancements, ev('playedSpin', dealt)]),
		ev('playedBonusSpin', bonusState(bonus, opts.played, opts.left)),
	];
};
const ending = (bonus: Bonus, played: number, win: number) => [
	ev('playedBonusSpins', bonusState(bonus, played, 0)),
	ev('gameEnd', { win }),
];
const coin = (reel: number, row: number, n: number | Tier, value?: number): Coin =>
	value === undefined ? { reel, row, n } : { reel, row, n, value };

// ---------- the surprise trigger into Expand ----------

const EXPAND: Bonus = { bits: '10000', occurs: 3 };
const SURPRISE_DEALT = [
	['PIC7', 'PIC9', 'PIC4'],
	['PIC9', 'PIC9', 'PIC9'],
	['PIC9', 'PIC5', 'PIC5'],
	['PIC8', 'PIC6', 'PIC6'],
	['PIC9', 'PIC7', 'PIC1'],
];
const SURPRISE_AFTER = [
	['PIC7', 'PIC9', 'COIN_3'],
	['PIC9', 'PIC9', 'PIC9'],
	['COLLECT_80', 'PIC5', 'PIC5'],
	['COIN_3', 'PIC6', 'PIC6'],
	['PIC9', 'COIN_1', 'COIN_1'],
];
const surpriseQuiet = (totals: [number, number], played: number, left: number) =>
	respin(EXPAND, 4, {
		collectors: [
			[1, totals[0]],
			[3, totals[1]],
		],
		played,
		left,
	});

export const SURPRISE_ROUND: RealRound = {
	stake: 10,
	win: 1060,
	answers: [
		[
			...head(),
			ev('playWindow', SURPRISE_DEALT),
			ev('surpriseTrigger', { state: 16 }),
			ev('bonusSymbol', { reel: 3, row: 0, symbol: 'COIN_3', win: 30 }),
			ev('bonusSymbol', { reel: 4, row: 1, symbol: 'COIN_1', win: 10 }),
			ev('bonusSymbol', { reel: 4, row: 2, symbol: 'COIN_1', win: 10 }),
			ev('bonusSymbol', { reel: 0, row: 2, symbol: 'COIN_3', win: 30 }),
			...payEvents([coin(0, 2, 3), coin(3, 0, 3), coin(4, 1, 1), coin(4, 2, 1)]),
			ev('collect', { reel: 2, row: 0, pay: 80 }),
			ev('bonusWin', { bonus: 'initialspin', pay: 80, isSpinWin: false }),
			ev('collectWindow', SURPRISE_AFTER),
			ev('boostsAwarded', flagsOf(EXPAND.bits)),
			ev('spinTrigger', {
				spins: [{ prob: 1, spins: 3 }],
				occurs: 3,
				bonus: EXPAND.bits,
				trigger: { occurs: [3, 4, 5], from: '' },
			}),
			ev('playedSpin', SURPRISE_AFTER),
			enterBonus(EXPAND, 3),
		],
		respin(EXPAND, 4, {
			collectors: [[1, 80]],
			coins: [coin(0, 0, 3), coin(0, 1, 1)],
			totals: [120],
			played: 1,
			left: 3,
		}),
		respin(EXPAND, 4, {
			collectors: [[1, 120]],
			coins: [coin(3, 1, 1)],
			totals: [130],
			played: 2,
			left: 3,
		}),
		respin(EXPAND, 4, {
			collectors: [[1, 130]],
			coins: [coin(3, 3, 2)],
			totals: [150],
			played: 3,
			left: 3,
		}),
		respin(EXPAND, 4, {
			collectors: [[1, 150]],
			coins: [coin(0, 3, 4), coin(4, 3, 1)],
			totals: [200],
			played: 4,
			left: 3,
		}),
		// A second collector lands on reel 3 (bare COLLECT, no bonusSymbol for it).
		respin(EXPAND, 4, {
			collectors: [
				[1, 200],
				[3, null],
			],
			coins: [coin(0, 2, 2), coin(3, 2, 2)],
			totals: [240, 40],
			played: 5,
			left: 3,
		}),
		respin(EXPAND, 4, {
			collectors: [
				[1, 240],
				[3, 40],
			],
			coins: [coin(1, 3, 4)],
			totals: [280, 80],
			played: 6,
			left: 3,
		}),
		respin(EXPAND, 4, {
			collectors: [
				[1, 280],
				[3, 80],
			],
			coins: [coin(1, 0, 5), coin(3, 0, 1)],
			totals: [340, 140],
			played: 7,
			left: 3,
		}),
		respin(EXPAND, 4, {
			collectors: [
				[1, 340],
				[3, 140],
			],
			coins: [coin(0, 2, 1), coin(3, 3, 3)],
			totals: [380, 180],
			played: 8,
			left: 3,
		}),
		surpriseQuiet([380, 180], 9, 2),
		respin(EXPAND, 4, {
			collectors: [
				[1, 380],
				[3, 180],
			],
			coins: [coin(1, 1, 'MINI')],
			totals: [630, 430],
			retrigger: 2,
			played: 10,
			left: 3,
		}),
		surpriseQuiet([630, 430], 11, 2),
		surpriseQuiet([630, 430], 12, 1),
		[...surpriseQuiet([630, 430], 13, 0), ...ending(EXPAND, 13, 1060)],
	],
};

// ---------- the natural trigger into Expand + Boost + Multiply ----------

const NATURAL: Bonus = { bits: '11010', occurs: 3 };
const NATURAL_DEALT = [
	['PIC5', 'PIC9', 'PIC9'],
	['PIC7', 'PIC7', 'COIN_1'],
	['COLLECT', 'PIC2', 'PIC2'],
	['COIN_3', 'COIN_2', 'PIC8'],
	['PIC8', 'COIN_3', 'COIN_4'],
];
const NATURAL_AFTER = NATURAL_DEALT.map((reel, r) =>
	r === 2 ? ['COLLECT_130', 'PIC2', 'PIC2'] : reel,
);
const NATURAL_COINS = [coin(1, 2, 1), coin(3, 0, 3), coin(3, 1, 2), coin(4, 1, 3), coin(4, 2, 4)];
const naturalQuiet = (played: number, left: number) =>
	respin(NATURAL, 4, {
		collectors: [[1, 330]],
		boost: 'X',
		multiplier: 'X',
		played,
		left,
	});

export const NATURAL_ROUND: RealRound = {
	stake: 10,
	win: 330,
	answers: [
		[
			...head(),
			BASE_SPIN_START,
			...coinEvents(NATURAL_COINS),
			ev('playWindow', NATURAL_DEALT),
			...payEvents(NATURAL_COINS),
			ev('collect', { reel: 2, row: 0, pay: 130 }),
			ev('bonusWin', { bonus: 'initialspin', pay: 130, isSpinWin: false }),
			ev('collectWindow', NATURAL_AFTER),
			ev('boostsAwarded', flagsOf(NATURAL.bits)),
			ev('spinTrigger', {
				spins: [{ prob: 1, spins: 3 }],
				occurs: 3,
				bonus: NATURAL.bits,
				trigger: { occurs: [3, 4, 5], from: '' },
			}),
			ev('playedSpin', NATURAL_AFTER),
			enterBonus(NATURAL, 3),
		],
		// Boost hits one coin (+20: 2 → 4), Multiply another (×4: 2 → 8); cellPayAmount already
		// carries the modified value, and collectWindow shows COIN_4 / COIN_8.
		respin(NATURAL, 4, {
			collectors: [[1, 130]],
			coins: [coin(0, 3, 2, 4), coin(1, 2, 2), coin(3, 1, 4), coin(3, 3, 2, 8)],
			boost: [{ reel: 0, row: 3, startingPay: 20, by: 20 }],
			multiplier: [{ reel: 3, row: 3, startingPay: 20, by: 4 }],
			totals: [310],
			played: 1,
			left: 3,
		}),
		// Nothing lands: Boost and Multiply still send their X.
		respin(NATURAL, 4, {
			collectors: [[1, 310]],
			boost: 'X',
			multiplier: 'X',
			played: 2,
			left: 2,
		}),
		respin(NATURAL, 4, {
			collectors: [[1, 310]],
			coins: [coin(4, 0, 2)],
			boost: 'X',
			multiplier: 'X',
			totals: [330],
			retrigger: 2,
			played: 3,
			left: 3,
		}),
		naturalQuiet(4, 2),
		naturalQuiet(5, 1),
		[...naturalQuiet(6, 0), ...ending(NATURAL, 6, 330)],
	],
};

// ---------- Force 5, through a surprise trigger ----------

const FORCE5: Bonus = { bits: '00100', occurs: 5 };
const FORCE5_DEALT = [
	['PIC8', 'PIC8', 'PIC8'],
	['COIN_1', 'PIC5', 'COIN_2'],
	['PIC6', 'PIC7', 'PIC3'],
	['PIC9', 'PIC8', 'PIC8'],
	['PIC2', 'PIC3', 'PIC2'],
];
const FORCE5_AFTER = [
	['PIC8', 'COIN_2', 'COIN_3'],
	['COIN_1', 'PIC5', 'COIN_2'],
	['COLLECT_100', 'PIC7', 'PIC3'],
	['COIN_2', 'PIC8', 'PIC8'],
	['PIC2', 'PIC3', 'PIC2'],
];
const force5Quiet = (total: number, played: number, left: number) =>
	respin(FORCE5, 5, {
		collectors: [[2, total]],
		boost: 'X',
		multiplier: 'X',
		played,
		left,
	});

export const FORCE5_ROUND: RealRound = {
	stake: 10,
	win: 890,
	answers: [
		[
			...head(),
			BASE_SPIN_START,
			ev('bonusSymbol', { reel: 1, row: 0, symbol: 'COIN_1', win: 10 }),
			ev('bonusSymbol', { reel: 1, row: 2, symbol: 'COIN_2', win: 20 }),
			ev('playWindow', FORCE5_DEALT),
			ev('surpriseTrigger', { state: 4 }),
			ev('bonusSymbol', { reel: 0, row: 2, symbol: 'COIN_3', win: 30 }),
			ev('bonusSymbol', { reel: 3, row: 0, symbol: 'COIN_2', win: 20 }),
			ev('bonusSymbol', { reel: 0, row: 1, symbol: 'COIN_2', win: 20 }),
			...payEvents([coin(0, 1, 2), coin(0, 2, 3), coin(1, 0, 1), coin(1, 2, 2), coin(3, 0, 2)]),
			ev('collect', { reel: 2, row: 0, pay: 100 }),
			ev('bonusWin', { bonus: 'initialspin', pay: 100, isSpinWin: false }),
			ev('collectWindow', FORCE5_AFTER),
			ev('boostsAwarded', flagsOf(FORCE5.bits)),
			ev('spinTrigger', {
				spins: [{ prob: 1, spins: 5 }],
				occurs: 5,
				bonus: FORCE5.bits,
				trigger: { occurs: [3, 4, 5], from: '' },
			}),
			ev('playedSpin', FORCE5_AFTER),
			enterBonus(FORCE5, 5),
		],
		respin(FORCE5, 5, {
			collectors: [[2, 100]],
			coins: [coin(3, 0, 2), coin(3, 1, 4), coin(4, 2, 2)],
			boost: 'X',
			multiplier: 'X',
			totals: [180],
			played: 1,
			left: 5,
		}),
		// A MINOR coin, and a Boost hit (+50 on a 30 coin → value 8).
		respin(FORCE5, 5, {
			collectors: [[2, 180]],
			coins: [coin(0, 1, 'MINOR'), coin(3, 2, 3, 8)],
			boost: [{ reel: 3, row: 2, startingPay: 30, by: 50 }],
			multiplier: 'X',
			totals: [760],
			played: 2,
			left: 5,
		}),
		force5Quiet(760, 3, 4),
		force5Quiet(760, 4, 3),
		// A Boost hit (+50 on a 10 coin → value 6); retrigger games 3 (left 2 → 5).
		respin(FORCE5, 5, {
			collectors: [[2, 760]],
			coins: [coin(0, 4, 1, 6), coin(3, 4, 2)],
			boost: [{ reel: 0, row: 4, startingPay: 10, by: 50 }],
			multiplier: 'X',
			totals: [840],
			retrigger: 3,
			played: 5,
			left: 5,
		}),
		respin(FORCE5, 5, {
			collectors: [[2, 840]],
			coins: [coin(0, 1, 4), coin(3, 0, 1)],
			boost: 'X',
			multiplier: 'X',
			totals: [890],
			played: 6,
			left: 5,
		}),
		force5Quiet(890, 7, 4),
		force5Quiet(890, 8, 3),
		force5Quiet(890, 9, 2),
		force5Quiet(890, 10, 1),
		[...force5Quiet(890, 11, 0), ...ending(FORCE5, 11, 890)],
	],
};
