/**
 * The COIN OVERLAY — an option a base game switches on (`docs/design/bonus-games.md` §1, §2.1). It
 * decides what lands in the base game and what TRIGGERS a bonus; it never plays one. Its styles:
 * `classic` (coins land on the reels, N+ start the bonus), `pots` (tokens fill pots, a full pot starts
 * its bonus) and `collector` (a collector beside coins starts it).
 *
 * It is the legacy `potsOverlay` block (pots, drops, timing) plus the trigger half of the legacy
 * `holdAndWin` block: the base-game coin values, what each special does in the base game, the
 * triggers and the symbol-filled meters. EVERY route names the mode it starts — a pot's
 * `bonus.mode`, a trigger's `mode`, a meter's `mode` — so a project can start several bonus modes.
 *
 * Whether coins land on the REELS is not a field: it is what the base game's strips deal, as it was
 * before the split (`holdAndWinIsOverlayBonus`), so it can never disagree with the strips.
 *
 * Normalization is STRUCTURAL, as in every block here; a route to a mode the project lacks is the
 * validator's to report (`./bonusGames`).
 */

import {
	HOLD_AND_WIN_SPECIALS,
	normalizeCoinTable,
	normalizeHoldAndWinMeter,
	normalizeHoldAndWinTrigger,
	type BuyTier,
	type CoinValueEntry,
	type CountTrigger,
	type HoldAndWinMeter,
	type HoldAndWinSpecial,
	type HoldAndWinTrigger,
	type PatternRequirement,
} from './holdAndWin';
import type {
	BaseGameSpecialFlags,
	BaseGameSpecials,
	HoldAndWinTriggerHalf,
} from './holdAndWinGame';
import {
	normalizeOverlayDrops,
	normalizeOverlayPot,
	type OverlayDrops,
	type OverlayPot,
	type OverlayTiming,
	type PotsOverlay,
} from './potsOverlay';

export const COIN_OVERLAY_STYLES = ['classic', 'pots', 'collector'] as const;
export type CoinOverlayStyle = (typeof COIN_OVERLAY_STYLES)[number];

/** "N+ coins" — starts `mode`. */
export type CountRoute = CountTrigger & { mode: string };
/** Every requirement on the same spin — starts `mode`. */
export type PatternRoute = { mode: string; requirements: PatternRequirement[] };
/** A buy tier: `betMode` is the `betModes` key whose cost is the price; `mode` the bonus it starts. */
export type BuyRoute = Omit<BuyTier, 'mode'> & { betMode: string; mode: string };
/** A random server-side trigger dressed as a metre — starts `mode`. */
export type RandomMetreRoute = { name: string; mode: string };
/** A server-announced spin that guarantees the trigger — starts `mode`. */
export type LuckySpinRoute = { mode: string };

export type CoinOverlayTrigger = {
	count?: CountRoute;
	pattern?: PatternRoute;
	buy?: BuyRoute[];
	randomMetre?: RandomMetreRoute;
	luckySpin?: LuckySpinRoute;
};

/** A meter filled by a LANDING symbol (3 Pots of Egypt); a full one starts `mode` with
 *  `activates` on. A pot filled by a DROPPED token is an {@link OverlayPot}. */
export type CoinMeter = HoldAndWinMeter & { mode: string };

export type CoinOverlay = {
	style: CoinOverlayStyle;
	/** Pots filled by dropped tokens. Absent ⇒ none. */
	pots?: OverlayPot[];
	/** What drops over the board. Absent ⇒ nothing drops: coins only land on the reels. Present
	 *  whenever there is a pot, as in the legacy block. */
	drops?: OverlayDrops;
	/** Absent ⇒ `afterStop`. Only with `drops`. */
	timing?: OverlayTiming;
	/** The base game's coin values. Absent ⇒ the coin table of the respin mode the coins start. */
	coins?: CoinValueEntry[];
	/** What each special does in the base game. Absent ⇒ none lands there. */
	baseGame?: BaseGameSpecials;
	trigger?: CoinOverlayTrigger;
	meters?: CoinMeter[];
};

/** Every mode one of the overlay's routes starts, with where the route is — pots included. */
export type OverlayRoute = { path: string; mode: string };

// ─── normalize ────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

const list = <T>(raw: unknown, read: (entry: unknown) => T | undefined): T[] =>
	Array.isArray(raw) ? raw.map(read).filter((e): e is T => e !== undefined) : [];

/** The kinds whose legacy table carries an instant collect; the rest only land. */
const INSTANT_COLLECT: readonly HoldAndWinSpecial[] = ['collector', 'multiplier'];

function baseGameSpecials(raw: unknown): BaseGameSpecials | undefined {
	if (!isObject(raw)) return undefined;
	const out: BaseGameSpecials = {};
	for (const kind of HOLD_AND_WIN_SPECIALS) {
		const entry = raw[kind];
		if (!isObject(entry) || kind === 'mystery') continue;
		const flags: BaseGameSpecialFlags = {};
		if (entry.landsInBaseGame === true) flags.landsInBaseGame = true;
		if (entry.instantCollectInBaseGame === true && INSTANT_COLLECT.includes(kind)) {
			flags.instantCollectInBaseGame = true;
		}
		if (Object.keys(flags).length) out[kind] = flags;
	}
	return Object.keys(out).length ? out : undefined;
}

