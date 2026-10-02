/**
 * The three Hold and Win PRESETS — one kind, three reference games (`docs/design/hold-and-win.md`
 * §1.2, owner decision 2026-09-30). Each is a complete raw config, the source
 * `apps/launcher-api/scripts/generate-game-config-defaults.ts` normalizes into the committed
 * `data/gameConfig/holdAndWin.<preset>.json` defaults, exactly as `apps/<type>/src/game/config.ts`
 * is the source for lines/ways/scatter. Edit here and regenerate; never edit the JSON.
 *
 * Numbers from 3 Oaks' own server config and rules where the design records them. Where it does
 * not (line-symbol pays, draw weights, the payer's and leave-behind coin's exact steps, the mystery
 * table, and Pots activating the specials that were on the triggering board) the values
 * are PLACEHOLDERS for the mock to generate from — the math team replaces them.
 */

import type { HoldAndWin, HoldAndWinSymbolRole } from './holdAndWin';
import type { GameConfigSymbol, Paylines, RawGameConfig, ReelStrip, WinLevelTier } from './types';

export const HOLD_AND_WIN_PRESET_IDS = ['pots', 'classic', 'collector'] as const;

export type HoldAndWinPresetId = (typeof HOLD_AND_WIN_PRESET_IDS)[number];

export const HOLD_AND_WIN_PRESET_LABELS: Record<HoldAndWinPresetId, string> = {
	pots: 'Pots (3 Pots of Egypt)',
	classic: 'Classic sticky (Grand)',
	collector: 'Collector streak (Super Hotfire Diamonds)',
};

/** The committed-default key a preset is stored under: `holdAndWin.pots`, … */
export const holdAndWinPresetKey = (id: HoldAndWinPresetId): string => `holdAndWin.${id}`;

/** The preset a new `holdAndWin` project starts on — 3 Pots is the first real game. */
export const DEFAULT_HOLD_AND_WIN_PRESET: HoldAndWinPresetId = 'pots';

const strip = (names: string[]): ReelStrip => names.map((name) => ({ name }));

const pays = (three: number, four: number, five: number): GameConfigSymbol => ({
	paytable: [{ '3': three }, { '4': four }, { '5': five }],
});

/** A 3-reel game only has a 3-of-a-kind. */
const pays3 = (three: number): GameConfigSymbol => ({ paytable: [{ '3': three }] });

const tag = (...roles: Array<HoldAndWinSymbolRole | 'wild'>): GameConfigSymbol => ({
	special_properties: roles,
});

/** The small/medium floor every preset shares (the lines template's) and four big tiers at the
 *  thresholds each reference game names. */
const winLevels = (big: [number, number, number, number]): WinLevelTier[] => {
	const bigTier = (alias: string, name: string, anim: string, threshold: number, ms: number) => ({
		alias,
		name,
		threshold,
		type: 'big' as const,
		animation: { intro: `${anim}_intro`, idle: `${anim}_idle`, outro: `${anim}_exit` },
		sound: { bgm: `bgm_winlevel_${alias}` },
		durationMs: ms,
	});
	return [
		{ alias: 'zero', name: 'ZERO', threshold: 0, type: 'small' },
		{ alias: 'standard', name: 'STANDARD', threshold: 0, type: 'small', durationMs: 600 },
		{ alias: 'small', name: 'SMALL', threshold: 1.5, type: 'small', durationMs: 1000 },
		{ alias: 'nice', name: 'NICE', threshold: 3, type: 'medium', durationMs: 1500 },
		{ alias: 'substantial', name: 'SUBSTANTIAL', threshold: 6, type: 'medium', durationMs: 2000 },
		bigTier('big', 'BIG WIN', 'big_win', big[0], 6000),
		bigTier('superwin', 'SUPER WIN', 'super_win', big[1], 18000),
		bigTier('mega', 'MEGA WIN', 'mega_win', big[2], 20000),
		bigTier('epic', 'EPIC WIN!', 'epic_win', big[3], 26000),
	];
};

const BASE_MODE = { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 };

