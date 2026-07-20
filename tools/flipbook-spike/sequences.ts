/**
 * Invisible Flipbook — headless harness for `detectSequences` (the "turn a numbered run into
 * a clip" offer in `/flipbook`):
 *
 *   pnpm --filter flipbook-spike run sequences
 *
 * Holds the TS implementation to the SAME behaviour as the Sheet Maker's Python
 * `plist_import.detect_sequences`, case for case — a sheet must group identically whichever
 * side looks at it, or an imported atlas and an authored one would offer different clips.
 *
 * The two rules that matter: numeric (not lexicographic) ordering, and a gap SPLITS a run.
 */

import { detectSequences, detectSequencesAcross } from 'engine-flipbook';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

console.log('sequences — the real sample sheet');
// The shipped cocos atlas: anim-sym-pic1_00 .. _48, zero-padded, one run.
const real = Array.from({ length: 49 }, (_, i) => `anim-sym-pic1_${String(i).padStart(2, '0')}`);
const found = detectSequences(real);
assert(found.length === 1, '49 consecutive frames ⇒ exactly one clip');
assert(found[0].frames.length === 49, 'the run keeps all 49 frames');
assert(found[0].stem === 'anim-sym-pic1', 'the stem drops the trailing separator');
assert(found[0].frames[0] === 'anim-sym-pic1_00', 'the run starts at _00');
assert(found[0].frames[48] === 'anim-sym-pic1_48', 'the run ends at _48');

console.log('sequences — numeric, not lexicographic');
const unpadded = detectSequences(Array.from({ length: 11 }, (_, i) => `b_${i + 1}`));
assert(unpadded[0].frames[1] === 'b_2', 'b_2 precedes b_10 (numeric order)');
assert(unpadded[0].frames[9] === 'b_10', 'b_10 lands at index 9, not index 1');
// Input order must not matter — the offer is the same however the sheet lists its regions.
const shuffled = detectSequences(['c_3', 'c_1', 'c_10', 'c_2', 'c_4', 'c_5']);
assert(
	shuffled[0].frames.join(',') === 'c_1,c_2,c_3,c_4,c_5',
	'input order is irrelevant; the run is rebuilt numerically and stops at the gap',
);

console.log('sequences — gaps split');
const split = detectSequences(['d_0', 'd_1', 'd_2', 'd_7', 'd_8', 'd_9']);
assert(split.length === 2, 'a numbering gap splits one stem into two clips');
assert(
	split.every((s) => s.frames.length === 3),
	'each side of the gap keeps its own frames',
);
// A duplicate index is ambiguous, not a sequence — it must break the run too.
const dupe = detectSequences(['e_0', 'e_1', 'e_1', 'e_2', 'e_3', 'e_4']);
assert(
	dupe.every((s) => !s.frames.some((f, i) => s.frames.indexOf(f) !== i)),
	'a duplicated index never produces a run containing the same frame twice',
);

console.log('sequences — what is NOT a clip');
assert(detectSequences(['f_0', 'f_1']).length === 0, 'a 2-frame run is below the threshold');
assert(detectSequences(['logo', 'bg', 'frame']).length === 0, 'unnumbered names yield nothing');
assert(detectSequences([]).length === 0, 'an empty sheet yields nothing');
const mixed = detectSequences(['logo', 'bg', 'g_0', 'g_1', 'g_2']);
assert(mixed.length === 1 && mixed[0].stem === 'g', 'unnumbered names are ignored, not crashed on');

console.log('sequences — multiple animations on one sheet');
const two = detectSequences([
	...Array.from({ length: 8 }, (_, i) => `idle_${i}`),
	...Array.from({ length: 20 }, (_, i) => `boom_${i}`),
]);
assert(two.length === 2, 'two stems ⇒ two clips');
assert(two[0].stem === 'boom' && two[0].frames.length === 20, 'the LONGEST run is offered first');
assert(two[1].stem === 'idle', 'the shorter run follows');

console.log('sequences — separator forms');
assert(detectSequences(['h-0', 'h-1', 'h-2'])[0].stem === 'h', 'a hyphen separator is handled');
assert(detectSequences(['i0', 'i1', 'i2'])[0].stem === 'i', 'no separator at all is handled');
assert(
	detectSequences(['sym1_0', 'sym1_1', 'sym1_2'])[0].stem === 'sym1',
	'a digit INSIDE the stem is not mistaken for the index',
);

