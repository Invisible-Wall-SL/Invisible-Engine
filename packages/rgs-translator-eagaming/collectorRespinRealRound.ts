/**
 * ONE REAL ROUND of the partner's Getting Hot (partner game 8), from their own server log, sent by
 * their developer on 2026-11-13: a base bet (betPerLine 1, base total 10 cents), a surprise trigger
 * that tops up a board with no coin and no collector, then the Expand bonus (`10000`) with 13 respins,
 * two collectors, a MINI coin and `gameEnd {win: 1060}`. See "One real round" in
 * `docs/reference/play4fun-collector-respin-capture.md`.
 *
 * The events are theirs, in their order. Their log abbreviated a few repeated contexts (a respin's
 * `jackpots` / `spinStart` / `boostsEnabled`, a `playedSpin` equal to its `collectWindow`, the
 * `playedBonusSpin` counters); those are filled in exactly as the neighbouring full ones read. No
 * session id, round id or token of theirs is in it.
 */

type WireEvent = { event: string; context?: unknown };

const ev = (event: string, context: unknown): WireEvent => ({ event, context });

const B = 'BLANK';
const PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
];
const JACKPOTS = ev('jackpots', { MINI: 25, MINOR: 50, MAJOR: 150, GRAND: 1000 });
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
const strip = (length: number, special: string, at: number) =>
	Array.from({ length }, (_, i) => (i === at ? special : B));
/** The bonus's `spinStart`: FILTERED display strips (all blank but one coin or collector). */
const BONUS_SPIN_START = ev('spinStart', {
	symbols: SYMBOLS,
	reels: [
		strip(15, 'COIN', 14),
		strip(15, 'COIN', 14),
		strip(30, 'COLLECT', 14),
		strip(15, 'COIN', 14),
		strip(15, 'COIN', 14),
	],
	symbolsPay: { line: SYMBOLS.slice(0, 9) },
	wildSymbols: [],
	lineAlign: 'any',
	lineCoinciding: false,
	gameCost: 10,
	betOptions: [10, 50, 500, 1000],
	betOptionNames: ['Base', 'Powerup', 'BuyCenterCoin', 'goldStrike'],
	maxWinMp: [5000, 5000],
	stops: [],
	ranges: [15, 15, 30, 15, 15],
});
const BOOSTS = { expand: 1, boost: 0, powerFive: 0, multiply: 0, respin: 0 };
const TRIGGER = { occurs: [3], from: '' };

const bonusSpin = (played: number, left: number) =>
	ev('playedBonusSpin', {
		prob: 1,
		additionalPrice: 0,
		triggers: 1,
		played,
		left,
		multiplier: {},
		bonusTriggers: { '10000': 1 },
		bonusPlayed: {
			'10000': { count: played, base: { count: 0, multiplierCount: 0 }, states: {} },
		},
		spins: left > 0 ? [{ spins: left, bonus: '10000', trigger: TRIGGER, state: 'main' }] : [],
		playing: '10000',
		state: 'main',
		trigger: TRIGGER,
	});

/** A 4-row bonus board, all BLANK but the listed `[reel, row, symbol]` cells. */
const board4 = (cells: [number, number, string][]) => {
	const board = Array.from({ length: 5 }, () => [B, B, B, B]);
	for (const [reel, row, text] of cells) board[reel][row] = text;
	return board;
};

type Coin = [reel: number, row: number, n: number | 'MINI'];
const coinText = (n: number | 'MINI') => `COIN_${n}`;
const coinPay = (n: number | 'MINI') => (n === 'MINI' ? 250 : n * 10);

/**
 * One respin as their server answers it. `held` — the collectors in view as the respin starts
 * (`[row, total]` on reel 2; a total of 0 is a bare `COLLECT` landing now), `coins` the coins that
 * land, `totals` each collector's `collect.pay` (its NEW total), `retrigger` the games added back.
 */
