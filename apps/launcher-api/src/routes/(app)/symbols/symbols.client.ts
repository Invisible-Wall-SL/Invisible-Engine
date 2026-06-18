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

/** Win-line overlay style — the line drawn across paying symbols. All optional/sparse:
 *  unset fields fall through to the game's coded defaults. Colours are CSS hex strings;
 *  `width` is a multiple of the symbol size; `speed` is a draw-speed multiplier. */
export interface WinLineLineStyle {
	color?: string;
	width?: number;
	glow?: boolean;
	glowColor?: string;
	animated?: boolean;
	speed?: number;
}

/** Win-amount text style (a bitmap font, so `color` is a tint multiply). `size` is a
 *  multiple of the symbol size. */
export interface WinLineTextStyle {
	font?: string;
	size?: number;
	color?: string;
}

/** Global win-line overlay config. Sparse: `enabled` absent = ON; only `{ enabled: false }`
 *  persists the OFF state; `line`/`text` carry only the fields the author changed. */
export interface WinLineConfig {
	enabled?: boolean;
	line?: WinLineLineStyle;
	text?: WinLineTextStyle;
}

export interface SymbolsDoc {
	version: 1;
	symbols: Record<string, SymbolStateMap>;
	/** Global win-frame spine that loops over winning symbols. Absent = the game's
	 *  built-in default (a local `payframe` spine). Set ONLY when the user overrides
	 *  it with an R2 spine bundle; never written for the default. */
	highlight?: SymbolCell;
	/** Global win-line overlay config (on/off + line + text style). A pure-config field,
	 *  no asset. Absent = the game defaults (overlay ON, gold line). The effective on/off
	 *  is `doc.winLine?.enabled ?? true`; every style field falls through to coded
	 *  defaults when unset. */
	winLine?: WinLineConfig;
	updatedAt?: string;
}

export interface SymbolDefaults {
	version: number;
	gameType: string;
	symbols: Record<string, SymbolStateMap>;
	/** The game's built-in win-frame default — display only, so the tool can show
	 *  "current = default (payframe)". Never forced into an override doc. */
	highlight?: SymbolCell;
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

/** The effective global highlight = override ?? coded default (may be absent). */
export function effectiveHighlight(
	doc: SymbolsDoc,
	defaults: SymbolDefaults,
): { cell: SymbolCell | undefined; overridden: boolean } {
	if (doc.highlight) return { cell: doc.highlight, overridden: true };
	return { cell: defaults.highlight, overridden: false };
}

/** Set the global highlight override, returning a NEW doc (immutable update). */
export function setHighlight(doc: SymbolsDoc, cell: SymbolCell): SymbolsDoc {
	return { ...doc, highlight: cell };
}

/** Clear the global highlight override (reset to the built-in default). New doc. */
export function clearHighlight(doc: SymbolsDoc): SymbolsDoc {
	if (!doc.highlight) return doc;
	const next = { ...doc };
	delete next.highlight;
	return next;
}

/** The effective "show win lines" flag = the doc's value ?? `true` (game default). */
export function winLineEnabled(doc: SymbolsDoc): boolean {
	return doc.winLine?.enabled ?? true;
}

/** Drop blank style fields (empty string / undefined / null) and empty `line`/`text`
 *  objects, returning a sparse `winLine` (or undefined when nothing remains). Keeps the
 *  doc minimal so an untouched/reset project ships no `winLine`. */
function pruneWinLine(winLine: WinLineConfig | undefined): WinLineConfig | undefined {
	if (!winLine) return undefined;
	const prune = <T extends object>(style: T | undefined): T | undefined => {
		if (!style) return undefined;
		const out = Object.fromEntries(
			Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== ''),
		);
		return Object.keys(out).length ? (out as T) : undefined;
	};
	const next: WinLineConfig = {};
	if (winLine.enabled === false) next.enabled = false;
	const line = prune(winLine.line);
	const text = prune(winLine.text);
	if (line) next.line = line;
	if (text) next.text = text;
	return Object.keys(next).length ? next : undefined;
}

/** Replace the doc's `winLine` with a pruned copy (or remove it). New doc. */
function withWinLine(doc: SymbolsDoc, winLine: WinLineConfig): SymbolsDoc {
	const pruned = pruneWinLine(winLine);
	const next = { ...doc };
	if (pruned) next.winLine = pruned;
	else delete next.winLine;
	return next;
}

/** Set the global "show win lines" flag, returning a NEW doc (immutable update). Kept
 *  sparse: turning it ON drops the `enabled` field (preserving any style); only OFF
 *  persists `enabled: false`. */
export function setWinLineEnabled(doc: SymbolsDoc, enabled: boolean): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	if (enabled) delete winLine.enabled;
	else winLine.enabled = false;
	return withWinLine(doc, winLine);
}

/** Merge a patch into `winLine.line` (line style). Pass a field as `undefined` to reset
 *  it to the coded default. New doc. */
export function setWinLineLine(doc: SymbolsDoc, patch: Partial<WinLineLineStyle>): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.line = { ...(winLine.line ?? {}), ...patch };
	return withWinLine(doc, winLine);
}

/** Merge a patch into `winLine.text` (win-amount text style). New doc. */
export function setWinLineText(doc: SymbolsDoc, patch: Partial<WinLineTextStyle>): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.text = { ...(winLine.text ?? {}), ...patch };
	return withWinLine(doc, winLine);
}

/** Reset the win-line STYLE to defaults (clears `line`/`text`), keeping the on/off
 *  state. New doc. */
export function clearWinLineStyle(doc: SymbolsDoc): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	delete winLine.line;
	delete winLine.text;
	return withWinLine(doc, winLine);
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
	const highlight = doc.highlight
		? {
				type: doc.highlight.type,
				assetKey: doc.highlight.assetKey,
				animationName: doc.highlight.animationName ?? '',
			}
		: null;
	// Sort style keys so the signature is stable regardless of how fields were merged in.
	const sortKeys = (style: object | undefined): Record<string, unknown> | null => {
		if (!style) return null;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(style).sort()) out[k] = (style as Record<string, unknown>)[k];
		return out;
	};
	const winLine = doc.winLine
		? {
				enabled: doc.winLine.enabled ?? null,
				line: sortKeys(doc.winLine.line),
				text: sortKeys(doc.winLine.text),
			}
		: null;
	return JSON.stringify({ symbols, highlight, winLine });
}

/** Persist the doc to R2 via the S2 endpoint; returns the stamped doc. */
export async function saveSymbolsDoc(project: string, doc: SymbolsDoc): Promise<SymbolsDoc> {
	const res = await fetch(`/api/editor/symbols?project=${encodeURIComponent(project)}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			version: 1,
			symbols: doc.symbols,
			...(doc.highlight ? { highlight: doc.highlight } : {}),
			...(doc.winLine ? { winLine: doc.winLine } : {}),
		}),
	});
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw new Error(msg || `Save failed (${res.status})`);
	}
	const body = (await res.json()) as { doc: SymbolsDoc };
	return body.doc;
}
