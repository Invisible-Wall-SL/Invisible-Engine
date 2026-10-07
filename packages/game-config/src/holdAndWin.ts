/**
 * The HOLD AND WIN mechanic block (`docs/design/hold-and-win.md` §1.3, §5). One kind, three
 * reference presets (Grand, Super Hotfire Diamonds, 3 Pots of Egypt): every knob any of them uses
 * lives here, and a preset is nothing but a set of values for these knobs.
 *
 * What this block is — like the rest of the config — is the FRONTEND's contract with the math: what
 * the respin feature can show and what the mock (Phase 3) generates rounds from. The RGS stays the
 * authority on outcomes; the weights here drive the mock and the tool's readouts, never a real game.
 *
 * Symbols take their Hold and Win ROLE from the dictionary's `special_properties` (one of
 * {@link HOLD_AND_WIN_SYMBOL_ROLES}), and this block holds each role's TABLES. The symbol name is
 * never repeated in here — a special is "whatever the dictionary tags `payer`" — so renaming a
 * symbol is one edit. The one exception is a meter, which names its filling symbol because three
 * meters filled by three different specials is the whole point of 3 Pots.
 *
 * Normalization is STRUCTURAL (drops what cannot be read, keeps what is merely wrong); every cross
 * reference — a jackpot name, a reel index, a role no symbol carries — is the validator's to report.
 */

