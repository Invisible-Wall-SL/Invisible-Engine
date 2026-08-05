/**
 * Offline fixture for `createLinesReach` — run with `node` (Node ≥ 22.18 / 24 strips the types):
 *   node packages/utils-slots/anticipationReach.fixture.ts
 *
 * Validates BOTH reach axes against the `apps/lines` sample paytable/paylines WITHOUT any UI:
 *   - win-reach and trigger-reach bounds narrow correctly (max non-increasing, min non-decreasing);
 *   - at k = numReels both bounds equal the true final value;
 *   - the `possible` (max) and `guaranteed` (min) confidence modes arm at DIFFERENT reels.
 */

import { createLinesReach } from './src/anticipationReach.ts';

// --- sample config (apps/lines/src/game/config.ts), bet-per-line line pays ---
const PAYLINES: number[][] = [
	[0, 0, 0, 0, 0],
	[1, 1, 1, 1, 1],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
	[0, 0, 1, 2, 2],
	[2, 2, 1, 0, 0],
	[1, 0, 1, 2, 1],
	[1, 2, 1, 0, 1],
	[0, 1, 1, 1, 2],
	[2, 1, 1, 1, 0],
	[0, 1, 0, 1, 2],
	[2, 1, 2, 1, 0],
	[1, 1, 0, 1, 1],
	[1, 1, 2, 1, 1],
	[0, 2, 1, 0, 2],
	[2, 0, 1, 2, 0],
	[0, 0, 2, 0, 0],
	[2, 2, 0, 2, 2],
	[1, 0, 0, 0, 1],
];

const PAY: Record<string, Record<number, number>> = {
	H1: { 3: 5, 4: 10, 5: 20 },
	H2: { 3: 3, 4: 5, 5: 15 },
	H3: { 3: 2, 4: 3, 5: 10 },
	H4: { 3: 1, 4: 2, 5: 8 },
	L1: { 3: 0.5, 4: 1, 5: 5 },
	L2: { 3: 0.3, 4: 0.7, 5: 3 },
	L3: { 3: 0.3, 4: 0.7, 5: 3 },
	L4: { 3: 0.2, 4: 0.5, 5: 2 },
	L5: { 3: 0.1, 4: 0.3, 5: 1 },
	W: { 3: 5, 4: 10, 5: 20 },
};

const NUM_LINES = 20;
const isWild = (s: string) => s === 'W';
const isSpecial = (s: string) => s === 'S';
const linePay = (s: string, run: number) => (run >= 3 ? (PAY[s]?.[run] ?? 0) : 0);
const payingSymbols = Object.keys(PAY);

const makeReach = (board: string[][]) =>
	createLinesReach({
		board,
		paylines: PAYLINES,
		payingSymbols,
		linePay,
		numLines: NUM_LINES,
		isWild,
		isSpecial,
	});

let failures = 0;
const assert = (cond: boolean, msg: string) => {
	if (!cond) {
		failures += 1;
		console.error('  ✗ FAIL:', msg);
	}
};

/** Shared monotonicity + convergence checks for one axis of one board. */
const checkAxis = (
	name: string,
	numReels: number,
	at: (k: number) => { min: number; max: number },
	gate: number,
	gateUnit: string,
	expectFinal: number,
) => {
	const rows: string[] = [];
	let prevMax = Infinity;
	let prevMin = -Infinity;
	for (let k = 0; k <= numReels; k++) {
		const { min, max } = at(k);
		const possible = max >= gate ? 'ARM' : '—';
		const guaranteed = min >= gate ? 'ARM' : '—';
		rows.push(
			`  k=${k}  min=${min.toFixed(2)}  max=${max.toFixed(2)}  possible:${possible}  guaranteed:${guaranteed}`,
		);
		assert(min <= max + 1e-9, `${name} k=${k}: min <= max`);
		assert(max <= prevMax + 1e-9, `${name} k=${k}: max non-increasing`);
		assert(min >= prevMin - 1e-9, `${name} k=${k}: min non-decreasing`);
		prevMax = max;
		prevMin = min;
	}
	const final = at(numReels);
	assert(Math.abs(final.min - final.max) < 1e-9, `${name}: min==max at k=numReels`);
	assert(
		Math.abs(final.max - expectFinal) < 1e-9,
		`${name}: final == ${expectFinal} (got ${final.max})`,
	);
	console.log(`\n${name}  (final = ${final.max.toFixed(2)} ${gateUnit}, gate ${gate})`);
	console.log(rows.join('\n'));
};

