/**
 * THE COIN VALUE LABEL — how a Hold and Win symbol prints its value or jackpot tier on itself, as
 * authored in the Invisible Symbols State Machine (`doc.coinLabel`, design
 * `docs/design/hold-and-win.md` §5 Symbols SM row).
 *
 * One home for the shape, its coded defaults and its prune, shared by the tool (the setters and the
 * dirty signature), the server (`normalizeSymbolsDoc`) and the game (`apps/lines` `coinLabel.ts`), so
 * "what an untouched field means" cannot drift between them. Pure and dependency-free, the same
 * reason {@link ./tumblePattern} lives here.
 *
 * SPARSE everywhere: a field equal to its coded default is pruned, an empty sub-object is dropped,
 * and an untouched project persists no `coinLabel` key at all — so its board prints exactly the
 * label the engine coded before the block existed.
 */

export interface CoinLabelStyle {
	/** A bitmap font name: an engine builtin (`gold`) or a project Font Maker font. */
	font?: string;
	/** Font size as a multiple of the symbol size. */
	size?: number;
	/** `#rrggbb`, multiplied over the bitmap font. */
	tint?: string;
}

export const COIN_LABEL_CASH_FORMATS = ['money', 'betMultiple'] as const;
export type CoinLabelCashFormat = (typeof COIN_LABEL_CASH_FORMATS)[number];

export interface CoinLabelCash {
	/** `money` (default) = the player's currency; `betMultiple` = `1.5×`. */
	format?: CoinLabelCashFormat;
	/** The fewest decimals printed. Never cuts a non-zero digit — only trailing zeros beyond it. */
	decimals?: number;
	/** Drop every trailing fraction zero (`$3.00` → `$3`, `$1.50` → `$1.5`). */
	trimZeros?: boolean;
}

export interface CoinLabelJackpot {
	/** What the tier prints instead of its name; a multiplier's ` ×N` suffix is kept. */
	text?: string;
	/** Overrides the shared style field by field for this tier. */
	style?: CoinLabelStyle;
}

export interface CoinLabelPlacement {
	/** Offset from the cell centre, as a multiple of the symbol size. */
	x?: number;
	y?: number;
	/** Multiplies the whole label. */
	scale?: number;
	/** The widest the label may draw before it shrinks to fit, × symbol size. */
	maxWidth?: number;
}

export interface CoinLabelPop {
	enabled?: boolean;
	/** Peak scale of the pop. */
	scale?: number;
	/** Whole pop length (up and back), ms. */
	ms?: number;
}

export interface CoinLabelAnimation {
	/** The label pops as its coin lands and sticks on the respin board. */
	landPop?: CoinLabelPop;
	/** How long one label's count-up runs (a payer, a multiplier boost, a collect), ms. */
	countMs?: number;
	/** The label pops when a count-up lands on its new value. */
	boostPop?: CoinLabelPop;
}

export interface CoinLabelConfig {
	/** Cash coin / collector / payer / multiplier text. */
	style?: CoinLabelStyle;
	cash?: CoinLabelCash;
	/** Keyed by the jackpot tier name as the Game Config declares it (`MINI`). */
	jackpots?: Record<string, CoinLabelJackpot>;
	placement?: CoinLabelPlacement;
	animation?: CoinLabelAnimation;
}

/** What the engine prints with when nothing is authored. */
export const COIN_LABEL_DEFAULTS = {
	font: 'gold',
	size: 0.3,
	x: 0,
	y: 0,
	scale: 1,
	maxWidth: 0.9,
	popScale: 1.25,
	popMs: 260,
} as const;

/** The tiers the tool offers when the project's Game Config declares none. */
export const COIN_LABEL_FALLBACK_JACKPOTS = ['MINI', 'MINOR', 'MAJOR', 'GRAND'] as const;

/** Inclusive ranges an authored number is clamped into. */
export const COIN_LABEL_BOUNDS = {
	size: [0.05, 1.5],
	offset: [-1, 1],
	scale: [0.1, 4],
	maxWidth: [0.1, 2],
	decimals: [0, 4],
	popScale: [1, 3],
	popMs: [0, 2000],
	countMs: [0, 10000],
} as const satisfies Record<string, readonly [number, number]>;

const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (value: number, [min, max]: readonly [number, number]) =>
	Math.min(max, Math.max(min, value));

/** A finite number clamped into `range`, or undefined when it is not a number or equals `fallback`. */
const authored = (
	value: number | undefined,
	range: readonly [number, number],
	fallback?: number,
	integer = false,
): number | undefined => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const clamped = clamp(integer ? Math.round(value) : value, range);
	return clamped === fallback ? undefined : clamped;
};

const compact = <T extends object>(value: T): T | undefined =>
	Object.keys(value).length ? value : undefined;

export function pruneCoinLabelStyle(style: CoinLabelStyle | undefined): CoinLabelStyle | undefined {
	if (!style) return undefined;
	const next: CoinLabelStyle = {};
	const font = typeof style.font === 'string' ? style.font.trim() : '';
	if (font) next.font = font;
	const size = authored(style.size, COIN_LABEL_BOUNDS.size);
	if (size !== undefined) next.size = size;
	if (typeof style.tint === 'string' && HEX.test(style.tint)) next.tint = style.tint.toLowerCase();
	return compact(next);
}

