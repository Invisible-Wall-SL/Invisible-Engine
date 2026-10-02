/**
 * The Hold and Win state reducer (`applyHoldAndWinEvent`) against a scripted 3 Pots feature and a
 * Grand column sweep — the picture the respin board and a resume both read.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/holdAndWinState.fixture.ts
 */
import {
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	type HoldAndWinEvent,
	type HoldAndWinState,
} from '../src/game/holdAndWin.ts';

const play = (events: HoldAndWinEvent[], from: HoldAndWinState = emptyHoldAndWinState()) =>
	events.reduce(applyHoldAndWinEvent, from);

const coin = (reel: number, row: number, value: number) => ({
	reel,
	row,
	symbol: { name: 'BONUS', value },
});
const valueAt = (state: HoldAndWinState, reel: number, row: number) =>
	state.cells.find((c) => c.reel === reel && c.row === row)?.symbol;

// No `node:assert` — the package has no Node types, and svelte-check reads this file too.
const assert = {
	equal: (actual: unknown, expected: unknown) => {
		if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
	},
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

const base = play([
	{ type: 'meterLevels', meters: [{ id: 'red', level: 4, max: 12 }] },
	{
		type: 'meterUpdate',
		meter: 'red',
		level: 5,
		max: 12,
		full: false,
		from: [{ reel: 2, row: 1, symbol: { name: 'BOOST', value: 3 } }],
	},
	{ type: 'luckySpin' },
]);

it('meters come from the server and survive the base game', () => {
	assert.deepEqual(base.meters, [{ id: 'red', level: 5, max: 12 }]);
	assert.equal(base.active, false);
	assert.equal(base.luckySpin, true);
});

const entered = applyHoldAndWinEvent(base, {
	type: 'holdAndWinTrigger',
	mode: 'holdAndWin',
	cause: 'luckySpin',
	payload: {
		cells: [coin(0, 0, 1), coin(1, 1, 1.5), coin(4, 2, 2)],
		respins: 3,
		stickiness: 'allCoins',
		activeModifiers: ['payer'],
	},
});

it('the trigger opens the feature with what sticks, keeping the meters', () => {
	assert.equal(entered.active, true);
	assert.equal(entered.cells.length, 3);
	assert.equal(entered.left, 3);
	assert.deepEqual(entered.activeModifiers, ['payer']);
	assert.deepEqual(entered.meters, base.meters);
});

it('a meter cause empties the meters it consumed, and only those', () => {
	const pots = play([
		{
			type: 'meterLevels',
			meters: [
				{ id: 'red', level: 12, max: 12 },
				{ id: 'blue', level: 7, max: 12 },
			],
		},
		{
			type: 'holdAndWinTrigger',
			mode: 'holdAndWin',
			cause: 'meter',
			payload: {
				cells: [coin(0, 0, 1)],
				respins: 3,
				stickiness: 'allCoins',
				activeModifiers: ['payer'],
				meters: ['red'],
			},
		},
	]);
	assert.deepEqual(pots.meters, [
		{ id: 'red', level: 0, max: 12 },
		{ id: 'blue', level: 7, max: 12 },
	]);
});

const respin = play(
	[
		{ type: 'coinsLand', cells: [{ reel: 2, row: 0, symbol: { name: 'BOOST', value: 2 } }] },
		{
			type: 'coinPay',
			payer: { reel: 2, row: 0, symbol: { name: 'BOOST', value: 2 } },
			value: 2,
			cells: [
				{ reel: 0, row: 0, from: 1, to: 3 },
				{ reel: 1, row: 1, from: 1.5, to: 3.5 },
			],
		},
		{
			type: 'mysteryReveal',
			cells: [
				{ reel: 3, row: 2, symbol: { name: 'JACKPOT', jackpot: 'MINI' }, becomes: 'jackpot' },
			],
			activates: ['multiplier'],
		},
		{
			type: 'coinBoost',
			source: 'special',
			multiplier: 2,
			cells: [{ reel: 3, row: 2, from: 1, to: 2, jackpot: 'MINI' }],
		},
		{ type: 'respinUpdate', left: 3, played: 1, start: 3, reset: true },
	],
	entered,
);

it('a payer raises cash values; a jackpot change is its factor', () => {
	assert.equal(valueAt(respin, 0, 0)?.value, 3);
	assert.equal(valueAt(respin, 1, 1)?.value, 3.5);
	assert.equal(valueAt(respin, 4, 2)?.value, 2);
	assert.deepEqual(valueAt(respin, 3, 2), { name: 'JACKPOT', jackpot: 'MINI', factor: 2 });
});

it('a mystery replaces its cell and activates what it unlocks', () => {
	assert.deepEqual(respin.activeModifiers, ['payer', 'multiplier']);
	assert.equal(respin.played, 1);
});

it('the server snapshot replaces the picture wholesale', () => {
	const { active: _active, luckySpin: _luckySpin, meters: _meters, ...snapshot } = respin;
	const resumed = applyHoldAndWinEvent(base, {
		type: 'holdAndWinState',
		snapshot: { ...snapshot, cells: [coin(0, 0, 9)], total: 900, left: 1 },
	});
	assert.equal(resumed.active, true);
	assert.deepEqual(resumed.meters, base.meters);
	assert.equal(resumed.cells.length, 1);
	assert.equal(resumed.total, 900);
	assert.equal(resumed.left, 1);
});

it('a payload that repeats a position keeps one cell there (the last named)', () => {
	const twice = applyHoldAndWinEvent(entered, {
		type: 'coinsLand',
		cells: [coin(2, 2, 1), coin(2, 2, 5)],
	});
	assert.equal(twice.cells.filter((c) => c.reel === 2 && c.row === 2).length, 1);
	assert.equal(valueAt(twice, 2, 2)?.value, 5);
});

it('a cleared column banks its amount and empties; a lit one stays', () => {
	const grand = play(
		[
			{
				type: 'columnComplete',
				reel: 0,
				letter: 'G',
				newlyLit: true,
				cleared: true,
				value: 6,
				amount: 600,
				cells: [{ reel: 0, row: 0 }],
			},
			{ type: 'jackpotWin', tier: 'MINI', amount: 1500, source: 'column', banked: false },
			{ type: 'jackpotWin', tier: 'GRAND', amount: 100000, source: 'letters', banked: true },
		],
		entered,
	);
	assert.deepEqual(grand.lettersLit, [0]);
	assert.equal(
		grand.cells.some((c) => c.reel === 0),
		false,
	);
	assert.equal(grand.banked, 600 + 100000);
});

it('a collector keeps its value; a streak clears what it took', () => {
	const streak = play(
		[
			{
				type: 'coinCollect',
				collector: { reel: 1, row: 1, symbol: { name: 'COLLECT' } },
				level: 2,
				cells: [{ ...coin(0, 0, 1), amount: 100 }],
				value: 2,
			},
			{ type: 'cellsCleared', reason: 'collected', cells: [{ reel: 0, row: 0 }] },
		],
		entered,
	);
	assert.deepEqual(valueAt(streak, 1, 1), { name: 'COLLECT', value: 2 });
	assert.equal(valueAt(streak, 0, 0), undefined);
});

it('an add-respins raises the counter and its cap, then leaves when it applied', () => {
	const add = { reel: 4, row: 0, symbol: { name: 'ADD', value: 2 } };
	const added = play(
		[
			{ type: 'coinsLand', cells: [add] },
			{ type: 'respinsAdded', cell: add, added: 2, left: 4, total: 5 },
			{ type: 'cellsCleared', reason: 'applied', cells: [{ reel: 4, row: 0 }] },
		],
		{ ...respin, left: 2, start: 3 },
	);
	assert.equal(added.left, 4);
	assert.equal(added.start, 5);
	assert.equal(valueAt(added, 4, 0), undefined);
	const reset = applyHoldAndWinEvent(added, {
		type: 'respinUpdate',
		left: 5,
		played: 2,
		start: 5,
		reset: true,
	});
	assert.equal(reset.left, 5);
	assert.equal(reset.start, 5);
});

it('an upgrade raises cash values and steps a jackpot tier, keeping its factor', () => {
	const upgrader = { reel: 4, row: 1, symbol: { name: 'UPG', value: 0.5 } };
	const upgraded = play(
		[
			{ type: 'coinsLand', cells: [upgrader] },
			{
				type: 'coinUpgrade',
				upgrader,
				target: 'all',
				step: 0.5,
				cells: [
					{ reel: 0, row: 0, kind: 'value', from: 3, to: 3.5 },
					{ reel: 1, row: 1, kind: 'value', from: 3.5, to: 4 },
				],
			},
			{
				type: 'coinUpgrade',
				upgrader,
				target: 'jackpotTier',
				step: 0,
				cells: [{ reel: 3, row: 2, kind: 'jackpot', from: 'MINI', to: 'MINOR' }],
			},
			{ type: 'coinUpgrade', upgrader, target: 'adjacent', step: 0.5, cells: [] },
		],
		respin,
	);
	assert.equal(valueAt(upgraded, 0, 0)?.value, 3.5);
	assert.equal(valueAt(upgraded, 1, 1)?.value, 4);
	assert.deepEqual(valueAt(upgraded, 3, 2), { name: 'JACKPOT', jackpot: 'MINOR', factor: 2 });
	assert.deepEqual(valueAt(upgraded, 4, 1), upgrader.symbol);
	assert.equal(upgraded.left, respin.left);
});

it('an expanding board opens with its entry rows, grows on an unlock, and resumes its rows', () => {
	assert.equal(entered.rows, undefined);
	const grows = applyHoldAndWinEvent(base, {
		type: 'holdAndWinTrigger',
		mode: 'holdAndWin',
		cause: 'count',
		payload: {
			cells: [coin(0, 0, 1)],
			respins: 3,
			stickiness: 'allCoins',
			activeModifiers: [],
			expansion: { rows: 3, maxRows: 6 },
		},
	});
	assert.equal(grows.rows, 3);
	const unlock = { reel: 2, row: 2, symbol: { name: 'UNLOCK' } };
	const opened = play(
		[
			{ type: 'coinsLand', cells: [unlock] },
			{ type: 'rowsUnlocked', from: 3, rows: 4, cause: 'unlockSymbol', unlockers: [unlock] },
			{ type: 'cellsCleared', reason: 'applied', cells: [{ reel: 2, row: 2 }] },
		],
		grows,
	);
	assert.equal(opened.rows, 4);
	assert.equal(valueAt(opened, 2, 2), undefined);
	const { active: _a, luckySpin: _l, meters: _m, ...snapshot } = opened;
	const resumed = applyHoldAndWinEvent(emptyHoldAndWinState(), {
		type: 'holdAndWinState',
		snapshot,
	});
	assert.equal(resumed.rows, 4);
	const ended = applyHoldAndWinEvent(opened, {
		type: 'holdAndWinEnd',
		mode: 'holdAndWin',
		total: 0,
		payload: { cells: [], banked: 0 },
	});
	assert.equal(ended.rows, undefined);
});

it('the end closes the feature and keeps only the meters', () => {
	const ended = applyHoldAndWinEvent(respin, {
		type: 'holdAndWinEnd',
		mode: 'holdAndWin',
		total: 1234,
		payload: { cells: [], banked: 0 },
	});
	assert.equal(ended.active, false);
	assert.equal(ended.cells.length, 0);
	assert.equal(ended.total, 1234);
	assert.deepEqual(ended.meters, base.meters);
});

console.log(`
${passed} Hold and Win state checks passed, ${failed} failed.`);
if (failed > 0) throw new Error('Hold and Win state fixture failed');