// ============================ WIN-REACH ============================
const BIG_TIER = 0.9; // smallest big-win tier, total-bet multiplier
// A: near-miss — three H1 on the top line then it dies. Final = 3×H1 = 5/20 = 0.25x.
const winMiss = makeReach([
	['H1', 'L2', 'L3'],
	['H1', 'L4', 'L5'],
	['H1', 'L2', 'H4'],
	['L5', 'L3', 'L2'],
	['L4', 'H2', 'L1'],
]);
// B: big — five H1 on the top line. Final = 5×H1 = 20/20 = 1.0x.
const winBig = makeReach([
	['H1', 'L2', 'L3'],
	['H1', 'L4', 'L5'],
	['H1', 'L2', 'H4'],
	['H1', 'L3', 'L2'],
	['H1', 'H2', 'L1'],
]);
checkAxis(
	'WIN · near-miss (3×H1)',
	winMiss.numReels,
	(k) => winMiss.winBounds(k),
	BIG_TIER,
	'x',
	0.25,
);
checkAxis('WIN · big (5×H1)', winBig.numReels, (k) => winBig.winBounds(k), BIG_TIER, 'x', 1.0);
assert(winBig.winBounds(2).max >= BIG_TIER, 'win-big: possible armed at k=2');
assert(winBig.winBounds(4).min < BIG_TIER, 'win-big: guaranteed NOT armed at k=4');
assert(winBig.winBounds(5).min >= BIG_TIER, 'win-big: guaranteed armed at k=5 (locked in)');
assert(winMiss.winBounds(5).max < BIG_TIER, 'win-miss: possible disarmed by final board');
assert(winMiss.winBounds(5).min < BIG_TIER, 'win-miss: guaranteed never arms');

// ============================ TRIGGER-REACH ============================
const TRIGGER = 3; // scatters needed for the feature
// C: trigger hit — scatters on reels 0,1,2. Final count = 3.
const trigHit = makeReach([
	['L1', 'S', 'L3'],
	['S', 'L4', 'L5'],
	['L2', 'H1', 'S'],
	['L5', 'L3', 'L2'],
	['L4', 'H2', 'L1'],
]);
// D: scatter near-miss — scatters on reels 0,1 only. Final count = 2 (tension until the last reel).
const trigMiss = makeReach([
	['L1', 'S', 'L3'],
	['S', 'L4', 'L5'],
	['L2', 'H1', 'H4'],
	['L5', 'L3', 'L2'],
	['L4', 'H2', 'L1'],
]);
checkAxis(
	'TRIGGER · hit (3 scatters)',
	trigHit.numReels,
	(k) => trigHit.triggerBounds(k),
	TRIGGER,
	'S',
	3,
);
checkAxis(
	'TRIGGER · near-miss (2 scatters)',
	trigMiss.numReels,
	(k) => trigMiss.triggerBounds(k),
	TRIGGER,
	'S',
	2,
);
assert(
	trigHit.triggerBounds(3).min >= TRIGGER,
	'trig-hit: guaranteed armed once 3rd scatter locked (k=3)',
);
assert(trigHit.triggerBounds(2).min < TRIGGER, 'trig-hit: guaranteed NOT armed at k=2');
assert(
	trigMiss.triggerBounds(4).max >= TRIGGER,
	'trig-miss: possible still armed at k=4 (tension holds)',
);
assert(trigMiss.triggerBounds(5).max < TRIGGER, 'trig-miss: possible disarms on the final reel');
assert(trigMiss.triggerBounds(5).min < TRIGGER, 'trig-miss: guaranteed never arms');

// ===================== BOOK-TRIGGER-REACH (Book-of expanding special) =====================
// The Book-of book axis reuses `triggerBounds`, but its special is a DYNAMIC PAYING symbol (the
// round's expanding symbol), not a dedicated scatter — so the predicate must count a symbol that
// ALSO appears in the paytable. Validate that overlap works and narrows toward the 3+ expansion.
const BOOK_EXPANSION = 3;
const makeBookReach = (board: string[][], book: string) =>
	createLinesReach({
		board,
		paylines: PAYLINES,
		payingSymbols,
		linePay,
		numLines: NUM_LINES,
		isWild,
		isSpecial: (s) => s === book, // the round's special is a paying symbol, e.g. H1
	});
// H1 is the round's book. Instances on reels 0,1,2 → expansion count reaches 3.
const bookHit = makeBookReach(
	[
		['H1', 'L2', 'L3'],
		['L4', 'H1', 'L5'],
		['L2', 'L1', 'H1'],
		['L5', 'L3', 'L2'],
		['L4', 'H2', 'L1'],
	],
	'H1',
);
checkAxis(
	'BOOK · hit (3 H1 specials)',
	bookHit.numReels,
	(k) => bookHit.triggerBounds(k),
	BOOK_EXPANSION,
	'H1',
	3,
);
assert(
	bookHit.triggerBounds(3).min >= BOOK_EXPANSION,
	'book-hit: guaranteed armed once 3rd book locked (k=3)',
);
assert(bookHit.triggerBounds(2).min < BOOK_EXPANSION, 'book-hit: guaranteed NOT armed at k=2');

// Games with no special get an inert trigger axis.
const noSpecial = createLinesReach({
	board: [['H1'], ['H1'], ['H1'], ['H1'], ['H1']],
	paylines: [[0, 0, 0, 0, 0]],
	payingSymbols,
	linePay,
	numLines: NUM_LINES,
	isWild,
});
assert(noSpecial.triggerBounds(0).max === 0, 'no-special: trigger axis inert');

console.log(
	failures === 0
		? '\n✅ all reachability assertions passed'
		: `\n❌ ${failures} assertion(s) failed`,
);
if (failures > 0) process.exit(1);
