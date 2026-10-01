/**
 * The pre-feature wheel's geometry (`holdAndWinWheel.ts`) and a column sweep's split
 * (`respinCount.ts` `cellWorth` + `countSteps`): where the wheel stops for an index, and how a
 * swept column's amount is shared across its coins.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/holdAndWinWheel.fixture.ts
 */
import {
	wheelEase,
	wheelLandingRotation,
	wheelPrizeLabel,
	wheelSegmentAngle,
	wheelSegmentAt,
} from '../src/game/holdAndWinWheel.ts';
import { cellWorth, countSteps } from '../src/game/respinCount.ts';

// No `node:assert` — the package has no Node types, and svelte-check reads this file too.
const assert = {
	equal: (actual: unknown, expected: unknown) => {
		if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
	},
	ok: (value: boolean, message: string) => {
		if (!value) throw new Error(message);
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

const TURN = Math.PI * 2;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

it('the wheel lands every index of every size under the pointer', () => {
	for (const count of [1, 2, 3, 5, 7, 8, 12]) {
		for (let index = 0; index < count; index++) {
			const rotation = wheelLandingRotation({ count, index });
			assert.equal(wheelSegmentAt(rotation, count), index);
			// Centred, not merely inside the segment: the pointer sits on the segment's middle.
			const offset = (((-rotation % TURN) + TURN) % TURN) / wheelSegmentAngle(count);
			assert.ok(
				near(offset, Math.round(offset)) || near(offset, count),
				`${count}/${index} off centre`,
			);
		}
	}
});

it('it always turns at least the asked turns past where it starts, and less than one more', () => {
	for (const from of [0, 1.234, -4, 25.5]) {
		for (const turns of [0, 1, 3]) {
			for (let index = 0; index < 7; index++) {
				const rotation = wheelLandingRotation({ count: 7, index, from, turns });
				assert.ok(rotation >= from + turns * TURN - 1e-9, `short: ${from}/${turns}/${index}`);
				assert.ok(rotation < from + (turns + 1) * TURN, `too far: ${from}/${turns}/${index}`);
				assert.equal(wheelSegmentAt(rotation, 7), index);
			}
		}
	}
});

it('the landing is deterministic — a slam jumps to the very rotation the spin eases onto', () => {
	const a = wheelLandingRotation({ count: 7, index: 4, from: 0.5, turns: 3 });
	const b = wheelLandingRotation({ count: 7, index: 4, from: 0.5, turns: 3 });
	assert.equal(a, b);
	assert.equal(wheelEase(1), 1);
	assert.equal(wheelEase(1.7), 1);
	assert.equal(wheelEase(0), 0);
	assert.ok(wheelEase(0.5) > 0.5, 'eases out: past half way at half time');
});

it('an index outside the wheel wraps rather than landing nowhere', () => {
	assert.equal(wheelSegmentAt(wheelLandingRotation({ count: 7, index: 9 }), 7), 2);
	assert.equal(wheelSegmentAt(wheelLandingRotation({ count: 7, index: -1 }), 7), 6);
});

it('the coded prize labels read as the reference wheel does', () => {
	assert.equal(wheelPrizeLabel({ type: 'coinBoost', multiplier: 2 }), 'COIN BOOST ×2');
	assert.equal(wheelPrizeLabel({ type: 'extraCollect', count: 1 }), '+1 COLLECT');
	assert.equal(wheelPrizeLabel({ type: 'jackpot', jackpot: 'GRAND' }), 'GRAND');
});

const JACKPOTS = [
	{ name: 'MINI', multiplier: 15 },
	{ name: 'MINOR', multiplier: 30 },
];

it('a cell is worth its value, or its jackpot tier × factor', () => {
	assert.equal(cellWorth({ value: 2.5 }, JACKPOTS), 2.5);
	assert.equal(cellWorth({ jackpot: 'MINI' }, JACKPOTS), 15);
	assert.equal(cellWorth({ jackpot: 'MINOR', factor: 2 }, JACKPOTS), 60);
	assert.equal(cellWorth({ jackpot: 'MEGA' }, JACKPOTS), 0);
	assert.equal(cellWorth({}, JACKPOTS), 0);
});

it("a swept column's amount is shared by worth and lands exactly on the bar's new value", () => {
	// GRAND's column A: 3 + MINI + 3 = 21 × bet, amount 2100.
	const weights = [{ value: 3 }, { jackpot: 'MINI' }, { value: 3 }].map((s) =>
		cellWorth(s, JACKPOTS),
	);
	const steps = countSteps(500, 500 + 2100, weights);
	assert.deepEqual(steps, [
		{ from: 500, to: 800 },
		{ from: 800, to: 2300 },
		{ from: 2300, to: 2600 },
	]);
	// A column the table cannot value still sweeps, in equal shares.
	assert.equal(countSteps(0, 90, [0, 0, 0])[2].to, 90);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} wheel fixture check(s) failed`);
