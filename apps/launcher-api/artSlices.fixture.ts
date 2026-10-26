/**
 * Offline fixture for 9-SLICE art data (P10.9) — run with `node` (types stripped):
 *   node apps/launcher-api/artSlices.fixture.ts
 *
 * Pins: the insets doc keeps only whole, non-negative, not-all-zero insets, scoped to the sheet;
 * `sliceBorders` is the frame's `borders` rescaled with the rect (the KTX2 twin); and the shared
 * layout (`nineSlicePieces`) keeps corners at art size, shrinks them all by PIXI's one factor when
 * the box is too small, and never tiles a corner. The pixel parity of the editor against the game
 * is `pnpm --filter fx-spike nine-slice-parity`.
 */

import { artSliceRef, normalizeArtSlicesDoc, sliceBorders } from './src/lib/artSlices.ts';
import {
	clampSliceInsets,
	nineSlicePieces,
	packedSubRect,
	sliceCornerScale,
} from '../../packages/engine-layout/src/lib/nineSlice.ts';

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

const SHEET = 'demo/match/manifests/atlas_manifest_hud.json';

console.log('art slices — the doc');
check('ref is <assetKey>::<region>', artSliceRef(SHEET, 'panel'), `${SHEET}::panel`);
const doc = normalizeArtSlicesDoc({
	junk: 1,
	slices: {
		[`${SHEET}::panel`]: { left: 12.4, top: 10, right: 12, bottom: 9.6, mode: 'tile' },
		[`${SHEET}::zero`]: { left: 0, top: 0, right: 0, bottom: 0 },
		[`${SHEET}::neg`]: { left: -1, top: 4, right: 4, bottom: 4 },
		[`${SHEET}::nan`]: { left: Number.NaN, top: 4, right: 4, bottom: 4 },
		[`${SHEET}::text`]: { left: '4', top: 4, right: 4, bottom: 4 },
		[`${SHEET}::partial`]: { left: 4, top: 4, right: 4 },
		[`${SHEET}::edge`]: { left: 0, top: 6, right: 0, bottom: 0 },
		'': { left: 4, top: 4, right: 4, bottom: 4 },
	},
});
check('version is stamped', doc.version, 1);
check('insets are rounded and copied field by field', doc.slices[`${SHEET}::panel`], {
	left: 12,
	top: 10,
	right: 12,
	bottom: 10,
});
check('a single-edge slice is kept', doc.slices[`${SHEET}::edge`], {
	left: 0,
	top: 6,
	right: 0,
	bottom: 0,
});
check('every malformed or empty slice is dropped', Object.keys(doc.slices).sort(), [
	`${SHEET}::edge`,
	`${SHEET}::panel`,
]);
check('normalization is idempotent', normalizeArtSlicesDoc(doc), doc);

console.log('art slices — shipped borders');
const slice = { left: 12, top: 10, right: 12, bottom: 10 };
check('full-res borders are the insets', sliceBorders(slice), slice);
check('a halved KTX2 page halves them with the rect', sliceBorders(slice, 0.5, 0.5), {
	left: 6,
	top: 5,
	right: 6,
	bottom: 5,
});

console.log('nine-slice layout');
const ins = { left: 10, top: 8, right: 6, bottom: 4 };
check('insets never cross', clampSliceInsets({ left: 30, top: 2, right: 30, bottom: -3 }, 40, 20), {
	left: 30,
	top: 2,
	right: 10,
	bottom: 0,
});
check('corners keep art size in a large box', sliceCornerScale(ins, 200, 100), 1);
check(
	'a box smaller than two corners shrinks them by one factor',
	sliceCornerScale(ins, 8, 12),
	0.5,
);
const stretched = nineSlicePieces(40, 30, ins, 100, 50, 'stretch');
check('nine pieces', stretched.length, 9);
check(
	'the corners sit at the box corners at art size',
	[stretched[0], stretched[2], stretched[6], stretched[8]].map((p) => [p.dx, p.dy, p.dw, p.dh]),
	[
		[0, 0, 10, 8],
		[94, 0, 6, 8],
		[0, 46, 10, 4],
		[94, 46, 6, 4],
	],
);
check(
	'the centre fills what is left',
	[stretched[4].dx, stretched[4].dy, stretched[4].dw, stretched[4].dh],
	[10, 8, 84, 38],
);
check(
	'stretch tiles nothing',
	stretched.some((p) => p.tile),
	false,
);
const tiled = nineSlicePieces(40, 30, ins, 100, 50, 'tile');
check(
	'tile repeats the edges and centre, never a corner',
	tiled.map((p) => p.tile),
	[false, true, false, true, true, true, false, true, false],
);
check(
	'zero insets leave the centre alone, the art stretched whole',
	nineSlicePieces(40, 30, { left: 0, top: 0, right: 0, bottom: 0 }, 80, 60, 'stretch').map((p) => [
		p.sw,
		p.sh,
		p.dw,
		p.dh,
	]),
	[[40, 30, 80, 60]],
);
check('a zero box draws nothing', nineSlicePieces(40, 30, ins, 0, 20, 'stretch'), []);

console.log('packed sub-rects');
check('unrotated is itself', packedSubRect({ x: 2, y: 3, w: 4, h: 5 }, 30, false), {
	x: 2,
	y: 3,
	w: 4,
	h: 5,
});
check(
	'rotated 90° clockwise: the top-left corner is at the packed right',
	packedSubRect({ x: 0, y: 0, w: 10, h: 8 }, 30, true),
	{ x: 22, y: 0, w: 8, h: 10 },
);

if (failures) {
	console.error(`\n✗ art slices: ${failures} failed`);
	process.exit(1);
}
console.log('\n✓ art slices: all checks pass');
