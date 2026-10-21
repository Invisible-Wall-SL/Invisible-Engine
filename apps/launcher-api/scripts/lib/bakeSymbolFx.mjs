/**
 * The BAKE half of the per-symbol Element FX (`symbols.symbolFx`, `bake-editor-doc.mjs`) — split out
 * so `check:symbol-fx` runs the exact code the bake runs instead of grepping for it.
 *
 * A SHAPE rebuild, deliberately not a second reader: the server already pruned the section
 * (`$lib/symbolFx` `pruneSymbolFx`) and the game reads every list through `readElementFxEntries`,
 * which drops what it cannot play. The state keys are checked for shape, not against
 * `SYMBOL_STATES`: this script imports nothing from the workspace (it runs inside a game build), and
 * a copied list would drift. The entries go through untouched, so one a newer build wrote ships.
 */

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The baked `symbols.symbolFx`, or undefined (no key) when nothing is authored. */
export function bakeSymbolFx(raw) {
	if (!isRecord(raw)) return undefined;
	const out = {};
	for (const [symbol, states] of Object.entries(raw)) {
		if (!symbol || !isRecord(states)) continue;
		const kept = {};
		for (const [state, entries] of Object.entries(states)) {
			if (!state || !Array.isArray(entries)) continue;
			const list = entries.filter(isRecord);
			if (list.length) kept[state] = list;
		}
		if (Object.keys(kept).length) out[symbol] = kept;
	}
	return Object.keys(out).length ? out : undefined;
}
