/**
 * Offline fixture for the styled payline (`src/lib/winLineStyle.ts`):
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *     packages/engine-layout/winLineStyle.fixture.ts
 *
 * Pins:
 *   - `pathSlice(pts, 0, p)` is the polyline `WinLine.svelte` traced before it was shared: the same
 *     vertices, the same interpolated head, over random lines and progress values;
 *   - the head (`pathHeadPose`) is the last point of that slice, and its tangent is the segment it
 *     sits on — the first segment's at 0, the last one's at the end, never a zero-length one's;
 *   - the tapered runs cover the drawn line end to end with no gap and no overlap, ramp alpha and
 *     width up to 1 at the tip, and never cut within `clearance` of a corner;
 *   - the prune: an unset style stays unset, defaults drop, a tip without its kind's asset is no
 *     tip, a tip keeps only its kind's asset field, numbers clamp, the trail dedupes and caps, the
 *     result is a fixed point, and the other `line` fields pass through untouched;
 *   - `winLineEffectIds` names the effect tip, the burst (only when bursting) and the trail.
 */

import {
	normalizeWinLineTip,
	pathHeadPose,
	pathLength,
	pathSlice,
	pruneWinLineStyle,
	taperPieces,
	taperRuns,
	WIN_LINE_TRAIL_FX_MAX,
	winLineEffectIds,
	type WinLinePoint,
} from './src/lib/winLineStyle.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.error(`  FAIL  ${label}\n        got      ${a}\n        expected ${e}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const ok = (label: string, value: boolean) => check(label, value, true);

/** `WinLine.svelte`'s `tracePath` before the maths moved here, recording its moveTo/lineTo. */
function legacyTrace(pts: WinLinePoint[], p: number): WinLinePoint[] {
	const out: WinLinePoint[] = [{ ...pts[0] }];
	if (p >= 1) {
		for (let i = 1; i < pts.length; i += 1) out.push({ ...pts[i] });
		return out;
	}
	const target = pathLength(pts) * p;
	let acc = 0;
	for (let i = 1; i < pts.length; i += 1) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		if (acc + d <= target) {
			out.push({ ...pts[i] });
			acc += d;
		} else {
			const t = d > 0 ? (target - acc) / d : 0;
			out.push({
				x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
				y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
			});
			return out;
		}
	}
	return out;
}

let seed = 7;
const random = () => {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed / 2147483648;
};
const randomLine = (): WinLinePoint[] => {
	const count = 2 + Math.floor(random() * 5);
	return Array.from({ length: count }, (_, i) => ({
		x: i * 200,
		y: Math.floor(random() * 3) * 200,
	}));
};

// 1. THE SLICE IS THE OLD TRACE
{
	let same = 0;
	const runs = 2000;
	for (let n = 0; n < runs; n += 1) {
		const pts = randomLine();
		const p = n % 10 === 0 ? 1 : n % 13 === 0 ? 0 : random();
		if (JSON.stringify(pathSlice(pts, 0, p)) === JSON.stringify(legacyTrace(pts, p))) same += 1;
	}
	check('pathSlice(pts, 0, p) draws exactly what tracePath drew', same, runs);
}

// 2. THE HEAD
{
	const zig = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 100 },
		{ x: 200, y: 100 },
	];
	check('head at 0 is the start, facing the first segment', pathHeadPose(zig, 0), {
		x: 0,
		y: 0,
		angle: 0,
	});
	check('head half way is the corner-to-corner midpoint, facing down', pathHeadPose(zig, 0.5), {
		x: 100,
		y: 50,
		angle: Math.PI / 2,
	});
	check('head at the end is the last point, facing the last segment', pathHeadPose(zig, 1), {
		x: 200,
		y: 100,
		angle: 0,
	});
	check('head on a vertex faces the segment that reached it', pathHeadPose(zig, 1 / 3)?.angle, 0);
	check(
		'a zero-length last segment never decides the tangent',
		pathHeadPose([...zig, { x: 200, y: 100 }], 1)?.angle,
		0,
	);
	check(
		'a zero-length first segment never decides the start tangent',
		pathHeadPose([{ x: 0, y: 0 }, ...zig], 0)?.angle,
		0,
	);
	check('fewer than two points has no head', pathHeadPose([{ x: 1, y: 1 }], 0.5), undefined);
	let agree = 0;
	const runs = 1000;
	for (let n = 0; n < runs; n += 1) {
		const pts = randomLine();
		const p = random();
		const slice = pathSlice(pts, 0, p);
		const pose = pathHeadPose(pts, p);
		const end = slice[slice.length - 1];
		if (pose && pose.x === end.x && pose.y === end.y) agree += 1;
	}
	check('the head is always the end of the drawn stroke', agree, runs);
}

