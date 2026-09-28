// Offline fixture for the PAYTABLE IMPORT — `/config`'s "Import from server" button, which turns
// the operator's declared paytable into the rows Invisible Game Config stores
// (`packages/rgs-translator-eagaming/src/paytable.ts` reads + names the wire,
// `packages/game-config/src/serverPaytable.ts` converts + plans).
//
//   node scripts/verify-server-paytable-import.mts
//
// Needs Node's TypeScript type-stripping: on by default from 22.18; on 22.16/22.17 add
// `--experimental-strip-types`.
//
// WHAT IT PROVES. The import is a reviewable authoring action, so what it shows must be exactly what
// it writes, and what it writes must be exactly what the boot cross-check then accepts. It must:
//
//   1. read both real wire shapes — the Book `{ line, scatter }` groups and the lines mock's
//      symbol-keyed `{ occurs, pay }` — and name them in ENGINE symbols via the vocabulary-picked
//      mapping (the same pick the facade makes at boot);
//   2. store line rows in the authored shape: one single-key `{ count: multiplier }` per paying
//      count, ascending, zero pays dropped;
//   3. keep scatter rows apart — they have no authored home — and say whether they match the row
//      the info page synthesizes;
//   4. plan against the dictionary: unchanged vs changed, skip server symbols it has no entry for
//      (never invent one), and leave alone what the server does not price;
//   5. once applied, leave the boot cross-check with nothing to say about line rows.

import {
	bookMapping,
	linesMapping,
	pickMappingForConfig,
} from '../packages/rgs-translator-eagaming/src/gameMappings.ts';
import {
	readDeclaredPaytable,
	readMappedPaytable,
} from '../packages/rgs-translator-eagaming/src/paytable.ts';
import {
	comparePaytables,
	formatPayRow,
	planPaytableImport,
	toImportedPaytable,
	type PayEntry,
} from '../packages/game-config/src/serverPaytable.ts';
import type { PaytableRow } from '../packages/game-config/src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `scripts/mock-rgs-server-book.mjs`'s boot config, which mirrors the live Book of Thermopylae. */
const BOOK_LINE: Record<string, Record<number, number>> = {
	PIC1: { 2: 10, 3: 100, 4: 1000, 5: 5000 },
	PIC2: { 2: 10, 3: 30, 4: 400, 5: 2000 },
	PIC3: { 2: 5, 3: 30, 4: 100, 5: 750 },
	PIC4: { 2: 5, 3: 20, 4: 100, 5: 750 },
	ACE: { 3: 5, 4: 50, 5: 150 },
	KING: { 3: 5, 4: 50, 5: 150 },
	QUEEN: { 3: 5, 4: 20, 5: 100 },
	JACK: { 3: 5, 4: 20, 5: 100 },
	TEN: { 3: 5, 4: 20, 5: 100 },
};
const BOOK_CONFIG = {
	symbols: [...Object.keys(BOOK_LINE), 'SCAT'],
	paytable: {
		line: Object.entries(BOOK_LINE).map(([of, row]) => {
			const counts = Object.keys(row).map(Number);
			return { on: { occurs: counts, of, mode: 'line' }, pay: counts.map((c) => row[c]) };
		}),
		scatter: [
			{
				on: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter' },
				pay: [2, 20, 200],
				trigger: 'feature',
			},
		],
	},
	symbolsPay: { line: Object.keys(BOOK_LINE), scatter: ['SCAT'] },
};

/** `scripts/mock-rgs-server.mjs`'s shape: keyed by symbol, no mode, no scatter row announced. */
const LINES_CONFIG = {
	symbols: ['PIC1', 'PIC5', 'PIC7', 'SCAT'],
	paytable: {
		PIC1: { occurs: [3, 4, 5], pay: [200, 1000, 5000] },
		PIC5: { occurs: [5, 3, 4], pay: [200, 15, 75] },
		PIC7: { occurs: [2, 3, 4, 5], pay: [0, 5, 25, 50] },
	},
};

const rows = (row: Record<number, number>): PaytableRow[] =>
	Object.keys(row)
		.map(Number)
		.sort((a, b) => a - b)
		.map((count) => ({ [String(count)]: row[count] }));

