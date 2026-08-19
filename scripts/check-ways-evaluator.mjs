import { evaluateWays } from './mock-rgs-server.mjs';

let bad = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) bad++;
};

// reels[reel][row]
const board = (rows) => rows;

// PIC1 on reels 0,1,2 — 1 cell each ⇒ 1 way, 3-of-a-kind.
const simple = board([
	['PIC1', 'PIC2', 'PIC3'],
	['PIC1', 'PIC4', 'PIC5'],
	['PIC1', 'PIC6', 'PIC7'],
	['PIC2', 'PIC2', 'PIC2'],
	['PIC3', 'PIC3', 'PIC3'],
]);
const w1 = evaluateWays(simple, 1).find((w) => w.what === 'PIC1');
check(!!w1, 'a 3-reel run pays');
check(w1?.occurs === 3, 'occurs = number of contributing REELS', ` (got ${w1?.occurs})`);
check(
	w1?.context.length === 3,
	'positions = one cell per reel here',
	` (got ${w1?.context.length})`,
);
check(Array.isArray(w1?.context), 'positions are a BARE ARRAY (the only shape the facade reads)');
check(
	w1?.context.ways === 1,
	'ways = 1 when each reel contributes once',
	` (got ${w1?.context.ways})`,
);

// PIC1 twice on reel 0, three times on reel 1, once on reel 2 ⇒ 2*3*1 = 6 ways.
const multi = board([
	['PIC1', 'PIC1', 'PIC3'],
	['PIC1', 'PIC1', 'PIC1'],
	['PIC1', 'PIC6', 'PIC7'],
	['PIC2', 'PIC4', 'PIC5'],
	['PIC3', 'PIC4', 'PIC5'],
]);
const w2 = evaluateWays(multi, 1).find((w) => w.what === 'PIC1');
check(
	w2?.context.ways === 6,
	'ways = PRODUCT of per-reel counts (2x3x1)',
	` (got ${w2?.context.ways})`,
);
check(
	w2?.context.length === 6,
	'positions cover EVERY matching cell (6)',
	` (got ${w2?.context.length})`,
);
check(w2.pay === w1.pay * 6, 'pay scales with ways', ` (${w1.pay} -> ${w2.pay})`);
const perReel = new Map();
for (const p of w2.context) perReel.set(p.reel, (perReel.get(p.reel) ?? 0) + 1);
check(
	perReel.get(0) === 2 && perReel.get(1) === 3,
	'several cells on ONE reel — the shape a payline cannot express',
);

// A gap on reel 1 ends the run: PIC1 on reels 0 and 2 only.
const gap = board([
	['PIC1', 'PIC5', 'PIC3'],
	['PIC2', 'PIC4', 'PIC6'],
	['PIC1', 'PIC6', 'PIC7'],
	['PIC2', 'PIC4', 'PIC5'],
	['PIC3', 'PIC4', 'PIC5'],
]);
check(
	!evaluateWays(gap, 1).some((w) => w.what === 'PIC1'),
	'a gap on reel 2 ends the run (no 2-reel pay)',
);

// Wilds substitute.
const wildBoard = board([
	['PIC1', 'PIC5', 'PIC3'],
	['WILD', 'PIC4', 'PIC6'],
	['PIC1', 'PIC6', 'PIC7'],
	['PIC2', 'PIC4', 'PIC5'],
	['PIC3', 'PIC4', 'PIC5'],
]);
const w3 = evaluateWays(wildBoard, 1, { paytable: { 3: 5 } }).find((w) => w.what === 'PIC1');
check(!!w3 && w3.occurs === 3, 'a WILD substitutes to extend the run');

// No scatter pays through the ways evaluator (scatters have their own pass).
check(
	!evaluateWays(simple, 1).some((w) => w.what === 'SCAT'),
	'SCAT is not paid by the ways evaluator',
);

process.exit(bad ? 1 : 0);