// 3. TAPER
{
	const pieces = taperPieces(0.2, 0.5, 8);
	check('eight pieces', pieces.length, 8);
	ok(
		'the first piece starts at the tail values',
		near(pieces[0].alpha, 0.2) && near(pieces[0].width, 0.5),
	);
	ok('the last piece is full', near(pieces[7].alpha, 1) && near(pieces[7].width, 1));
	ok(
		'alpha and width never fall toward the tip',
		pieces.every(
			(piece, i) =>
				i === 0 || (piece.alpha >= pieces[i - 1].alpha && piece.width >= pieces[i - 1].width),
		),
	);

	let covered = 0;
	let clear = 0;
	let rising = 0;
	const runs = 1000;
	const clearance = 12;
	for (let n = 0; n < runs; n += 1) {
		const pts = randomLine();
		const p = n % 4 === 0 ? 1 : 0.05 + random() * 0.95;
		const out = taperRuns(pts, p, 0.1, 0.4, clearance);
		const lengths = out.map((run) => pathLength(run.points));
		const drawn = pathLength(pathSlice(pts, 0, p));
		if (
			near(
				lengths.reduce((a, b) => a + b, 0),
				drawn,
				1e-4,
			)
		)
			covered += 1;
		// Every run boundary is a cut; none within the clearance of an interior vertex.
		const corners: number[] = [];
		let acc = 0;
		for (let i = 1; i < pts.length - 1; i += 1) {
			acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
			const before = pts[i - 1];
			const after = pts[i + 1];
			const turns =
				(pts[i].x - before.x) * (after.y - pts[i].y) -
					(pts[i].y - before.y) * (after.x - pts[i].x) !==
				0;
			if (turns) corners.push(acc);
		}
		let at = 0;
		let safe = true;
		for (let k = 0; k < out.length - 1; k += 1) {
			at += lengths[k];
			if (corners.some((corner) => Math.abs(at - corner) < clearance - 1e-6)) safe = false;
		}
		if (safe) clear += 1;
		if (out.every((run, i) => i === 0 || run.alpha >= out[i - 1].alpha)) rising += 1;
	}
	check('the runs cover the drawn line end to end, no gap, no overlap', covered, runs);
	check('no run is cut at a corner', clear, runs);
	check('the runs brighten toward the tip', rising, runs);
	check('an undrawn line has no runs', taperRuns(randomLine(), 0, 0.1, 0.4, clearance), []);
}

// 4. PRUNE
{
	const base = { color: '#ff0000', width: 0.05, glow: true };
	check('an unset style stays unset (other fields untouched)', pruneWinLineStyle(base), base);
	check(
		'defaults drop',
		pruneWinLineStyle({
			...base,
			coreColor: '  ',
			blend: 'normal',
			taper: { alpha: 1, width: 1 },
			tip: { kind: 'sprite' },
			trailFx: [],
		}),
		base,
	);
	const authored = {
		...base,
		trailFx: [' fx-embers ', 'fx-notes', 'fx-embers', '', 'a', 'b', 'c'],
		tip: {
			kind: 'effect',
			assetKey: 'stray',
			clipId: 'stray',
			effectId: 'fx-flare',
			scale: 99,
			rotateWithLine: false,
			blend: 'add',
			atEnd: 'burst',
			endEffectId: 'fx-pop',
		},
		taper: { alpha: -1, width: 0.5 },
		blend: 'add',
		coreColor: '#ffffff',
		drawSound: ' sfx_whoosh ',
		endSound: '',
	};
	const pruned = pruneWinLineStyle(authored);
	check('an authored style is canonical', pruned, {
		...base,
		coreColor: '#ffffff',
		blend: 'add',
		taper: { alpha: 0, width: 0.5 },
		tip: {
			kind: 'effect',
			effectId: 'fx-flare',
			scale: 8,
			blend: 'add',
			atEnd: 'burst',
			endEffectId: 'fx-pop',
		},
		trailFx: ['fx-embers', 'fx-notes', 'a', 'b'],
		drawSound: 'sfx_whoosh',
	});
	check('…capped at the trail maximum', pruned.trailFx.length, WIN_LINE_TRAIL_FX_MAX);
	check('…and a fixed point', pruneWinLineStyle(pruned), pruned);
	check(
		'a burst effect drops when the tip does not burst',
		normalizeWinLineTip({
			kind: 'sprite',
			assetKey: 'c/p::frame',
			atEnd: 'fade',
			endEffectId: 'x',
		}),
		{ kind: 'sprite', assetKey: 'c/p::frame', atEnd: 'fade' },
	);
	check(
		'a flipbook tip keeps its clip only',
		normalizeWinLineTip({ kind: 'flipbook', clipId: 'flare', assetKey: 'sheet', scale: 1 }),
		{ kind: 'flipbook', clipId: 'flare' },
	);
	check(
		'an unknown tip kind is no tip',
		normalizeWinLineTip({ kind: 'rig', assetKey: 'x' }),
		undefined,
	);
}

// 5. EFFECT IDS
{
	check(
		'the effect tip, its burst and the trail',
		winLineEffectIds({
			line: {
				tip: { kind: 'effect', effectId: 'fx-flare', atEnd: 'burst', endEffectId: 'fx-pop' },
				trailFx: ['fx-embers', 'fx-flare'],
			},
		}),
		['fx-flare', 'fx-pop', 'fx-embers'],
	);
	check(
		'a sprite tip that stays names no effect',
		winLineEffectIds({ line: { tip: { kind: 'sprite', effectId: 'stray', endEffectId: 'x' } } }),
		[],
	);
	check('no win line, no effects', winLineEffectIds(undefined), []);
}

// A throw exits non-zero without Node's types, which this package does not carry.
if (failures) throw new Error(`winLineStyle.fixture: ${failures} of ${checks} FAILED`);
console.log(`winLineStyle.fixture: all ${checks} ok`);