import { symbolsInPlay, symbolsInPlayForGameType } from './inPlay';
import { BASE_GAME_MODE, HOLD_AND_WIN_MODE, gameModeById, gameTypeForMode } from './modes';
import type { GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';

/** The Hold and Win roles a symbol can carry in `special_properties`.
 *
 *  `coinMultiplier`, not `multiplier`: the lines family already reads `multiplier` as "a
 *  multiplier wild / tumble multiplier" (the mock contract deals multiplier cells for it), so a
 *  Hold and Win MULTI tagged `multiplier` would switch that on for the base game. */
export const HOLD_AND_WIN_SYMBOL_ROLES = [
	'coin',
	'jackpot',
	'collector',
	'coinMultiplier',
	'payer',
	'mystery',
	'meterSpecial',
	'blank',
	'addRespins',
	'upgrade',
	'unlock',
] as const;

export type HoldAndWinSymbolRole = (typeof HOLD_AND_WIN_SYMBOL_ROLES)[number];

/** The feature's special kinds, each optional, each with its own table. */
export const HOLD_AND_WIN_SPECIALS = [
	'collector',
	'multiplier',
	'payer',
	'mystery',
	'addRespins',
	'upgrade',
] as const;

export type HoldAndWinSpecial = (typeof HOLD_AND_WIN_SPECIALS)[number];

/** The `special_properties` role each special kind's symbols carry. */
export const SPECIAL_SYMBOL_ROLE: Record<HoldAndWinSpecial, HoldAndWinSymbolRole> = {
	collector: 'collector',
	multiplier: 'coinMultiplier',
	payer: 'payer',
	mystery: 'mystery',
	addRespins: 'addRespins',
	upgrade: 'upgrade',
};

/** A value with a draw weight — the shape every value table in the block shares. `value` is a
 *  multiple of the TOTAL bet unless the table says otherwise (a multiplier's values are factors). */
export type WeightedValue = { value: number; weight: number };

/** A progressive tier's pool, × total bet like `multiplier`: it starts at `seed`, grows by
 *  `contribution` with every bet, stops at `cap` (absent ⇒ no cap) and goes back to `seed` when won.
 *  The pool is SERVER state (per player on the mock); the client only shows what the server says. */
export type HoldAndWinProgressive = { seed: number; contribution: number; cap?: number };

/** One jackpot tier. `multiplier` is × total bet. `fixed: false` names a progressive tier, whose
 *  `progressive` pool the server grows and pays (design §7 11c); `multiplier` stays its fallback. */
export type HoldAndWinJackpot = {
	name: string;
	multiplier: number;
	fixed: boolean;
	progressive?: HoldAndWinProgressive;
};

/** One row of the coin value table: a cash coin (× total bet, decimals allowed) or a jackpot label.
 *  `reels` are 0-based reel indices the entry may land on; absent ⇒ every reel. A cash entry is
 *  drawn as a `coin` symbol and a jackpot entry as a `jackpot` symbol — or as the `coin` symbol
 *  when the game has no separate jackpot art. */
export type CoinValueEntry =
	| { kind: 'cash'; value: number; weight: number; reels?: number[] }
	| { kind: 'jackpot'; jackpot: string; weight: number; reels?: number[] };

/** "N+ symbols of these roles anywhere on the board". */
export type CountTrigger = { min: number; roles: HoldAndWinSymbolRole[] };

/** One per-reel requirement of a pattern trigger: at least `min` symbols of `roles` on `reel`. */
export type PatternRequirement = { reel: number; roles: HoldAndWinSymbolRole[]; min: number };

/** How many of which role a bought feature guarantees on entry. */
export type GuaranteedSpecial = { role: HoldAndWinSymbolRole; count: number };

/**
 * A buy tier. Its PRICE is the named bet mode's `cost` — the bet modes already own price, RTP and
 * max win, and a second price here would drift from the one the bet selector charges.
 */
export type BuyTier = {
	/** A `betModes` key whose `buyBonus` is true. */
	mode: string;
	guaranteed: GuaranteedSpecial[];
	/** "More boosts all round" (Grand's Super Buy): specials land more often during this feature. */
	boostedSpecials: boolean;
};

export type HoldAndWinTrigger = {
	count?: CountTrigger;
	/** Every requirement must hold on the same spin. */
	pattern?: PatternRequirement[];
	buy?: BuyTier[];
	/** A random server-side trigger dressed as a metre (Grand's Diamond Metre, Hotfire's Extra Bonus
	 *  Game). Presentation only — the server decides. */
	randomMetre?: { name: string };
	/** A server-announced base spin that guarantees the trigger (own intro, all-reel anticipation,
	 *  no skip). */
	luckySpin?: boolean;
};

export const STICKINESS = ['allCoins', 'collectorsOnly'] as const;
export type Stickiness = (typeof STICKINESS)[number];

/** `anyCoin` — only a new coin or jackpot resets the counter; `anySpecial` — any new coin, jackpot
 *  or special does. */
export const RESPIN_RESETS = ['anyCoin', 'anySpecial'] as const;
export type RespinReset = (typeof RESPIN_RESETS)[number];

export type HoldAndWinRespins = {
	start: number;
	reset: RespinReset;
	/** Most respins one feature may play. Absent ⇒ uncapped (ends on 0 or a full board). */
	cap?: number;
};

export const BOARD_END_TYPES = ['none', 'fullBoardJackpot', 'columnLetters'] as const;

export type BoardEnd =
	| { type: 'none' }
	/** A full board awards `jackpot`; `roles` say which symbols count as filling a cell. */
	| { type: 'fullBoardJackpot'; jackpot: string; roles: HoldAndWinSymbolRole[] }
	/** One letter per reel; a full column lights its letter (and clears, when `clearOnComplete`);
	 *  every letter lit awards `jackpot`. */
	| { type: 'columnLetters'; letters: string; jackpot: string; clearOnComplete: boolean };

export type CollectorSpecial = {
	/** How many times a collector collects on its turn — 1 single, 2 double, 3 triple. */
	level: number;
	/** The highest level a wheel prize or upgrade may raise it to. */
	maxLevel: number;
	sticky: boolean;
	/** `perRespin` — gathers every visible coin each respin it is on the board (a streak);
	 *  `atEnd` — gathers once when the feature ends. */
	collects: 'perRespin' | 'atEnd';
	/** 0-based reels it may land on; absent ⇒ every reel. */
	reels?: number[];
	landsInBaseGame: boolean;
	/** A collector + any coin in the BASE game pays at once, without the feature. */
	instantCollectInBaseGame: boolean;
};

/** What a multiplier leaves on its cell after applying. */
export type LeaveBehind = { type: 'none' } | { type: 'becomesCoin'; values: WeightedValue[] };

export type MultiplierSpecial = {
	/** Factors (x2 / x3 / x5), not × total bet. */
	values: WeightedValue[];
	multipliesJackpots: boolean;
	leaveBehind: LeaveBehind;
	reels?: number[];
	landsInBaseGame: boolean;
	instantCollectInBaseGame: boolean;
};

export type PayerSpecial = {
	/** Added to every visible coin, × total bet. */
	values: WeightedValue[];
	reels?: number[];
	landsInBaseGame: boolean;
};

/**
 * Adds respins to the counter when it lands in a respin (Lightning-Link style). `values` are whole
 * respins, not × total bet.
 */
export type AddRespinsSpecial = {
	values: WeightedValue[];
	/** Also raise the counter's CAP — the count a reset fills it back to — by the same amount, so
	 *  every later reset fills to the higher count. `respins.cap` (the most respins one feature
	 *  plays) is a different limit and is never raised. */
	raisesCap: boolean;
	/** Stays on the board after applying (holding its cell, worth nothing); else its cell clears. */
	sticky: boolean;
	reels?: number[];
	/** Lands in the base game too (where it does nothing but count toward a trigger that counts its
	 *  role). Normally off. */
	landsInBaseGame: boolean;
};

/** What an upgrade raises: every cash coin by its step (`all`), the cash coins in the 8 cells
 *  around it by its step (`adjacent`), or ONE jackpot coin by one tier (`jackpotTier` — the
 *  lowest-tier one, never past the top tier). */
export const UPGRADE_TARGETS = ['all', 'adjacent', 'jackpotTier'] as const;
export type UpgradeTarget = (typeof UPGRADE_TARGETS)[number];

export type UpgradeSpecial = {
	/** Which rule a landing applies — drawn per landing. */
	targets: { target: UpgradeTarget; weight: number }[];
	/** The step a cash coin rises by, × total bet, decimals allowed. Unused by `jackpotTier`. */
	values: WeightedValue[];
	reels?: number[];
	landsInBaseGame: boolean;
};

/** One outcome of a mystery reveal. */
export type MysteryReveal =
	| { type: 'coin'; weight: number }
	| { type: 'jackpot'; jackpot: string; weight: number }
	| { type: 'special'; special: Exclude<HoldAndWinSpecial, 'mystery'>; weight: number };

export type MysterySpecial = {
	reveals: MysteryReveal[];
	reels?: number[];
	/** A revealed special that was NOT active activates it for the rest of the round. */
	unlocksInactive: boolean;
};

export type HoldAndWinSpecials = {
	collector?: CollectorSpecial;
	multiplier?: MultiplierSpecial;
	payer?: PayerSpecial;
	mystery?: MysterySpecial;
	addRespins?: AddRespinsSpecial;
	upgrade?: UpgradeSpecial;
};

/** Which specials may land in the respins, decided at entry. */
export type ActiveModifiers = {
	/** Always active when the feature starts. */
	atEntry: HoldAndWinSpecial[];
	/** Specials that were on the triggering board are also active. */
	fromTriggeringSpecials: boolean;
};

/** A persistent per-player meter (a 3 Pots pot). Server state — the client never computes a level. */
export type HoldAndWinMeter = {
	id: string;
	/** The symbol whose landing fills it (tagged `meterSpecial`). */
	symbol: string;
	maxLevel: number;
	/** Levels at which the meter art steps up a size, ascending (3 Pots: 5 and 9). */
	sizeStages: number[];
	/** The special a full meter enters the feature with active. */
	activates: HoldAndWinSpecial;
};

export type WheelPrize =
	| { type: 'coinBoost'; multiplier: number; weight: number }
	| { type: 'extraCollect'; count: number; weight: number }
	| { type: 'jackpot'; jackpot: string; weight: number };

/** A pre-feature wheel, spun once when the feature starts. */
export type HoldAndWinWheel = { prizes: WheelPrize[] };

/** What opens the next locked row of an expanding board. */
export const EXPANSION_RULES = ['fullRow', 'unlockSymbol', 'coinCount'] as const;
export type ExpansionRule = (typeof EXPANSION_RULES)[number];

/** Reaching `rows` open rows awards `jackpot` (banked, once per feature). */
export type RowJackpot = { rows: number; jackpot: string };

/**
 * Board expansion (design §7 11b): the respin board opens with `startRows` rows — the base grid's —
 * and unlocks rows BELOW them up to `maxRows`, so a held cell's row index never changes. Locked rows
 * hold nothing. A full board (`boardEnd.fullBoardJackpot`) is every cell of `maxRows`.
 */
export type HoldAndWinExpansion = {
	startRows: number;
	maxRows: number;
	/** `fullRow` — every cell of the bottom-most open row held opens the next; `unlockSymbol` — a
	 *  symbol tagged `unlock` landing opens one; `coinCount` — the held count reaching a threshold. */
	rule: ExpansionRule;
	/** `coinCount` only: the held symbols that open each row past `startRows`, ascending —
	 *  `thresholds[i]` opens row `startRows + i + 1`. */
	thresholds?: number[];
	/** `unlockSymbol` only: the reels an unlock symbol may land on; absent ⇒ every reel. It clears
	 *  after opening its row. */
	unlockReels?: number[];
	/** An unlock resets the respin counter to its start. */
	resetsRespins: boolean;
	rowJackpots?: RowJackpot[];
};

export type HoldAndWin = {
	trigger: HoldAndWinTrigger;
	stickiness: Stickiness;
	respins: HoldAndWinRespins;
	boardEnd: BoardEnd;
	coins: CoinValueEntry[];
	jackpots: HoldAndWinJackpot[];
	specials: HoldAndWinSpecials;
	/** The order specials that land on the same respin apply in. */
	applyOrder: HoldAndWinSpecial[];
	activeModifiers: ActiveModifiers;
	meters?: HoldAndWinMeter[];
	wheel?: HoldAndWinWheel;
	expansion?: HoldAndWinExpansion;
};

// ─── normalize ────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const positive = (v: unknown): number | undefined => {
	const n = num(v);
	return n !== undefined && n > 0 ? n : undefined;
};