/** 5×3: the three rows and the two V shapes. */
const FIVE_LINES_5X3: Paylines = {
	'1': [1, 1, 1, 1, 1],
	'2': [0, 0, 0, 0, 0],
	'3': [2, 2, 2, 2, 2],
	'4': [0, 1, 2, 1, 0],
	'5': [2, 1, 0, 1, 2],
};

const TWENTY_FIVE_LINES_5X3: Paylines = {
	...FIVE_LINES_5X3,
	'6': [0, 0, 1, 2, 2],
	'7': [2, 2, 1, 0, 0],
	'8': [1, 0, 1, 2, 1],
	'9': [1, 2, 1, 0, 1],
	'10': [0, 1, 1, 1, 2],
	'11': [2, 1, 1, 1, 0],
	'12': [0, 1, 0, 1, 2],
	'13': [2, 1, 2, 1, 0],
	'14': [1, 1, 0, 1, 1],
	'15': [1, 1, 2, 1, 1],
	'16': [0, 2, 1, 0, 2],
	'17': [2, 0, 1, 2, 0],
	'18': [0, 0, 2, 0, 0],
	'19': [2, 2, 0, 2, 2],
	'20': [1, 0, 0, 0, 1],
	'21': [0, 1, 0, 1, 0],
	'22': [2, 1, 2, 1, 2],
	'23': [1, 0, 1, 0, 1],
	'24': [1, 2, 1, 2, 1],
	'25': [0, 2, 0, 2, 0],
};

/** 3×3: the three rows and the two diagonals. */
const FIVE_LINES_3X3: Paylines = {
	'1': [1, 1, 1],
	'2': [0, 0, 0],
	'3': [2, 2, 2],
	'4': [0, 1, 2],
	'5': [2, 1, 0],
};

const LINE_SYMBOLS_5: Record<string, GameConfigSymbol> = {
	H1: pays(2, 10, 50),
	H2: pays(1.5, 6, 30),
	H3: pays(1, 4, 20),
	H4: pays(0.8, 3, 15),
	L1: pays(0.5, 1.5, 6),
	L2: pays(0.4, 1.2, 5),
	L3: pays(0.3, 1, 4),
	L4: pays(0.2, 0.8, 3),
	W: tag('wild'),
};

const cash = (value: number, weight: number, reels?: number[]) =>
	reels
		? { kind: 'cash' as const, value, weight, reels }
		: { kind: 'cash' as const, value, weight };
const jp = (jackpot: string, weight: number, reels?: number[]) =>
	reels
		? { kind: 'jackpot' as const, jackpot, weight, reels }
		: { kind: 'jackpot' as const, jackpot, weight };

const even = (...values: number[]) => values.map((value) => ({ value, weight: 1 }));

// ─── 3 Pots of Egypt ──────────────────────────────────────────────────────────────────────────

