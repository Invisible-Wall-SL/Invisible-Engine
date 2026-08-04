/**
 * Offline fixture for `createLinesReach` — run with `node` (Node ≥ 22.18 / 24 strips the types):
 *   node packages/utils-slots/src/anticipationReach.fixture.ts
 *
 * Validates the reachability math against the `apps/lines` sample paytable/paylines WITHOUT any UI:
 *   - bounds narrow correctly as reels lock (max non-increasing, min non-decreasing);
 *   - at k = numReels both bounds equal the true final win;
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
	});

// board[reel][row], 5 reels × 3 rows.
// A: near-miss — three H1 on the top line (line 1 = [0,0,0,0,0]) then it dies.
const boardNearMiss: string[][] = [
	['H1', 'L2', 'L3'],
	['H1', 'L4', 'L5'],
	['H1', 'L2', 'H4'],
	['L5', 'L3', 'L2'],
	['L4', 'H2', 'L1'],
];
// B: real big — five H1 on the top line (a 5-of-a-kind).
const boardBig: string[][] = [
	['H1', 'L2', 'L3'],
	['H1', 'L4', 'L5'],
	['H1', 'L2', 'H4'],
	['H1', 'L3', 'L2'],
	['H1', 'H2', 'L1'],
];

// smallest big-win tier, in total-bet multiplier, for the arm/disarm demo.
const BIG_TIER = 0.9;

let failures = 0;
const assert = (cond: boolean, msg: string) => {
	if (!cond) {
		failures += 1;
		console.error('  ✗ FAIL:', msg);
	}
};

const runBoard = (name: string, board: string[][], expectFinal: number) => {
	const reach = makeReach(board);
	const rows: string[] = [];
	let prevMax = Infinity;
	let prevMin = -Infinity;
	for (let k = 0; k <= reach.numReels; k++) {
		const { min, max } = reach.bounds(k);
		const possible = max >= BIG_TIER ? 'ARM' : '—';
		const guaranteed = min >= BIG_TIER ? 'ARM' : '—';
		rows.push(
			`  k=${k}  min=${min.toFixed(3)}  max=${max.toFixed(3)}  possible:${possible}  guaranteed:${guaranteed}`,
		);
		assert(min <= max + 1e-9, `${name} k=${k}: min(${min}) <= max(${max})`);
		assert(max <= prevMax + 1e-9, `${name} k=${k}: max non-increasing`);
		assert(min >= prevMin - 1e-9, `${name} k=${k}: min non-decreasing`);
		prevMax = max;
		prevMin = min;
	}
	const final = reach.bounds(reach.numReels);
	assert(Math.abs(final.min - final.max) < 1e-9, `${name}: min==max at k=numReels`);
	assert(
		Math.abs(final.max - expectFinal) < 1e-9,
		`${name}: final win == ${expectFinal} (got ${final.max})`,
	);
	console.log(`\n${name}  (final win = ${final.max.toFixed(3)}x total bet)`);
	console.log(rows.join('\n'));
	return reach;
};

// Near-miss final: line 1 = 3×H1 → 5 bet-per-line / 20 = 0.25x. (No other line pays 3+.)
runBoard('A · near-miss (3×H1 top line)', boardNearMiss, 0.25);
// Big final: line 1 = 5×H1 → 20 bet-per-line / 20 = 1.0x.
runBoard('B · big win (5×H1 top line)', boardBig, 1.0);

// The confidence modes must differ: on the BIG board, `possible` arms early and stays; `guaranteed`
// only arms once the 5-oak is locked in (k=5, min reaches 1.0 ≥ 0.9). On the near-miss board,
// `guaranteed` NEVER arms (final 0.25 < 0.9) while `possible` disarms as the top line's ceiling falls.
const big = makeReach(boardBig);
assert(big.bounds(2).max >= BIG_TIER, 'big: possible armed at k=2');
assert(big.bounds(4).min < BIG_TIER, 'big: guaranteed NOT yet armed at k=4');
assert(big.bounds(5).min >= BIG_TIER, 'big: guaranteed armed at k=5 (locked in)');

const miss = makeReach(boardNearMiss);
assert(miss.bounds(5).min < BIG_TIER, 'near-miss: guaranteed never arms');
assert(miss.bounds(5).max < BIG_TIER, 'near-miss: possible disarmed by the final board');

console.log(
	failures === 0
		? '\n✅ all reachability assertions passed'
		: `\n❌ ${failures} assertion(s) failed`,
);
if (failures > 0) process.exit(1);