// ---------------------------------------------------------------------------
// Cross-sheet detection — the form that matches a real multipacked export.
// ---------------------------------------------------------------------------
console.log('sequences — across sheets (the real 4-page export)');
const K = (n: number): string => `c/p/manifests/atlas_manifest_page${n}.json`;
const F = (i: number): string => `anim-sym-pic1_${String(i).padStart(2, '0')}`;

// The ACTUAL frame→page distribution of the owner's export.
const PAGES: Record<number, number[]> = {
	0: [0, 13, 21, 29, 30, 32, 40, 41, 42, 43, 44, 45, 48],
	1: [1, 2, 3, 4, 5, 6, 7, 14, 15, 22, 26, 27, 28, 36, 37, 38, 39],
	2: [8, 9, 10, 12, 16, 17, 18, 24, 25, 31, 33, 34, 35, 46],
	3: [11, 19, 20, 23, 47],
};
const sheets = Object.entries(PAGES).map(([p, idx]) => ({
	assetKey: K(Number(p)),
	regions: idx.map(F),
}));

// Per sheet, page 0 offers only 40..45 — six frames — because nothing else on it is
// consecutive. That is correct and useless, and is why the cross-sheet form exists.
const page0Only = detectSequences(PAGES[0].map(F));
assert(
	page0Only.length === 1 && page0Only[0].frames.length === 6,
	'per-sheet detection on page 0 finds only the 6-frame fragment (40..45)',
);

const across = detectSequencesAcross(sheets);
assert(across.length === 1, 'across all four pages there is exactly ONE animation');
assert(across[0].frames.length === 49, 'it recovers all 49 frames');
assert(across[0].sheets.length === 4, 'and reports that it spans 4 sheets');

// Order must be the ANIMATION's, not any page's.
const regionOf = (entry: string): string => (entry.includes('::') ? entry.split('::')[1] : entry);
assert(
	across[0].frames.map(regionOf).join(',') === Array.from({ length: 49 }, (_, i) => F(i)).join(','),
	'frames come back in animation order 00..48, ignoring page boundaries',
);

// Primary = the sheet with the most frames (page 1, 17 of them) ⇒ fewest scoped refs.
assert(across[0].primary === K(1), 'the primary sheet is the one contributing the most frames');
const bare = across[0].frames.filter((f) => !f.includes('::'));
assert(bare.length === 17, 'frames on the primary sheet stay bare (17 of them)');
assert(across[0].frames.length - bare.length === 32, 'the other 32 are scoped to their own page');
// Every scoped ref must name the page that actually holds it.
const wrong = across[0].frames.filter((f) => {
	if (!f.includes('::')) return false;
	const [key, region] = [f.slice(0, f.indexOf('::')), regionOf(f)];
	const page = Number(region.split('_').pop());
	return key !== K(Number(Object.entries(PAGES).find(([, v]) => v.includes(page))![0]));
});
assert(wrong.length === 0, 'every scoped frame names the page that actually packs it');

console.log('sequences — across sheets, edge cases');
// A run wholly on one sheet stores NO scoped refs — a single-sheet clip is unchanged.
const single = detectSequencesAcross([{ assetKey: K(0), regions: ['x_0', 'x_1', 'x_2'] }]);
assert(
	single[0].frames.join(',') === 'x_0,x_1,x_2' && single[0].sheets.length === 1,
	'a run confined to one sheet produces bare names and one sheet',
);
// The same index on two sheets is ambiguous — it must break the run, not be guessed at.
const dupeAcross = detectSequencesAcross([
	{ assetKey: K(0), regions: ['y_0', 'y_1', 'y_2', 'y_3'] },
	{ assetKey: K(1), regions: ['y_2'] },
]);
assert(
	dupeAcross.every((s) => s.frames.length < 4),
	'a duplicated index across sheets breaks the run rather than picking a page',
);
assert(detectSequencesAcross([]).length === 0, 'no sheets yields nothing');

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK SEQUENCES: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK SEQUENCES: PASSED');
