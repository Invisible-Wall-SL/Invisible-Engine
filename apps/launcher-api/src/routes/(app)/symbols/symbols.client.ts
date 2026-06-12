/**
 * Client-side helpers for the Invisible Symbols State Machine grid: the cell
 * shape, the override-over-default merge that yields each cell's EFFECTIVE
 * binding, and the save round-trip to the S2 `PUT /api/editor/symbols` endpoint.
 * Kept in step with `$lib/server/symbolsStorage` (the doc schema) and
 * `$lib/server/symbolDefaults` (the coded defaults) — those are server-only, so
 * the structural types are re-declared here for the browser bundle.
 */

export const SYMBOL_STATES = [
	'static',
	'spin',
	'land',
	'win',
	'postWinStatic',
	'explosion',
] as const;
export type SymbolState = (typeof SYMBOL_STATES)[number];

/** Human labels for the column headers. */
export const STATE_LABELS: Record<SymbolState, string> = {
	static: 'Static',
	spin: 'Spin',
	land: 'Land',
	win: 'Win',
	postWinStatic: 'Post-win',
	explosion: 'Explosion',
};

export interface SizeRatios {
	width: number;
	height: number;
}

/** A single symbol×state binding — sprite frame or spine animation. */
export interface SymbolCell {
	type: 'sprite' | 'spine';
	assetKey: string;
	animationName?: string;
	/** Tool-only spine resolver hint (`<folder>/<stem>`, e.g. `symbols/h1`) on a
	 *  DEFAULT cell, so the grid previews the specific skeleton of a shared-atlas
	 *  bundle. Display/preview only — `applyDraft` never copies it into an override. */
	previewKey?: string;
	sizeRatios: SizeRatios;
}

/** Symbol name → state → binding (sparse for the override doc, dense for defaults). */
export type SymbolStateMap = Partial<Record<SymbolState, SymbolCell>>;

export interface SymbolsDoc {
	version: 1;
	symbols: Record<string, SymbolStateMap>;
	updatedAt?: string;
}

export interface SymbolDefaults {
	version: number;
	gameType: string;
	symbols: Record<string, SymbolStateMap>;
}

/** The effective binding for a cell = override ?? coded default (may be absent). */
export function effectiveCell(
	doc: SymbolsDoc,
	defaults: SymbolDefaults,
	symbol: string,
	state: SymbolState,
): { cell: SymbolCell | undefined; overridden: boolean } {
	const override = doc.symbols[symbol]?.[state];
	if (override) return { cell: override, overridden: true };
	return { cell: defaults.symbols[symbol]?.[state], overridden: false };
}

/** Set an override cell, returning a NEW doc (immutable update for `$state`). */
export function setOverride(
	doc: SymbolsDoc,
	symbol: string,
	state: SymbolState,
	cell: SymbolCell,
): SymbolsDoc {
	const states: SymbolStateMap = { ...(doc.symbols[symbol] ?? {}), [state]: cell };
	return { ...doc, symbols: { ...doc.symbols, [symbol]: states } };
}

/** Remove an override (reset-to-default), pruning a now-empty symbol. New doc. */
export function clearOverride(doc: SymbolsDoc, symbol: string, state: SymbolState): SymbolsDoc {
	const current = doc.symbols[symbol];
	if (!current || !(state in current)) return doc;
	const states: SymbolStateMap = { ...current };
	delete states[state];
	const symbols = { ...doc.symbols };
	if (Object.keys(states).length === 0) delete symbols[symbol];
	else symbols[symbol] = states;
	return { ...doc, symbols };
}

/** Stable JSON for dirty-tracking (key order is fixed by `SYMBOL_STATES`). */
export function docSignature(doc: SymbolsDoc): string {
	const symbols: Record<string, SymbolStateMap> = {};
	for (const name of Object.keys(doc.symbols).sort()) {
		const states = doc.symbols[name];
		const ordered: SymbolStateMap = {};
		for (const state of SYMBOL_STATES) if (states[state]) ordered[state] = states[state];
		symbols[name] = ordered;
	}
	return JSON.stringify(symbols);
}

/** Persist the doc to R2 via the S2 endpoint; returns the stamped doc. */
export async function saveSymbolsDoc(project: string, doc: SymbolsDoc): Promise<SymbolsDoc> {
	const res = await fetch(`/api/editor/symbols?project=${encodeURIComponent(project)}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ version: 1, symbols: doc.symbols }),
	});
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw new Error(msg || `Save failed (${res.status})`);
	}
	const body = (await res.json()) as { doc: SymbolsDoc };
	return body.doc;
}
