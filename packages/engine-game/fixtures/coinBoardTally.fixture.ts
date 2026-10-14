/**
 * A coin board's end tally (`coinBoardTally.ts`): what flies when, what dims and what shows its ×N,
 * per pay rule (`docs/design/hold-and-win-coin-board.md` §1.2).
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/coinBoardTally.fixture.ts
 */
import { coinBoardTallyPlan } from '../src/game/coinBoardTally.ts';
import type { HoldAndWinTallyCell } from '../src/game/holdAndWin.ts';

// No `node:assert` — the package has no Node types, and svelte-check reads this file too.
const assert = {
	deepEqual: (actual: unknown, expected: unknown) => {
		const a = JSON.stringify(actual);
		const e = JSON.stringify(expected);
		if (a !== e) throw new Error(`expected ${e}, got ${a}`);
	},
};

let passed = 0;
let failed = 0;
const it = (label: string, run: () => void) => {
	try {
		run();
		passed += 1;
		console.log(`  ok  ${label}`);
	} catch (error) {
		failed += 1;
		console.log(`FAIL  ${label}
        ${(error as Error).message}`);
	}
};

const cell = (reel: number, row: number, amount: number, lines?: number): HoldAndWinTallyCell => ({
	reel,
	row,
	symbol: { name: 'BONUS', value: amount / 100 },
	amount,
	...(lines === undefined ? {} : { lines }),
});
const at = (cells: { reel: number; row: number }[]) => cells.map((c) => [c.reel, c.row]);

it('coinsOnLines — and a tally with no rule — flies every coin in one step, board order', () => {
	const cells = [cell(2, 0, 100), cell(0, 1, 200), cell(0, 0, 300)];
	for (const payRule of ['coinsOnLines', undefined] as const) {
		const plan = coinBoardTallyPlan({ cells, banked: 0, ...(payRule ? { payRule } : {}) });
		assert.deepEqual(
			plan.steps.map((step) => at(step.cells)),
			[
				[
					[0, 0],
					[0, 1],
					[2, 0],
				],
			],
		);
		assert.deepEqual([plan.dimmed, plan.marks], [[], []]);
	}
});

it('perLine marks every coin with the lines it paid on', () => {
	const plan = coinBoardTallyPlan({
		cells: [cell(1, 1, 300, 3), cell(0, 0, 200, 2)],
		banked: 0,
		payRule: 'perLine',
	});
	assert.deepEqual(plan.marks, [
		{ reel: 0, row: 0, times: 2 },
		{ reel: 1, row: 1, times: 3 },
	]);
	assert.deepEqual(plan.steps.length, 1);
});

it('lineFill flies run by run; a coin on two runs flies once, with the first', () => {
	const middle = { reel: 0, row: 1 };
	const plan = coinBoardTallyPlan({
		cells: [
			cell(0, 1, 400, 2),
			cell(1, 1, 200, 1),
			cell(2, 1, 200, 1),
			cell(1, 0, 100, 1),
			cell(2, 0, 100, 1),
			cell(4, 2, 0, 0),
		],
		banked: 0,
		payRule: 'lineFill',
		runs: [
			{
				id: '1',
				cells: [middle, { reel: 1, row: 1 }, { reel: 2, row: 1 }],
				total: 600,
			},
			{
				id: '4',
				cells: [middle, { reel: 1, row: 0 }, { reel: 2, row: 0 }],
				total: 500,
			},
		],
	});
	assert.deepEqual(
		plan.steps.map((step) => [step.run?.id, at(step.cells)]),
		[
			[
				'1',
				[
					[0, 1],
					[1, 1],
					[2, 1],
				],
			],
			[
				'4',
				[
					[1, 0],
					[2, 0],
				],
			],
		],
	);
	assert.deepEqual(plan.dimmed, [{ reel: 4, row: 2 }]);
});

it('lineFill with no run dims every coin and flies nothing', () => {
	const plan = coinBoardTallyPlan({
		cells: [cell(0, 0, 0, 0), cell(3, 1, 0, 0)],
		banked: 0,
		payRule: 'lineFill',
		runs: [],
	});
	assert.deepEqual(plan.steps, []);
	assert.deepEqual(at(plan.dimmed), [
		[0, 0],
		[3, 1],
	]);
});

console.log(`
${passed} coin board tally checks passed, ${failed} failed.`);
if (failed > 0) throw new Error('coin board tally fixture failed');
