/**
 * The editor Library's search box and type filter (Rive plan Phase 9d, `docs/design/rive-reference.md`
 * §3.2 Assets row). Pure, so the gate pins what a query shows.
 *
 * Fonts and audio are listed READ-ONLY: they are not placed from here, and they ship through their
 * own chains (`fontExport.ts`, `soundExport.ts`), so the Library only shows that they exist.
 */

export const LIBRARY_TYPES = [
	{ id: 'all', label: 'All types' },
	{ id: 'atlas', label: 'Atlases' },
	{ id: 'rig', label: 'Rigs' },
	{ id: 'sheet', label: 'Sheets' },
	{ id: 'effect', label: 'Effects' },
	{ id: 'flipbook', label: 'Flipbooks' },
	{ id: 'font', label: 'Fonts (read-only)' },
	{ id: 'audio', label: 'Audio (read-only)' },
] as const;

export type LibraryType = (typeof LIBRARY_TYPES)[number]['id'];

/** The words of a query, lowercased; an empty query has none (and matches everything). */
export function queryTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term appears in one of `names` (an asset's name, its key, a region's name …). */
export function libraryMatches(
	terms: readonly string[],
	...names: (string | undefined)[]
): boolean {
	if (!terms.length) return true;
	const hay = names
		.filter((n): n is string => typeof n === 'string')
		.join(' ')
		.toLowerCase();
	return terms.every((t) => hay.includes(t));
}

/** Whether the section for `type` shows under the type filter. */
export function showsType(filter: LibraryType, type: Exclude<LibraryType, 'all'>): boolean {
	return filter === 'all' || filter === type;
}

/**
 * The rows of a section under the query: those whose own names match, and — for an atlas or
 * sheet whose regions are loaded — those with a matching region (`regions` lists them).
 */
export function filterRows<T>(
	rows: readonly T[],
	terms: readonly string[],
	names: (row: T) => (string | undefined)[],
	regions?: (row: T) => readonly string[] | undefined,
): T[] {
	if (!terms.length) return [...rows];
	return rows.filter(
		(row) =>
			libraryMatches(terms, ...names(row)) ||
			(regions?.(row) ?? []).some((name) => libraryMatches(terms, name)),
	);
}
