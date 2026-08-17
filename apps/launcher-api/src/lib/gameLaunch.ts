import { locales } from 'config-lingui';

/**
 * Locales a launch link may select, straight from the engine's own list — never a
 * copy, so a locale added to the engine shows up here with no second edit.
 */
export const LAUNCH_LOCALES: readonly string[] = [...locales].sort();

export const DEFAULT_LAUNCH_LOCALE = 'en';

/**
 * `it — Italian` for a picker option. A menu of 48 bare two-letter codes is a trap: `it`
 * and `lt`, `sk` and `sl`, `no` and `nl` sit a few rows apart and read identically at a
 * glance, and picking the wrong one produces a game that silently renders English (an
 * un-translated locale falls back, by design). Falls back to the bare code where
 * `Intl.DisplayNames` is unavailable or has no name for it.
 */
export function localeLabel(code: string): string {
	try {
		const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
		return name && name !== code ? `${code} — ${name}` : code;
	} catch {
		return code;
	}
}

/**
 * Currencies a launch link may select. The wire value is free-form (the engine formats
 * with `Intl.NumberFormat`, which takes any well-formed code), so this is a curated menu
 * rather than a contract — add a code here and it works with no engine change. `XGC`/`XSC`
 * are the social-casino Gold/Sweeps coins the engine formats by hand instead of via `Intl`.
 *
 * Worth knowing when checking layout: the engine formats every amount to exactly 2
 * decimals, so a zero-decimal currency (JPY, KRW, CLP, VND) renders `¥1.00`, not `¥1`.
 */
export const LAUNCH_CURRENCIES: readonly string[] = [
	'USD',
	'EUR',
	'GBP',
	'CHF',
	'SEK',
	'NOK',
	'DKK',
	'PLN',
	'CZK',
	'HUF',
	'RON',
	'TRY',
	'UAH',
	'BRL',
	'MXN',
	'ARS',
	'CLP',
	'PEN',
	'CAD',
	'AUD',
	'NZD',
	'JPY',
	'KRW',
	'CNY',
	'INR',
	'IDR',
	'PHP',
	'THB',
	'VND',
	'ZAR',
	'NGN',
	'XGC',
	'XSC',
];

export const DEFAULT_LAUNCH_CURRENCY = 'USD';

const LOCALE_STORAGE_KEY = 'iw.launchLocale';
const CURRENCY_STORAGE_KEY = 'iw.launchCurrency';

/**
 * SET a query parameter on a game URL, replacing any value already there.
 *
 * Appending (`url + '&lang=it'`) is the trap: every generated game URL already carries
 * `lang=en&currency=USD`, and the game reads the FIRST occurrence — so an appended one is
 * silently ignored and the game stays English/dollars. `URL` also normalises the `&?lang=`
 * shape that hand-editing produces, where the parameter ends up literally named `?lang`.
 */
function withParam(url: string, key: string, value: string): string {
	if (!value) return url;
	try {
		const parsed = new URL(url, 'https://games.invisiblewall.org');
		parsed.searchParams.set(key, value);
		// Keep relative URLs relative — callers pass both absolute and site-relative.
		return /^https?:\/\//i.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
}

export const withLocale = (url: string, locale: string): string => withParam(url, 'lang', locale);

/** SET `currency` on a game URL. The engine reads it in `stateUrlDerived.currency()` and
 *  lets it override the code the RGS reports — which is how a mock-RGS launch (always
 *  `USD`) can still be previewed in any currency. */
export const withCurrency = (url: string, currency: string): string =>
	withParam(url, 'currency', currency);

/** Last locale the author launched with, so the choice survives a reload. */
export function readStoredLocale(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_LAUNCH_LOCALE;
	const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
	return stored && LAUNCH_LOCALES.includes(stored) ? stored : DEFAULT_LAUNCH_LOCALE;
}

export function storeLocale(locale: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

/** Last currency the author launched with, so the choice survives a reload. */
export function readStoredCurrency(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_LAUNCH_CURRENCY;
	const stored = localStorage.getItem(CURRENCY_STORAGE_KEY);
	return stored && LAUNCH_CURRENCIES.includes(stored) ? stored : DEFAULT_LAUNCH_CURRENCY;
}

export function storeCurrency(currency: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
}