const POTS_HOLD_AND_WIN: HoldAndWin = {
	trigger: {
		count: { min: 6, roles: ['coin', 'jackpot', 'payer', 'collector', 'coinMultiplier'] },
		luckySpin: true,
	},
	stickiness: 'allCoins',
	respins: { start: 3, reset: 'anyCoin' },
	boardEnd: {
		type: 'fullBoardJackpot',
		jackpot: 'GRAND',
		roles: ['coin', 'jackpot', 'collector', 'coinMultiplier', 'payer', 'mystery'],
	},
	coins: [
		cash(1, 30),
		cash(1.5, 24),
		cash(2, 20),
		cash(2.5, 16),
		cash(3, 12),
		cash(5, 8),
		cash(8, 4),
		cash(10, 3),
		jp('MINI', 2),
		jp('MINOR', 1),
		jp('MAJOR', 0.25),
	],
	jackpots: [
		{ name: 'MINI', multiplier: 15, fixed: true },
		{ name: 'MINOR', multiplier: 30, fixed: true },
		{ name: 'MAJOR', multiplier: 100, fixed: true },
		{ name: 'GRAND', multiplier: 2000, fixed: true },
	],
	specials: {
		collector: {
			level: 1,
			maxLevel: 1,
			sticky: true,
			collects: 'perRespin',
			landsInBaseGame: true,
			instantCollectInBaseGame: false,
		},
		multiplier: {
			values: [
				{ value: 2, weight: 6 },
				{ value: 3, weight: 3 },
				{ value: 5, weight: 1 },
			],
			multipliesJackpots: false,
			leaveBehind: { type: 'becomesCoin', values: even(2, 3, 4, 5, 6, 7, 8, 9, 10) },
			landsInBaseGame: true,
			instantCollectInBaseGame: false,
		},
		payer: { values: even(2, 3, 4, 5, 6, 7, 8, 9, 10), landsInBaseGame: true },
		mystery: {
			reveals: [
				{ type: 'special', special: 'payer', weight: 3 },
				{ type: 'special', special: 'collector', weight: 3 },
				{ type: 'special', special: 'multiplier', weight: 3 },
				{ type: 'jackpot', jackpot: 'MINI', weight: 2 },
				{ type: 'jackpot', jackpot: 'MINOR', weight: 1 },
				{ type: 'jackpot', jackpot: 'MAJOR', weight: 0.25 },
			],
			unlocksInactive: true,
		},
	},
	applyOrder: ['mystery', 'payer', 'multiplier', 'collector'],
	activeModifiers: { atEntry: ['mystery'], fromTriggeringSpecials: true },
	meters: [
		{ id: 'red', symbol: 'BOOST', maxLevel: 12, sizeStages: [5, 9], activates: 'payer' },
		{ id: 'blue', symbol: 'COLLECT', maxLevel: 12, sizeStages: [5, 9], activates: 'collector' },
		{ id: 'green', symbol: 'MULTI', maxLevel: 12, sizeStages: [5, 9], activates: 'multiplier' },
	],
};

const POTS: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: '3_pots',
	gameID: 'hold_and_win_pots',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: BASE_MODE },
	paylines: TWENTY_FIVE_LINES_5X3,
	symbols: {
		...LINE_SYMBOLS_5,
		BONUS: tag('coin'),
		JACKPOT: tag('jackpot'),
		BOOST: tag('payer', 'meterSpecial'),
		COLLECT: tag('collector', 'meterSpecial'),
		MULTI: tag('coinMultiplier', 'meterSpecial'),
		MYSTERY: tag('mystery'),
		BLANK: tag('blank'),
	},
	paddingReels: {
		basegame: [
			strip(['H1', 'L1', 'BONUS', 'L2', 'H2', 'BOOST', 'L3', 'W', 'L4', 'H3', 'BONUS', 'L1']),
			strip(['H2', 'L3', 'BONUS', 'H4', 'L2', 'COLLECT', 'L1', 'W', 'H1', 'L4', 'JACKPOT', 'L3']),
			strip(['H3', 'L4', 'BONUS', 'L1', 'H1', 'MULTI', 'L2', 'W', 'H4', 'L3', 'BONUS', 'H2']),
			strip(['H4', 'L2', 'BONUS', 'H3', 'L1', 'BOOST', 'L4', 'W', 'H2', 'L3', 'JACKPOT', 'L1']),
			strip(['H1', 'L3', 'BONUS', 'L4', 'H2', 'COLLECT', 'L2', 'W', 'H3', 'L1', 'BONUS', 'H4']),
		],
		respin: Array.from({ length: 5 }, () =>
			strip([
				'BLANK',
				'BONUS',
				'BLANK',
				'BOOST',
				'BLANK',
				'JACKPOT',
				'BLANK',
				'COLLECT',
				'BLANK',
				'MULTI',
				'BLANK',
				'MYSTERY',
			]),
		),
	},
	winLevels: winLevels([15, 25, 50, 80]),
	holdAndWin: POTS_HOLD_AND_WIN,
};

// ─── Grand ────────────────────────────────────────────────────────────────────────────────────

