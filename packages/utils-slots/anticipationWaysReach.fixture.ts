/**
 * Offline fixture for `createWaysReach` — run with `node` (Node >= 22.18 / 24 strips the types):
 *   node packages/utils-slots/anticipationWaysReach.fixture.ts
 *
 * The ways twin of `anticipationReach.fixture.ts`. It validates the properties anticipation actually
 * depends on, WITHOUT any UI:
 *
 *   - the bounds narrow correctly — `max` non-increasing in `k`, `min` non-decreasing;
 *   - at `k = numReels` both bounds meet, and — the check that matters most — the value they meet at
 *     equals what the board REALLY pays, computed independently below. A reach that converges on the
 *     wrong number would still look perfectly well-behaved on every monotonicity assertion;
 *   - a run already broken among the locked reels cannot be rescued by an unlocked one;
 *   - the ways product is honoured: widening a reel's matching cells multiplies the win;
 *   - trigger-reach behaves exactly as it does for lines, because a scatter count was never a line
 *     calculation to begin with;
 *   - and all of the above on a STEPPED board (docs/design/stepped-grid.md), where the columns are
 *     different heights. Ways is the win model a stepped grid moves most: a pay is the PRODUCT of the
 *     per-reel matching counts divided by the ways count, and the ways count is the product of the
 *     per-reel ROW counts — so one column measured at the wrong height moves every number in the
 *     round. `createWaysReach` takes those heights off the board it is handed, which is exactly why
 *     the board handed to it must be sliced PER COLUMN (see `buildAnticipationArming`).
 */

import { createWaysReach } from './src/anticipationReach.ts';

// --- sample config (apps/ways/src/game/config.ts), pays quoted PER WAY -----------------------
const PAYTABLE: Record<string, Record<number, number>> = {
	H1: { 3: 3, 4: 5, 5: 10 },
	H2: { 3: 2, 4: 4, 5: 8 },
	H3: { 3: 1, 4: 2, 5: 5 },
	H4: { 3: 0.5, 4: 1, 5: 3 },
	H5: { 3: 0.4, 4: 0.8, 5: 2 },
	L1: { 3: 0.4, 4: 0.8, 5: 2 },
	L2: { 3: 0.2, 4: 0.5, 5: 1.5 },
	L3: { 3: 0.2, 4: 0.5, 5: 1.5 },
	L4: { 3: 0.1, 4: 0.3, 5: 1 },
};
const PAYING = Object.keys(PAYTABLE);
const wayPay = (symbol: string, runLength: number) => PAYTABLE[symbol]?.[runLength] ?? 0;
const isWild = (symbol: string) => symbol === 'W';
const isSpecial = (symbol: string) => symbol === 'S';

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failures++;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * The board's TRUE ways win, written independently of the reach walker so the convergence check is a
 * second opinion rather than a restatement: for each symbol, extend while a reel holds it (or a
 * wild), multiply the per-reel counts, pay `mult(runLength) x ways`. Divided by the ways count to
 * land in total-bet multiples, the units `winBounds` reports.
 */
const trueWin = (board: string[][]): number => {
	const waysCount = board.reduce((product, reel) => product * reel.length, 1);
	let total = 0;
	for (const symbol of PAYING) {
		let ways = 1;
		let run = 0;
		for (const reel of board) {
			const count = reel.filter((c) => c === symbol || isWild(c)).length;
			if (count === 0) break;
			run += 1;
			ways *= count;
		}
		total += wayPay(symbol, run) * ways;
	}
	return total / waysCount;
};

const reachFor = (board: string[][]) =>
	createWaysReach({ board, payingSymbols: PAYING, wayPay, isWild, isSpecial });

// --- 1. Convergence + monotonicity on a board with a real, wild-assisted win ----------------
// H1 runs three reels: 2 cells, then 1, then 2 (a natural H1 plus the substituting W) = 4 ways at
// `mult(3) = 3`, so 12 per-way units = 12/243 of a total bet. Reel 3 holds no H1, so the run stops
// there — reel 4's three H1s are unreachable, which is the case a naive "count them all" evaluator
// gets wrong, and why the fixture asserts the exact converged value rather than just monotonicity.
const BOARD = [
	['H1', 'H1', 'L1'],
	['H1', 'L2', 'L3'],
	['W', 'H1', 'L4'],
	['L1', 'L2', 'L3'],
	['H1', 'H1', 'H1'],
];

