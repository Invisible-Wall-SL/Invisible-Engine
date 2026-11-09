/**
 * Contract check for the Admin → Costs bulk import of historical spend:
 *   (discovered and run by `scripts/check-all.mjs`; alone:
 *    pnpm --filter launcher-api check:cost-import)
 *
 * Runs the real `parseCostImport` over the shapes a transcribed paste actually takes. Pinned:
 * a month written as a name is read whatever separates it from the fields (`May 2026, …`,
 * `May 2026<TAB>…`, `May 2026  …`), and an amount's thousands/decimal separators are never
 * mistaken for field separators (`2026-05, runpod, 1,234.56` is 1234.56, not 234.56) — plus
 * every form that already worked: single spaces, tabs, ISO and MM/YYYY months, Spanish month
 * names, `$`/`€` prefixes, `;` separators, `#` comments, and the per-line errors.
 */
import { parseAmount, parseCostImport } from '../src/lib/server/costs/importMonths';

let checks = 0;
let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	process.stderr.write(`FAIL ${name}\n  expected ${e}\n  actual   ${a}\n`);
}

/** One line in → its single row (without `source`), or its errors. */
function one(line: string): unknown {
	const { rows, errors } = parseCostImport(line);
	if (errors.length) return { errors };
	return rows.map(({ provider, year, month, usd }) => ({ provider, year, month, usd }));
}
const row = (provider: string, year: number, month: number, usd: number) => [
	{ provider, year, month, usd },
];

const RUNPOD_MAY = row('runpod', 2026, 5, 12.5);
const RUNPOD_MAY_BIG = row('runpod', 2026, 5, 1234.56);

// A month name followed by the line's own field separator.
check('name, comma-separated', one('May 2026, runpod, 12.50'), RUNPOD_MAY);
check('name, comma no spaces', one('May 2026,runpod,12.50'), RUNPOD_MAY);
check('name, tab-separated', one('May 2026\trunpod\t12.50'), RUNPOD_MAY);
check('name, two-space-separated', one('May 2026  runpod  12.50'), RUNPOD_MAY);
check('name, semicolon-separated', one('May 2026;runpod;12.50'), RUNPOD_MAY);
check('name with a period', one('Mar. 2026, runpod, 12.50'), row('runpod', 2026, 3, 12.5));
check('name, comma inside the month', one('May, 2026, runpod, 12.50'), RUNPOD_MAY);

// Thousands/decimal separators inside the amount.
check('ISO, commas, English amount', one('2026-05, runpod, 1,234.56'), RUNPOD_MAY_BIG);
check('ISO, commas, Spanish amount', one('2026-05,runpod,1.234,56'), RUNPOD_MAY_BIG);
check('name, commas, English amount', one('May 2026, runpod, $1,234.56'), RUNPOD_MAY_BIG);
check('name, commas, Spanish amount', one('mayo 2026,runpod,€1.234,56'), RUNPOD_MAY_BIG);
check('semicolons, Spanish amount', one('2026-05;runpod;1.234,56'), RUNPOD_MAY_BIG);
check('tabs, English amount', one('2026-05\trunpod\t$1,234.56'), RUNPOD_MAY_BIG);
check('commas, Spanish decimal only', one('2026-05, runpod, 12,50'), RUNPOD_MAY);
check('amount before provider', one('2026-05, 1,234.56, runpod'), RUNPOD_MAY_BIG);
check('commas, Spanish decimal, no spaces', one('2026-05,runpod,12,50'), RUNPOD_MAY);
check('commas, $ 1 234,56', one('2026-05, runpod, $ 1 234,56'), RUNPOD_MAY_BIG);
check('commas, thousands only', one('2026-05,runpod,$1,234'), row('runpod', 2026, 5, 1234));
// A complete amount followed by another column that starts with a digit stays separate.
check('amount then a note column', one('2026-05,runpod,12.50,7 GPUs'), RUNPOD_MAY);

// A provider alias ending in a digit, then a comma: the comma still separates.
check('alias ending in a digit, commas', one('2026-05,r2,4'), row('r2', 2026, 5, 4));
check('alias ending in a digit, mixed', one('2026-05, r2,4'), row('r2', 2026, 5, 4));
check(
	'alias ending in a digit, big amount',
	one('May 2026,cfr2,1,234.56'),
	row('r2', 2026, 5, 1234.56),
);

