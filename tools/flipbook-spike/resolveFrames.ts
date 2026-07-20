/**
 * Invisible Flipbook — headless harness for the runtime frame resolver
 * (`engine-flipbook`'s `resolveClipFrames`, the seam `<Flipbook>` stands on):
 *
 *   pnpm --filter flipbook-spike run frames
 *
 * Proves the two contracts that decide whether a shipped animation is right or subtly wrong:
 * (1) editor-art SCOPED keys (`<assetKey>::<frame>`) win over bare names, with a bare fallback
 * for games whose registration predates namespacing; (2) authored ORDER is preserved, including
 * duplicate frames (a hold); (3) a missing frame is dropped and REPORTED, never silently
 * substituted; (4) resolving nothing yields nothing — there is deliberately no whole-sheet
 * fallback, the failure mode that makes a broken FX layer spray arbitrary wrong art.
 */

import { resolveClipFrames } from 'engine-flipbook';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const SHEET = 'borut/book_of_borut/manifests/atlas_manifest_fx.json';
const clip = (frames: string[], assetKey = SHEET) => ({ assetKey, frames });

console.log('flipbook frames — scoped vs bare keys');
// Both registered (the real editor-art shape: scoped AND bare for back-compat).
const both = resolveClipFrames(clip(['a', 'b']), {
	[`${SHEET}::a`]: 'SCOPED_A',
	[`${SHEET}::b`]: 'SCOPED_B',
	a: 'BARE_A',
	b: 'BARE_B',
});
assert(
	both.textures.join(',') === 'SCOPED_A,SCOPED_B',
	'a scoped key WINS over a bare one of the same name',
);

// Legacy registration: bare only.
const bare = resolveClipFrames(clip(['a', 'b']), { a: 'BARE_A', b: 'BARE_B' });
assert(bare.textures.join(',') === 'BARE_A,BARE_B', 'bare names still resolve (legacy fallback)');

// A game-bundled assetKey is not a manifest path, so scoping does not apply.
const bundled = resolveClipFrames(clip(['a'], 'symbolsStatic'), {
	'symbolsStatic::a': 'SCOPED',
	a: 'BARE',
});
assert(bundled.textures.join(',') === 'BARE', 'a non-manifest assetKey resolves bare, not scoped');

console.log('flipbook frames — order');
const ordered = resolveClipFrames(clip(['c', 'a', 'b']), { a: 'A', b: 'B', c: 'C' });
assert(ordered.textures.join(',') === 'C,A,B', 'authored order is preserved, not sorted');

const held = resolveClipFrames(clip(['a', 'a', 'b']), { a: 'A', b: 'B' });
assert(held.textures.join(',') === 'A,A,B', 'a duplicated frame resolves twice (a HOLD)');

console.log('flipbook frames — missing');
const partial = resolveClipFrames(clip(['a', 'gone', 'b']), { a: 'A', b: 'B' });
assert(partial.textures.join(',') === 'A,B', 'a missing frame is dropped from the textures');
assert(partial.missing.join(',') === 'gone', 'the missing frame is REPORTED, not swallowed');
// A gap in the middle must not reorder what remains — the frames after it keep their place.
const gapped = resolveClipFrames(clip(['a', 'gone', 'b', 'alsoGone', 'c']), {
	a: 'A',
	b: 'B',
	c: 'C',
});
assert(gapped.textures.join(',') === 'A,B,C', 'gaps do not reorder the surviving frames');
assert(gapped.missing.join(',') === 'gone,alsoGone', 'every gap is reported, in authored order');

console.log('flipbook frames — the no-fallback rule');
const allGone = resolveClipFrames(clip(['x', 'y']), { a: 'A', b: 'B' });
assert(allGone.textures.length === 0, 'resolving NOTHING yields NO textures');
assert(
	allGone.missing.join(',') === 'x,y',
	'every unresolved frame is reported so the caller can complain loudly',
);
// The whole point: a broken clip must not fall back to "whatever is in the sheet".
assert(
	!allGone.textures.includes('A') && !allGone.textures.includes('B'),
	'a broken clip NEVER substitutes unrelated sheet frames (the ParticleEmitter trap)',
);

console.log('flipbook frames — edges');
assert(
	resolveClipFrames(clip([]), { a: 'A' }).textures.length === 0,
	'an empty clip resolves empty',
);
assert(
	resolveClipFrames(clip(['a']), undefined).missing.join(',') === 'a',
	'no loadedAssets ⇒ all missing',
);
// A null/undefined entry in the map is "not loaded", not a usable texture.
const nulled = resolveClipFrames(clip(['a', 'b']), { a: null, b: 'B' });
assert(
	nulled.textures.join(',') === 'B' && nulled.missing.join(',') === 'a',
	'a null entry counts as missing, not as a texture',
);

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK FRAMES: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK FRAMES: PASSED');
