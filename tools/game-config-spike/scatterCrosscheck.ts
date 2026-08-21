/**
 * Prove the verifier scores scatter pays the way the ENGINE does.
 *
 *   pnpm --filter game-config-spike run scattercrosscheck
 *
 * `scatterEvaluator.ts` re-expresses the count-anywhere rule against a Game Config doc, because
 * `mock-rgs-server`'s `evaluateScatterPays` is bound to the mock's own PIC/SCAT vocabulary and
 * cannot score a project config. Two implementations of one rule is how a measurement quietly stops
 * describing the game, so this holds them against each other on random boards and asserts they
 * agree on what decides a pay: which symbol wins, on what count, for how much.
 *
 * The mock takes the project's own count-keyed table through `opts.symbolPaytable`, so the two can
 * be pointed at exactly the same paytable — agreement therefore covers the THRESHOLD lookup (a row
 * is "10+", not "exactly 10"), which is the part that is easy to get wrong and silent when it is.
 */

import { evaluateScatterPays as mockEvaluateScatterPays } from '../../scripts/mock-rgs-server.mjs';

import { buildRules, makeRng, type Doc } from './waysEvaluator';
import { evaluateScatterPaysDoc } from './scatterEvaluator';

/**
 * A SPARSE table on purpose. A dense one hides the threshold rule: every count would find an exact
 * row, so an exact-match lookup and a highest-tier-at-or-below lookup agree everywhere. The gaps
 * (11, 12, 14+) are where the two diverge, and the mock shipped that exact bug once.
 */
const MOCK_PAY: Record<string, Record<number, number>> = {
	PIC1: { 8: 20, 9: 50, 10: 100, 13: 400 },
	PIC2: { 8: 10, 9: 25, 10: 50, 13: 200 },
	PIC3: { 8: 5, 10: 20, 13: 80 },
	PIC4: { 8: 3, 9: 7.5, 10: 15, 13: 60 },
	PIC5: { 8: 2, 10: 8, 13: 30 },
	PIC6: { 8: 1.5, 9: 3, 10: 6, 13: 24 },
	PIC7: { 8: 1, 10: 4, 13: 16 },
};

/**
 * A DENSE table with a low floor. The sparse one above cannot exercise a low `minCount`: its
 * lowest row is 8, so a count of 3 clears the threshold and then finds no row to price it —
 * both scorers correctly pay nothing, and the comparison is agreement about nothing. This one
 * makes almost every board pay, so the check is dense rather than mostly-empty.
 */
const DENSE_PAY: Record<string, Record<number, number>> = Object.fromEntries(
	Object.entries(MOCK_PAY).map(([sym, table]) => [sym, { 3: 0.5, 5: 2, ...table }]),
);

/** A synthetic Game Config doc whose rules ARE the mock's, so the two scorers are comparable. */
const mockAsDoc = (withWild: boolean, pay: Record<string, Record<number, number>>): Doc => ({
	numReels: 6,
	numRows: [5, 5, 5, 5, 5, 5],
	symbols: {
		...Object.fromEntries(
			Object.entries(pay).map(([sym, table]) => [
				sym,
				{ paytable: Object.entries(table).map(([occurs, mult]) => ({ [occurs]: mult })) },
			]),
		),
		SCAT: { paytable: null, special_properties: ['scatter'] },
		...(withWild ? { WILD: { paytable: null, special_properties: ['wild'] } } : {}),
	},
});

const POOL_NO_WILD = [...Object.keys(MOCK_PAY), 'SCAT'];
const POOL_WILD = [...POOL_NO_WILD, 'WILD'];

let failed = 0;
const fail = (msg: string) => {
	failed += 1;
	console.error(`  FAIL  ${msg}`);
};

/**
 * As in the ways crosscheck, the two wild modes are checked separately: the mock only substitutes
 * when a wild paytable is supplied, so without one `WILD` must never reach the board at all or the
 * mock would treat it as an ordinary non-matching cell while the doc-scorer substitutes.
 */
const run = (
	label: string,
	withWild: boolean,
	minCount: number,
	pay: Record<string, Record<number, number>>,
	boards: number,
) => {
	const rand = makeRng(withWild ? 4242 : 77);
	const rules = buildRules(mockAsDoc(withWild, pay));
	const pool = withWild ? POOL_WILD : POOL_NO_WILD;
	const wild = withWild ? { paytable: { 8: 1, 10: 2, 13: 3 } } : null;
	const betPerSpin = 1;

	let compared = 0;
	let withWins = 0;

	for (let i = 0; i < boards; i++) {
		const board = Array.from({ length: 6 }, () =>
			Array.from({ length: 5 }, () => pool[Math.floor(rand() * pool.length)]),
		);

		const mine = evaluateScatterPaysDoc(board, rules, minCount, betPerSpin)
			.map((w) => `${w.symbol}:${w.count}:${w.pay.toFixed(6)}`)
			.sort();
		const theirs = (
			mockEvaluateScatterPays(board, betPerSpin, wild, {
				minCount,
				symbolPaytable: pay,
			}) as { what: string; occurs: number; pay: number }[]
		)
			.map((w) => `${w.what}:${w.occurs}:${w.pay.toFixed(6)}`)
			.sort();

		if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
			fail(
				`${label} board ${i}\n        doc  ${JSON.stringify(mine)}\n        mock ${JSON.stringify(theirs)}`,
			);
			if (failed > 4) return { compared, withWins };
		}
		compared += 1;
		if (mine.length) withWins += 1;
	}
	return { compared, withWins };
};

console.log('scatter evaluator cross-check — doc-scorer vs mock-rgs-server evaluateScatterPays\n');

for (const [label, withWild] of [
	['no wild', false],
	['with wild', true],
] as const) {
	// The sparse table exercises the THRESHOLD gaps (11, 12, 14+); the dense one makes almost
	// every board pay, so the check is not mostly-empty agreement about nothing.
	for (const [table, pay, minCount] of [
		['sparse', MOCK_PAY, 8],
		['dense ', DENSE_PAY, 3],
	] as const) {
		const { compared, withWins } = run(
			`${label} ${table}`,
			withWild,
			minCount,
			pay as Record<string, Record<number, number>>,
			20_000,
		);
		console.log(
			`  ${label.padEnd(9)} ${table} table, minCount ${String(minCount).padEnd(2)}  ` +
				`${compared.toLocaleString()} boards, ${withWins.toLocaleString()} with wins`,
		);
	}
}

console.log(
	failed === 0
		? '\nThe two scorers agree on every board.\n'
		: `\n${failed} disagreement(s) — the verifier does NOT score what the engine scores.\n`,
);
process.exit(failed === 0 ? 0 : 1);