// Forms that already worked.
check('name, single spaces', one('May 2026 runpod 12.50'), RUNPOD_MAY);
check('ISO, single spaces', one('2026-05 runpod 12.50'), RUNPOD_MAY);
check('ISO, tabs', one('2026-05\trunpod\t12.50'), RUNPOD_MAY);
check('ISO with a day', one('2026-05-01 runpod 12.50'), RUNPOD_MAY);
check('YYYY/MM', one('2026/05 runpod 12.50'), RUNPOD_MAY);
check('MM/YYYY', one('05/2026 runpod 12.50'), RUNPOD_MAY);
check('M/YYYY, commas', one('5/2026,runpod,12.50'), RUNPOD_MAY);
check('Spanish name', one('marzo 2026 railway 3'), row('railway', 2026, 3, 3));
check('Spanish abbreviation', one('dic 2025 openai 7.10'), row('openai', 2025, 12, 7.1));
check('full English name', one('September 2026 claude 40'), row('anthropic', 2026, 9, 40));
check('name case-insensitive', one('MAY 2026 RunPod 12.50'), RUNPOD_MAY);
check('dollar prefix', one('2026-05 runpod $12.50'), RUNPOD_MAY);
check('dollar with a space', one('2026-05\trunpod\t$ 12.50'), RUNPOD_MAY);
check('euro prefix', one('2026-05 runpod €12,50'), RUNPOD_MAY);
check('single-space English thousands', one('2026-05 runpod 1,234.56'), RUNPOD_MAY_BIG);
check('single-space Spanish thousands', one('2026-05 runpod 1.234,56'), RUNPOD_MAY_BIG);
check('amount then provider, spaces', one('2026-05 12.50 runpod'), RUNPOD_MAY);
check('two-word provider, spaces', one('2026-05 Cloudflare R2 4'), row('r2', 2026, 5, 4));
check('two-word provider, tabs', one('2026-05\tCloudflare R2\t4'), row('r2', 2026, 5, 4));
check(
	'agents provider, tabs',
	one('2026-05\tAnthropic (agents)\t9'),
	row('anthropicAgents', 2026, 5, 9),
);
check('provider alias', one('2026-05, gpu, 12.50'), RUNPOD_MAY);

// Comments, blanks, and a multi-line paste.
const block = parseCostImport(
	[
		'# month, provider, amount',
		'',
		'May 2026, runpod, 12.50',
		'   ',
		'2026-04\trailway\t1,234.56',
		'03/2026;r2;1.234,56',
	].join('\r\n'),
);
check('block errors', block.errors, []);
check(
	'block rows',
	block.rows.map(({ provider, year, month, usd }) => [provider, year, month, usd]),
	[
		['runpod', 2026, 5, 12.5],
		['railway', 2026, 4, 1234.56],
		['r2', 2026, 3, 1234.56],
	],
);
check('source echoed', block.rows[0]?.source, 'May 2026, runpod, 12.50');

// Per-line errors stay per line.
check('no month', one('runpod 12.50'), { errors: ['Couldn\'t read a month from: "runpod 12.50"'] });
check('not a month name', one('Foo 2026, runpod, 1'), {
	errors: ['Couldn\'t read a month from: "Foo 2026, runpod, 1"'],
});
check('month out of range', one('2026-13 runpod 1'), {
	errors: ['Month out of range in: "2026-13 runpod 1"'],
});
check('no provider', one('2026-05, acme, 1'), {
	errors: ['Couldn\'t read a provider from: "2026-05, acme, 1"'],
});
check('no amount', one('May 2026, runpod'), {
	errors: ['Couldn\'t read an amount from: "May 2026, runpod"'],
});
check('negative amount', one('2026-05 runpod -3'), {
	errors: ['Negative amount in: "2026-05 runpod -3"'],
});
const mixed = parseCostImport('May 2026, runpod, 12.50\nnonsense\n2026-06 railway 2');
check('bad line does not sink the paste', mixed.rows.length, 2);
check('bad line reported', mixed.errors.length, 1);

// parseAmount itself.
check('parseAmount English', parseAmount('1,234.56'), 1234.56);
check('parseAmount Spanish', parseAmount('1.234,56'), 1234.56);
check('parseAmount thousands only', parseAmount('12,345,678'), 12345678);
check('parseAmount decimal comma', parseAmount('12,5'), 12.5);
check('parseAmount currency', parseAmount('$ 12.50'), 12.5);
check('parseAmount empty', parseAmount('$'), null);
check('parseAmount word', parseAmount('runpod'), null);

if (failures) {
	process.stderr.write(`\n${failures}/${checks} cost-import checks failed\n`);
	process.exit(1);
}
console.log(`cost-import: ${checks} checks passed`);
