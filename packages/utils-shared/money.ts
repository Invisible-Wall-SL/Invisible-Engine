/**
 * Money as the player reads it — pure, so `money.fixture.mts` drives it with literals.
 *
 * Every surface that prints money goes through `amount.ts` `numberToCurrencyString`, which reads the
 * live locale, currency and operator declaration and calls {@link formatMoney}. An operator that
 * declares neither `currencySymbol` nor `currencyFormat` gets exactly the string the engine printed
 * before either existed: this ships to every online game.
 */

export interface MoneyFormat {
	/** The active UI locale (`stateI18n.i18n.locale`). */
	locale: string;
	/** The ISO code the amount is in (`stateBet.currency`). */
	currency: string;
	/** The operator's `currencySymbol`: the glyph printed instead of the one the code implies. */
	symbol?: string | null;
	/** The operator's `currencyFormat`, read by {@link parseMoneyPattern}. */
	pattern?: string | null;
	/** At least this many decimals — for a figure finer than a cent (a credit's value). Absent ⇒ the
	 *  rendering's own, which is what every amount the player stakes or wins uses. */
	minimumDecimals?: number;
}

/** Social-casino coins (Gold / Sweeps) have no ISO glyph and are never localised. */
const SOCIAL_COINS: Record<string, string> = {
	XGC: 'GC',
	XSC: 'SC',
};

/** The `currency` part of a narrow-symbol rendering (`R$`, `¥`, `zł`), or undefined when
 *  the runtime can't format that code. Read off `formatToParts` so the glyph comes back
 *  clean, without digits, spaces or the locale's grouping. */
const narrowSymbolOf = (locale: string, currency: string): string | undefined => {
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			currencyDisplay: 'narrowSymbol',
		})
			.formatToParts(0)
			.find((part) => part.type === 'currency')?.value;
	} catch {
		return undefined;
	}
};

const narrowSymbolUniqueCache = new Map<string, boolean>();

/**
 * Is `currency`'s narrow symbol unambiguous in `locale`?
 *
 * `Intl`'s default (`currencyDisplay: 'symbol'`) prints the ISO code wherever CLDR
 * judges the glyph ambiguous FOR THAT LOCALE — Italian renders `€` and `£` but
 * `1234,50 USD`, because a bare `$` doesn't tell an Italian reader WHICH dollar.
 * Forcing `narrowSymbol` everywhere wins back `R$`, `zł`, `₹`, `₺` — but collapses
 * USD/CAD/AUD/NZD/MXN/ARS/CLP to one indistinguishable `$`, which is not acceptable
 * in a money product.
 *
 * So take the narrow symbol only when nothing else claims it. Uniqueness is COMPUTED,
 * not listed: every currency the runtime knows (`Intl.supportedValuesOf`) is narrow-
 * formatted and compared, so the answer tracks the platform's own CLDR data instead of
 * a hand-kept table that would silently rot. Cached per (locale, currency) — a session
 * has one of each, so this scan runs once. A runtime without `supportedValuesOf` can't
 * prove uniqueness and keeps the `symbol` behaviour.
 */
const narrowSymbolIsUnique = (locale: string, currency: string): boolean => {
	const cacheKey = `${locale}|${currency}`;
	const cached = narrowSymbolUniqueCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
		.supportedValuesOf;
	const target = narrowSymbolOf(locale, currency);
	const all = typeof supportedValuesOf === 'function' ? supportedValuesOf('currency') : [];
	const unique =
		!!target &&
		all.length > 0 &&
		!all.some((other) => other !== currency && narrowSymbolOf(locale, other) === target);

	narrowSymbolUniqueCache.set(cacheKey, unique);
	return unique;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * One cached `Intl.NumberFormat`. The locale list is `[locale, 'en']` because that is what Lingui's
 * `i18n.number` — the formatter money went through before this file — hands `Intl`: a locale the
 * runtime lacks falls back to English, not to whatever the browser happens to default to.
 */
const formatter = (locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
	const key = `${locale}|${JSON.stringify(options)}`;
	let cached = formatterCache.get(key);
	if (!cached) {
		cached = new Intl.NumberFormat([locale, 'en'], options);
		formatterCache.set(key, cached);
	}
	return cached;
};

/** The currency rendering money had before any operator setting: always two decimals, the glyph
 *  where it cannot be mistaken for another currency, `Intl`'s own code-or-symbol choice elsewhere. */
const currencyFormatter = (locale: string, currency: string, decimals = 2): Intl.NumberFormat =>
	formatter(locale, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
		style: 'currency',
		currency,
		...(narrowSymbolIsUnique(locale, currency) ? { currencyDisplay: 'narrowSymbol' as const } : {}),
	});

/** The glyph (or code) the currency renders with in this locale today. */
const impliedSymbolOf = (locale: string, currency: string): string =>
	currencyFormatter(locale, currency)
		.formatToParts(1)
		.find((part) => part.type === 'currency')?.value ?? currency;

export interface MoneyPattern {
	/** Literal text before the digits, `{0}` still in it. */
	before: string;
	/** Literal text after the digits, `{0}` still in it. */
	after: string;
	/** A `,` in the integer part: group thousands (the locale says how). */
	grouping: boolean;
	/** `0`/`#` placeholders after the `.` — `.#0` and `.00` both mean 2. */
	decimals: number;
}