const int = (v: unknown, min = 0): number | undefined => {
	const n = num(v);
	return n !== undefined && Number.isInteger(n) && n >= min ? n : undefined;
};

const text = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
	list.includes(v as T) ? (v as T) : undefined;

const list = <T>(raw: unknown, read: (entry: unknown) => T | undefined): T[] =>
	Array.isArray(raw) ? raw.map(read).filter((e): e is T => e !== undefined) : [];

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Weight: a non-negative finite number; absent ⇒ 1, so a hand-typed table without weights is an
 *  even draw rather than a table of nothing. */
const weight = (v: unknown): number | undefined => {
	if (v === undefined) return 1;
	const n = num(v);
	return n !== undefined && n >= 0 ? n : undefined;
};

const roles = (raw: unknown): HoldAndWinSymbolRole[] =>
	unique(list(raw, (r) => oneOf(HOLD_AND_WIN_SYMBOL_ROLES, r)));

const specials = (raw: unknown): HoldAndWinSpecial[] =>
	unique(list(raw, (s) => oneOf(HOLD_AND_WIN_SPECIALS, s)));

const reels = (raw: unknown): number[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const out = unique(list(raw, (r) => int(r))).sort((a, b) => a - b);
	return out.length ? out : undefined;
};

/** `reels` only when authored, so a special that lands anywhere stores no list. */
const withReels = <T extends object>(entry: T, raw: Record<string, unknown>): T => {
	const onReels = reels(raw.reels);
	return onReels ? { ...entry, reels: onReels } : entry;
};

const weightedValue = (raw: unknown): WeightedValue | undefined => {
	if (!isObject(raw)) return undefined;
	const value = positive(raw.value);
	const w = weight(raw.weight);
	return value !== undefined && w !== undefined ? { value, weight: w } : undefined;
};

const values = (raw: unknown): WeightedValue[] => list(raw, weightedValue);

const jackpot = (raw: unknown): HoldAndWinJackpot | undefined => {
	if (!isObject(raw)) return undefined;
	const name = text(raw.name);
	const multiplier = positive(raw.multiplier);
	if (!name || multiplier === undefined) return undefined;
	if (raw.fixed !== false) return { name, multiplier, fixed: true };
	return { name, multiplier, fixed: false, progressive: progressive(raw.progressive, multiplier) };
};

/** A progressive tier's pool; an absent or partial one falls back to a pool that starts at the
 *  tier's `multiplier` and never grows — exactly what a `fixed: false` tier paid before 11c. */
const progressive = (raw: unknown, multiplier: number): HoldAndWinProgressive => {
	const r = isObject(raw) ? raw : {};
	const contribution = num(r.contribution);
	const cap = positive(r.cap);
	return {
		seed: positive(r.seed) ?? multiplier,
		contribution: contribution !== undefined && contribution >= 0 ? contribution : 0,
		...(cap !== undefined ? { cap } : {}),
	};
};

const coin = (raw: unknown): CoinValueEntry | undefined => {
	if (!isObject(raw)) return undefined;
	const w = weight(raw.weight);
	if (w === undefined) return undefined;
	const label = text(raw.jackpot);
	if (raw.kind === 'jackpot' || (raw.kind === undefined && label)) {
		return label
			? withReels<CoinValueEntry>({ kind: 'jackpot', jackpot: label, weight: w }, raw)
			: undefined;
	}
	const value = positive(raw.value);
	return value !== undefined
		? withReels<CoinValueEntry>({ kind: 'cash', value, weight: w }, raw)
		: undefined;
};

const trigger = (raw: unknown): HoldAndWinTrigger => {
	if (!isObject(raw)) return {};
	const out: HoldAndWinTrigger = {};
	if (isObject(raw.count)) {
		const min = int(raw.count.min, 1);
		const countRoles = roles(raw.count.roles);
		if (min !== undefined) out.count = { min, roles: countRoles };
	}
	const pattern = list(raw.pattern, (entry): PatternRequirement | undefined => {
		if (!isObject(entry)) return undefined;
		const reel = int(entry.reel);
		if (reel === undefined) return undefined;
		return { reel, roles: roles(entry.roles), min: int(entry.min, 1) ?? 1 };
	});
	if (pattern.length) out.pattern = pattern;
	const buy = list(raw.buy, (entry): BuyTier | undefined => {
		if (!isObject(entry)) return undefined;
		const mode = text(entry.mode);
		if (!mode) return undefined;
		return {
			mode,
			guaranteed: list(entry.guaranteed, (g): GuaranteedSpecial | undefined => {
				if (!isObject(g)) return undefined;
				const role = oneOf(HOLD_AND_WIN_SYMBOL_ROLES, g.role);
				const count = int(g.count, 1);
				return role && count !== undefined ? { role, count } : undefined;
			}),
			boostedSpecials: entry.boostedSpecials === true,
		};
	});
	if (buy.length) out.buy = buy;
	if (isObject(raw.randomMetre)) {
		out.randomMetre = { name: text(raw.randomMetre.name) ?? 'Metre' };
	}
	if (raw.luckySpin === true) out.luckySpin = true;
	return out;
};

const respins = (raw: unknown): HoldAndWinRespins => {
	const r = isObject(raw) ? raw : {};
	const out: HoldAndWinRespins = {
		start: int(r.start, 1) ?? 3,
		reset: oneOf(RESPIN_RESETS, r.reset) ?? 'anyCoin',
	};
	const cap = int(r.cap, 1);
	if (cap !== undefined) out.cap = cap;
	return out;
};

const boardEnd = (raw: unknown): BoardEnd => {
	if (!isObject(raw)) return { type: 'none' };
	if (raw.type === 'fullBoardJackpot') {
		const name = text(raw.jackpot);
		if (name) return { type: 'fullBoardJackpot', jackpot: name, roles: roles(raw.roles) };
	}
	if (raw.type === 'columnLetters') {
		const letters = text(raw.letters);
		const name = text(raw.jackpot);
		if (letters && name) {
			return {
				type: 'columnLetters',
				letters,
				jackpot: name,
				clearOnComplete: raw.clearOnComplete !== false,
			};
		}
	}
	return { type: 'none' };
};

