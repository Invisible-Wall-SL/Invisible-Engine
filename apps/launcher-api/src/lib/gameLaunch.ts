import { locales } from 'config-lingui';

/**
 * Locales a launch link may select, straight from the engine's own list — never a
 * copy, so a locale added to the engine shows up here with no second edit.
 */
export const LAUNCH_LOCALES: readonly string[] = [...locales].sort();

export const DEFAULT_LAUNCH_LOCALE = 'en';

const STORAGE_KEY = 'iw.launchLocale';

/**
 * SET `lang` on a game URL, replacing any value already there.
 *
 * Appending (`url + '&lang=it'`) is the trap: every generated game URL already
 * carries `lang=en`, and the game reads the FIRST occurrence — so an appended
 * one is silently ignored and the game stays English. `URL` also normalises the
 * `&?lang=` shape that hand-editing produces, where the parameter ends up
 * literally named `?lang`.
 */
export function withLocale(url: string, locale: string): string {
	if (!locale) return url;
	try {
		const parsed = new URL(url, 'https://games.invisiblewall.org');
		parsed.searchParams.set('lang', locale);
		// Keep relative URLs relative — callers pass both absolute and site-relative.
		return /^https?:\/\//i.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
}

/** Last locale the author launched with, so the choice survives a reload. */
export function readStoredLocale(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_LAUNCH_LOCALE;
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored && LAUNCH_LOCALES.includes(stored) ? stored : DEFAULT_LAUNCH_LOCALE;
}

export function storeLocale(locale: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, locale);
}