/** Past this a pattern is a typo, and `Intl` throws on large fraction counts — which would blank
 *  every money readout in the game. Three covers every ISO minor unit. */
const MAX_PATTERN_DECIMALS = 4;

/** The digit run: `#`, `0`, `,` and `.`, with at least one digit placeholder. */
const DIGIT_RUN = /[#0,.]*[#0][#0,.]*/;
const SYMBOL_SLOT = '{0}';

/**
 * Read a numeral-style money pattern (the partner's `balanceFormat`, e.g. `{0} #,#.#0`).
 *
 * `{0}` is where the symbol goes, every time it appears; a pattern without one prints no symbol. The
 * FIRST run of `#`/`0`/`,`/`.` is the number: a `,` before its `.` turns grouping on, and the count of
 * `#`/`0` after the `.` is the decimals (no `.` ⇒ none). Everything else is literal text, spaces
 * included. The locale still chooses the separators — the pattern only says WHETHER to group and HOW
 * MANY decimals, as numeral does under its own locale setting. Null when there is no digit run.
 */
export const parseMoneyPattern = (pattern: string): MoneyPattern | null => {
	// `{0}` holds a `0`, so it is split out before looking for digits.
	const segments = pattern.split(SYMBOL_SLOT);
	for (let i = 0; i < segments.length; i++) {
		const match = DIGIT_RUN.exec(segments[i]);
		if (!match) continue;
		const run = match[0];
		const dot = run.indexOf('.');
		const integer = dot < 0 ? run : run.slice(0, dot);
		const fraction = dot < 0 ? '' : run.slice(dot + 1);
		return {
			before: [...segments.slice(0, i), segments[i].slice(0, match.index)].join(SYMBOL_SLOT),
			after: [segments[i].slice(match.index + run.length), ...segments.slice(i + 1)].join(
				SYMBOL_SLOT,
			),
			grouping: integer.includes(','),
			decimals: Math.min((fraction.match(/[#0]/g) ?? []).length, MAX_PATTERN_DECIMALS),
		};
	}
	return null;
};

/**
 * The decimals an amount prints with under a pattern that states `decimals`.
 *
 * A pattern with fewer than two (`#,#`, `#,#.0`) is honoured whenever the amount has nothing below
 * that — `1,234`, not `1,234.00`. An amount that DOES have cents (a `0.5` stake on a ladder the
 * operator's pattern did not anticipate) prints two decimals instead of being rounded into a figure
 * it is not: money must never read as a different amount than was staked or won. Measured to the
 * cent, since no engine amount is finer.
 */
export const moneyFractionDigits = (value: number, decimals: number): number => {
	if (decimals >= 2) return decimals;
	const cents = Math.round(Math.abs(value) * 100);
	return cents % 10 ** (2 - decimals) === 0 ? decimals : 2;
};

const formatWithPattern = (
	value: number,
	locale: string,
	symbol: string,
	pattern: MoneyPattern,
	minimumDecimals = 0,
): string => {
	const digits = Math.max(moneyFractionDigits(value, pattern.decimals), minimumDecimals);
	const magnitude = formatter(locale, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
		...(pattern.grouping ? {} : { useGrouping: false }),
	});
	// The sign leads the whole amount, symbol included (`-€ 5.00`), as it does in the locale's own
	// currency rendering. An amount that rounds to zero carries none.
	const negative = value < 0 && Math.round(Math.abs(value) * 10 ** digits) > 0;
	const minus = negative
		? (magnitude.formatToParts(-1).find((part) => part.type === 'minusSign')?.value ?? '-')
		: '';
	const place = (text: string) => text.split(SYMBOL_SLOT).join(symbol);
	return `${minus}${place(pattern.before)}${magnitude.format(Math.abs(value))}${place(pattern.after)}`;
};

/**
 * Format one money amount.
 *
 * - Neither `symbol` nor `pattern`: the engine's currency rendering, unchanged.
 * - `symbol` only: that same rendering — the locale's grouping, decimals, symbol position and
 *   spacing — with the currency part swapped for the declared glyph.
 * - `pattern`: the digits in the locale, grouped and with decimals as the pattern says, placed in the
 *   pattern with `{0}` as the declared symbol, else the one the currency implies today.
 * - Social coins (`XGC`/`XSC`) keep their own `GC 1.00` form whatever is declared.
 */
export const formatMoney = (
	value: number,
	{ locale, currency, symbol, pattern, minimumDecimals }: MoneyFormat,
): string => {
	if (currency in SOCIAL_COINS) {
		return `${SOCIAL_COINS[currency]} ${Number.parseFloat(`${value}`).toFixed(2)}`;
	}

	const parsed = pattern ? parseMoneyPattern(pattern) : null;
	if (parsed) {
		return formatWithPattern(
			value,
			locale,
			symbol || impliedSymbolOf(locale, currency),
			parsed,
			minimumDecimals,
		);
	}

	const base = currencyFormatter(locale, currency, Math.max(2, minimumDecimals ?? 2));
	if (!symbol) return base.format(value);
	return base
		.formatToParts(value)
		.map((part) => (part.type === 'currency' ? symbol : part.value))
		.join('');
};