/** One trigger slot through the legacy reader, so a route parses exactly as the block's did. */
const legacySlot = <K extends keyof HoldAndWinTrigger>(
	key: K,
	value: unknown,
): HoldAndWinTrigger[K] => normalizeHoldAndWinTrigger({ [key]: value })[key];

function routes(raw: unknown): CoinOverlayTrigger | undefined {
	if (!isObject(raw)) return undefined;
	const out: CoinOverlayTrigger = {};
	const modeOf = (entry: unknown) => (isObject(entry) ? text(entry.mode) : undefined);

	const countMode = modeOf(raw.count);
	const count = countMode && legacySlot('count', raw.count);
	if (count) out.count = { ...count, mode: countMode };

	const patternMode = modeOf(raw.pattern);
	const pattern =
		patternMode && isObject(raw.pattern) && legacySlot('pattern', raw.pattern.requirements);
	if (pattern) out.pattern = { mode: patternMode, requirements: pattern };

	const buy = list(raw.buy, (entry): BuyRoute | undefined => {
		const mode = modeOf(entry);
		if (!mode || !isObject(entry)) return undefined;
		const tier = legacySlot('buy', [{ ...entry, mode: entry.betMode }])?.[0];
		if (!tier) return undefined;
		const { mode: betMode, ...rest } = tier;
		return { betMode, mode, ...rest };
	});
	if (buy.length) out.buy = buy;

	const metreMode = modeOf(raw.randomMetre);
	const metre = metreMode && legacySlot('randomMetre', raw.randomMetre);
	if (metre) out.randomMetre = { ...metre, mode: metreMode };

	const luckyMode = modeOf(raw.luckySpin);
	if (luckyMode) out.luckySpin = { mode: luckyMode };

	return Object.keys(out).length ? out : undefined;
}

const coinMeter = (raw: unknown): CoinMeter | undefined => {
	const mode = isObject(raw) ? text(raw.mode) : undefined;
	const meter = mode ? normalizeHoldAndWinMeter(raw) : undefined;
	return meter && mode ? { ...meter, mode } : undefined;
};

/**
 * The style an overlay reads as when none is stored: pots when something fills a pot, collector when
 * a collector starts the bonus, else classic.
 */
export function inferCoinOverlayStyle(overlay: Omit<CoinOverlay, 'style'>): CoinOverlayStyle {
	if (overlay.pots?.length || overlay.meters?.length) return 'pots';
	const pattern = overlay.trigger?.pattern?.requirements ?? [];
	if (
		pattern.some((req) => req.roles.includes('collector')) ||
		overlay.baseGame?.collector?.instantCollectInBaseGame
	) {
		return 'collector';
	}
	return 'classic';
}

/**
 * Canonicalize a `coinOverlay` block, or `undefined` when it holds nothing. SPARSE: a pot brings its
 * drops (as the legacy block always had them), drops with no pot and an empty table are no drops, and
 * a timing only rides with drops — so every form normalizes to one doc, and the compat mirror
 * (`./bonusGames`) round-trips it.
 */
export function normalizeCoinOverlay(raw: unknown): CoinOverlay | undefined {
	if (!isObject(raw)) return undefined;
	const pots = list(raw.pots, normalizeOverlayPot);
	const dropsRaw =
		isObject(raw.drops) || pots.length ? normalizeOverlayDrops(raw.drops) : undefined;
	const drops = dropsRaw && (pots.length || dropsRaw.table.length) ? dropsRaw : undefined;
	const coins = Array.isArray(raw.coins) ? normalizeCoinTable(raw.coins) : undefined;
	const baseGame = baseGameSpecials(raw.baseGame);
	const trigger = routes(raw.trigger);
	const meters = list(raw.meters, coinMeter);

	const body: Omit<CoinOverlay, 'style'> = {
		...(pots.length ? { pots } : {}),
		...(drops ? { drops } : {}),
		...(drops && raw.timing === 'perReel' ? { timing: 'perReel' as const } : {}),
		...(coins ? { coins } : {}),
		...(baseGame ? { baseGame } : {}),
		...(trigger ? { trigger } : {}),
		...(meters.length ? { meters } : {}),
	};
	if (!Object.keys(body).length) return undefined;
	const style = COIN_OVERLAY_STYLES.find((s) => s === raw.style) ?? inferCoinOverlayStyle(body);
	return { style, ...body };
}

// ─── the legacy halves ────────────────────────────────────────────────────────────────────────

/** The legacy `potsOverlay` block the overlay's pots and drops make, or `undefined` without drops. */
export function legacyPotsOverlayOf(overlay: CoinOverlay | undefined): PotsOverlay | undefined {
	if (!overlay?.drops) return undefined;
	return structuredClone({
		pots: overlay.pots ?? [],
		drops: overlay.drops,
		...(overlay.timing ? { timing: overlay.timing } : {}),
	});
}