function prunePop(pop: CoinLabelPop | undefined): CoinLabelPop | undefined {
	if (pop?.enabled !== true) return undefined;
	const next: CoinLabelPop = { enabled: true };
	const scale = authored(pop.scale, COIN_LABEL_BOUNDS.popScale, COIN_LABEL_DEFAULTS.popScale);
	if (scale !== undefined) next.scale = scale;
	const ms = authored(pop.ms, COIN_LABEL_BOUNDS.popMs, COIN_LABEL_DEFAULTS.popMs, true);
	if (ms !== undefined) next.ms = ms;
	return next;
}

/**
 * The sparse form of a coin label block: out-of-range numbers clamped, a non-hex tint or blank font
 * dropped, every default pruned, every empty object removed. Undefined when nothing authored is
 * left, so an untouched project persists no key. Idempotent.
 */
export function pruneCoinLabel(config: CoinLabelConfig | undefined): CoinLabelConfig | undefined {
	if (!config) return undefined;
	const next: CoinLabelConfig = {};

	const style = pruneCoinLabelStyle(config.style);
	if (style) next.style = style;

	if (config.cash) {
		const cash: CoinLabelCash = {};
		if (config.cash.format === 'betMultiple') cash.format = 'betMultiple';
		const decimals = authored(config.cash.decimals, COIN_LABEL_BOUNDS.decimals, undefined, true);
		if (decimals !== undefined) cash.decimals = decimals;
		if (config.cash.trimZeros === true) cash.trimZeros = true;
		const kept = compact(cash);
		if (kept) next.cash = kept;
	}

	const jackpots: Record<string, CoinLabelJackpot> = {};
	for (const [tier, entry] of Object.entries(config.jackpots ?? {})) {
		const name = tier.trim();
		if (!name || !entry) continue;
		const kept: CoinLabelJackpot = {};
		const text = typeof entry.text === 'string' ? entry.text.trim() : '';
		if (text) kept.text = text;
		const tierStyle = pruneCoinLabelStyle(entry.style);
		if (tierStyle) kept.style = tierStyle;
		if (Object.keys(kept).length) jackpots[name] = kept;
	}
	const keptJackpots = compact(jackpots);
	if (keptJackpots) next.jackpots = keptJackpots;

	if (config.placement) {
		const p = config.placement;
		const placement: CoinLabelPlacement = {};
		const x = authored(p.x, COIN_LABEL_BOUNDS.offset, COIN_LABEL_DEFAULTS.x);
		if (x !== undefined) placement.x = x;
		const y = authored(p.y, COIN_LABEL_BOUNDS.offset, COIN_LABEL_DEFAULTS.y);
		if (y !== undefined) placement.y = y;
		const scale = authored(p.scale, COIN_LABEL_BOUNDS.scale, COIN_LABEL_DEFAULTS.scale);
		if (scale !== undefined) placement.scale = scale;
		const maxWidth = authored(p.maxWidth, COIN_LABEL_BOUNDS.maxWidth, COIN_LABEL_DEFAULTS.maxWidth);
		if (maxWidth !== undefined) placement.maxWidth = maxWidth;
		const kept = compact(placement);
		if (kept) next.placement = kept;
	}

	if (config.animation) {
		const a = config.animation;
		const animation: CoinLabelAnimation = {};
		const landPop = prunePop(a.landPop);
		if (landPop) animation.landPop = landPop;
		const countMs = authored(a.countMs, COIN_LABEL_BOUNDS.countMs, undefined, true);
		if (countMs !== undefined) animation.countMs = countMs;
		const boostPop = prunePop(a.boostPop);
		if (boostPop) animation.boostPop = boostPop;
		const kept = compact(animation);
		if (kept) next.animation = kept;
	}

	return compact(next);
}

/** The look one label resolves to: the tier's style over the shared one over the coded default. */
export interface CoinLabelLook {
	font: string;
	size: number;
	tint?: string;
	x: number;
	y: number;
	scale: number;
	maxWidth: number;
}

export function resolveCoinLabelLook(
	config: CoinLabelConfig | undefined,
	jackpot?: string,
): CoinLabelLook {
	const tier = jackpot === undefined ? undefined : config?.jackpots?.[jackpot]?.style;
	const style = config?.style;
	const placement = config?.placement;
	const tint = tier?.tint ?? style?.tint;
	return {
		font: tier?.font ?? style?.font ?? COIN_LABEL_DEFAULTS.font,
		size: tier?.size ?? style?.size ?? COIN_LABEL_DEFAULTS.size,
		...(tint ? { tint } : {}),
		x: placement?.x ?? COIN_LABEL_DEFAULTS.x,
		y: placement?.y ?? COIN_LABEL_DEFAULTS.y,
		scale: placement?.scale ?? COIN_LABEL_DEFAULTS.scale,
		maxWidth: placement?.maxWidth ?? COIN_LABEL_DEFAULTS.maxWidth,
	};
}

/** An authored pop with its defaults filled, or null when it is off. */
export function resolveCoinLabelPop(
	pop: CoinLabelPop | undefined,
): { scale: number; ms: number } | null {
	if (pop?.enabled !== true) return null;
	return {
		scale: pop.scale ?? COIN_LABEL_DEFAULTS.popScale,
		ms: pop.ms ?? COIN_LABEL_DEFAULTS.popMs,
	};
}
