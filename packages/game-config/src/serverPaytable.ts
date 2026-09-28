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