const CLASSIC_HOLD_AND_WIN: HoldAndWin = {
	trigger: {
		count: { min: 6, roles: ['coin', 'jackpot', 'coinMultiplier'] },
		buy: [
			{ mode: 'buy', guaranteed: [], boostedSpecials: false },
			{
				mode: 'superBuy',
				guaranteed: [{ role: 'coinMultiplier', count: 2 }],
				boostedSpecials: true,
			},
		],
		randomMetre: { name: 'Diamond Metre' },
	},
	stickiness: 'allCoins',
	respins: { start: 3, reset: 'anySpecial' },
	boardEnd: { type: 'columnLetters', letters: 'GRAND', jackpot: 'GRAND', clearOnComplete: true },
	coins: [
		cash(1, 30),
		cash(2, 22),
		cash(3, 16),
		cash(4, 12),
		cash(5, 9),
		cash(6, 6),
		cash(7, 4),
		cash(10, 2),
		jp('MINI', 2),
		jp('MINOR', 1),
		jp('MAJOR', 0.25),
	],
	jackpots: [
		{ name: 'MINI', multiplier: 15, fixed: true },
		{ name: 'MINOR', multiplier: 30, fixed: true },
		{ name: 'MAJOR', multiplier: 100, fixed: true },
		{ name: 'GRAND', multiplier: 1000, fixed: true },
	],
	specials: {
		multiplier: {
			values: [
				{ value: 2, weight: 6 },
				{ value: 3, weight: 3 },
				{ value: 5, weight: 1 },
			],
			multipliesJackpots: true,
			leaveBehind: { type: 'none' },
			landsInBaseGame: true,
			instantCollectInBaseGame: true,
		},
	},
	applyOrder: ['multiplier'],
	activeModifiers: { atEntry: ['multiplier'], fromTriggeringSpecials: false },
};

const CLASSIC: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: 'grand',
	gameID: 'hold_and_win_classic',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: {
		base: BASE_MODE,
		buy: { cost: 70, feature: false, buyBonus: true, rtp: 0.96, max_win: 5000 },
		superBuy: { cost: 300, feature: false, buyBonus: true, rtp: 0.96, max_win: 5000 },
	},
	betModePresentation: {
		buy: { kind: 'buy', order: 1, text: { title: 'BUY BONUS' } },
		superBuy: { kind: 'buy', order: 2, text: { title: 'SUPER BUY' } },
	},
	paylines: FIVE_LINES_5X3,
	symbols: {
		...LINE_SYMBOLS_5,
		BONUS: tag('coin'),
		JACKPOT: tag('jackpot'),
		BOOST: tag('coinMultiplier'),
		BLANK: tag('blank'),
	},
	paddingReels: {
		basegame: [
			strip(['H1', 'L1', 'BONUS', 'L2', 'H2', 'BOOST', 'L3', 'W', 'L4', 'H3', 'BONUS', 'L1']),
			strip(['H2', 'L3', 'BONUS', 'H4', 'L2', 'JACKPOT', 'L1', 'W', 'H1', 'L4', 'BONUS', 'L3']),
			strip(['H3', 'L4', 'BONUS', 'L1', 'H1', 'BOOST', 'L2', 'W', 'H4', 'L3', 'BONUS', 'H2']),
			strip(['H4', 'L2', 'BONUS', 'H3', 'L1', 'JACKPOT', 'L4', 'W', 'H2', 'L3', 'BONUS', 'L1']),
			strip(['H1', 'L3', 'BONUS', 'L4', 'H2', 'BOOST', 'L2', 'W', 'H3', 'L1', 'BONUS', 'H4']),
		],
		respin: Array.from({ length: 5 }, () =>
			strip(['BLANK', 'BONUS', 'BLANK', 'BOOST', 'BLANK', 'JACKPOT', 'BLANK', 'BONUS']),
		),
	},
	winLevels: winLevels([15, 30, 50, 80]),
	holdAndWin: CLASSIC_HOLD_AND_WIN,
};

// ─── Super Hotfire Diamonds ───────────────────────────────────────────────────────────────────

const OUTER_REELS = [0, 2];