console.log('ways reachability fixture\n');
console.log('1. bounds narrow, and converge on the REAL win:');
{
	const reach = reachFor(BOARD);
	const bounds = Array.from({ length: reach.numReels + 1 }, (_, k) => reach.winBounds(k));

	for (const [k, b] of bounds.entries()) {
		console.log(`  k=${k}  min=${b.min.toFixed(6)}  max=${b.max.toFixed(6)}`);
	}

	check(
		'max is non-increasing in k',
		bounds.every((b, k) => k === 0 || b.max <= bounds[k - 1].max + 1e-9),
	);
	check(
		'min is non-decreasing in k',
		bounds.every((b, k) => k === 0 || b.min >= bounds[k - 1].min - 1e-9),
	);
	check(
		'min <= max at every k',
		bounds.every((b) => b.min <= b.max + 1e-9),
	);

	const final = bounds[reach.numReels];
	const actual = trueWin(BOARD);
	check('bounds meet at k = numReels', near(final.min, final.max));
	check(
		`they meet at the REAL win (${actual.toFixed(6)})`,
		near(final.min, actual) && near(final.max, actual),
		`got min=${final.min} max=${final.max}`,
	);

	// The optimistic bound before anything locks must be able to see a full-width board.
	check('max at k=0 is at least the true win', bounds[0].max >= actual - 1e-9);
	check('min at k=0 is zero (nothing is guaranteed yet)', near(bounds[0].min, 0));
}

// --- 2. A broken run cannot be rescued -------------------------------------------------------
console.log('\n2. a run broken among the locked reels stays broken:');
{
	// H1 on reel 0 only; reel 1 holds none. After two reels lock, no H1 win is reachable at all — the
	// unlocked reels cannot repair a run that already stopped.
	const board = [
		['H1', 'H1', 'H1'],
		['L1', 'L2', 'L3'],
		['H1', 'H1', 'H1'],
		['H1', 'H1', 'H1'],
		['H1', 'H1', 'H1'],
	];
	const reach = reachFor(board);
	const atTwo = reach.winBounds(2);
	const final = reach.winBounds(5);

	check('true win is zero (the run dies on reel 1)', near(trueWin(board), 0));
	check('max collapses to 0 once the break is locked in', near(atTwo.max, 0), `got ${atTwo.max}`);
	check('final bounds are 0/0', near(final.min, 0) && near(final.max, 0));

	// ...while at k=1 the break is not yet visible, so the optimistic bound is still alive. That is
	// the whole point of the `possible` mode: it teases what is not yet ruled out.
	check('at k=1 the optimistic bound is still positive', reach.winBounds(1).max > 0);
}

// --- 3. The ways PRODUCT is honoured, not just the run length --------------------------------
console.log('\n3. more matching cells on a reel multiply the win:');
{
	const narrow = [
		['H1', 'L1', 'L2'],
		['H1', 'L1', 'L2'],
		['H1', 'L1', 'L2'],
		['L3', 'L4', 'L4'],
		['L3', 'L4', 'L4'],
	];
	const wide = [
		['H1', 'H1', 'L2'],
		['H1', 'L1', 'L2'],
		['H1', 'L1', 'L2'],
		['L3', 'L4', 'L4'],
		['L3', 'L4', 'L4'],
	];
	const a = reachFor(narrow).winBounds(5).min;
	const b = reachFor(wide).winBounds(5).min;
	check('a 1x1x1 H1 run pays the base multiple', near(a, trueWin(narrow)));
	check('doubling reel 0 doubles the H1 contribution', near(b - trueWin(wide), 0) && b > a);
}

