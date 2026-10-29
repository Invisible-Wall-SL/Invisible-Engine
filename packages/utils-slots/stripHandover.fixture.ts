/**
 * Offline fixture for the reel strip HANDOVER — run with `node` (Node ≥ 22.18 strips the types):
 *   node packages/utils-slots/stripHandover.fixture.ts
 *
 * When a spin takes over a rolling reel, `createReelForSpinning` lays the result and its filler
 * above the cells `onScreenTail` keeps and moves the reel by `reelYAbove`. Pins: at ANY reel Y, every
 * cell that can be on screen is drawn at the same y after the handover as before it (what the reel
 * swapped in one frame when the result landed as a pre-spin lap ended); only cells above the window
 * are dropped; at rest and at a lap's end the strip lands where it always did, so the spin's length
 * does not change.
 */

import { onScreenTail, reelYAbove } from './src/stripHandover.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

const pitch = 120;
const homeY = -pitch;
const lap = 5;
const added = lap + 15;
const yOf = (reelY: number, index: number) => reelY + index * pitch;

// The pre-spin loop's strip: a new lap (cells 0-4) above the lap on screen (cells 5-9).
const strip = Array.from({ length: 2 * lap }, (_, i) => `c${i}`);

let moved = 0;
let droppedVisible = 0;
for (let reelY = homeY - lap * pitch; reelY <= homeY; reelY += 3) {
	const { tail, tailY } = onScreenTail(strip, reelY, homeY, pitch);
	const first = strip.length - tail.length;
	const next = reelYAbove(tailY, added, pitch);
	tail.forEach((cell, i) => {
		if (yOf(next, added + i) !== yOf(reelY, first + i)) moved += 1;
	});
	for (let i = 0; i < first; i++) if (yOf(reelY, i) > homeY - pitch / 2) droppedVisible += 1;
}
check('at every reel Y, each kept cell is drawn where it was', moved, 0);
check('only cells above the resting top seat are dropped', droppedVisible, 0);

const atRest = onScreenTail(strip.slice(lap), homeY, homeY, pitch);
check('at rest the whole strip is kept', atRest.tail, strip.slice(lap));
check(
	'at rest the strip lands where it always did',
	reelYAbove(atRest.tailY, added, pitch),
	homeY - added * pitch,
);

const lapEnd = onScreenTail(strip, homeY - lap * pitch, homeY, pitch);
check(
	'at a lap end the lap on screen is kept, not the new one above it',
	lapEnd.tail,
	strip.slice(lap),
);
check(
	'at a lap end the strip lands where a resting one does (same spin length)',
	reelYAbove(lapEnd.tailY, added, pitch),
	homeY - added * pitch,
);

if (failures) {
	console.log(`\nstripHandover: ${failures} check(s) FAILED`);
	throw new Error('stripHandover fixture failed');
}
console.log('\nstripHandover: all checks passed');