const COLLECTOR_HOLD_AND_WIN: HoldAndWin = {
	trigger: {
		pattern: [
			{ reel: 0, roles: ['coin', 'jackpot'], min: 1 },
			{ reel: 1, roles: ['collector'], min: 1 },
			{ reel: 2, roles: ['coin', 'jackpot'], min: 1 },
		],
		randomMetre: { name: 'Extra Bonus Game' },
	},
	stickiness: 'collectorsOnly',
	respins: { start: 3, reset: 'anySpecial' },
	boardEnd: { type: 'none' },
	coins: [
		cash(1, 30, OUTER_REELS),
		cash(2, 22, OUTER_REELS),
		cash(3, 16, OUTER_REELS),
		cash(5, 10, OUTER_REELS),
		cash(7, 6, OUTER_REELS),
		cash(10, 3, OUTER_REELS),
		cash(15, 1.5, OUTER_REELS),
		jp('MINI', 2, OUTER_REELS),
		jp('MINOR', 1, OUTER_REELS),
		jp('MAJOR', 0.25, OUTER_REELS),
		jp('GRAND', 0.02, OUTER_REELS),
	],
	jackpots: [
		{ name: 'MINI', multiplier: 25, fixed: true },
		{ name: 'MINOR', multiplier: 50, fixed: true },
		{ name: 'MAJOR', multiplier: 150, fixed: true },
		{ name: 'GRAND', multiplier: 1000, fixed: true },
	],
	specials: {
		collector: {
			level: 1,
			maxLevel: 3,
			sticky: true,
			collects: 'perRespin',
			landsInBaseGame: true,
			instantCollectInBaseGame: true,
			reels: [1],
		},
	},
	applyOrder: ['collector'],
	activeModifiers: { atEntry: ['collector'], fromTriggeringSpecials: false },
	wheel: {
		prizes: [
			{ type: 'coinBoost', multiplier: 2, weight: 4 },
			{ type: 'extraCollect', count: 1, weight: 4 },
			{ type: 'extraCollect', count: 2, weight: 2 },
			{ type: 'jackpot', jackpot: 'MINI', weight: 2 },
			{ type: 'jackpot', jackpot: 'MINOR', weight: 1 },
			{ type: 'jackpot', jackpot: 'MAJOR', weight: 0.3 },
			{ type: 'jackpot', jackpot: 'GRAND', weight: 0.05 },
		],
	},
};

const COLLECTOR: RawGameConfig = {
	providerName: 'invisible_wall',
	gameName: 'hotfire',
	gameID: 'hold_and_win_collector',
	rtp: 0.96,
	numReels: 3,
	numRows: [3, 3, 3],
	betModes: { base: BASE_MODE },
	paylines: FIVE_LINES_3X3,
	symbols: {
		H1: pays3(5),
		H2: pays3(3),
		H3: pays3(2),
		L1: pays3(1),
		L2: pays3(0.6),
		L3: pays3(0.4),
		W: tag('wild'),
		BONUS: tag('coin'),
		JACKPOT: tag('jackpot'),
		COLLECT: tag('collector'),
		BLANK: tag('blank'),
	},
	paddingReels: {
		basegame: [
			strip(['H1', 'L1', 'BONUS', 'L2', 'H2', 'L3', 'W', 'BONUS', 'H3', 'JACKPOT']),
			strip(['H2', 'L3', 'COLLECT', 'L1', 'H3', 'L2', 'W', 'H1', 'COLLECT', 'L3']),
			strip(['H3', 'L2', 'BONUS', 'L1', 'H1', 'L3', 'W', 'BONUS', 'H2', 'JACKPOT']),
		],
		respin: [
			strip(['BLANK', 'BONUS', 'BLANK', 'JACKPOT', 'BLANK', 'BONUS']),
			strip(['BLANK', 'BLANK', 'COLLECT', 'BLANK', 'BLANK', 'BLANK']),
			strip(['BLANK', 'BONUS', 'BLANK', 'JACKPOT', 'BLANK', 'BONUS']),
		],
	},
	winLevels: winLevels([20, 30, 50, 100]),
	holdAndWin: COLLECTOR_HOLD_AND_WIN,
};