const collector = (raw: unknown): CollectorSpecial | undefined => {
	if (!isObject(raw)) return undefined;
	const level = int(raw.level, 1) ?? 1;
	return withReels<CollectorSpecial>(
		{
			level,
			maxLevel: int(raw.maxLevel, 1) ?? level,
			sticky: raw.sticky !== false,
			collects: raw.collects === 'atEnd' ? 'atEnd' : 'perRespin',
			landsInBaseGame: raw.landsInBaseGame === true,
			instantCollectInBaseGame: raw.instantCollectInBaseGame === true,
		},
		raw,
	);
};

const leaveBehind = (raw: unknown): LeaveBehind => {
	if (isObject(raw) && raw.type === 'becomesCoin') {
		return { type: 'becomesCoin', values: values(raw.values) };
	}
	return { type: 'none' };
};

const multiplier = (raw: unknown): MultiplierSpecial | undefined => {
	if (!isObject(raw)) return undefined;
	return withReels<MultiplierSpecial>(
		{
			values: values(raw.values),
			multipliesJackpots: raw.multipliesJackpots === true,
			leaveBehind: leaveBehind(raw.leaveBehind),
			landsInBaseGame: raw.landsInBaseGame === true,
			instantCollectInBaseGame: raw.instantCollectInBaseGame === true,
		},
		raw,
	);
};

const payer = (raw: unknown): PayerSpecial | undefined => {
	if (!isObject(raw)) return undefined;
	return withReels<PayerSpecial>(
		{ values: values(raw.values), landsInBaseGame: raw.landsInBaseGame === true },
		raw,
	);
};

const MYSTERY_SPECIALS = ['collector', 'multiplier', 'payer', 'addRespins', 'upgrade'] as const;

const mysteryReveal = (raw: unknown): MysteryReveal | undefined => {
	if (!isObject(raw)) return undefined;
	const w = weight(raw.weight);
	if (w === undefined) return undefined;
	if (raw.type === 'coin') return { type: 'coin', weight: w };
	if (raw.type === 'jackpot') {
		const name = text(raw.jackpot);
		return name ? { type: 'jackpot', jackpot: name, weight: w } : undefined;
	}
	if (raw.type === 'special') {
		const special = oneOf(MYSTERY_SPECIALS, raw.special);
		return special ? { type: 'special', special, weight: w } : undefined;
	}
	return undefined;
};

const mystery = (raw: unknown): MysterySpecial | undefined => {
	if (!isObject(raw)) return undefined;
	return withReels<MysterySpecial>(
		{ reveals: list(raw.reveals, mysteryReveal), unlocksInactive: raw.unlocksInactive === true },
		raw,
	);
};

const addRespins = (raw: unknown): AddRespinsSpecial | undefined => {
	if (!isObject(raw)) return undefined;
	return withReels<AddRespinsSpecial>(
		{
			values: values(raw.values),
			raisesCap: raw.raisesCap === true,
			sticky: raw.sticky === true,
			landsInBaseGame: raw.landsInBaseGame === true,
		},
		raw,
	);
};

const upgradeTarget = (raw: unknown): UpgradeSpecial['targets'][number] | undefined => {
	if (!isObject(raw)) return undefined;
	const target = oneOf(UPGRADE_TARGETS, raw.target);
	const w = weight(raw.weight);
	return target && w !== undefined ? { target, weight: w } : undefined;
};

const upgrade = (raw: unknown): UpgradeSpecial | undefined => {
	if (!isObject(raw)) return undefined;
	const targets = list(raw.targets, upgradeTarget).filter(
		(t, i, all) => all.findIndex((o) => o.target === t.target) === i,
	);
	return withReels<UpgradeSpecial>(
		{ targets, values: values(raw.values), landsInBaseGame: raw.landsInBaseGame === true },
		raw,
	);
};

const specialsBlock = (raw: unknown): HoldAndWinSpecials => {
	if (!isObject(raw)) return {};
	const out: HoldAndWinSpecials = {};
	const c = collector(raw.collector);
	if (c) out.collector = c;
	const m = multiplier(raw.multiplier);
	if (m) out.multiplier = m;
	const p = payer(raw.payer);
	if (p) out.payer = p;
	const y = mystery(raw.mystery);
	if (y) out.mystery = y;
	const a = addRespins(raw.addRespins);
	if (a) out.addRespins = a;
	const u = upgrade(raw.upgrade);
	if (u) out.upgrade = u;
	return out;
};

const meter = (raw: unknown): HoldAndWinMeter | undefined => {
	if (!isObject(raw)) return undefined;
	const id = text(raw.id);
	const symbol = text(raw.symbol);
	const maxLevel = int(raw.maxLevel, 1);
	const activates = oneOf(HOLD_AND_WIN_SPECIALS, raw.activates);
	if (!id || !symbol || maxLevel === undefined || !activates) return undefined;
	const stages = unique(list(raw.sizeStages, (s) => int(s, 1))).sort((a, b) => a - b);
	return { id, symbol, maxLevel, sizeStages: stages, activates };
};

const wheelPrize = (raw: unknown): WheelPrize | undefined => {
	if (!isObject(raw)) return undefined;
	const w = weight(raw.weight);
	if (w === undefined) return undefined;
	if (raw.type === 'coinBoost') {
		const factor = positive(raw.multiplier);
		return factor !== undefined ? { type: 'coinBoost', multiplier: factor, weight: w } : undefined;
	}
	if (raw.type === 'extraCollect') {
		const count = int(raw.count, 1);
		return count !== undefined ? { type: 'extraCollect', count, weight: w } : undefined;
	}
	if (raw.type === 'jackpot') {
		const name = text(raw.jackpot);
		return name ? { type: 'jackpot', jackpot: name, weight: w } : undefined;
	}
	return undefined;
};

const expansion = (raw: unknown): HoldAndWinExpansion | undefined => {
	if (!isObject(raw)) return undefined;
	const startRows = int(raw.startRows, 1);
	const maxRows = int(raw.maxRows, 1);
	const rule = oneOf(EXPANSION_RULES, raw.rule);
	if (startRows === undefined || maxRows === undefined || !rule) return undefined;
	const out: HoldAndWinExpansion = {
		startRows,
		maxRows,
		rule,
		resetsRespins: raw.resetsRespins !== false,
	};
	if (rule === 'coinCount') out.thresholds = list(raw.thresholds, (t) => int(t, 1));
	if (rule === 'unlockSymbol') {
		const onReels = reels(raw.unlockReels);
		if (onReels) out.unlockReels = onReels;
	}
	const rowJackpots = list(raw.rowJackpots, (entry): RowJackpot | undefined => {
		if (!isObject(entry)) return undefined;
		const rows = int(entry.rows, 1);
		const name = text(entry.jackpot);
		return rows !== undefined && name ? { rows, jackpot: name } : undefined;
	});
	if (rowJackpots.length) out.rowJackpots = rowJackpots;
	return out;
};

