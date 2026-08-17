import { stateI18n } from 'state-shared';

import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet } from 'state-shared';

const NO_LOCALISATION_CURRENCY_MAP: Record<string, string> = {
	XGC: 'GC',
	XSC: 'SC',
};

// bookEventAmount: is the amount or win numbers in the events of books, e.g. the amount in setTotalWin bookEvent
// {
// 	"index": 3,
// 	"type": "setTotalWin",
// 	"amount": 100
// },
// if betting on $1,   100 bookEventAmount equals to $1.    betAmountMultiplier is (100 / BOOK_AMOUNT_MULTIPLIER =) 1
// if betting on $1,    50 bookEventAmount equals to $0.5.  betAmountMultiplier is ( 50 / BOOK_AMOUNT_MULTIPLIER =) 0.5
// if betting on $0.5, 100 bookEventAmount equals to $0.5.  betAmountMultiplier is (100 / BOOK_AMOUNT_MULTIPLIER =) 1
// if betting on $0.5,  50 bookEventAmount equals to $0.25. betAmountMultiplier is ( 50 / BOOK_AMOUNT_MULTIPLIER =) 0.5

export const bookEventAmountToBetAmountMultiplier = (bookEventAmount: number) =>
	bookEventAmount / BOOK_AMOUNT_MULTIPLIER;

export const bookEventAmountToNormalisedAmount = (bookEventAmount: number) => {
	const betAmountMultiplier = bookEventAmountToBetAmountMultiplier(bookEventAmount);
	return stateBet.wageredBetAmount * betAmountMultiplier;
};

export const numberToFloat = (value: number) => Number.parseFloat(`${value}`);

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

export const numberToCurrencyString = (value: number) => {
	if (stateBet.currency in NO_LOCALISATION_CURRENCY_MAP) {
		return `${NO_LOCALISATION_CURRENCY_MAP[stateBet.currency]} ${numberToFloat(value).toFixed(2)}`;
	}

	const locale = stateI18n.i18n.locale;
	return stateI18n.i18n.number(value, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		style: 'currency',
		currency: stateBet.currency,
		// Prefer the glyph where it can't be mistaken for another currency; fall back to
		// `Intl`'s own (code-or-symbol) choice where it can. See `narrowSymbolIsUnique`.
		...(narrowSymbolIsUnique(locale, stateBet.currency)
			? { currencyDisplay: 'narrowSymbol' as const }
			: {}),
		// numberingSystem: 'latn',
	});
};

export const bookEventAmountToCurrencyString = (bookEventAmount: number) => {
	const normalisedAmount = bookEventAmountToNormalisedAmount(bookEventAmount);
	return numberToCurrencyString(normalisedAmount);
};
