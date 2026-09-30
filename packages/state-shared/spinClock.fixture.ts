/**
 * The operator's minimum spin duration (`minSpinDuration`) as the reveal sees it: how long a
 * spin's result must still be held back, and which moment the spin is timed from.
 *
 * Drives the REAL `spinClock` with a fake clock. `apps/lines` `presentReveal` holds for exactly
 * `remainingUntil(revealDeadline(min))` after starting the roll, and `newGame` calls `markPress` —
 * both only when the minimum is above zero; `utils-xstate/newGameGate.fixture.mjs` covers that the
 * press is marked when (and only when) it should be.
 *
 * Run: pnpm exec tsx packages/state-shared/spinClock.fixture.ts
 */
import assert from 'node:assert/strict';

import { createSpinClock } from './src/spinClock.ts';

let t = 0;
const clock = createSpinClock(() => t);
let passed = 0;
const check = (label: string, run: () => void) => {
	run();
	passed += 1;
	console.log(`  ok  ${label}`);
};

console.log('spinClock — minSpinDuration');

check('ABSENT: no minimum ⇒ the result shows the moment it arrives', () => {
	t = 1_000;
	clock.markPress();
	t = 1_050;
	assert.equal(clock.remainingUntil(clock.revealDeadline(0)), 0);
});

check('a nonsensical negative minimum is no minimum', () => {
	t = 2_000;
	assert.equal(clock.remainingUntil(clock.revealDeadline(-500)), 0);
});

check('PRESENT: a fast result is held for the rest of the minimum, timed from the PRESS', () => {
	t = 10_000;
	clock.markPress();
	t = 10_300; // the RGS answered 300 ms after the press
	const deadline = clock.revealDeadline(1_000);
	assert.equal(deadline, 11_000);
	assert.equal(clock.remainingUntil(deadline), 700);
	t = 10_950;
	assert.equal(clock.remainingUntil(deadline), 50, 'the wait is re-read, not frozen');
	t = 11_000;
	assert.equal(clock.remainingUntil(deadline), 0);
});

check('PRESENT: a result slower than the minimum is not held at all', () => {
	t = 20_000;
	clock.markPress();
	t = 21_500;
	assert.equal(clock.remainingUntil(clock.revealDeadline(1_000)), 0);
});

check('the press mark is consumed by the FIRST reveal only', () => {
	t = 30_000;
	clock.markPress();
	t = 30_200;
	assert.equal(clock.remainingUntil(clock.revealDeadline(1_000)), 800);
	// The book's second reveal (a free spin) begins after the first spin's presentation.
	t = 34_000;
	const deadline = clock.revealDeadline(1_000);
	assert.equal(deadline, 35_000, 'timed from its own start, not the long-gone press');
	assert.equal(clock.remainingUntil(deadline), 1_000);
});

check('every free spin is timed from its own start', () => {
	t = 40_000;
	clock.markPress();
	clock.revealDeadline(2_000);
	for (const start of [45_000, 52_000, 58_500]) {
		t = start;
		const deadline = clock.revealDeadline(2_000);
		t = start + 400;
		assert.equal(clock.remainingUntil(deadline), 1_600);
	}
});

check('a resumed round (no press) is timed from its first reveal', () => {
	t = 70_000;
	const deadline = clock.revealDeadline(1_500);
	assert.equal(deadline, 71_500);
});

check('a newer press replaces an unconsumed one (a bet that failed before any reveal)', () => {
	t = 80_000;
	clock.markPress();
	t = 90_000;
	clock.markPress();
	t = 90_100;
	assert.equal(clock.remainingUntil(clock.revealDeadline(1_000)), 900);
});

console.log(`spinClock: ${passed} passed`);
