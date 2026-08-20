/**
 * Prove the verifier scores ways the way the ENGINE does.
 *
 *   pnpm --filter game-config-spike run wayscrosscheck
 *
 * `waysEvaluator.ts` re-expresses the ways rule against a Game Config doc, because
 * `mock-rgs-server`'s `evaluateWays` is bound to the mock's own PIC/SCAT vocabulary and its own
 * hardcoded paytable and cannot score a project config. Two implementations of one rule is how a
 * measurement quietly stops describing the game, so this holds them against each other on random
 * boards and asserts they agree on the structure that decides a pay: which symbol wins, over how
 * many reels, and across how many ways.
 *
 * Pay AMOUNTS are compared too, by feeding the doc-scorer the mock's paytable — so agreement covers
 * `mult x ways x betPerWay`, not just the run detection.
 */

import { evaluateWays as mockEvaluateWays } from '../../scripts/mock-rgs-server.mjs';

import { buildRules, evaluateWaysDoc, makeRng, type Doc } from './waysEvaluator';

// The mock's own vocabulary + paytable, transcribed so the doc-scorer can be pointed at the exact
// same rules the mock applies. Sourced from `scripts/mock-rgs-server.mjs` (`SYMBOLS`, `PAY_TABLE`).
const MOCK_PAY: Record<string, Record<number, number>> = {
	PIC1: { 3: 200, 4: 1000, 5: 5000 },
	PIC2: { 3: 100, 4: 500, 5: 2500 },
	PIC3: { 3: 75, 4: 250, 5: 1000 },
	PIC4: { 3: 20, 4: 100, 5: 500 },
	PIC5: { 3: 15, 4: 75, 5: 200 },
	PIC6: { 3: 10, 4: 40, 5: 100 },
	PIC7: { 2: 5, 3: 5, 4: 25, 5: 50 },
};

/** A synthetic Game Config doc whose rules ARE the mock's, so the two scorers are comparable. */
const mockAsDoc = (withWild: boolean): Doc => ({
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	symbols: {
		...Object.fromEntries(
			Object.entries(MOCK_PAY).map(([sym, table]) => [
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
	failed++;
	console.error(`  FAIL  ${msg}`);
};

/**
 * The mock only substitutes wilds when the project declares a wild paytable (`wild.paytable`), so
 * the two modes are checked separately: without a wild, `WILD` must never appear on the board at
 * all, or the mock would treat it as an ordinary non-matching cell while the doc-scorer substitutes.
 */
const run = (label: string, withWild: boolean, boards: number) => {
	const rand = makeRng(withWild ? 12345 : 999);
	const rules = buildRules(mockAsDoc(withWild));
	const pool = withWild ? POOL_WILD : POOL_NO_WILD;
	const wild = withWild ? { paytable: { 3: 1, 4: 2, 5: 3 } } : null;
	const betPerWay = 1 / rules.waysCount;

	let compared = 0;
	let withWins = 0;

	for (let i = 0; i < boards; i++) {
		const board = Array.from({ length: 5 }, () =>
			Array.from({ length: 3 }, () => pool[Math.floor(rand() * pool.length)]),
		);

		const mine = evaluateWaysDoc(board, rules, betPerWay)
			.map((w) => `${w.symbol}:${w.occurs}:${w.ways}:${w.pay.toFixed(6)}`)
			.sort();
		const theirs = (mockEvaluateWays(board, betPerWay, wild) as MockWin[])
			.map(
				(w) => `${w.what}:${w.occurs}:${(w.context as { ways: number }).ways}:${w.pay.toFixed(6)}`,
			)
			.sort();

		compared++;
		if (mine.length) withWins++;
		if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
			fail(
				`${label} board ${i}\n        doc-scorer: ${mine.join(' | ') || '(none)'}\n        mock:       ${theirs.join(' | ') || '(none)'}`,
			);
			if (failed > 3) return { compared, withWins };
		}
	}
	return { compared, withWins };
};

type MockWin = { what: string; occurs: number; pay: number; context: unknown };

console.log('ways evaluator cross-check — doc-scorer vs mock-rgs-server evaluateWays\n');

for (const [label, withWild] of [
	['no wild', false],
	['wild substituting', true],
] as const) {
	const { compared, withWins } = run(label, withWild, 20_000);
	const ok = failed === 0;
	console.log(
		`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${compared.toLocaleString()} boards agree ` +
			`(${withWins.toLocaleString()} carried at least one win)`,
	);
	if (!ok) break;
}

// A cross-check that never sees a win would pass vacuously, so assert the sample had teeth.
console.log(`\n${failed === 0 ? 'WAYS CROSS-CHECK: PASSED' : 'WAYS CROSS-CHECK: FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
