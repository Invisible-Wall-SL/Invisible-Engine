/**
 * Invisible Flipbook — headless harness for PLAYBACK ORDER (`engine-flipbook`'s
 * `playbackIndices` / `playbackFrameCount`, and the copy of the length formula that
 * `engine-layout`'s registry deliberately keeps):
 *
 *   pnpm --filter flipbook-spike run playback
 *
 * Proves: (1) `forward` is byte-identical to the pre-direction walk, so every clip authored
 * before directions existed plays exactly as it did; (2) `reverse` walks the authored list
 * backwards without touching it; (3) `pingpong` returns through the INTERIOR frames only, so a
 * loop never holds an endpoint for two ticks; (4) degenerate counts (0, 1, 2) can't produce a
 * walk longer than the list; (5) `playbackFrameCount` agrees with `playbackIndices().length` at
 * every count — the two are used in different places (duration vs. rendering) and a disagreement
 * is exactly how a symbol state reverts halfway through its own animation; (6) the copy of that
 * formula in `engine-layout` agrees with the original, which is the price of that package staying
 * dependency-free.
 *
 * Imported by PATH for the `engine-layout` half — that barrel pulls in Svelte + pixi, which Node
 * cannot resolve ([[gotcha_constants_shared_not_node_resolvable]]).
 */

import {
	FLIPBOOK_DIRECTIONS,
	isFlipbookDirection,
	playbackFrameCount,
	playbackIndices,
	type FlipbookDirection,
} from 'engine-flipbook';
import { flipbookPlaybackFrameCount } from '../../packages/engine-layout/src/lib/registerFlipbooks';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const walk = (n: number, d?: FlipbookDirection): string => playbackIndices(n, d).join(',');

console.log('flipbook playback — forward is the untouched walk');
assert(walk(5) === '0,1,2,3,4', 'no direction ⇒ the authored order, unchanged');
assert(walk(5, 'forward') === '0,1,2,3,4', 'an explicit `forward` is the same walk');
assert(walk(0) === '', 'an empty clip walks nowhere');

console.log('flipbook playback — reverse');
assert(walk(5, 'reverse') === '4,3,2,1,0', 'reverse walks the authored list backwards');
assert(walk(1, 'reverse') === '0', 'a one-frame clip reversed is itself');

console.log('flipbook playback — ping-pong');
assert(walk(5, 'pingpong') === '0,1,2,3,4,3,2,1', 'the turnaround frames are NOT repeated');
assert(walk(3, 'pingpong') === '0,1,2,1', 'three frames bounce through the one interior frame');
assert(
	walk(2, 'pingpong') === '0,1',
	'two frames have no interior to come back through ⇒ the forward walk',
);
assert(walk(1, 'pingpong') === '0', 'one frame ping-ponged is one frame');

console.log('flipbook playback — a ping-pong loop returns to frame 0 exactly once per cycle');
const cycle = playbackIndices(4, 'pingpong');
assert(cycle.filter((i) => i === 0).length === 1, 'frame 0 appears once per cycle, not twice');
assert(
	cycle.filter((i) => i === 3).length === 1,
	'the last frame appears once per cycle, not twice',
);

console.log('flipbook playback — length agrees with the walk at every count');
let lengthsAgree = true;
let copyAgrees = true;
for (let n = 0; n <= 12; n++) {
	for (const d of [undefined, ...FLIPBOOK_DIRECTIONS]) {
		const built = playbackIndices(n, d).length;
		if (playbackFrameCount(n, d) !== built) lengthsAgree = false;
		if (flipbookPlaybackFrameCount(n, d) !== built) copyAgrees = false;
	}
}
assert(lengthsAgree, 'playbackFrameCount === playbackIndices().length for counts 0..12');
assert(
	copyAgrees,
	"engine-layout's copy of the formula agrees with engine-flipbook's (the dependency-free price)",
);
assert(playbackFrameCount(49, 'pingpong') === 96, 'a 49-frame ping-pong cycle is 96 ticks, not 49');

console.log('flipbook playback — direction guard');
assert(isFlipbookDirection('pingpong'), 'a known direction is accepted');
assert(
	!isFlipbookDirection('boomerang'),
	'an unknown direction is refused (⇒ the default applies)',
);
assert(!isFlipbookDirection(undefined), 'an absent direction is not a direction');
assert(
	walk(4, 'boomerang' as FlipbookDirection) === '0,1,2,3',
	'an unrecognised direction walks forward rather than throwing',
);

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK PLAYBACK: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK PLAYBACK: PASSED');
