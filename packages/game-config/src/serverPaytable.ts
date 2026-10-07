import type { PaytableRow } from './types';

/**
 * One paytable row, in the shape both sides can state it: the operator's boot `config` (once the
 * facade has normalised the wire and mapped its symbol names) and the paytable the game DISPLAYS
 * (`apps/lines/src/game/paytable.ts`). `occurs[i]` pays `pay[i]`. Structurally identical to
 * `utils-shared`'s `ServerPayEntry`, declared here so this module stays loadable by `node` directly.
 */
export type PayEntry = {
	on: { occurs: number[]; of: string; mode: string };
	pay: number[];
};

/** One way the paytable the player is SHOWN disagrees with the one the server DECLARED. */
export type PaytableDrift =
	| { kind: 'differs'; symbol: string; mode: string; shown: PayRow; declared: PayRow }
	| { kind: 'unshown'; symbol: string; mode: string; declared: PayRow }
	| { kind: 'undeclared'; symbol: string; mode: string; shown: PayRow };

/** Of-a-kind count → multiplier. Only counts that PAY — a zero is the same claim as no entry. */
export type PayRow = Record<number, number>;

const keyOf = (symbol: string, mode: string) => `${symbol}\u0000${mode}`;

type IndexedRow = { symbol: string; mode: string; row: PayRow };

const isEntry = (entry: unknown): entry is PayEntry => {
	const e = entry as Partial<PayEntry> | null;
	return typeof e?.on?.of === 'string' && Array.isArray(e.on.occurs) && Array.isArray(e.pay);
};

/**
 * Rows that PAY, keyed by symbol and mode class. A malformed entry is skipped rather than trusted:
 * this runs at boot in every online game, so a bad row must cost a row, never the game.
 *
 * Every mode but `scatter` is one class. The info page labels each per-symbol row `line` whatever the
 * win model, so a ways or cluster server's rows are the same claim under another name — keeping the
 * names apart would report every symbol twice and compare none of them.
 */
const indexRows = (entries: readonly unknown[]): Map<string, IndexedRow> => {
	const out = new Map<string, IndexedRow>();
	for (const entry of entries) {
		if (!isEntry(entry)) continue;
		const symbol = entry.on.of;
		const mode = entry.on.mode === 'scatter' ? 'scatter' : 'line';
		const key = keyOf(symbol, mode);
		const row = out.get(key)?.row ?? {};
		entry.on.occurs.forEach((count, i) => {
			const pay = entry.pay[i];
			if (Number.isFinite(count) && Number.isFinite(pay) && pay > 0) row[count] = pay;
		});
		if (Object.keys(row).length) out.set(key, { symbol, mode, row });
	}
	return out;
};

/** Multipliers are routinely fractional (`0.4`), and one side may have passed through JSON arithmetic. */
const samePay = (a: number, b: number) =>
	Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const sameRow = (a: PayRow, b: PayRow): boolean => {
	const counts = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const count of counts) {
		const x = a[Number(count)];
		const y = b[Number(count)];
		if (x === undefined || y === undefined || !samePay(x, y)) return false;
	}
	return true;
};

/**
 * Where the paytable a game SHOWS and the one its server DECLARES disagree, row by row.
 *
 * Compared as raw multipliers, because both sides quote the same stake: a `line` row multiplies the
 * bet per line on the wire (`pay × betPerLine`) and on the info page (`totalBet / payoutDivisor`),
 * and a `scatter` row multiplies the total bet on both. Keyed by symbol AND mode class, so a symbol
 * that pays both ways is two rows.
 *
 * One-sided rows are reported in both directions, with two limits that keep the check about
 * DECLARATIONS rather than guesses:
 *
 *  - `unshown` — the server prices a row the player is never shown. Limited to symbols it deals
 *    (`dealt`, when known): a price for a symbol that never lands pays nothing.
 *  - `undeclared` — the player is shown a row the server states no price for. Only when the server
 *    declared ANY row of that mode. A server that states no scatter rows at all (our lines mock, which
 *    pays its scatter off a table it never announces) has said nothing to compare against, and
 *    reporting that as drift on every game would teach everyone to ignore the warning.
 */