/**
 * Canonicalize a `holdAndWin` block, or `undefined` when there is none. Any object normalizes to a
 * full block (defaults filled: 3 respins resetting on a new coin, every coin sticks, no board end),
 * because the block's PRESENCE is what makes a project a Hold and Win game — a half-typed block is
 * still that game, and the validator names what it is missing.
 */
export function normalizeHoldAndWin(raw: unknown): HoldAndWin | undefined {
	if (!isObject(raw)) return undefined;
	const configured = specialsBlock(raw.specials);
	const active = isObject(raw.activeModifiers) ? raw.activeModifiers : {};
	const out: HoldAndWin = {
		trigger: trigger(raw.trigger),
		stickiness: oneOf(STICKINESS, raw.stickiness) ?? 'allCoins',
		respins: respins(raw.respins),
		boardEnd: boardEnd(raw.boardEnd),
		coins: list(raw.coins, coin),
		jackpots: list(raw.jackpots, jackpot),
		specials: configured,
		// Absent ⇒ the canonical order over whatever is configured, so a block that never states an
		// order still resolves one; an authored order is kept as written (the validator checks it).
		applyOrder: Array.isArray(raw.applyOrder)
			? specials(raw.applyOrder)
			: HOLD_AND_WIN_SPECIALS.filter((s) => configured[s]),
		activeModifiers: {
			atEntry: specials(active.atEntry),
			fromTriggeringSpecials: active.fromTriggeringSpecials === true,
		},
	};
	const meters = list(raw.meters, meter);
	if (meters.length) out.meters = meters;
	if (isObject(raw.wheel)) {
		const prizes = list(raw.wheel.prizes, wheelPrize);
		if (prizes.length) out.wheel = { prizes };
	}
	const grows = expansion(raw.expansion);
	if (grows) out.expansion = grows;
	return out;
}

// ─── read helpers ─────────────────────────────────────────────────────────────────────────────

/** The Hold and Win roles a symbol carries. */
export const symbolHoldAndWinRoles = (
	symbol: { special_properties?: string[] } | undefined,
): HoldAndWinSymbolRole[] =>
	(symbol?.special_properties ?? []).filter((p): p is HoldAndWinSymbolRole =>
		HOLD_AND_WIN_SYMBOL_ROLES.includes(p as HoldAndWinSymbolRole),
	);

/** Every dictionary symbol carrying `role`, sorted. */
export const symbolsWithRole = (
	doc: Pick<GameConfigDoc, 'symbols'>,
	role: HoldAndWinSymbolRole,
): string[] =>
	Object.entries(doc.symbols)
		.filter(([, symbol]) => symbol.special_properties?.includes(role))
		.map(([name]) => name)
		.sort();

/** Does the symbol carry any Hold and Win role? Such a symbol pays by its value, never on a line,
 *  so the paytable shows it as the coin value table rather than as pays. */
export const isHoldAndWinSymbol = (
	symbol: { special_properties?: string[] } | undefined,
): boolean => symbolHoldAndWinRoles(symbol).length > 0;

/** A coin entry's label as the board would print it: `1.5×` or `MINI`. */
export const coinEntryLabel = (entry: CoinValueEntry): string =>
	entry.kind === 'cash' ? `${entry.value}×` : entry.jackpot;

/** The jackpot tiers, lowest prize first — the ladder a `jackpotTier` upgrade climbs. */
export const jackpotLadder = (block: Pick<HoldAndWin, 'jackpots'>): string[] =>
	[...block.jackpots].sort((a, b) => a.multiplier - b.multiplier).map((j) => j.name);

/** The rows the respin board can reach: `maxRows` when it expands, else the grid's. */
export const respinBoardMaxRows = (doc: Pick<GameConfigDoc, 'numRows' | 'holdAndWin'>): number =>
	doc.holdAndWin?.expansion?.maxRows ?? doc.numRows[0] ?? 0;

/** The feature's special kinds a game uses, in apply order — the mechanics a profile names. */
export const configuredSpecials = (block: HoldAndWin): HoldAndWinSpecial[] =>
	HOLD_AND_WIN_SPECIALS.filter((s) => block.specials[s]);

/**
 * Is the `holdAndWin` block the pots overlay's BONUS rather than the base game
 * (`docs/design/pots-overlay.md` §3.1)? It is when an overlay is present and the base game's strips
 * deal no Hold and Win symbol: the host's own mock deals the base game, and the feature is reached
 * only through the overlay. A Hold and Win game that adds an overlay keeps its base-game block.
 * Decided from the data, here only, so the validator, the mock, the facade and the runtime agree.
 */
export const holdAndWinIsOverlayBonus = (doc: GameConfigDoc): boolean =>
	Boolean(doc.potsOverlay) &&
	!symbolsInPlayForGameType(
		doc,
		gameTypeForMode(gameModeById(doc, BASE_GAME_MODE) ?? { id: BASE_GAME_MODE }),
	).some((name) => isHoldAndWinSymbol(doc.symbols[name]));

// ─── validate ─────────────────────────────────────────────────────────────────────────────────

/**
 * Internal consistency of a normalized doc's `holdAndWin` block. Every `error` is a config the mock
 * could not generate a round from or the board could not show; every `warning` is one that renders
 * but has a knob that does nothing.
 *
 * Beside a `potsOverlay` block, a pot routed to Hold and Win also starts the feature. When the block
 * is the overlay's BONUS ({@link holdAndWinIsOverlayBonus}) the host's own mock deals the base game:
 * the lines-only rule does not apply, the feature starts only from a pot or from dropped coins, and
 * the base-board-only options — symbol-filled meters among them — are refused.
 */
