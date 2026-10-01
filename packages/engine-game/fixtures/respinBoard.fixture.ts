/**
 * The respin board's rules (`respinBoard.ts`): which cells a respin spins and onto what, which cells
 * a new picture lets go of, and what every one-cell reel shows when the board mounts.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/respinBoard.fixture.ts
 */
import { releasedCells, respinSeedBoard, respinSpins } from '../src/game/respinBoard.ts';

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

const coin = (reel: number, row: number, value: number) => ({
	reel,
	row,
	symbol: { name: 'BONUS', value },
});
const blankAt = (reel: number, row: number) => ({ reel, row, symbol: { name: 'BLANK' } });

/** A whole 5×3 respin reveal: two held coins, one new coin at (3, 2), BLANK everywhere else. */
const held = [coin(0, 1, 2), coin(4, 0, 5)];
const reveal = [
	...Array.from({ length: 5 }, (_r, reel) =>
		Array.from({ length: 3 }, (_c, row) => blankAt(reel, row)),
	).flat(),
].map((cell) => held.find((h) => h.reel === cell.reel && h.row === cell.row) ?? cell);
reveal[3 * 3 + 2] = coin(3, 2, 1.5);

it('a respin spins every cell that is not held, and only those', () => {
	const spins = respinSpins({ reels: 5, rows: 3, held, reveal, blank: 'BLANK' });
	assert.equal(spins.length, 13);
	assert.equal(
		spins.some((s) => (s.reel === 0 && s.row === 1) || (s.reel === 4 && s.row === 0)),
		false,
	);
});

it('each spinning cell lands on what the reveal names for it — the new coin keeps its value', () => {
	const spins = respinSpins({ reels: 5, rows: 3, held, reveal, blank: 'BLANK' });
	assert.deepEqual(spins.find((s) => s.reel === 3 && s.row === 2)?.symbol, {
		name: 'BONUS',
		value: 1.5,
	});
	assert.deepEqual(spins.find((s) => s.reel === 1 && s.row === 0)?.symbol, { name: 'BLANK' });
});

it('a held cell does not spin even when the reveal names something else for it', () => {
	const lying = reveal.map((cell) =>
		cell.reel === 0 && cell.row === 1 ? { ...cell, symbol: { name: 'BLANK' } } : cell,
	);
	const spins = respinSpins({ reels: 5, rows: 3, held, reveal: lying, blank: 'BLANK' });
	assert.equal(
		spins.some((s) => s.reel === 0 && s.row === 1),
		false,
	);
});

it('a cell the reveal does not mention lands on the blank symbol', () => {
	const spins = respinSpins({ reels: 2, rows: 1, held: [], reveal: [], blank: 'EMPTY' });
	assert.deepEqual(
		spins.map((s) => s.symbol.name),
		['EMPTY', 'EMPTY'],
	);
});

it('cells stop column by column: the order is the reel, rows of a column stop together', () => {
	const spins = respinSpins({ reels: 5, rows: 3, held, reveal, blank: 'BLANK' });
	assert.deepEqual(
		spins.map((s) => s.order),
		[0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4],
	);
});

it('a full board spins nothing', () => {
	const full = Array.from({ length: 3 }, (_r, reel) => coin(reel, 0, 1));
	assert.equal(respinSpins({ reels: 3, rows: 1, held: full, reveal: full, blank: 'B' }).length, 0);
});

it('released cells are the held ones the new picture no longer holds', () => {
	const before = [coin(0, 0, 1), coin(1, 1, 2), coin(2, 2, 3)];
	const after = [coin(1, 1, 4)];
	assert.deepEqual(releasedCells(before, after), [
		{ reel: 0, row: 0 },
		{ reel: 2, row: 2 },
	]);
	assert.deepEqual(releasedCells(after, before), []);
});

it('the mount shows the blank on every cell, held or free', () => {
	const board = respinSeedBoard({ reels: 2, rows: 2, blank: 'BLANK' });
	assert.deepEqual(board, [
		[{ name: 'BLANK' }, { name: 'BLANK' }],
		[{ name: 'BLANK' }, { name: 'BLANK' }],
	]);
});

console.log(`
${passed} respin board checks passed, ${failed} failed.`);
if (failed > 0) throw new Error('respin board fixture failed');