export const comparePaytables = (
	shown: readonly unknown[],
	declared: readonly unknown[],
	dealt?: readonly string[],
): PaytableDrift[] => {
	const shownRows = indexRows(shown);
	const declaredRows = indexRows(declared);
	const declaredModes = new Set([...declaredRows.values()].map((r) => r.mode));
	const dealtSet = dealt?.length ? new Set(dealt) : null;
	const drift: PaytableDrift[] = [];

	for (const [key, { symbol, mode, row: shownRow }] of shownRows) {
		const declaredRow = declaredRows.get(key)?.row;
		if (declaredRow) {
			if (!sameRow(shownRow, declaredRow)) {
				drift.push({ kind: 'differs', symbol, mode, shown: shownRow, declared: declaredRow });
			}
		} else if (declaredModes.has(mode)) {
			drift.push({ kind: 'undeclared', symbol, mode, shown: shownRow });
		}
	}
	for (const [key, { symbol, mode, row }] of declaredRows) {
		if (shownRows.has(key) || (dealtSet && !dealtSet.has(symbol))) continue;
		drift.push({ kind: 'unshown', symbol, mode, declared: row });
	}
	return drift;
};

const formatRow = (row: PayRow): string =>
	Object.keys(row)
		.map(Number)
		.sort((a, b) => a - b)
		.map((count) => `${count}:${row[count]}`)
		.join(' ') || '—';

/** One line per drift, e.g. `H1 (line): shows 3:5 4:20 5:100, server pays 3:5 4:25 5:100`. */
export const describePaytableDrift = (drift: PaytableDrift): string => {
	const label = `${drift.symbol} (${drift.mode})`;
	switch (drift.kind) {
		case 'differs':
			return `${label}: shows ${formatRow(drift.shown)}, server pays ${formatRow(drift.declared)}`;
		case 'unshown':
			return `${label}: not shown, server pays ${formatRow(drift.declared)}`;
		case 'undeclared':
			return `${label}: shows ${formatRow(drift.shown)}, server declares no price`;
	}
};

/** The symbol-dictionary slice the paytable reads — a doc's `symbols`, or the engine's live config. */
export type PaytableSymbols = Readonly<
	Record<string, { paytable?: PaytableRow[]; special_properties?: string[] }>
>;

/**
 * What a scatter pays when its dictionary entry states no `paytable` — × total bet. These are the
 * numbers the info page quoted while scatter pays had no authored home, so every config written
 * before they did shows exactly what it showed then.
 */
export const DEFAULT_SCATTER_PAYTABLE: PaytableRow[] = [{ '3': 2 }, { '4': 20 }, { '5': 200 }];

/**
 * How many scatters trigger the feature BY DEFAULT. It is NOT the lowest count of the scatter's pay
 * row: a row may pay from 2 or start at 4 without moving the trigger. It is the count the default
 * row, both mocks and the anticipation tease have always used. A project may author its own count
 * and symbol in `freeSpins`: read the live rule through `resolveFreeSpins`, never this constant.
 */
export const SCATTER_TRIGGER_COUNT = 3;

export const isScatterSymbol = (symbol: PaytableSymbols[string] | undefined): boolean =>
	symbol?.special_properties?.includes('scatter') ?? false;

/**
 * THE scatter: the first dictionary symbol that is a scatter AND is dealt (`inPlay`, the strip
 * gate). One answer for every side that asks — the info page's scatter row, the mock's scatter
 * pays, the free-spins trigger default — so no two of them can pick different scatters.
 */
export const inPlayScatterSymbol = (
	symbols: PaytableSymbols,
	inPlay: readonly string[],
): string | undefined => {
	const dealt = new Set(inPlay);
	return Object.keys(symbols).find((name) => dealt.has(name) && isScatterSymbol(symbols[name]));
};

/** A scatter's pays: its authored `paytable`, else {@link DEFAULT_SCATTER_PAYTABLE}. */
export const scatterPaytableOf = (symbol: PaytableSymbols[string] | undefined): PaytableRow[] =>
	symbol?.paytable?.length ? symbol.paytable : DEFAULT_SCATTER_PAYTABLE;

/** A {@link PayEntry} the info page shows — only ever one of the two modes it renders. */
export type ShownPayEntry = PayEntry & { on: { mode: 'line' | 'scatter' } };

