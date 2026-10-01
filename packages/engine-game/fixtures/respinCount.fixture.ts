/**
 * The respin board's count-ups (`respinCount.ts`): how a collector's rise is split per coin, and
 * how a row of coins is staggered.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/respinCount.fixture.ts
 */
import { countSteps, staggerDelays, tallyCountUp } from '../src/game/respinCount.ts';

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

it('a collector rises by each coin in turn, in proportion to its worth', () => {
	assert.deepEqual(countSteps(0, 6, [100, 200, 300]), [
		{ from: 0, to: 1 },
		{ from: 1, to: 3 },
		{ from: 3, to: 6 },
	]);
});

it('the legs are contiguous and the last lands exactly on the server value', () => {
	// Rounded per-coin credits (33 × 3 = 99) against a value of 1: the last leg is still exactly 1.
	const steps = countSteps(0.1, 1.1, [33, 33, 33]);
	assert.equal(steps.length, 3);
	assert.equal(steps[0].from, 0.1);
	assert.equal(steps[1].from, steps[0].to);
	assert.equal(steps[2].from, steps[1].to);
	assert.equal(steps[2].to, 1.1);
});

it('a collector that already holds a value counts on from it', () => {
	assert.deepEqual(countSteps(4, 8, [1, 1]), [
		{ from: 4, to: 6 },
		{ from: 6, to: 8 },
	]);
});

it('weights that sum to nothing usable share the distance equally', () => {
	assert.deepEqual(countSteps(0, 4, [0, 0]), [
		{ from: 0, to: 2 },
		{ from: 2, to: 4 },
	]);
	assert.deepEqual(countSteps(0, 4, [Number.NaN, -1]), [
		{ from: 0, to: 2 },
		{ from: 2, to: 4 },
	]);
});

it('a zero weight among real ones is a leg that does not move', () => {
	assert.deepEqual(countSteps(0, 2, [1, 0, 1]), [
		{ from: 0, to: 1 },
		{ from: 1, to: 1 },
		{ from: 1, to: 2 },
	]);
});

it('no coins, no legs; one coin, the whole distance', () => {
	assert.deepEqual(countSteps(0, 5, []), []);
	assert.deepEqual(countSteps(2, 5, [7]), [{ from: 2, to: 5 }]);
});

it('a few coins stagger at the full step', () => {
	assert.deepEqual(staggerDelays(3, 120, 900), [0, 120, 240]);
});

it('a board full of coins compresses the stagger to the span', () => {
	const delays = staggerDelays(16, 120, 900);
	assert.equal(delays.length, 16);
	assert.equal(delays[0], 0);
	assert.equal(delays[15], 900);
	assert.equal(
		delays.every((delay, i) => i === 0 || delay > delays[i - 1]),
		true,
	);
});

it('one item starts at once; none, nothing', () => {
	assert.deepEqual(staggerDelays(1, 120, 900), [0]);
	assert.deepEqual(staggerDelays(0, 120, 900), []);
});

it('the tally adds each coin as it lands and ends exactly on the feature total', () => {
	const tally = tallyCountUp({ start: 200, amounts: [100, 150, 250], banked: 1500, total: 2000 });
	assert.equal(tally.arrive(0), 300);
	assert.equal(tally.arrive(1), 450);
	assert.equal(tally.arrive(2), 700);
	assert.equal(tally.final, 2200);
});

it('coins landing out of order add their own amounts, and a repeat counts once', () => {
	const tally = tallyCountUp({ start: 0, amounts: [100, 150, 250], banked: 0, total: 500 });
	assert.equal(tally.arrive(2), 250);
	assert.equal(tally.arrive(2), 250);
	assert.equal(tally.arrive(0), 350);
	assert.equal(tally.arrive(1), 500);
});

it('rounded per-coin amounts still land the last coin and the end exactly', () => {
	// Short: 33 × 3 = 99 against 100 — the last coin takes up the cent.
	const short = tallyCountUp({ start: 0, amounts: [33, 33, 33], banked: 0, total: 100 });
	assert.deepEqual([short.arrive(0), short.arrive(1), short.arrive(2)], [33, 66, 100]);
	// Over: 34 × 3 = 102 against 100 — the bar never passes the coins' share early, never goes down.
	const over = tallyCountUp({ start: 0, amounts: [34, 34, 34], banked: 0, total: 100 });
	const seen = [over.arrive(0), over.arrive(1), over.arrive(2)];
	assert.deepEqual(seen, [34, 68, 100]);
	assert.equal(over.final, 100);
	// Every order of every split is monotonic and lands on the total.
	for (const order of [
		[0, 1, 2],
		[2, 1, 0],
		[1, 2, 0],
	]) {
		const t = tallyCountUp({ start: 5, amounts: [70, 0, 45], banked: 10, total: 120 });
		let last = 5;
		for (const i of order) {
			const v = t.arrive(i);
			assert.equal(v >= last, true);
			last = v;
		}
		assert.equal(last, 115);
		assert.equal(t.final, 125);
	}
});

it('a tally with no coins is only its banked part', () => {
	const tally = tallyCountUp({ start: 0, amounts: [], banked: 200000, total: 200000 });
	assert.equal(tally.arrive(0), 0);
	assert.equal(tally.final, 200000);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error('respin count fixture failed');
