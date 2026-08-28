/**
 * Offline fixture for the bounds-box art→screen mapping — run with `node` (Node ≥ 22.18 / 24
 * strips the types):
 *   node apps/launcher-api/boundsFit.fixture.ts
 *
 * Runs directly because `src/lib/boundsFit.ts` is dependency-free by design. This app's `build` is
 * a bare `vite build` that strips types without checking them, so a green build proves nothing
 * about geometry — and geometry is exactly what went wrong here.
 *
 * The regression it pins: the overlay's numbers are relative to the THUMBNAIL, and the thumbnail
 * sits centred inside a wider stage. Positioning the overlay against the STAGE put it
 * `(stageWidth − size) / 2` px away from its art — 562px on a 1400px window, which reads as "the
 * box is somewhere else entirely and I can't place it". The last two checks simulate both layouts
 * and assert the fixed one lands on the art while the old one does not, so a future refactor that
 * re-parents the overlay fails here rather than in someone's hands.
 */

import { artAtOffset, boxFit, boxRect } from './src/lib/boundsFit.ts';

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
const near = (a: number, b: number, tol = 0.001): boolean => Math.abs(a - b) <= tol;

console.log('bounds fit — the centred contain-fit');
const square = boxFit(240, { x: -100, y: -100, w: 200, h: 200 })!;
check('a square view fills the thumbnail', square.scale, 1.2);
check('and is centred (no slack on either axis)', [square.originX, square.originY], [120, 120]);

const wide = boxFit(240, { x: 0, y: 0, w: 400, h: 200 })!;
check('a wide view fits by its LONGER side', wide.scale, 0.6);
check(
	'and is letterboxed vertically, not stretched',
	[wide.originX, near(wide.originY, 60)],
	[0, true],
);

console.log('bounds fit — a box maps onto the art it describes');
const fit = boxFit(240, { x: -200, y: -200, w: 400, h: 400 })!;
const r = boxRect(fit, { x: -160, y: -160, w: 320, h: 320 });
check(
	'the box is drawn at its art position, scaled',
	[r.left, r.top, r.width, r.height],
	[24, 24, 192, 192],
);
check(
	'a box centred on the origin is centred on the thumbnail',
	[r.left + r.width / 2, r.top + r.height / 2],
	[120, 120],
);

console.log('bounds fit — drag round-trip (grabbing a corner must read that corner)');
const back = artAtOffset(fit, r.left, r.top);
check('the box’s top-left reads back as its own art coordinates', [back.x, back.y], [-160, -160]);
const mid = artAtOffset(fit, 120, 120);
check('the thumbnail centre reads back as the art origin', [mid.x, mid.y], [0, 0]);

console.log('bounds fit — the overlay must be parented to the THUMBNAIL, not the stage');
// A 1400px-wide stage centring a 250px thumbnail: the reported failure.
const STAGE_W = 1400;
const SIZE = 250;
const thumbLeft = (STAGE_W - SIZE) / 2; // where the thumbnail actually starts
const f = boxFit(SIZE, { x: -200, y: -200, w: 400, h: 400 })!;
const box = { x: -160, y: -160, w: 320, h: 320 };
const drawnLeft = thumbLeft + boxRect(f, box).left; // where the ART draws the box, in stage px
const overlayInThumb = thumbLeft + boxRect(f, box).left; // overlay parented to the thumbnail
const overlayInStage = boxRect(f, box).left; // overlay parented to the stage (the bug)
check('parented to the thumbnail, the overlay lands ON the art', overlayInThumb - drawnLeft, 0);
check(
	'parented to the stage, it lands half the leftover width away',
	overlayInStage - drawnLeft,
	-thumbLeft,
);
check('which on this window is 575px of drift', Math.round(drawnLeft - overlayInStage), 575);

console.log('bounds fit — degenerate inputs never divide by zero');
check('a zero-width view has no fit', boxFit(240, { x: 0, y: 0, w: 0, h: 10 }), null);
check('a zero-size thumbnail has no fit', boxFit(0, { x: 0, y: 0, w: 10, h: 10 }), null);
check('an absent view has no fit', boxFit(240, undefined), null);

console.log('');
if (failures > 0) {
	console.error(`BOUNDS FIT: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('BOUNDS FIT: PASSED');
