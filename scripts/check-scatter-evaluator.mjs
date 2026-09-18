// Unit gate for the SCATTER-PAYS evaluator (`winModel: 'scatter'`) — every symbol pays on COUNT
// ANYWHERE. The wire side is covered by check-stake-consistency.mjs; this pins the arithmetic.
//
//   node scripts/check-scatter-evaluator.mjs
//
// ⚠️ Not the SCAT feature symbol. `evaluateScatters` is a different function with a confusingly
// similar name — it pays the free-spin trigger and runs for EVERY win model.

import { evaluateScatterPays } from './mock-rgs-server.mjs';

let bad = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) bad++;
};

/** Build a reels[reel][row] board with `count` cells of `symbol` scattered across it, the rest fill. */
const boardWith = (symbol, count, reels = 6, rows = 5, fill = 'PIC6') => {
	const board = Array.from({ length: reels }, () => Array.from({ length: rows }, () => fill));
	let placed = 0;
	// Walk row-major so the cells land NON-ADJACENT across reels — a scatter pay must not care.
	for (let row = 0; row < rows && placed < count; row++) {
		for (let reel = 0; reel < reels && placed < count; reel++) {
			board[reel][row] = symbol;
			placed++;
		}
	}
	return board;
};

const TABLE = { PIC1: { 8: 1, 9: 2.5, 10: 6, 13: 20 } };
const opts = { minCount: 8, symbolPaytable: TABLE };

// Below the floor: eight is the minimum, seven pays nothing.
check(
	!evaluateScatterPays(boardWith('PIC1', 7), 100, null, opts).some((w) => w.what === 'PIC1'),
	'a count below minCount does not pay',
);

const at8 = evaluateScatterPays(boardWith('PIC1', 8), 100, null, opts).find(
	(w) => w.what === 'PIC1',
);
check(!!at8, 'a count at minCount pays');
check(at8?.occurs === 8, 'occurs is the COUNT, not a run length', ` (got ${at8?.occurs})`);
check(at8?.pay === 100, 'pay = multiplier × the TOTAL stake (1 × 100)', ` (got ${at8?.pay})`);
check(Array.isArray(at8?.context), 'positions are a BARE ARRAY (the shape the facade reads)');
check(at8?.context.length === 8, 'one position per counted cell', ` (got ${at8?.context.length})`);
check(at8?.mode === 'scatterPays', 'mode names the win model', ` (got ${at8?.mode})`);

// Positions are not adjacent — the difference from a cluster.
const reelsTouched = new Set(at8?.context.map((p) => p.reel));
check(reelsTouched.size > 1, 'a scatter pay spans reels with no adjacency requirement');

// Exact tiers.
const at9 = evaluateScatterPays(boardWith('PIC1', 9), 100, null, opts).find(
	(w) => w.what === 'PIC1',
);
check(at9?.pay === 250, 'the 9 tier prices at 2.5 × stake', ` (got ${at9?.pay})`);

// THE sparse-table trap: rows are THRESHOLDS, not exact matches. A count of 11 against a table of
// {8,9,10,13} must pay the 10 row — an exact lookup paid nothing, so a win plainly on the board
// scored zero. Only a sparse table exposes it; the sample config lists every count from 8 to 36.
const at11 = evaluateScatterPays(boardWith('PIC1', 11), 100, null, opts).find(
	(w) => w.what === 'PIC1',
);
check(
	at11?.pay === 600,
	'a count between tiers takes the highest tier AT OR BELOW it (11 → 10)',
	` (got ${at11?.pay})`,
);

// Above the top tier: clamps to the last row rather than falling off.
const at20 = evaluateScatterPays(boardWith('PIC1', 20), 100, null, opts).find(
	(w) => w.what === 'PIC1',
);
check(
	at20?.pay === 2000,
	'a count above the top tier clamps to it (20 → 13)',
	` (got ${at20?.pay})`,
);

// Wilds substitute — but only when the game actually declares one.
const wildBoard = boardWith('PIC1', 7);
wildBoard[0][4] = 'WILD';
check(
	!evaluateScatterPays(wildBoard, 100, null, opts).some((w) => w.what === 'PIC1'),
	'a WILD does not count when the game declares no wild paytable',
);
check(
	evaluateScatterPays(wildBoard, 100, { paytable: { 3: 5 } }, opts).some(
		(w) => w.what === 'PIC1' && w.occurs === 8,
	),
	'a WILD substitutes into the count when the game declares one',
);

// No project table ⇒ the mock's own run-length table is the fallback, and reads oddly on purpose
// (every count above 5 pays the 5 row) — the honest signal that the paytable did not arrive.
const fallback = evaluateScatterPays(boardWith('PIC1', 12), 100, null, { minCount: 8 }).find(
	(w) => w.what === 'PIC1',
);
check(!!fallback && fallback.pay > 0, 'the run-length fallback still pays when no table ships');

// SCAT is the feature symbol; the win MODEL never pays it.
check(
	!evaluateScatterPays(boardWith('SCAT', 12), 100, null, opts).some((w) => w.what === 'SCAT'),
	'SCAT is not paid by the scatter-pays evaluator',
);

console.log(bad ? `\n${bad} check(s) FAILED` : '\nscatter evaluator OK');
process.exit(bad ? 1 : 0);
