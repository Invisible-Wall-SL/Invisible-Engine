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

/**
 * The scatter row the info page SHOWS. Synthesized, not authored — the config has no home for
 * scatter multipliers — by `scatterEntry` in `apps/lines/src/game/paytable.ts`; keep the two equal.
 */
export const SHOWN_SCATTER_ROWS: PaytableRow[] = [{ '3': 2 }, { '4': 20 }, { '5': 200 }];

/**
 * A declared paytable in the shape `/config` authors: line rows as `doc.symbols[name].paytable`
 * (one single-key `{ count: multiplier }` per paying count, ascending) and the scatter rows apart,
 * because they have no authored home. Symbols must already be in engine names.
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
	/** The server's scatter rows, information only, against the synthesized {@link SHOWN_SCATTER_ROWS}. */
	scatter: { symbol: string; rows: PaytableRow[]; matchesShown: boolean }[];
};

const payRowOf = (rows: readonly PaytableRow[] | undefined): PayRow => {
	const out: PayRow = {};
	for (const row of rows ?? []) {
		for (const [count, pay] of Object.entries(row)) {
			if (Number.isFinite(pay) && pay > 0) out[Number(count)] = pay;
		}
	}
	return out;
};

/**
 * What importing `imported` into a dictionary would change, symbol by symbol, in dictionary order.
 * Pure, so the page plans against its LIVE (possibly unsaved) doc and applies exactly what it showed.
 */
export const planPaytableImport = (
	symbols: Readonly<Record<string, { paytable?: PaytableRow[] }>>,
	imported: ImportedPaytable,
): PaytableImportPlan => {
	const rows: PaytableImportRow[] = [];
	const undeclared: string[] = [];
	for (const [symbol, entry] of Object.entries(symbols)) {
		const current = entry.paytable ?? [];
		const server = imported.lines[symbol];
		if (server) {
			const unchanged = sameRow(payRowOf(current), payRowOf(server));
			rows.push({ symbol, current, server, unchanged });
		} else if (Object.keys(payRowOf(current)).length) {
			undeclared.push(symbol);
		}
	}
	return {
		rows,
		skipped: Object.keys(imported.lines).filter((symbol) => !Object.hasOwn(symbols, symbol)),
		undeclared,
		scatter: imported.scatter.map(({ on, pay }) => {
			const rows = on.occurs.map((count, i) => ({ [String(count)]: pay[i] }));
			return {
				symbol: on.of,
				rows,
				matchesShown: sameRow(payRowOf(rows), payRowOf(SHOWN_SCATTER_ROWS)),
			};
		}),
	};
};

/** `3:5 4:20 5:100` — the compact row text the drift warning and the import review both print. */
export const formatPayRow = (rows: readonly PaytableRow[]): string => formatRow(payRowOf(rows));