/** The legacy trigger half of the routes that start `mode` — what its legacy block carried. */
export function triggerHalfFor(
	overlay: CoinOverlay | undefined,
	mode: string,
): HoldAndWinTriggerHalf {
	const t = overlay?.trigger;
	const trigger: HoldAndWinTrigger = {};
	if (t?.count?.mode === mode) trigger.count = { min: t.count.min, roles: [...t.count.roles] };
	if (t?.pattern?.mode === mode) trigger.pattern = structuredClone(t.pattern.requirements);
	const buy = (t?.buy ?? [])
		.filter((tier) => tier.mode === mode)
		.map(({ betMode, mode: _mode, ...tier }): BuyTier =>
			structuredClone({ mode: betMode, ...tier }),
		);
	if (buy.length) trigger.buy = buy;
	if (t?.randomMetre?.mode === mode) trigger.randomMetre = { name: t.randomMetre.name };
	if (t?.luckySpin?.mode === mode) trigger.luckySpin = true;
	const meters = (overlay?.meters ?? [])
		.filter((m) => m.mode === mode)
		.map(({ mode: _mode, ...meter }) => structuredClone(meter));
	return {
		trigger,
		...(meters.length ? { meters } : {}),
		...(overlay?.baseGame ? { baseGame: structuredClone(overlay.baseGame) } : {}),
	};
}

/** The overlay's routes from a legacy trigger half, every one starting `mode`. */
export function routesFrom(
	half: HoldAndWinTriggerHalf,
	mode: string,
): Pick<CoinOverlay, 'trigger' | 'meters'> {
	const t = half.trigger;
	const trigger: CoinOverlayTrigger = {};
	if (t.count) trigger.count = { ...t.count, mode };
	if (t.pattern) trigger.pattern = { mode, requirements: t.pattern };
	if (t.buy?.length) {
		trigger.buy = t.buy.map(({ mode: betMode, ...tier }) => ({ betMode, mode, ...tier }));
	}
	if (t.randomMetre) trigger.randomMetre = { ...t.randomMetre, mode };
	if (t.luckySpin) trigger.luckySpin = { mode };
	const meters = (half.meters ?? []).map((m) => ({ ...m, mode }));
	return structuredClone({
		...(Object.keys(trigger).length ? { trigger } : {}),
		...(meters.length ? { meters } : {}),
	});
}

/** Every mode the overlay routes to, with the route's path — its pots, triggers and meters. */
export function overlayRoutes(overlay: CoinOverlay | undefined): OverlayRoute[] {
	if (!overlay) return [];
	const t = overlay.trigger;
	return [
		...(overlay.pots ?? []).map((p, i) => ({ path: `pots.${i}.bonus.mode`, mode: p.bonus.mode })),
		...(t?.count ? [{ path: 'trigger.count.mode', mode: t.count.mode }] : []),
		...(t?.pattern ? [{ path: 'trigger.pattern.mode', mode: t.pattern.mode }] : []),
		...(t?.buy ?? []).map((tier, i) => ({ path: `trigger.buy.${i}.mode`, mode: tier.mode })),
		...(t?.randomMetre ? [{ path: 'trigger.randomMetre.mode', mode: t.randomMetre.mode }] : []),
		...(t?.luckySpin ? [{ path: 'trigger.luckySpin.mode', mode: t.luckySpin.mode }] : []),
		...(overlay.meters ?? []).map((m, i) => ({ path: `meters.${i}.mode`, mode: m.mode })),
	];
}

/**
 * The overlay with every route's mode passed through `to` — its pots, triggers and meters. A route
 * `to` maps to `undefined` is dropped, and so is a pot. A fresh copy; the input is not touched.
 */
export function retargetRoutes(
	overlay: CoinOverlay,
	to: (mode: string) => string | undefined,
): CoinOverlay {
	const out = structuredClone(overlay);
	const kept = <T extends { mode: string }>(route: T | undefined): T | undefined => {
		const mode = route && to(route.mode);
		return route && mode ? { ...route, mode } : undefined;
	};
	const pots = (out.pots ?? []).flatMap((pot) => {
		const mode = to(pot.bonus.mode);
		return mode ? [{ ...pot, bonus: { ...pot.bonus, mode } }] : [];
	});
	if (out.pots) out.pots = pots;
	const t = out.trigger;
	if (t) {
		const slots = {
			count: kept(t.count),
			pattern: kept(t.pattern),
			randomMetre: kept(t.randomMetre),
			luckySpin: kept(t.luckySpin),
			buy: (t.buy ?? []).flatMap((tier) => kept(tier) ?? []),
		};
		out.trigger = Object.fromEntries(
			Object.entries(slots).filter(([, v]) => (Array.isArray(v) ? v.length : v)),
		) as CoinOverlayTrigger;
	}
	if (out.meters) out.meters = out.meters.flatMap((meter) => kept(meter) ?? []);
	return out;
}