const toEntry = (
	of: string,
	mode: 'line' | 'scatter',
	rows: readonly PaytableRow[],
): ShownPayEntry => {
	const row = payRowOf(rows);
	const occurs = Object.keys(row)
		.map(Number)
		.sort((a, b) => a - b);
	return { on: { occurs, of, mode }, pay: occurs.map((count) => row[count]) };
};

/**
 * The paytable the game's info page SHOWS, in dictionary order: a `line` row per in-play symbol that
 * authors one, then the `scatter` row of the first in-play scatter symbol. A scatter's `paytable` is
 * its scatter pay (× total bet), never a line row — a line evaluator never pays it, so listing it
 * among the line rows would quote a price nobody can win.
 *
 * One implementation for every side that has to agree: the game builds its info page from it
 * (`apps/lines/src/game/paytable.ts`), and `/config` and the publish gate compare it with a partner's
 * declared table. `inPlay` is the strip gate (`symbolsInPlay`) — passed in so this module stays
 * loadable by `node` directly.
 */
export const shownPaytable = (
	symbols: PaytableSymbols,
	inPlay: readonly string[],
): ShownPayEntry[] => {
	const dealt = new Set(inPlay);
	const names = Object.keys(symbols).filter((name) => dealt.has(name));
	const lines = names
		.filter((name) => !isScatterSymbol(symbols[name]) && symbols[name].paytable?.length)
		.map((name) => toEntry(name, 'line', symbols[name].paytable ?? []));
	const scatter = inPlayScatterSymbol(symbols, inPlay);
	return scatter
		? [...lines, toEntry(scatter, 'scatter', scatterPaytableOf(symbols[scatter]))]
		: lines;
};

/**
 * A declared paytable in the shape `/config` authors: line rows as `doc.symbols[name].paytable`
 * (one single-key `{ count: multiplier }` per paying count, ascending) and the scatter rows apart,
 * because they land on the dictionary's scatter symbol. Symbols must already be in engine names.
 */
export type ImportedPaytable = {
	lines: Record<string, PaytableRow[]>;
	scatter: PayEntry[];
};

/** Declared entries → {@link ImportedPaytable}. Zero, non-finite and non-count rows are dropped. */
export const toImportedPaytable = (declared: readonly unknown[]): ImportedPaytable => {
	const lines: Record<string, PaytableRow[]> = {};
	const scatter: PayEntry[] = [];
	for (const { symbol, mode, row } of indexRows(declared).values()) {
		const counts = Object.keys(row)
			.map(Number)
			.filter((count) => Number.isInteger(count) && count > 0)
			.sort((a, b) => a - b);
		if (!counts.length) continue;
		if (mode === 'scatter') {
			scatter.push({ on: { occurs: counts, of: symbol, mode }, pay: counts.map((c) => row[c]) });
		} else {
			lines[symbol] = counts.map((count) => ({ [String(count)]: row[count] }));
		}
	}
	return { lines, scatter };
};

/** One dictionary symbol the import would write, `current` → `server`. */
export type PaytableImportRow = {
	symbol: string;
	/** `scatter` rows pay × total bet and land on the scatter symbol's `paytable`, like a line row. */
	mode: 'line' | 'scatter';
	/** What the game shows today — for a scatter with nothing authored, the default row. */
	current: PaytableRow[];
	server: PaytableRow[];
	/** Same paying counts at the same multipliers — the import leaves it alone. */
	unchanged: boolean;
};

export type PaytableImportPlan = {
	rows: PaytableImportRow[];
	/** Server symbols with no dictionary entry. Never added — the import does not invent symbols. */
	skipped: string[];
	/** Dictionary symbols with an authored paytable the server prices no line row for. Left as is. */
	undeclared: string[];
};

function payRowOf(rows: readonly PaytableRow[] | undefined): PayRow {
	const out: PayRow = {};
	for (const row of rows ?? []) {
		for (const [count, pay] of Object.entries(row)) {
			if (Number.isFinite(pay) && pay > 0) out[Number(count)] = pay;
		}
	}
	return out;
}

