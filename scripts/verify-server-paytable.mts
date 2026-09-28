// Offline fixture for the PAYTABLE CROSS-CHECK — the operator's declared paytable against the one
// the game shows (`packages/rgs-translator-eagaming/src/paytable.ts` reads the wire,
// `packages/game-config/src/serverPaytable.ts` compares).
//
//   node scripts/verify-server-paytable.mts
//
// Needs Node's TypeScript type-stripping: on by default from 22.18; on 22.16/22.17 add
// `--experimental-strip-types`.
//
// WHAT IT PROVES. The info page is built from the AUTHORED config; the server pays off its own
// math. Nothing compared them, so a partner changing a price would leave the game quoting one
// paytable while paying another. The check must:
//
//   1. read every wire shape in the wild — a reader that knew only one would answer "no paytable"
//      for the others, which silently switches the check OFF;
//   2. stay silent when the two agree and when the server declares nothing;
//   3. name each disagreeing row, in both directions, including a count one side pays and the
//      other does not;
//   4. not report what the server never stated — our lines mock pays its scatter off a table it
//      never announces, and flagging that on every game would teach everyone to ignore the warning;
//   5. never throw on a malformed row — it runs at boot in every online game.

import { readDeclaredPaytable } from '../packages/rgs-translator-eagaming/src/paytable.ts';
import {
	comparePaytables,
	describePaytableDrift,
	type PayEntry,
} from '../packages/game-config/src/serverPaytable.ts';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const entry = (mode: string, of: string, occurs: number[], pay: number[]): PayEntry => ({
	on: { occurs, of, mode },
	pay,
});
const line = (of: string, occurs: number[], pay: number[]) => entry('line', of, occurs, pay);
const scatter = (of: string, occurs: number[], pay: number[]) => entry('scatter', of, occurs, pay);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** What the facade does after reading: map the server's names into the engine's. */
const mapped = (entries: PayEntry[] | null, names: Record<string, string>) =>
	(entries ?? []).map((e) => ({ ...e, on: { ...e.on, of: names[e.on.of] ?? e.on.of } }));
const kinds = (drift: ReturnType<typeof comparePaytables>) =>
	drift
		.map((d) => `${d.kind}:${d.symbol}/${d.mode}`)
		.sort()
		.join(',');

