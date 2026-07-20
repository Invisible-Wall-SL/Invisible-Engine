/**
 * Invisible Flipbook — headless harness for the `FlipbookDoc` canonicalizer
 * (`engine-flipbook`'s `normalizeFlipbookDoc`). The `/flipbook` page will be a launcher-authed
 * WebGL surface (not browser-verifiable here), so — exactly as the sibling tools do — we verify
 * the data contract the tool stands on OFFLINE, in Node:
 *
 *   pnpm --filter flipbook-spike run doc
 *
 * Proves: (1) a clip's authored FRAME ORDER survives normalization verbatim — the whole point of
 * the doc, and the thing FX gets wrong today by inheriting checkbox-click order; (2) duplicate
 * frames are KEPT (holding a frame is a real technique) while empty ones are dropped; (3) an
 * unusable clip (no id, or no assetKey) is dropped rather than poisoning the runtime; (4) fps/loop
 * round-trip, and a nonsense fps falls back to the default rather than dividing by zero
 * downstream; (5) normalization is IDEMPOTENT (the save→reload fixed point).
 */

import {
	DEFAULT_FLIPBOOK_FPS,
	FLIPBOOK_DOC_VERSION,
	normalizeFlipbookDoc,
	type FlipbookDoc,
} from 'engine-flipbook';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const SHEET = 'borut/book_of_borut/manifests/atlas_manifest_fx.json';

// ---------------------------------------------------------------------------
// 1. Frame ORDER is the contract.
// ---------------------------------------------------------------------------
console.log('flipbook doc — frame order');
const ordered = normalizeFlipbookDoc({
	version: 1,
	clips: [{ id: 'boom', name: 'Explosion', assetKey: SHEET, frames: ['f3', 'f1', 'f2', 'f10'] }],
});
assert(
	eq(ordered.clips[0].frames, ['f3', 'f1', 'f2', 'f10']),
	'authored frame order survives verbatim (NOT sorted, NOT re-ordered)',
);
assert(ordered.version === FLIPBOOK_DOC_VERSION, 'the doc stamps the schema version');

// A held frame is a repeat. De-duplicating would silently retime the animation.
const held = normalizeFlipbookDoc({
	clips: [{ id: 'hold', assetKey: SHEET, frames: ['a', 'a', 'a', 'b'] }],
});
assert(eq(held.clips[0].frames, ['a', 'a', 'a', 'b']), 'duplicate frames are KEPT (a held frame)');

// Empty/non-string entries are noise, not intent.
const dirty = normalizeFlipbookDoc({
	clips: [{ id: 'dirty', assetKey: SHEET, frames: ['a', '', 'b', null, 7, 'c'] }],
});
assert(eq(dirty.clips[0].frames, ['a', 'b', 'c']), 'empty + non-string frames are dropped');

// ---------------------------------------------------------------------------
// 2. Unusable clips are dropped; usable-but-incomplete ones survive.
// ---------------------------------------------------------------------------
console.log('flipbook doc — clip validity');
const mixed = normalizeFlipbookDoc({
	clips: [
		{ id: 'good', assetKey: SHEET, frames: ['a'] },
		{ assetKey: SHEET, frames: ['a'] }, // no id ⇒ nothing can reference it
		{ id: 'noSheet', frames: ['a'] }, // no assetKey ⇒ no sheet to resolve against
		'garbage',
		null,
	],
});
assert(mixed.clips.length === 1 && mixed.clips[0].id === 'good', 'unusable clips are dropped');

// An empty frame list is work-in-progress, not garbage — the author may be mid-edit. Same call as
// normalizeEffectDoc keeping an unbound layer rather than destroying work on save.
const empty = normalizeFlipbookDoc({ clips: [{ id: 'wip', assetKey: SHEET, frames: [] }] });
assert(empty.clips.length === 1, 'a clip with NO frames yet is kept (work in progress)');

assert(
	eq(normalizeFlipbookDoc(undefined), { version: FLIPBOOK_DOC_VERSION, clips: [] }),
	'a garbage doc yields an empty clip list',
);

// `name` defaults to the id so a consumer always has a label.
assert(
	normalizeFlipbookDoc({ clips: [{ id: 'x', assetKey: SHEET, frames: [] }] }).clips[0].name === 'x',
	'name falls back to the id',
);

// ---------------------------------------------------------------------------
// 3. fps / loop.
// ---------------------------------------------------------------------------
console.log('flipbook doc — timing');
const timed = normalizeFlipbookDoc({
	clips: [{ id: 't', assetKey: SHEET, frames: ['a'], fps: 12, loop: false }],
});
assert(timed.clips[0].fps === 12 && timed.clips[0].loop === false, 'fps + loop round-trip');

// A 0/negative/NaN fps would divide by zero or run backwards at the consumer.
for (const [bad, label] of [
	[0, 'zero'],
	[-5, 'negative'],
	[Number.NaN, 'NaN'],
	['24', 'a string'],
] as const) {
	const c = normalizeFlipbookDoc({
		clips: [{ id: 'b', assetKey: SHEET, frames: ['a'], fps: bad }],
	}).clips[0];
	assert(
		c.fps === undefined,
		`${label} fps is dropped so the default (${DEFAULT_FLIPBOOK_FPS}) applies`,
	);
}

// Absent loop means looping — a one-shot must say so explicitly.
assert(
	normalizeFlipbookDoc({ clips: [{ id: 'l', assetKey: SHEET, frames: ['a'] }] }).clips[0].loop ===
		undefined,
	'absent loop stays absent (⇒ looping by default)',
);

// ---------------------------------------------------------------------------
// 4. Duplicate ids collapse, LAST wins — so a doc and the registry never disagree.
// ---------------------------------------------------------------------------
console.log('flipbook doc — id uniqueness');
const dupe = normalizeFlipbookDoc({
	clips: [
		{ id: 'same', name: 'first', assetKey: SHEET, frames: ['a'] },
		{ id: 'same', name: 'second', assetKey: SHEET, frames: ['b'] },
	],
});
assert(dupe.clips.length === 1, 'duplicate clip ids collapse to one');
assert(dupe.clips[0].name === 'second', 'LAST wins (parity with registerEffects latest-wins)');

// ---------------------------------------------------------------------------
// 5. Idempotence — the save→reload fixed point.
// ---------------------------------------------------------------------------
console.log('flipbook doc — idempotence');
const messy: unknown = {
	version: 99,
	editorOnlyJunk: { zoom: 3 },
	clips: [
		{
			id: 'boom',
			name: 'Explosion',
			assetKey: SHEET,
			frames: ['f1', 'f1', ''],
			fps: 30,
			loop: false,
			scratch: true,
		},
		{ id: 'idle', assetKey: SHEET, frames: ['i1', 'i2'] },
	],
};
const once = normalizeFlipbookDoc(messy);
const twice = normalizeFlipbookDoc(once);
assert(eq(once, twice), 're-normalizing a normalized doc is a fixed point');
assert(!('editorOnlyJunk' in (once as object)), 'editor-only state is stripped from the doc');
assert(
	!('scratch' in (once.clips[0] as unknown as Record<string, unknown>)),
	'unknown clip fields are stripped',
);
assert((once as FlipbookDoc).version === FLIPBOOK_DOC_VERSION, 'a stale version is restamped');

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK DOC: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK DOC: PASSED');