// --- 1. WIRE SHAPES → ENGINE NAMES ---------------------------------------------------------------
{
	check(
		'Book vocabulary picks the book mapping',
		pickMappingForConfig(BOOK_CONFIG) === bookMapping,
	);
	check('lines vocabulary picks the lines mapping', pickMappingForConfig(LINES_CONFIG) === linesMapping); // prettier-ignore
	check('an undecidable vocabulary picks nothing', pickMappingForConfig({ symbols: ['PIC1', 'SCAT'] }) === null); // prettier-ignore

	const book = toImportedPaytable(readMappedPaytable(BOOK_CONFIG, bookMapping) ?? []);
	check(
		'Book groups ⇒ nine line symbols in engine names',
		same(Object.keys(book.lines), ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5']),
		Object.keys(book.lines).join(','),
	);
	check('Book PIC1 ⇒ H1 in the stored row shape', same(book.lines.H1, [{ '2': 10 }, { '3': 100 }, { '4': 1000 }, { '5': 5000 }]), JSON.stringify(book.lines.H1)); // prettier-ignore
	check('Book TEN ⇒ L5', same(book.lines.L5, rows(BOOK_LINE.TEN)));

	const lines = toImportedPaytable(readMappedPaytable(LINES_CONFIG, linesMapping) ?? []);
	check('lines mock PIC1 ⇒ H1', same(lines.lines.H1, [{ '3': 200 }, { '4': 1000 }, { '5': 5000 }]));
	check('lines mock PIC7 ⇒ L5, its zero-paying 2-of-a-kind dropped', same(lines.lines.L5, [{ '3': 5 }, { '4': 25 }, { '5': 50 }]), JSON.stringify(lines.lines.L5)); // prettier-ignore
	check('rows are stored ascending whatever the wire order', same(lines.lines.L1, [{ '3': 15 }, { '4': 75 }, { '5': 200 }]), JSON.stringify(lines.lines.L1)); // prettier-ignore
	check('no scatter row announced ⇒ no scatter rows', lines.scatter.length === 0);

	const parity = (readDeclaredPaytable(BOOK_CONFIG.paytable, ['SCAT']) ?? []).map((e) => ({
		...e,
		on: { ...e.on, of: bookMapping.symbols[e.on.of] ?? e.on.of },
	}));
	check('readMappedPaytable is the facade read, unchanged', same(readMappedPaytable(BOOK_CONFIG, bookMapping), parity)); // prettier-ignore
	check('no declared paytable ⇒ null', readMappedPaytable({ paytable: {} }, bookMapping) === null);
}

// --- 2. ZERO / JUNK ROWS -------------------------------------------------------------------------
{
	const imported = toImportedPaytable([
		{ on: { occurs: [3, 4, 5], of: 'H1', mode: 'line' }, pay: [0, 0, 0] },
		{ on: { occurs: [0, 3, 2.5], of: 'H2', mode: 'line' }, pay: [9, 4, 7] },
		{ on: { occurs: 3, of: 'H3', mode: 'line' }, pay: [1] },
		null,
	]);
	check('a symbol paying nothing is not imported', !('H1' in imported.lines));
	check('non-count occurs (0, 2.5) are dropped', same(imported.lines.H2, [{ '3': 4 }]), JSON.stringify(imported.lines.H2)); // prettier-ignore
	check('malformed entries are skipped, not thrown on', !('H3' in imported.lines));
}

// --- 3. SCATTER KEPT APART ------------------------------------------------------------------------
{
	const book = toImportedPaytable(readMappedPaytable(BOOK_CONFIG, bookMapping) ?? []);
	check('the Book scatter is not a line row', !('S' in book.lines));
	check('…and is kept as a scatter entry named S', same(book.scatter, [{ on: { occurs: [3, 4, 5], of: 'S', mode: 'scatter' }, pay: [2, 20, 200] }]), JSON.stringify(book.scatter)); // prettier-ignore

	const modeless = toImportedPaytable(
		readMappedPaytable(
			{
				paytable: { SCAT: [{ on: { occurs: [3], of: 'SCAT' }, pay: [5] }] },
				symbolsPay: { scatter: ['SCAT'] },
			},
			bookMapping,
		) ?? [],
	);
	check('a mode-less row for a declared scatter symbol is a scatter row', modeless.scatter[0]?.on.of === 'S' && !('S' in modeless.lines)); // prettier-ignore
}

// --- 4. THE PLAN ---------------------------------------------------------------------------------
{
	const imported = toImportedPaytable(readMappedPaytable(BOOK_CONFIG, bookMapping) ?? []);
	const dictionary: Record<string, { paytable?: PaytableRow[]; special_properties?: string[] }> = {
		H1: { paytable: [{ '5': 5000 }, { '4': 1000 }, { '3': 100 }, { '2': 10 }] },
		H2: { paytable: [{ '3': 5 }, { '4': 10 }, { '5': 20 }] },
		H3: { paytable: [{ '1': 0 }, ...rows(BOOK_LINE.PIC3)] },
		L1: {},
		W: { paytable: [{ '3': 5 }] },
		S: { special_properties: ['scatter'] },
	};
	const plan = planPaytableImport(dictionary, imported);
	const byName = Object.fromEntries(plan.rows.map((r) => [r.symbol, r]));
	check('rows follow dictionary order', same(plan.rows.map((r) => r.symbol), ['H1', 'H2', 'H3', 'L1']), plan.rows.map((r) => r.symbol).join(',')); // prettier-ignore
	check('same pays in another order ⇒ unchanged', byName.H1.unchanged);
	check('a zero row on the authored side does not count as a difference', byName.H3.unchanged);
	check('different pays ⇒ changed, server rows carried', !byName.H2.unchanged && same(byName.H2.server, rows(BOOK_LINE.PIC2))); // prettier-ignore
	check('an unpriced dictionary symbol the server prices ⇒ changed', !byName.L1.unchanged && byName.L1.current.length === 0); // prettier-ignore
	check('server symbols with no dictionary entry are skipped, never added', same(plan.skipped, ['H4', 'L2', 'L3', 'L4', 'L5']), plan.skipped.join(',')); // prettier-ignore
	check('an authored row the server does not price is listed, not cleared', same(plan.undeclared, ['W']), plan.undeclared.join(',')); // prettier-ignore
	check('the Book scatter matches the synthesized info-page row', plan.scatter.length === 1 && plan.scatter[0].symbol === 'S' && plan.scatter[0].matchesShown); // prettier-ignore

	const other = planPaytableImport(dictionary, {
		lines: {},
		scatter: [{ on: { occurs: [3, 4, 5], of: 'S', mode: 'scatter' }, pay: [2, 10, 100] }],
	});
	check('a different scatter row is flagged as not matching', !other.scatter[0].matchesShown);
	check('formatPayRow prints ascending, zero-free', formatPayRow(dictionary.H3.paytable ?? []) === '2:5 3:30 4:100 5:750', formatPayRow(dictionary.H3.paytable ?? [])); // prettier-ignore
	check('formatPayRow of nothing is a dash', formatPayRow([]) === '—');
}

// --- 5. APPLIED ⇒ THE BOOT CHECK IS SATISFIED ----------------------------------------------------
{
	const declared = readMappedPaytable(BOOK_CONFIG, bookMapping) ?? [];
	const imported = toImportedPaytable(declared);
	const dictionary: Record<string, { paytable?: PaytableRow[] }> = Object.fromEntries(
		['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'].map((s) => [
			s,
			{ paytable: [{ '3': 1 }] },
		]),
	);
	for (const row of planPaytableImport(dictionary, imported).rows) {
		if (!row.unchanged) dictionary[row.symbol].paytable = row.server;
	}
	const shown: PayEntry[] = Object.entries(dictionary).map(([of, { paytable = [] }]) => ({
		on: { occurs: paytable.map((r) => Number(Object.keys(r)[0])), of, mode: 'line' },
		pay: paytable.map((r) => Object.values(r)[0]),
	}));
	const drift = comparePaytables(
		shown,
		declared.filter((e) => e.on.mode !== 'scatter'),
	);
	check('after applying, the cross-check finds no line drift', drift.length === 0, JSON.stringify(drift)); // prettier-ignore
	check('…and a second import is all unchanged', planPaytableImport(dictionary, imported).rows.every((r) => r.unchanged)); // prettier-ignore
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
