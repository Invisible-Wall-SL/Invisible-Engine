/**
 * Guard that the Symbols State-Machine stage tells the FX overlay the truth about where a bone is.
 *
 * Run: `pnpm --filter launcher-api run check:symbol-stage-geometry`
 *
 * THE BUG THIS EXISTS FOR. That stage draws rigs into a raw-WebGL canvas and their bound FX into a
 * SEPARATE Pixi canvas over it, so the two agree only while both use the same width. For months they
 * did not: the backing store and the mirror axis were taken from the SCROLL CONTAINER's
 * `clientWidth` — short by a scrollbar (measured live: 885 where the canvas was displayed across
 * 900) — so the browser stretched everything drawn by ~1.7%, growing with x. The rigs drifted right;
 * the correctly-sized FX overlay did not; a bound burst pulled away from its symbol the further
 * right it sat. Reported as "I can see the FX in the state machine but it's offset".
 *
 * WHAT IS ASSERTED. `boneScreenX` is where we TELL the overlay the bone is. `drawnScreenX` models
 * where the browser actually paints it: the camera maps world→backing px across its own visible
 * width, then the browser scales the backing store onto the CSS box. Those two must agree to within
 * a pixel for every cell, at every scrollbar width and device pixel ratio. `drawnScreenX` models the
 * BROWSER, not our code — and its premise (a canvas whose backing store is narrower than its CSS box
 * is stretched to fit) was measured live before this was written, not assumed.
 *
 * The relationship used to live inline in a `requestAnimationFrame` callback inside a Svelte
 * component, where nothing could assert it. That is why it survived so long, and why the geometry is
 * now a module.
 */
import {
	boneScreenX,
	cellSkeletonX,
	drawnScreenX,
	stageGeometry,
} from '../src/routes/(app)/symbols/symbolStageGeometry';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};

/** Real-world combinations: classic Windows/Linux scrollbars, macOS overlay (0), and the fractional
 * device pixel ratios that Windows display scaling actually produces. */
const SCROLLBARS = [0, 15, 17];
const DPRS = [1, 1.25, 1.5, 1.75, 2, 3];
/** The `.grid-area` width the canvas is displayed across. */
const AREA_WIDTH = 900;

/** Sweep every cell position across the grid, plus the extremes where the error was largest. */
const CELL_XS = [0, 1, 120, 443, 700, 884, 899];

for (const scrollbar of SCROLLBARS) {
	for (const dpr of DPRS) {
		// The canvas's own box — what `stageGeometry` is now given. The scroll container's
		// clientWidth (AREA_WIDTH - scrollbar) is deliberately NOT what we build geometry from.
		const geo = stageGeometry({ clientWidth: AREA_WIDTH, clientHeight: 400 }, dpr);

		check(
			`backing store matches the displayed box (sb=${scrollbar} dpr=${dpr})`,
			geo.backingWidth === Math.floor(AREA_WIDTH * dpr),
		);

		let worst = 0;
		for (const cellX of CELL_XS) {
			// A cell 120px wide whose rig's fit-scaled art centre sits at its middle: the skeleton
			// origin then lands on the cell centre, which is the case every symbol cell hits.
			const cellW = 120;
			const skelX = cellSkeletonX(geo, cellX, cellW, 1, 0);
			// `skel.x` IS the bone's world x for the root bone at the rig origin (scaleX applies to
			// local coords, and local x is 0 there) — the exact value `fxBoneTransform` reads.
			const told = boneScreenX(geo, skelX);
			const painted = drawnScreenX(geo, skelX);
			worst = Math.max(worst, Math.abs(told - painted));
		}
		check(
			`FX lands where the rig is drawn, within 1px (sb=${scrollbar} dpr=${dpr}, worst ${worst.toFixed(3)}px)`,
			worst < 1,
		);
	}
}

// The specific regression, stated as itself: building geometry from a scrollbar-shortened width
// puts the FX visibly off at the right-hand end of the grid. This is what the fix prevents, so it
// must be demonstrably BROKEN — if this ever passes, the model has stopped modelling the bug.
{
	const scrollbar = 15;
	const wrong = stageGeometry({ clientWidth: AREA_WIDTH - scrollbar, clientHeight: 400 }, 1);
	// …but painted across the real box, which is what the browser does.
	const painted = (worldX: number): number => {
		const visible = wrong.backingWidth / wrong.dpr;
		return ((visible - worldX) * wrong.dpr * AREA_WIDTH) / wrong.backingWidth;
	};
	const skelX = cellSkeletonX(wrong, 800, 120, 1, 0);
	const drift = Math.abs(boneScreenX(wrong, skelX) - painted(skelX));
	check(
		`the old sizing really does drift (got ${drift.toFixed(1)}px at the right of the grid)`,
		drift > 10,
	);
}

if (fails > 0) {
	console.error(`\n${fails} check(s) failed.`);
	process.exit(1);
}
console.log('symbol stage geometry: all checks passed');