export function validateHoldAndWin(doc: GameConfigDoc): GameConfigIssue[] {
	const block = doc.holdAndWin;
	if (!block) return [];
	const overlay = doc.potsOverlay;
	const asBonus = holdAndWinIsOverlayBonus(doc);
	const issues: GameConfigIssue[] = [];
	const error = (path: string, message: string) =>
		issues.push({ severity: 'error', path: `holdAndWin.${path}`, message });
	const warning = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: `holdAndWin.${path}`, message });

	const tagged = (role: HoldAndWinSymbolRole) => symbolsWithRole(doc, role);
	const jackpotNames = new Set(block.jackpots.map((j) => j.name));
	const checkJackpot = (path: string, name: string) => {
		if (!jackpotNames.has(name)) error(path, `"${name}" is not one of the jackpot tiers.`);
	};
	const checkReel = (path: string, reel: number, what: string) => {
		if (reel >= doc.numReels) {
			error(path, `${what} reel ${reel + 1}, but the grid is ${doc.numReels} reels wide.`);
		}
	};
	const checkTable = (path: string, table: WeightedValue[], what: string) => {
		if (!table.length) error(path, `${what} has no values.`);
		else if (!table.some((v) => v.weight > 0))
			error(path, `${what} has no value with a weight above 0.`);
	};

	if (!asBonus && doc.winModel && doc.winModel.type !== 'lines') {
		issues.push({
			severity: 'error',
			path: 'winModel',
			message: `A Hold and Win base game pays by lines, but this config pays by ${doc.winModel.type}.`,
		});
	}

	for (const [name, symbol] of Object.entries(doc.symbols)) {
		if (isHoldAndWinSymbol(symbol) && symbol.paytable?.length) {
			issues.push({
				severity: 'warning',
				path: `symbols.${name}.paytable`,
				message: `${name} is a Hold and Win symbol but carries a line paytable — it pays by its value, never on a line.`,
			});
		}
	}

	// Jackpots
	const seen = new Set<string>();
	block.jackpots.forEach((j, i) => {
		if (seen.has(j.name)) error(`jackpots.${i}.name`, `Jackpot "${j.name}" is listed twice.`);
		seen.add(j.name);
		const pool = j.progressive;
		if (!j.fixed && pool) {
			if (pool.cap !== undefined && pool.cap < pool.seed) {
				error(
					`jackpots.${i}.progressive.cap`,
					`"${j.name}" caps its pool at ${pool.cap}×, below its ${pool.seed}× seed.`,
				);
			}
			if (pool.contribution === 0) {
				warning(
					`jackpots.${i}.progressive.contribution`,
					`"${j.name}" is progressive but no bet contributes to it, so it always pays its ${pool.seed}× seed.`,
				);
			}
		}
	});

	// Coins. A symbol on no strip is unused (`symbolUses`) and never dealt, so it carries no coin.
	const inPlay = new Set(symbolsInPlay(doc));
	const dealt = (role: HoldAndWinSymbolRole) => tagged(role).filter((name) => inPlay.has(name));
	if (!tagged('coin').length && !tagged('jackpot').length) {
		error('coins', 'No symbol is tagged coin or jackpot, so no coin can ever land.');
	} else if (!dealt('coin').length && !dealt('jackpot').length) {
		error('coins', 'No coin or jackpot symbol is on a reel strip, so no coin can ever land.');
	} else if (!dealt('coin').length && block.coins.some((c) => c.kind === 'cash' && c.weight > 0)) {
		// The mock would deal it as the jackpot symbol, which the game values at nothing.
		error(
			'coins',
			tagged('coin').length
				? `The coin table has cash coins, but no coin symbol is on a reel strip (${tagged('coin').join(', ')} is unused), so they can never land.`
				: 'The coin table has cash coins, but no symbol is tagged coin, so they can never land.',
		);
	}
	if (!block.coins.length) error('coins', 'The coin value table is empty.');
	else if (!block.coins.some((c) => c.weight > 0)) {
		error('coins', 'No coin value has a weight above 0.');
	}
	block.coins.forEach((c, i) => {
		if (c.kind === 'jackpot') checkJackpot(`coins.${i}.jackpot`, c.jackpot);
		c.reels?.forEach((r) => checkReel(`coins.${i}.reels`, r, 'This coin lands on'));
	});
	const allReels = [...Array(doc.numReels).keys()];
	const coinReels = new Set(block.coins.flatMap((c) => c.reels ?? allReels));
	/** The reels a symbol of `role` can land on — the pattern trigger asks this per requirement. */
	const roleReels = (role: HoldAndWinSymbolRole): Set<number> => {
		if (role === 'coin' || role === 'jackpot') return coinReels;
		const kind = HOLD_AND_WIN_SPECIALS.find((k) => SPECIAL_SYMBOL_ROLE[k] === role);
		return new Set((kind && block.specials[kind]?.reels) || allReels);
	};

	// The respin board is one cell per row of a rectangular board; a stepped grid is refused rather
	// than drawn wrong (decided in Hold and Win Phase 4 polish — no reference game is stepped).
	if (doc.numRows.some((rows) => rows !== doc.numRows[0])) {
		error(
			'grid',
			`Hold and Win needs the same number of rows on every reel (the grid is ${doc.numRows.join('/')}).`,
		);
	}

	// Trigger
	const t = block.trigger;
	const potRoute = Boolean(overlay?.pots.some((p) => p.bonus.mode === HOLD_AND_WIN_MODE));
	const coinDrops = Boolean(overlay?.drops.table.some((e) => 'coin' in e));
	const baseTriggers = Boolean(
		t.count || t.pattern || t.buy?.length || t.randomMetre || t.luckySpin || block.meters?.length,
	);
	if (!(potRoute || (asBonus ? t.count && coinDrops : baseTriggers))) {
		error(
			'trigger',
			asBonus
				? 'Nothing can start the feature — route a pot to Hold and Win, or drop value coins for the count trigger.'
				: 'Nothing can start the feature — add a trigger.',
		);
	}
	if (asBonus) {
		const notForOverlay = (path: string, what: string) =>
			error(path, `${what} is not built for an overlay host yet.`);
		if (t.pattern) notForOverlay('trigger.pattern', 'A pattern trigger');
		if (t.luckySpin) notForOverlay('trigger.luckySpin', 'A lucky spin');
		if (t.randomMetre) notForOverlay('trigger.randomMetre', 'A random metre');
		if (t.buy?.length) notForOverlay('trigger.buy', 'Buying the feature');
		for (const kind of ['collector', 'multiplier'] as const) {
			if (block.specials[kind]?.instantCollectInBaseGame) {
				notForOverlay(
					`specials.${kind}.instantCollectInBaseGame`,
					`The ${kind}'s instant collect in the base game`,
				);
			}
		}
		if (block.meters?.length) {
			error(
				'meters',
				'A meter filled by a landing symbol is not built for an overlay host yet — make it a pot of the overlay.',
			);
		}
		if (t.count && !coinDrops) {
			warning(
				'trigger.count',
				'The count trigger counts dropped value coins, but the overlay drops none, so it never fires.',
			);
		}
	}
	const cells = doc.numRows.reduce((sum, rows) => sum + rows, 0);
	const noBlank = (path: string, counted: HoldAndWinSymbolRole[]) => {
		if (counted.includes('blank')) error(path, 'A blank is an empty cell — it cannot count here.');
	};
	if (t.count) {
		if (!t.count.roles.length)
			error('trigger.count.roles', 'The count trigger counts no symbol roles.');
		noBlank('trigger.count.roles', t.count.roles);
		if (t.count.min > cells) {
			error(
				'trigger.count.min',
				`The trigger needs ${t.count.min} symbols but the board only has ${cells} cells.`,
			);
		}
		for (const role of t.count.roles) {
			if (!tagged(role).length) {
				warning(
					'trigger.count.roles',
					`The trigger counts "${role}" but no symbol carries that role.`,
				);
			}
		}
	}
	t.pattern?.forEach((req, i) => {
		checkReel(`trigger.pattern.${i}.reel`, req.reel, 'The pattern needs a symbol on');
		if (!req.roles.length) error(`trigger.pattern.${i}.roles`, 'This requirement names no role.');
		noBlank(`trigger.pattern.${i}.roles`, req.roles);
		const rows = doc.numRows[req.reel] ?? 0;
		if (req.reel < doc.numReels && req.min > rows) {
			error(
				`trigger.pattern.${i}.min`,
				`The pattern needs ${req.min} symbols on reel ${req.reel + 1}, which has ${rows} rows.`,
			);
		}
		if (req.reel < doc.numReels && !req.roles.some((r) => roleReels(r).has(req.reel))) {
			error(
				`trigger.pattern.${i}.reel`,
				`The pattern needs ${req.roles.join(' or ')} on reel ${req.reel + 1}, but none of them lands there.`,
			);
		}
	});
	t.buy?.forEach((tier, i) => {
		const mode = doc.betModes[tier.mode];
		if (!mode) error(`trigger.buy.${i}.mode`, `Bet mode "${tier.mode}" does not exist.`);
		else if (!mode.buyBonus) {
			error(`trigger.buy.${i}.mode`, `Bet mode "${tier.mode}" is not a buy-bonus mode.`);
		}
		const guaranteed = tier.guaranteed.reduce((sum, g) => sum + g.count, 0);
		if (guaranteed > cells) {
			error(
				`trigger.buy.${i}.guaranteed`,
				`Guarantees ${guaranteed} symbols on a ${cells}-cell board.`,
			);
		}
		for (const g of tier.guaranteed) {
			if (g.role === 'blank' || g.role === 'meterSpecial' || g.role === 'unlock') {
				error(
					`trigger.buy.${i}.guaranteed`,
					`A buy can guarantee coins, jackpots and specials, not a "${g.role}".`,
				);
			} else if (!tagged(g.role).length) {
				error(
					`trigger.buy.${i}.guaranteed`,
					`Guarantees a "${g.role}" but no symbol carries that role.`,
				);
			}
		}
	});

	// Respins
	if (block.respins.cap !== undefined && block.respins.cap < block.respins.start) {
		error(
			'respins.cap',
			`The cap (${block.respins.cap}) is below the starting count (${block.respins.start}).`,
		);
	}

	// Specials — each configured special needs a symbol, and each tagged symbol needs its table.
	for (const kind of HOLD_AND_WIN_SPECIALS) {
		const role = SPECIAL_SYMBOL_ROLE[kind];
		const configured = Boolean(block.specials[kind]);
		const symbols = tagged(role);
		if (configured && !symbols.length) {
			error(`specials.${kind}`, `The ${kind} is configured but no symbol is tagged "${role}".`);
		}
		if (!configured && symbols.length) {
			warning(
				`specials.${kind}`,
				`${symbols.join(', ')} ${symbols.length > 1 ? 'are' : 'is'} tagged "${role}" but the ${kind} is not configured, so it does nothing.`,
			);
		}
	}
	for (const kind of HOLD_AND_WIN_SPECIALS) {
		block.specials[kind]?.reels?.forEach((r) =>
			checkReel(`specials.${kind}.reels`, r, `The ${kind} lands on`),
		);
	}
	const {
		collector: col,
		multiplier: mul,
		payer: pay,
		mystery: mys,
		addRespins: add,
		upgrade: upg,
	} = block.specials;
	if (block.stickiness === 'collectorsOnly' && (!col || !col.sticky)) {
		error(
			'stickiness',
			'Only collectors stick, but there is no sticky collector — nothing would ever stay on the board.',
		);
	}
	if (block.stickiness === 'collectorsOnly' && col?.collects === 'atEnd') {
		warning(
			'specials.collector.collects',
			'Coins are cleared every respin but the collector only gathers at the end, so every coin before the last respin is lost.',
		);
	}
	if (col && col.level > col.maxLevel) {
		error('specials.collector.level', 'The collector starts above its maximum level.');
	}
	if (mul) {
		checkTable('specials.multiplier.values', mul.values, 'The multiplier');
		if (mul.leaveBehind.type === 'becomesCoin') {
			checkTable(
				'specials.multiplier.leaveBehind.values',
				mul.leaveBehind.values,
				'The coin a multiplier leaves',
			);
		}
	}
	if (pay) checkTable('specials.payer.values', pay.values, 'The payer');
	if (add) {
		checkTable('specials.addRespins.values', add.values, 'The add-respins');
		add.values.forEach((v, i) => {
			if (!Number.isInteger(v.value)) {
				error(
					`specials.addRespins.values.${i}.value`,
					`${v.value} is not a whole number of respins.`,
				);
			}
		});
	}
	if (upg) {
		if (!upg.targets.length) error('specials.upgrade.targets', 'The upgrade has no target rule.');
		else if (!upg.targets.some((t) => t.weight > 0))
			error('specials.upgrade.targets', 'No upgrade target rule has a weight above 0.');
		if (upg.targets.some((t) => t.target !== 'jackpotTier'))
			checkTable('specials.upgrade.values', upg.values, 'The upgrade step');
		if (upg.targets.some((t) => t.target === 'jackpotTier') && block.jackpots.length < 2) {
			error(
				'specials.upgrade.targets',
				'A jackpot-tier upgrade needs at least two jackpot tiers to step between.',
			);
		}
	}
	if (mys) {
		if (!mys.reveals.length)
			error('specials.mystery.reveals', 'The mystery has nothing to reveal.');
		mys.reveals.forEach((r, i) => {
			if (r.type === 'jackpot') checkJackpot(`specials.mystery.reveals.${i}.jackpot`, r.jackpot);
			if (r.type === 'special' && !block.specials[r.special]) {
				error(
					`specials.mystery.reveals.${i}.special`,
					`The mystery can reveal a ${r.special}, which is not configured.`,
				);
			}
		});
	}

	// Apply order + active modifiers
	const configuredKinds = configuredSpecials(block);
	for (const kind of configuredKinds) {
		if (!block.applyOrder.includes(kind)) {
			error('applyOrder', `The ${kind} is configured but missing from the apply order.`);
		}
	}
	for (const kind of block.applyOrder) {
		if (!block.specials[kind])
			warning('applyOrder', `The apply order names the ${kind}, which is not configured.`);
	}
	for (const kind of block.activeModifiers.atEntry) {
		if (!block.specials[kind]) {
			error('activeModifiers.atEntry', `The ${kind} is active at entry but is not configured.`);
		}
	}
	if (configuredKinds.length) {
		const canActivate =
			block.activeModifiers.atEntry.length > 0 ||
			block.activeModifiers.fromTriggeringSpecials ||
			Boolean(block.trigger.buy?.some((tier) => tier.guaranteed.length)) ||
			Boolean(block.meters?.length) ||
			Boolean(overlay?.pots.some((p) => p.bonus.mode === HOLD_AND_WIN_MODE && p.bonus.activates)) ||
			Boolean(block.wheel) ||
			Boolean(mys?.unlocksInactive);
		if (!canActivate) {
			warning(
				'activeModifiers',
				'No special is active at entry and nothing activates one, so no special can land in the feature.',
			);
		}
	}

	// Board end
	const end = block.boardEnd;
	if (end.type === 'fullBoardJackpot') {
		checkJackpot('boardEnd.jackpot', end.jackpot);
		if (!end.roles.length) error('boardEnd.roles', 'The full board counts no symbol roles.');
		noBlank('boardEnd.roles', end.roles);
		if (block.stickiness === 'collectorsOnly' && end.roles.every((r) => r !== 'collector')) {
			warning(
				'boardEnd',
				'Coins are cleared every respin, so the board can only fill with collectors.',
			);
		}
	}
	if (end.type === 'columnLetters') {
		checkJackpot('boardEnd.jackpot', end.jackpot);
		if ([...end.letters].length !== doc.numReels) {
			error(
				'boardEnd.letters',
				`"${end.letters}" has ${[...end.letters].length} letters but the grid has ${doc.numReels} reels — one letter per reel.`,
			);
		}
	}

	// Meters
	const meterIds = new Set<string>();
	block.meters?.forEach((m, i) => {
		if (meterIds.has(m.id)) error(`meters.${i}.id`, `Meter "${m.id}" is listed twice.`);
		meterIds.add(m.id);
		const symbol = doc.symbols[m.symbol];
		if (!symbol) error(`meters.${i}.symbol`, `${m.symbol} is not in the symbol dictionary.`);
		else if (!symbol.special_properties?.includes('meterSpecial')) {
			warning(`meters.${i}.symbol`, `${m.symbol} fills a meter but is not tagged "meterSpecial".`);
		}
		if (!block.specials[m.activates]) {
			error(
				`meters.${i}.activates`,
				`A full ${m.id} meter activates the ${m.activates}, which is not configured.`,
			);
		}
		if (m.sizeStages.some((s) => s >= m.maxLevel)) {
			error(
				`meters.${i}.sizeStages`,
				`A size stage is at or past the maximum level (${m.maxLevel}).`,
			);
		}
	});

	// Wheel
	if (block.wheel) {
		if (!block.wheel.prizes.some((p) => p.weight > 0))
			error('wheel.prizes', 'No wheel prize has a weight above 0.');
		block.wheel.prizes.forEach((p, i) => {
			if (p.type === 'jackpot') checkJackpot(`wheel.prizes.${i}.jackpot`, p.jackpot);
			if (p.type === 'extraCollect') {
				if (!col) {
					error(`wheel.prizes.${i}`, 'An extra-collect prize needs a collector.');
				} else if (col.level + p.count > col.maxLevel) {
					error(
						`wheel.prizes.${i}.count`,
						`+${p.count} collect would take the collector past its maximum level (${col.maxLevel}).`,
					);
				}
			}
		});
	}

	// Board expansion
	const grow = block.expansion;
	const unlockSymbols = tagged('unlock');
	if (unlockSymbols.length && grow?.rule !== 'unlockSymbol') {
		warning(
			'expansion',
			`${unlockSymbols.join(', ')} ${unlockSymbols.length > 1 ? 'are' : 'is'} tagged "unlock" but no unlock-symbol board expansion is configured, so it does nothing.`,
		);
	}
	if (grow) {
		const gridRows = doc.numRows[0] ?? 0;
		if (grow.startRows !== gridRows) {
			error(
				'expansion.startRows',
				`The board starts at ${grow.startRows} rows but the grid has ${gridRows} — the base game plays the starting rows.`,
			);
		}
		if (grow.maxRows < grow.startRows) {
			error(
				'expansion.maxRows',
				`The board grows to ${grow.maxRows} rows, fewer than it starts with (${grow.startRows}).`,
			);
		} else if (grow.maxRows === grow.startRows) {
			warning('expansion.maxRows', 'The board starts at its maximum, so no row ever unlocks.');
		}
		const opens = Math.max(0, grow.maxRows - grow.startRows);
		if (end.type === 'columnLetters') {
			error(
				'expansion',
				'Column letters need a fixed column height; an expanding board ends on a full board or not at all.',
			);
		}
		if (grow.rule === 'fullRow' && block.stickiness === 'collectorsOnly') {
			error(
				'expansion.rule',
				'Coins are cleared every respin, so a row can never fill — pick another unlock rule.',
			);
		}
		if (grow.rule === 'coinCount') {
			const thresholds = grow.thresholds ?? [];
			if (thresholds.length !== opens) {
				error(
					'expansion.thresholds',
					`${opens} row${opens === 1 ? '' : 's'} can unlock, so the count rule needs ${opens} threshold${opens === 1 ? '' : 's'} (it has ${thresholds.length}).`,
				);
			}
			thresholds.forEach((t, i) => {
				if (i > 0 && t <= thresholds[i - 1]) {
					error(
						`expansion.thresholds.${i}`,
						`Each threshold must be above the one before (${t} after ${thresholds[i - 1]}).`,
					);
				}
				const room = doc.numReels * (grow.startRows + i);
				if (t > room) {
					error(
						`expansion.thresholds.${i}`,
						`${t} held symbols can never be reached: the ${grow.startRows + i} open rows hold ${room}.`,
					);
				}
			});
			if (block.stickiness === 'collectorsOnly') {
				warning(
					'expansion.rule',
					'Coins are cleared every respin, so a threshold counts the collectors plus what that respin landed.',
				);
			}
		}
		if (grow.rule === 'unlockSymbol') {
			if (!unlockSymbols.length) {
				error(
					'expansion.rule',
					'Rows unlock on an unlock symbol, but no symbol is tagged "unlock".',
				);
			}
			grow.unlockReels?.forEach((r) =>
				checkReel('expansion.unlockReels', r, 'The unlock symbol lands on'),
			);
		}
		const jackpotRows = new Set<number>();
		grow.rowJackpots?.forEach((rj, i) => {
			checkJackpot(`expansion.rowJackpots.${i}.jackpot`, rj.jackpot);
			if (jackpotRows.has(rj.rows)) {
				error(`expansion.rowJackpots.${i}.rows`, `Reaching ${rj.rows} rows pays twice.`);
			}
			jackpotRows.add(rj.rows);
			if (rj.rows <= grow.startRows || rj.rows > grow.maxRows) {
				error(
					`expansion.rowJackpots.${i}.rows`,
					`Row ${rj.rows} never unlocks: the board grows from ${grow.startRows} to ${grow.maxRows} rows.`,
				);
			}
		});
	}

	return issues;
}