/**
 * What importing `imported` into a dictionary would change, symbol by symbol, in dictionary order.
 * Pure, so the page plans against its LIVE (possibly unsaved) doc and applies exactly what it showed.
 *
 * A server scatter row lands on the dictionary symbol of the same name only when that symbol IS a
 * scatter; anything else would turn a scatter price into a line price. A scatter the server states
 * no row for is not `undeclared`: most servers never announce their scatter, and the default row
 * then stands.
 */
export const planPaytableImport = (
	symbols: PaytableSymbols,
	imported: ImportedPaytable,
): PaytableImportPlan => {
	const rows: PaytableImportRow[] = [];
	const undeclared: string[] = [];
	const scatterRows = new Map(
		imported.scatter.map(({ on, pay }) => [
			on.of,
			on.occurs.map((count, i) => ({ [String(count)]: pay[i] })),
		]),
	);
	for (const [symbol, entry] of Object.entries(symbols)) {
		if (isScatterSymbol(entry)) {
			const server = scatterRows.get(symbol);
			if (!server) continue;
			const current = scatterPaytableOf(entry);
			const unchanged = sameRow(payRowOf(current), payRowOf(server));
			rows.push({ symbol, mode: 'scatter', current, server, unchanged });
			continue;
		}
		const current = entry.paytable ?? [];
		const server = imported.lines[symbol];
		if (server) {
			const unchanged = sameRow(payRowOf(current), payRowOf(server));
			rows.push({ symbol, mode: 'line', current, server, unchanged });
		} else if (Object.keys(payRowOf(current)).length) {
			undeclared.push(symbol);
		}
	}
	const known = (symbol: string) => Object.hasOwn(symbols, symbol);
	const skipped = [
		...Object.keys(imported.lines).filter((symbol) => !known(symbol)),
		...[...scatterRows.keys()].filter(
			(symbol) => !known(symbol) || !isScatterSymbol(symbols[symbol]),
		),
	];
	return { rows, skipped, undeclared };
};

/** `3:5 4:20 5:100` — the compact row text the drift warning and the import review both print. */
export const formatPayRow = (rows: readonly PaytableRow[]): string => formatRow(payRowOf(rows));

/**
 * A partner server's declared paytable, captured in a browser on the partner's game and kept in the
 * config as the REFERENCE the authored table is checked against — the partner's edge challenges
 * server-side fetches, so a pasted capture is the only way its prices reach the launcher.
 */
export type PartnerPaytable = {
	/** ISO time the capture was imported. */
	capturedAt: string;
	/** Where it came from, as the author named it (a game or host) — for the banner, never fetched. */
	source: string;
	/** The declared rows, in ENGINE symbol names. */
	entries: PayEntry[];
	/** The symbols the partner's config deals, in engine names — limits `unshown` drift. */
	dealt?: string[];
};

/** Keeps a {@link PartnerPaytable} whose entries survive; anything else is dropped (undefined). */
export const normalizePartnerPaytable = (raw: unknown): PartnerPaytable | undefined => {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const entries = (Array.isArray(r.entries) ? r.entries : []).filter(isEntry).map((e) => ({
		on: { occurs: e.on.occurs.map(Number), of: e.on.of, mode: String(e.on.mode) },
		pay: e.pay.map(Number),
	}));
	if (!indexRows(entries).size) return undefined;
	const dealt = Array.isArray(r.dealt)
		? r.dealt.filter((s): s is string => typeof s === 'string' && s.length > 0)
		: [];
	return {
		capturedAt: typeof r.capturedAt === 'string' ? r.capturedAt : '',
		source: typeof r.source === 'string' ? r.source.slice(0, 200) : '',
		entries,
		...(dealt.length ? { dealt } : {}),
	};
};

/**
 * Where the paytable a config SHOWS disagrees with its partner reference — the `/config` banner and
 * the publish/deliver gate. Empty when no reference was captured, so a project that never pasted
 * one is never gated.
 */
export const partnerPaytableDrift = (
	symbols: PaytableSymbols,
	inPlay: readonly string[],
	partner: PartnerPaytable | undefined,
): PaytableDrift[] =>
	partner ? comparePaytables(shownPaytable(symbols, inPlay), partner.entries, partner.dealt) : [];