const respin = (opts: {
	collectors: [row: number, before: number | null][];
	coins: Coin[];
	totals?: number[];
	retrigger?: number;
	played: number;
	left: number;
}): WireEvent[] => {
	const collectorText = (total: number | null) => (total === null ? 'COLLECT' : `COLLECT_${total}`);
	const dealt = board4([
		...opts.collectors.map(([row, before]): [number, number, string] => [
			2,
			row,
			collectorText(before),
		]),
		...opts.coins.map(([reel, row, n]): [number, number, string] => [reel, row, coinText(n)]),
	]);
	const landed = opts.coins.length > 0;
	const totals = opts.totals ?? [];
	const after = board4([
		...opts.collectors.map(([row], i): [number, number, string] => [
			2,
			row,
			`COLLECT_${totals[i]}`,
		]),
		...opts.coins.map(([reel, row, n]): [number, number, string] => [reel, row, coinText(n)]),
	]);
	const gathered = opts.coins.reduce((sum, [, , n]) => sum + coinPay(n), 0);
	return [
		JACKPOTS,
		BONUS_SPIN_START,
		ev('boostsEnabled', BOOSTS),
		...opts.coins.map(([reel, row, n]) =>
			ev('bonusSymbol', { reel, row, symbol: coinText(n), win: n === 'MINI' ? 'MINI' : n * 10 }),
		),
		ev('playWindow', dealt),
		...(landed
			? [
					...opts.coins.map(([reel, row, n]) =>
						ev('cellPayAmount', {
							reel,
							row,
							original: String(n),
							value: n,
							pay: coinPay(n),
						}),
					),
					...opts.collectors.map(([row], i) => ev('collect', { reel: 2, row, pay: totals[i] })),
					ev('bonusWin', {
						bonus: '10000',
						pay: gathered * opts.collectors.length,
						isSpinWin: false,
					}),
					ev('collectWindow', after),
					ev('retrigger', { games: opts.retrigger ?? 1 }),
					ev('playedSpin', after),
				]
			: [ev('playedSpin', dealt)]),
		bonusSpin(opts.played, opts.left),
	];
};

/** The answer to `[bet, play]`: the surprise trigger, its collect and the bonus's entry. */
export const REAL_ROUND_BET: WireEvent[] = [
	ev('bet', { total: 10, betPerLine: 1, paylines: PAYLINES }),
	ev('gameStart', { totalBet: 10, betPerLine: 1 }),
	JACKPOTS,
	ev('playWindow', [
		['PIC7', 'PIC9', 'PIC4'],
		['PIC9', 'PIC9', 'PIC9'],
		['PIC9', 'PIC5', 'PIC5'],
		['PIC8', 'PIC6', 'PIC6'],
		['PIC9', 'PIC7', 'PIC1'],
	]),
	ev('surpriseTrigger', { state: 16 }),
	ev('bonusSymbol', { reel: 3, row: 0, symbol: 'COIN_3', win: 30 }),
	ev('bonusSymbol', { reel: 4, row: 1, symbol: 'COIN_1', win: 10 }),
	ev('bonusSymbol', { reel: 4, row: 2, symbol: 'COIN_1', win: 10 }),
	ev('bonusSymbol', { reel: 0, row: 2, symbol: 'COIN_3', win: 30 }),
	ev('cellPayAmount', { reel: 0, row: 2, original: '3', value: 3, pay: 30 }),
	ev('cellPayAmount', { reel: 3, row: 0, original: '3', value: 3, pay: 30 }),
	ev('cellPayAmount', { reel: 4, row: 1, original: '1', value: 1, pay: 10 }),
	ev('cellPayAmount', { reel: 4, row: 2, original: '1', value: 1, pay: 10 }),
	ev('collect', { reel: 2, row: 0, pay: 80 }),
	ev('bonusWin', { bonus: 'initialspin', pay: 80, isSpinWin: false }),
	ev('collectWindow', [
		['PIC7', 'PIC9', 'COIN_3'],
		['PIC9', 'PIC9', 'PIC9'],
		['COLLECT_80', 'PIC5', 'PIC5'],
		['COIN_3', 'PIC6', 'PIC6'],
		['PIC9', 'COIN_1', 'COIN_1'],
	]),
	ev('boostsAwarded', BOOSTS),
	ev('spinTrigger', {
		spins: [{ prob: 1, spins: 3 }],
		occurs: 3,
		bonus: '10000',
		trigger: { occurs: [3, 4, 5], from: '' },
	}),
	ev('playedSpin', [
		['PIC7', 'PIC9', 'COIN_3'],
		['PIC9', 'PIC9', 'PIC9'],
		['COLLECT_80', 'PIC5', 'PIC5'],
		['COIN_3', 'PIC6', 'PIC6'],
		['PIC9', 'COIN_1', 'COIN_1'],
	]),
	ev('enterBonus', {
		prob: 1,
		additionalPrice: 0,
		triggers: 1,
		played: 0,
		left: 3,
		multiplier: {},
		bonusTriggers: { '10000': 1 },
		bonusPlayed: {},
		spins: [{ spins: 3, bonus: '10000', trigger: TRIGGER }],
		triggering: { bonus: '10000', trigger: TRIGGER },
	}),
];