const BOOK_NAMES = { PIC1: 'H1', PIC2: 'H2', ACE: 'L1', SCAT: 'S' };
const PIC_NAMES = { PIC1: 'H1', PIC7: 'L5', WILD: 'W' };
const SCAT_3_4_5 = { on: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter' }, pay: [2, 20, 200] };

// --- 1. WIRE SHAPES ------------------------------------------------------------------------------
{
	check('no paytable ⇒ null (the check stays off)', readDeclaredPaytable(undefined) === null);
	check('empty object ⇒ null', readDeclaredPaytable({}) === null);
	const garbage = readDeclaredPaytable({ PIC1: { occurs: [3], pay: ['x'] }, junk: 7 });
	check('garbage ⇒ null, not half-read', garbage === null);

	// The live Book of Thermopylae wire, as `scripts/mock-rgs-server-book.mjs` mirrors it.
	const grouped = readDeclaredPaytable({
		line: [{ on: { occurs: [2, 3, 4, 5], of: 'PIC1', mode: 'line' }, pay: [10, 100, 1000, 5000] }],
		scatter: [{ ...SCAT_3_4_5, trigger: 'feature' }],
	});
	const groupedWant = [
		line('PIC1', [2, 3, 4, 5], [10, 100, 1000, 5000]),
		scatter('SCAT', [3, 4, 5], [2, 20, 200]),
	];
	check('grouped by mode ⇒ both rows, modes kept', same(grouped, groupedWant));

	// Our lines mock (`scripts/mock-rgs-server.mjs`): keyed by symbol, no mode.
	const keyed = readDeclaredPaytable({ PIC1: { occurs: [3, 4, 5], pay: [200, 1000, 5000] } });
	const keyedWant = [line('PIC1', [3, 4, 5], [200, 1000, 5000])];
	check('keyed by symbol ⇒ a line row named by its key', same(keyed, keyedWant));

	// The shape their client names: a symbol key holding entries, `on` without a mode.
	const keyedEntries = readDeclaredPaytable(
		{
			PIC1: [{ on: { occurs: [3], of: 'PIC1' }, pay: [100] }],
			SCAT: [{ on: { occurs: [3], of: 'SCAT' }, pay: [2] }],
		},
		['SCAT'],
	);
	const keyedEntriesWant = [line('PIC1', [3], [100]), scatter('SCAT', [3], [2])];
	check(
		'mode-less rows: the declared scatter symbol reads as scatter, the rest as line',
		same(keyedEntries, keyedEntriesWant),
		JSON.stringify(keyedEntries),
	);

	const flat = readDeclaredPaytable([{ on: { occurs: [3], of: 'ACE', mode: 'line' }, pay: [5] }]);
	check('flat entry array ⇒ read', same(flat, [line('ACE', [3], [5])]));
}

// --- 2. AGREEMENT IS SILENT ----------------------------------------------------------------------
{
	const declared = mapped(
		readDeclaredPaytable({
			line: [
				{ on: { occurs: [2, 3, 4, 5], of: 'PIC1', mode: 'line' }, pay: [10, 100, 1000, 5000] },
				{ on: { occurs: [3, 4, 5], of: 'ACE', mode: 'line' }, pay: [5, 50, 150] },
			],
			scatter: [SCAT_3_4_5],
		}),
		BOOK_NAMES,
	);
	const shown = [
		line('H1', [5, 4, 3, 2], [5000, 1000, 100, 10]),
		line('L1', [3, 4, 5], [5, 50, 150]),
		scatter('S', [3, 4, 5], [2, 20, 200]),
	];
	check('shown = declared ⇒ no drift (order-independent)', !comparePaytables(shown, declared).length); // prettier-ignore

	const fractional = comparePaytables([line('L1', [3], [0.1 + 0.3])], [line('L1', [3], [0.4])]);
	check('fractional multipliers compare by value', fractional.length === 0);
	const zeroed = comparePaytables([line('L1', [2, 3], [0, 5])], [line('L1', [3], [5])]);
	check('a zero pay is the same claim as no entry', zeroed.length === 0);

	// A ways server labels its rows `ways`; the info page labels the same rows `line`.
	const ways = comparePaytables([line('H1', [3, 4, 5], [1, 2, 5])], [entry('ways', 'H1', [3, 4, 5], [1, 2, 5])]); // prettier-ignore
	check('a ways server is compared against the shown rows, not reported beside them', ways.length === 0, kinds(ways)); // prettier-ignore
}

// --- 3. DISAGREEMENT IS NAMED --------------------------------------------------------------------
{
	const h1 = line('H1', [3, 4, 5], [100, 1000, 5000]);
	const l5 = line('L5', [3, 4, 5], [5, 25, 50]);
	const shown = [h1, l5];

	const repriced = comparePaytables(shown, [line('H1', [3, 4, 5], [100, 1000, 4000]), l5]);
	check('a changed price ⇒ differs', kinds(repriced) === 'differs:H1/line', kinds(repriced));
	const message = describePaytableDrift(repriced[0]);
	const want = 'H1 (line): shows 3:100 4:1000 5:5000, server pays 3:100 4:1000 5:4000';
	check('the message names both sides', message === want, message);

	// Hot Fruits' PIC7 pays 2-of-a-kind — a count the display never quotes is still a disagreement.
	const extra = comparePaytables(shown, [h1, line('L5', [2, 3, 4, 5], [5, 5, 25, 50])]);
	check('the server pays a count the display omits ⇒ differs', kinds(extra) === 'differs:L5/line', kinds(extra)); // prettier-ignore

	const wild = line('W', [3, 4, 5], [20, 50, 100]);
	const unshown = comparePaytables(shown, [...shown, wild], ['H1', 'L5', 'W']);
	check('the server pays a dealt symbol the player is never shown ⇒ unshown', kinds(unshown) === 'unshown:W/line', kinds(unshown)); // prettier-ignore
	const undealt = comparePaytables(shown, [...shown, wild], ['H1', 'L5']);
	check('…but not a symbol it never deals (that price pays nothing)', undealt.length === 0, kinds(undealt)); // prettier-ignore
	const shownAtZero = comparePaytables([...shown, line('W', [3], [0])], [...shown, wild], ['W']);
	check('a symbol shown paying nothing does not hide the server pricing it', kinds(shownAtZero) === 'unshown:W/line', kinds(shownAtZero)); // prettier-ignore

	const undeclared = comparePaytables(shown, [h1]);
	check('the player is quoted a line row the server does not price ⇒ undeclared', kinds(undeclared) === 'undeclared:L5/line', kinds(undeclared)); // prettier-ignore

	const modeSwap = comparePaytables([scatter('S', [3, 4, 5], [2, 20, 200])], [line('S', [3, 4, 5], [2, 20, 200])], ['S']); // prettier-ignore
	check('same numbers, different mode ⇒ not agreement', kinds(modeSwap) === 'unshown:S/line', kinds(modeSwap)); // prettier-ignore
}

// --- 4. SILENCE IS NOT DRIFT ---------------------------------------------------------------------
{
	// Our lines mock declares line rows (the project's own table) and NO scatter rows at all.
	const declared = mapped(
		readDeclaredPaytable({ PIC1: { occurs: [3, 4, 5], pay: [100, 1000, 5000] } }),
		PIC_NAMES,
	);
	const shown = [line('H1', [3, 4, 5], [100, 1000, 5000]), scatter('S', [3, 4, 5], [2, 20, 200])];
	check('no scatter rows declared ⇒ the shown scatter row is not reported', !comparePaytables(shown, declared).length); // prettier-ignore
}

// --- 5. A MALFORMED ROW COSTS A ROW, NEVER THE GAME ----------------------------------------------
{
	const junk = [null, 7, 'x', {}, { on: null }, { on: { of: 'H1' } }, { on: { of: 'H1', occurs: 3 }, pay: [1] }]; // prettier-ignore
	let threw = '';
	let drift: ReturnType<typeof comparePaytables> = [];
	try {
		drift = comparePaytables([line('H1', [3], [5])], [...junk, line('H1', [3], [5])]);
	} catch (err) {
		threw = String(err);
	}
	check('malformed declared rows are skipped, the good one still compared', !threw && !drift.length, threw || kinds(drift)); // prettier-ignore
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