/** The raw preset configs — read by the defaults generator and the offline fixture only. */
export const HOLD_AND_WIN_PRESETS: Record<HoldAndWinPresetId, RawGameConfig> = {
	pots: POTS,
	classic: CLASSIC,
	collector: COLLECTOR,
};

/**
 * 3 Pots plus the Phase 11a specials: an `ADD` add-respins (+1/+2, clears after applying, the cap
 * untouched) and an `UPG` upgrade (all / adjacent / one jackpot tier, steps 0.5/1/2), both active
 * at entry, applied after the payer, and both revealable by the mystery.
 */
const POTS_EXTRA: RawGameConfig = {
	...POTS,
	gameName: '3_pots_extra',
	gameID: 'hold_and_win_pots_extra',
	symbols: { ...POTS.symbols, ADD: tag('addRespins'), UPG: tag('upgrade') },
	paddingReels: {
		...POTS.paddingReels,
		respin: POTS.paddingReels.respin.map((reel) => [
			...reel,
			...strip(['BLANK', 'ADD', 'BLANK', 'UPG']),
		]),
	},
	holdAndWin: {
		...POTS_HOLD_AND_WIN,
		boardEnd: {
			type: 'fullBoardJackpot',
			jackpot: 'GRAND',
			roles: [
				'coin',
				'jackpot',
				'collector',
				'coinMultiplier',
				'payer',
				'mystery',
				'addRespins',
				'upgrade',
			],
		},
		specials: {
			...POTS_HOLD_AND_WIN.specials,
			mystery: {
				reveals: [
					...(POTS_HOLD_AND_WIN.specials.mystery?.reveals ?? []),
					{ type: 'special', special: 'addRespins', weight: 3 },
					{ type: 'special', special: 'upgrade', weight: 3 },
				],
				unlocksInactive: true,
			},
			addRespins: {
				values: [
					{ value: 1, weight: 3 },
					{ value: 2, weight: 1 },
				],
				raisesCap: false,
				sticky: false,
				landsInBaseGame: false,
			},
			upgrade: {
				targets: [
					{ target: 'all', weight: 1 },
					{ target: 'adjacent', weight: 2 },
					{ target: 'jackpotTier', weight: 1 },
				],
				values: [
					{ value: 0.5, weight: 3 },
					{ value: 1, weight: 2 },
					{ value: 2, weight: 1 },
				],
				landsInBaseGame: false,
			},
		},
		applyOrder: ['mystery', 'payer', 'addRespins', 'upgrade', 'multiplier', 'collector'],
		activeModifiers: {
			atEntry: ['mystery', 'addRespins', 'upgrade'],
			fromTriggeringSpecials: true,
		},
	},
};

/**
 * DEV/TEST fixtures — never offered by the Game Maker. `pots-progressive` is 3 Pots with its upper
 * three tiers progressive (design §7 11c), so the mock, the facade and the engine's live jackpot
 * values can be exercised without any project turning the option on; `pots-extra` is 3 Pots with
 * the 11a add-respins and upgrade specials (`PRESET=pots-extra` on the mock CLI).
 */
export const HOLD_AND_WIN_TEST_FIXTURES: Record<string, RawGameConfig> = {
	'pots-progressive': {
		...POTS,
		holdAndWin: {
			...POTS_HOLD_AND_WIN,
			jackpots: [
				{ name: 'MINI', multiplier: 15, fixed: true },
				{
					name: 'MINOR',
					multiplier: 30,
					fixed: false,
					progressive: { seed: 30, contribution: 1, cap: 40 },
				},
				{
					name: 'MAJOR',
					multiplier: 100,
					fixed: false,
					progressive: { seed: 100, contribution: 0.2 },
				},
				{
					name: 'GRAND',
					multiplier: 2000,
					fixed: false,
					progressive: { seed: 2000, contribution: 1 },
				},
			],
		},
	},
	'pots-extra': POTS_EXTRA,
};