const ONE: [number, number | null][] = [[1, 80]];
const quiet = (totals: [number, number], played: number, left: number) =>
	respin({
		collectors: [
			[1, totals[0]],
			[3, totals[1]],
		],
		coins: [],
		played,
		left,
	});

/** The answer to each respin's `[play]`, in order; the last one ends the round. */
export const REAL_ROUND_RESPINS: WireEvent[][] = [
	respin({
		collectors: ONE,
		coins: [
			[0, 0, 3],
			[0, 1, 1],
		],
		totals: [120],
		played: 1,
		left: 3,
	}),
	respin({ collectors: [[1, 120]], coins: [[3, 1, 1]], totals: [130], played: 2, left: 3 }),
	respin({ collectors: [[1, 130]], coins: [[3, 3, 2]], totals: [150], played: 3, left: 3 }),
	respin({
		collectors: [[1, 150]],
		coins: [
			[0, 3, 4],
			[4, 3, 1],
		],
		totals: [200],
		played: 4,
		left: 3,
	}),
	// A second collector lands on reel 3 (bare COLLECT, no bonusSymbol for it).
	respin({
		collectors: [
			[1, 200],
			[3, null],
		],
		coins: [
			[0, 2, 2],
			[3, 2, 2],
		],
		totals: [240, 40],
		played: 5,
		left: 3,
	}),
	respin({
		collectors: [
			[1, 240],
			[3, 40],
		],
		coins: [[1, 3, 4]],
		totals: [280, 80],
		played: 6,
		left: 3,
	}),
	respin({
		collectors: [
			[1, 280],
			[3, 80],
		],
		coins: [
			[1, 0, 5],
			[3, 0, 1],
		],
		totals: [340, 140],
		played: 7,
		left: 3,
	}),
	respin({
		collectors: [
			[1, 340],
			[3, 140],
		],
		coins: [
			[0, 2, 1],
			[3, 3, 3],
		],
		totals: [380, 180],
		played: 8,
		left: 3,
	}),
	quiet([380, 180], 9, 2),
	respin({
		collectors: [
			[1, 380],
			[3, 180],
		],
		coins: [[1, 1, 'MINI']],
		totals: [630, 430],
		retrigger: 2,
		played: 10,
		left: 3,
	}),
	quiet([630, 430], 11, 2),
	quiet([630, 430], 12, 1),
	[
		...quiet([630, 430], 13, 0),
		ev('playedBonusSpins', {
			prob: 1,
			additionalPrice: 0,
			triggers: 1,
			played: 13,
			left: 0,
			multiplier: {},
			bonusTriggers: { '10000': 1 },
			bonusPlayed: {
				'10000': { count: 13, base: { count: 0, multiplierCount: 0 }, states: {} },
			},
			spins: [],
			playing: '10000',
			state: 'main',
			trigger: TRIGGER,
		}),
		ev('gameEnd', { win: 1060 }),
	],
];
