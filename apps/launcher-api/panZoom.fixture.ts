/**
 * Offline fixture for the preview viewport's pan/zoom — run with `node` (Node ≥ 22.18 / 24 strips
 * the types):
 *   node apps/launcher-api/panZoom.fixture.ts
 *
 * Runs directly because `src/lib/panZoom.ts` is dependency-free by design.
 *
 * What it pins, in order of what each one cost:
 *
 *  1. **Zoom is anchored.** Whatever sits under the cursor stays under it — the difference between
 *     a canvas tool and a box that leaps away every time you scroll.
 *  2. **Zoom is bounded, and a pinned zoom is a NO-OP.** Without the second half, a wheel held at
 *     the cap keeps recomputing a ratio of 1 and slowly walks the pane off screen.
 *  3. **The pane's size is bounded.** A thumbnail is a real bitmap; an uncapped zoom is one
 *     allocation away from taking the tab down.
 *  4. **Nothing here reads back what it writes.** The functions are pure and take the viewport size
 *     as an argument — the runaway that made this tool unusable came from an observer feeding a
 *     measured height back into the styled height, so the shape of this API is the fix.
 */

import {
	centrePane,
	clampZoom,
	paneSize,
	toPane,
	zoomAbout,
	SIZE_MAX,
	ZOOM_MAX,
	ZOOM_MIN,
} from './src/lib/panZoom.ts';

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
const near = (a: number, b: number, tol = 0.51): boolean => Math.abs(a - b) <= tol;

const FIT = 300; // the pane size that fits the viewport at 100%

console.log('pan/zoom — the point under the cursor stays under the cursor');
{
	// A pane at (50, 20), zoomed 1 → 2 about the viewport point (400, 300).
	const before = { zoom: 1, x: 50, y: 20 };
	const cursor = { x: 400, y: 300 };
	// Where that cursor sits within the pane, as a fraction of its size.
	const u = (cursor.x - before.x) / paneSize(FIT, before.zoom);
	const v = (cursor.y - before.y) / paneSize(FIT, before.zoom);
	const after = zoomAbout(before, FIT, 2, cursor.x, cursor.y);
	const u2 = (cursor.x - after.x) / paneSize(FIT, after.zoom);
	const v2 = (cursor.y - after.y) / paneSize(FIT, after.zoom);
	check(
		'the same fraction of the pane is under the cursor after zooming in',
		[near(u, u2, 0.002), near(v, v2, 0.002)],
		[true, true],
	);

	const back = zoomAbout(after, FIT, 1, cursor.x, cursor.y);
	check(
		'zooming back out about the same point restores the pane',
		[near(back.x, before.x), near(back.y, before.y)],
		[true, true],
	);
}

console.log('pan/zoom — bounds');
check('zoom clamps low', clampZoom(0.0001), ZOOM_MIN);
check('zoom clamps high', clampZoom(9999), ZOOM_MAX);
{
	const atCap = zoomAbout({ zoom: ZOOM_MAX, x: 10, y: 10 }, FIT, ZOOM_MAX * 4, 100, 100);
	check('a zoom already at the cap does NOT move the pane', [atCap.x, atCap.y], [10, 10]);
	check('and reports the capped zoom', atCap.zoom, ZOOM_MAX);
}
check('the pane size is capped', paneSize(100000, ZOOM_MAX), SIZE_MAX);
check('and floored', paneSize(1, ZOOM_MIN), 48);

console.log('pan/zoom — a wheel held at the cap cannot walk the pane away');
{
	let v = { zoom: ZOOM_MAX, x: 0, y: 0 };
	for (let i = 0; i < 200; i++) v = zoomAbout(v, FIT, v.zoom * 1.12, 640, 360);
	check(
		'200 wheel ticks at the cap leave the pane exactly where it was',
		[v.x, v.y, v.zoom],
		[0, 0, ZOOM_MAX],
	);
}

console.log('pan/zoom — centring');
check('a pane smaller than the viewport is centred', centrePane(1000, 400, 300), { x: 350, y: 50 });
check('a pane larger than the viewport overhangs evenly', centrePane(200, 200, 400), {
	x: -100,
	y: -100,
});

console.log('pan/zoom — the pane is translated, never scaled');
{
	// This is the property that lets the bounds overlay keep working unchanged at any zoom:
	// a viewport point maps into pane pixels by subtraction alone.
	const v = { zoom: 3, x: -120, y: -80 };
	check('a viewport point maps into the pane by translation', toPane(v, 200, 100), {
		x: 320,
		y: 180,
	});
}

console.log('');
if (failures > 0) {
	console.error(`PAN/ZOOM: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('PAN/ZOOM: PASSED');
