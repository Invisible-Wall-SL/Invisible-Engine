// Unit gate for the CLUSTER evaluator (`winModel: 'cluster'`) — a connected group of `minCluster`+
// cells pays, adjacency orthogonal or diagonal. The wire side is covered by
// check-stake-consistency.mjs; this pins the flood fill.
//
//   node scripts/check-cluster-evaluator.mjs
//
// ⚠️ The PAYOUT is a test approximation and always was: the mock's paytable is keyed by payline run
// lengths (3/4/5) while a cluster is 5+ cells, so size clamps to the largest priced row. Real cluster
// pricing is by cluster size and needs a math export. What is NOT approximate — and is asserted here
// — is the grouping, and that a cluster smaller than the paytable's floor reads as "clusters don't
// work" rather than as a bug.

import { evaluateClusters } from './mock-rgs-server.mjs';

let bad = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) bad++;
};

/** reels[reel][row]. Written as rows for readability, then transposed. */
const board = (rows) => rows[0].map((_unused, reel) => rows.map((r) => r[reel]));

// An L-shaped orthogonal group of 6 PIC1, on a 5×4 grid.
const lShape = board([
	['PIC1', 'PIC1', 'PIC3', 'PIC4', 'PIC5'],
	['PIC1', 'PIC1', 'PIC3', 'PIC4', 'PIC5'],
	['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5'],
	['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5'],
]);

const l = evaluateClusters(lShape, 1, null, { minCluster: 5 }).find((w) => w.what === 'PIC1');
check(!!l, 'a connected L-shaped group pays');
check(l?.occurs === 6, 'occurs is the CELL COUNT of the group', ` (got ${l?.occurs})`);
check(Array.isArray(l?.context), 'positions are a BARE ARRAY (the shape the facade reads)');
check(l?.context.length === 6, 'one position per cell in the group', ` (got ${l?.context.length})`);
check(
	l?.context.cluster === 6,
	'the group size rides on the context',
	` (got ${l?.context.cluster})`,
);
check(l?.mode === 'cluster', 'mode names the win model', ` (got ${l?.mode})`);

// minCluster is honoured — the same board with a floor of 7 pays nothing.
check(
	!evaluateClusters(lShape, 1, null, { minCluster: 7 }).some((w) => w.what === 'PIC1'),
	'a group below minCluster does not pay',
);

// Adjacency: two groups touching only at a CORNER are one cluster diagonally, two orthogonally.
const corners = board([
	['PIC1', 'PIC1', 'PIC1', 'PIC2', 'PIC2'],
	['PIC2', 'PIC2', 'PIC2', 'PIC1', 'PIC1'],
	['PIC3', 'PIC3', 'PIC3', 'PIC4', 'PIC4'],
	['PIC3', 'PIC3', 'PIC3', 'PIC4', 'PIC4'],
]);
const ortho = evaluateClusters(corners, 1, null, {
	minCluster: 5,
	adjacency: 'orthogonal',
}).filter((w) => w.what === 'PIC1');
check(ortho.length === 0, 'orthogonally, a run of 3 and a run of 2 stay separate (no 5+ group)');
const diag = evaluateClusters(corners, 1, null, { minCluster: 5, adjacency: 'diagonal' }).find(
	(w) => w.what === 'PIC1',
);
check(
	diag?.occurs === 5,
	'diagonally, the corner-touching runs join into one group of 5',
	` (got ${diag?.occurs})`,
);

// Wilds substitute — and, unlike a payline, a single wild can join clusters of DIFFERENT symbols at
// once, which is why the fill runs per candidate symbol rather than partitioning the board once.
const shared = board([
	['PIC1', 'PIC1', 'PIC1', 'PIC5', 'PIC5'],
	['PIC1', 'WILD', 'PIC2', 'PIC2', 'PIC5'],
	['PIC3', 'PIC2', 'PIC2', 'PIC2', 'PIC5'],
	['PIC3', 'PIC4', 'PIC4', 'PIC4', 'PIC5'],
]);
const withWild = evaluateClusters(shared, 1, { paytable: { 3: 5 } }, { minCluster: 5 });
check(
	withWild.some((w) => w.what === 'PIC1') && withWild.some((w) => w.what === 'PIC2'),
	'one WILD joins clusters of two DIFFERENT symbols in the same spin',
);
check(
	!evaluateClusters(shared, 1, null, { minCluster: 5 }).some((w) => w.what === 'PIC1'),
	'a WILD is inert when the game declares no wild paytable',
);

// Pay scales with the base it is handed — the base itself is the caller's job (`payoutBase` in the
// mock, which mirrors the client's `payoutDivisor()` returning 1 for this model).
const one = evaluateClusters(lShape, 1, null, { minCluster: 5 }).find((w) => w.what === 'PIC1');
const hundred = evaluateClusters(lShape, 100, null, { minCluster: 5 }).find(
	(w) => w.what === 'PIC1',
);
check(hundred?.pay === one?.pay * 100, 'pay scales linearly with the payout base');

// SCAT is the feature symbol; the win MODEL never pays it.
const scats = board([
	['SCAT', 'SCAT', 'SCAT', 'PIC4', 'PIC5'],
	['SCAT', 'SCAT', 'SCAT', 'PIC4', 'PIC5'],
	['PIC3', 'PIC2', 'PIC2', 'PIC4', 'PIC5'],
	['PIC3', 'PIC2', 'PIC2', 'PIC4', 'PIC5'],
]);
check(
	!evaluateClusters(scats, 1, null, { minCluster: 5 }).some((w) => w.what === 'SCAT'),
	'SCAT is not paid by the cluster evaluator',
);

console.log(bad ? `\n${bad} check(s) FAILED` : '\ncluster evaluator OK');
process.exit(bad ? 1 : 0);