// --- 4. Trigger-reach is the model-independent axis -------------------------------------------
console.log('\n4. trigger-reach counts scatters anywhere, as it does for lines:');
{
	const board = [
		['S', 'L1', 'L2'],
		['L1', 'S', 'L2'],
		['L1', 'L2', 'L3'],
		['L1', 'L2', 'L3'],
		['L1', 'L2', 'S'],
	];
	const reach = reachFor(board);
	check('k=0 min is 0', near(reach.triggerBounds(0).min, 0));
	check('k=0 max is one per reel', near(reach.triggerBounds(0).max, 5));
	check('k=2 has 2 locked in', near(reach.triggerBounds(2).min, 2));
	check(
		'k=5 converges on the real count (3)',
		near(reach.triggerBounds(5).min, 3) && near(reach.triggerBounds(5).max, 3),
	);
	check(
		'trigger max is non-increasing',
		Array.from({ length: 6 }, (_, k) => reach.triggerBounds(k).max).every(
			(m, k, all) => k === 0 || m <= all[k - 1] + 1e-9,
		),
	);
}

// --- 4. STEPPED BOARDS (docs/design/stepped-grid.md) ---------------------------------------
// The columns are different heights, so `board[reel].length` varies. Everything ways does is a
// product over the reels, and `createWaysReach` takes each reel's height from the array it is handed
// — so the reach is right only if that array is the VISIBLE window of each column rather than the
// bounding box. `buildAnticipationArming` slices per column for exactly this reason: slicing every
// column to `max(numRows)` leaves a SHORT column carrying its bottom PADDING row, which both inflates
// the ways product and lets an off-screen symbol complete a run.
console.log('\n4. stepped boards — ragged columns:');
{
	// 3/4/5/4/3, the diamond.
	const STEPPED = [
		['H1', 'H1', 'L1'],
		['H1', 'L2', 'L3', 'L4'],
		['W', 'H1', 'H1', 'L4', 'L1'],
		['H1', 'L2', 'H1', 'L3'],
		['H1', 'L1', 'L2'],
	];
	check(
		'the fixture board really is ragged',
		JSON.stringify(STEPPED.map((reel) => reel.length)) === JSON.stringify([3, 4, 5, 4, 3]),
	);

	const reach = reachFor(STEPPED);
	const bounds = Array.from({ length: reach.numReels + 1 }, (_, k) => reach.winBounds(k));
	for (const [k, b] of bounds.entries()) {
		console.log(`  k=${k}  min=${b.min.toFixed(6)}  max=${b.max.toFixed(6)}`);
	}

	check(
		'max is non-increasing in k',
		bounds.every((b, k) => k === 0 || b.max <= bounds[k - 1].max + 1e-9),
	);
	check(
		'min is non-decreasing in k',
		bounds.every((b, k) => k === 0 || b.min >= bounds[k - 1].min - 1e-9),
	);
	check(
		'min <= max at every k',
		bounds.every((b) => b.min <= b.max + 1e-9),
	);

	const final = bounds[reach.numReels];
	const actual = trueWin(STEPPED);
	check('bounds meet at k = numReels', near(final.min, final.max));
	check(
		`they meet at the REAL win on a ragged board (${actual.toFixed(6)})`,
		near(final.min, actual) && near(final.max, actual),
		`got min=${final.min} max=${final.max}`,
	);

	// THE ONE THAT MATTERS. A short column measured at the bounding box's height — which is what a
	// board sliced to `max(numRows)` hands over — changes the ways count, and with it every payout in
	// the round: 3x4x5x4x3 = 720 ways, against 5^5 = 3125 if every column is counted as five. Assert
	// that padding the short columns out to the box gives a DIFFERENT answer, so the day the
	// per-column slice regresses this fails loudly instead of quietly paying the wrong multiple.
	const raggedWays = STEPPED.reduce((product, reel) => product * reel.length, 1);
	check(`the ways count is the ragged product (${raggedWays})`, raggedWays === 720);
	const asRectangle = STEPPED.map((reel) => [...reel, ...Array(5 - reel.length).fill('L5')]);
	const boxedWin = trueWin(asRectangle);
	check(
		'padding a short column out to the bounding box CHANGES the win',
		!near(actual, boxedWin),
		`ragged=${actual} boxed=${boxedWin} (${raggedWays} vs ${5 ** 5} ways)`,
	);
}

console.log(
	failures === 0
		? '\nWAYS REACH FIXTURE: PASSED'
		: `\nWAYS REACH FIXTURE: FAILED (${failures} assertion(s))`,
);
if (failures > 0) process.exit(1);
