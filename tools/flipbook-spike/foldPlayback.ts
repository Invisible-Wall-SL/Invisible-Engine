/**
 * Invisible Flipbook — headless harness for the per-binding playback FOLD
 * (`engine-layout`'s `foldFlipbookPlayback`):
 *
 *   pnpm --filter flipbook-spike run fold
 *
 * Imported by PATH for the reason `registry.ts` states: the `engine-layout` barrel pulls in
 * Svelte components and pixi, which Node cannot resolve.
 *
 * This fold is what lets ONE authored clip serve several uses — a placed scene node and a symbol
 * state — instead of forcing a second clip whose frame list, and therefore whose referential
 * integrity, would have to be kept in step by hand. Both consumers call this one function, so the
 * contract it has to hold is:
 *
 *   1. `undefined` means INHERIT and `false` does not. Read with `||` instead of `??`, a binding
 *      could never un-mirror a clip authored mirrored, nor un-loop one authored looping — the
 *      override would silently do nothing, which is the worst possible failure for a toggle.
 *   2. An empty override returns the clip BY IDENTITY. `<Flipbook>` derives its texture array from
 *      this object; a fresh object every time re-derives that array for no reason.
 *   3. A field the caller leaves out is not touched. A symbol cell omits `loop` deliberately (it
 *      travels as a prop so `<Flipbook>`'s own `props.loop ?? clip.loop ?? true` chain still
 *      drives the Book riders), and that omission must not be read as "set it to undefined".
 */

import {
	foldFlipbookPlayback,
	type FlipbookClipEntry,
} from '../../packages/engine-layout/src/lib/registerFlipbooks';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures++;
	}
};

const clip = (over: Partial<FlipbookClipEntry> = {}): FlipbookClipEntry => ({
	id: 'c',
	assetKey: 'sheet.json',
	frames: ['a', 'b', 'c'],
	...over,
});

console.log('\nfoldFlipbookPlayback\n');

// --- 1. nothing to fold -----------------------------------------------------
const plain = clip({ direction: 'reverse', fps: 12 });
assert(
	foldFlipbookPlayback(plain, undefined) === plain,
	'no override at all returns the clip itself',
);
assert(foldFlipbookPlayback(plain, {}) === plain, 'an empty override returns the clip BY IDENTITY');
assert(
	foldFlipbookPlayback(plain, { fps: undefined, direction: undefined }) === plain,
	'an override of all-undefined is still the same object (not a copy)',
);

// --- 2. the override wins ---------------------------------------------------
const walked = foldFlipbookPlayback(clip(), { direction: 'reverse' });
assert(walked.direction === 'reverse', 'a direction override applies');
assert(walked !== clip(), 'a real override produces a new object');
assert(
	foldFlipbookPlayback(clip({ direction: 'pingpong' }), { direction: 'forward' }).direction ===
		'forward',
	'an override BEATS the clip\u2019s own direction \u2014 forward is a choice, not an absence',
);
assert(foldFlipbookPlayback(clip({ fps: 24 }), { fps: 8 }).fps === 8, 'an fps override applies');

// --- 3. inheritance ---------------------------------------------------------
assert(
	foldFlipbookPlayback(clip({ direction: 'pingpong', fps: 30 }), { flipX: true }).direction ===
		'pingpong',
	'a field the binding does not override keeps the clip\u2019s value',
);
assert(
	foldFlipbookPlayback(clip({ fps: 30 }), { flipX: true }).fps === 30,
	'\u2026 including fps, when only mirroring was overridden',
);

// --- 4. false is a VALUE, not an absence (the whole point) -------------------
assert(
	foldFlipbookPlayback(clip({ flipX: true }), { flipX: false }).flipX === false,
	'a binding can UN-MIRROR a clip authored mirrored (false !== inherit)',
);
assert(
	foldFlipbookPlayback(clip({ loop: true }), { loop: false }).loop === false,
	'a binding can UN-LOOP a clip authored looping',
);
assert(
	foldFlipbookPlayback(clip({ flipY: true }), { flipX: true }).flipY === true,
	'overriding one mirror axis leaves the other inherited',
);

// --- 5. omitted fields are not clobbered ------------------------------------
// A symbol cell folds everything EXCEPT loop, on purpose. If the fold treated a missing key as an
// explicit undefined, that omission would erase the clip's own loop and the Book riders' chain
// would start from the wrong value.
const kept = foldFlipbookPlayback(clip({ loop: false }), { direction: 'reverse' });
assert(kept.loop === false, 'a key the caller omitted keeps the clip\u2019s value, not undefined');
assert(kept.direction === 'reverse', '\u2026 while the key it did pass still applies');

// --- 6. nothing else is disturbed -------------------------------------------
const full = foldFlipbookPlayback(clip({ bounds: { x: 1, y: 2, w: 3, h: 4 } }), {
	direction: 'reverse',
});
assert(full.frames.length === 3 && full.id === 'c', 'frames and id survive the fold');
assert(full.bounds?.w === 3, 'the clip\u2019s bounds box survives the fold');

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK FOLD: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK FOLD: PASSED');
