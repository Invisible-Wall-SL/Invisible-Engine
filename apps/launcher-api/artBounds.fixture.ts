/**
 * Offline fixture for the ART BOUNDS doc — run with `node` (Node ≥ 22.18 / 24 strips the types):
 *   node apps/launcher-api/artBounds.fixture.ts
 *
 * Runs directly because `src/lib/artBounds.ts` is dependency-free by design. This app's `build` is
 * a bare `vite build` that strips types without checking them, so a green build proves nothing
 * here; these assertions are the gate (the `pickSheets.fixture.ts` precedent).
 *
 * What it pins: a box is stored SCOPED to its sheet (a bare region name would apply one sheet's box
 * to another sheet's same-named frame), and a degenerate box never survives normalization — every
 * consumer divides by `w`/`h` to fit it, so a zero would reach the game as a division by zero.
 */

import { artBoundsRef, normalizeArtBoundsDoc } from './src/lib/artBounds.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

const SHEET = 'borut/book_of_borut/manifests/atlas_manifest_symbols.json';
const OTHER = 'borut/book_of_borut/manifests/atlas_manifest_fx.json';

console.log('art bounds — the key is scoped to the sheet');
check('ref is <assetKey>::<region>', artBoundsRef(SHEET, 'h1'), `${SHEET}::h1`);
check(
	'the same region name on two sheets gets two keys',
	artBoundsRef(SHEET, 'h1') === artBoundsRef(OTHER, 'h1'),
	false,
);

console.log('art bounds — normalization');
const doc = normalizeArtBoundsDoc({
	junk: 1,
	bounds: {
		[`${SHEET}::h1`]: { x: -60, y: -60, w: 120, h: 120, stray: 'no' },
		[`${SHEET}::zero`]: { x: 0, y: 0, w: 0, h: 10 },
		[`${SHEET}::neg`]: { x: 0, y: 0, w: -5, h: 10 },
		[`${SHEET}::nan`]: { x: 0, y: 0, w: Number.NaN, h: 10 },
		[`${SHEET}::text`]: { x: '0', y: 0, w: 10, h: 10 },
		[`${SHEET}::partial`]: { x: 0, y: 0, w: 10 },
		[`${SHEET}::notobj`]: 7,
		'': { x: 0, y: 0, w: 10, h: 10 },
	},
});
check('version is stamped', doc.version, 1);
check('a valid box survives, field by field', doc.bounds[`${SHEET}::h1`], {
	x: -60,
	y: -60,
	w: 120,
	h: 120,
});
check('every degenerate / malformed box is dropped', Object.keys(doc.bounds), [`${SHEET}::h1`]);
check('editor-only junk is stripped', 'junk' in doc, false);
check('garbage input yields an empty map', normalizeArtBoundsDoc(undefined).bounds, {});
check(
	'normalization is idempotent (the save→reload fixed point)',
	JSON.stringify(normalizeArtBoundsDoc(doc)),
	JSON.stringify(doc),
);

console.log('');
if (failures > 0) {
	console.error(`ART BOUNDS: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('ART BOUNDS: PASSED');
