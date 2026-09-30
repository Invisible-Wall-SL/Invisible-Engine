/**
 * Which UI language a launch plays in — pure, so `localeResolution.fixture.mts` drives it with
 * literals. `stateUrl.svelte.ts` `lang()` is the state-reading wrapper.
 */

/**
 * The shipped language an operator's locale tag names, or null. Case-insensitive, `_` read as `-`:
 * the exact tag first (`pt-BR` if a game ever ships one), then its primary subtag (`pt_BR` → `pt`).
 */
export const matchShippedLocale = <L extends string>(
	tag: string | null | undefined,
	shipped: readonly L[],
): L | null => {
	if (!tag) return null;
	const wanted = tag.trim().replaceAll('_', '-').toLowerCase();
	if (!wanted) return null;
	const byTag = (candidate: string) => shipped.find((l) => l.toLowerCase() === candidate) ?? null;
	return byTag(wanted) ?? byTag(wanted.split('-')[0]);
};

/**
 * The language to play in.
 *
 * 1. The operator's declared `locale`, when it names a language the game ships — their page knows
 *    the player's language better than a query param someone typed.
 * 2. Otherwise `?lang=` exactly as it always read: `br` is Brazilian Portuguese (`pt`), any other
 *    value is taken as given. A declared locale we do not ship must not force English over a `?lang=`
 *    we do.
 * 3. Otherwise English.
 */
export const resolveLanguage = <L extends string>({
	operatorLocale,
	urlLang,
	shipped,
}: {
	operatorLocale: string | null | undefined;
	urlLang: string | null | undefined;
	shipped: readonly L[];
}): string =>
	matchShippedLocale(operatorLocale, shipped) ?? (urlLang === 'br' ? 'pt' : urlLang || 'en');
