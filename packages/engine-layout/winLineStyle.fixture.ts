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
 *   - `winLineEffectIds` names the effect tip, the burst (only when bursting) and the trail;
 *   - `paintWinLine` makes exactly the calls `WinLine.svelte`'s own `paint` made before the strokes
 *     moved here (the legacy painter below is that code, verbatim but for its types), over random
 *     lines, shapes, styles, progress and passes; and `winLineDrawMs` is its old duration formula.
 */

import {
	normalizeWinLineColor,
	normalizeWinLineTip,
	paintWinLine,
	pathHeadPose,
	pathLength,
	pathSlice,
	pruneWinLineStyle,
	taperPieces,
	taperRuns,
	WIN_LINE_TRAIL_FX_MAX,
	WIN_LINE_CORE_RATIO,
	winLineDrawMs,
	winLineEffectIds,
	winLineGlowAdditive,
	type WinLineGraphics,
	type WinLineHeadPose,
	type WinLinePaintPart,
	type WinLinePaintStyle,
	type WinLinePoint,
	type WinLineShape,
	type WinLineTaperRun,
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

	// A staircase whose corners sit closer together than the clearance: a cut pushed past one
	// corner lands on the next, and must be pushed again until it is clear of every one.
	const stairs: WinLinePoint[] = [{ x: 0, y: 0 }];
	for (let i = 1; i <= 40; i += 1) {
		const last = stairs[stairs.length - 1];
		stairs.push(i % 2 ? { x: last.x + 8, y: last.y } : { x: last.x, y: last.y + 8 });
	}
	stairs.push({ x: stairs[stairs.length - 1].x + 400, y: stairs[stairs.length - 1].y });
	const stairCorners: number[] = [];
	for (let i = 1, acc = 0; i < stairs.length - 1; i += 1) {
		acc += Math.hypot(stairs[i].x - stairs[i - 1].x, stairs[i].y - stairs[i - 1].y);
		stairCorners.push(acc);
	}
	let stairsClear = 0;
	const stairRuns = 200;
	for (let n = 0; n < stairRuns; n += 1) {
		const out = taperRuns(stairs, 0.2 + (0.8 * n) / stairRuns, 0.1, 0.4, clearance);
		let at = 0;
		let safe = true;
		for (let k = 0; k < out.length - 1; k += 1) {
			at += pathLength(out[k].points);
			if (stairCorners.some((corner) => Math.abs(at - corner) < clearance - 1e-6)) safe = false;
		}
		if (safe) stairsClear += 1;
	}
	check('a cut pushed past one corner is pushed past the next too', stairsClear, stairRuns);
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
		'a hex colour is kept in each Pixi form, anything else dropped',
		['#fff', '#ffcc00', '#FFCC0080', ' #abc ', 'red', '#ffcc0', 'rgb(0,0,0)', '#gggggg', 3].map(
			normalizeWinLineColor,
		),
		['#fff', '#ffcc00', '#FFCC0080', '#abc', undefined, undefined, undefined, undefined, undefined],
	);
	check('a bad core colour never survives the prune', pruneWinLineStyle({ coreColor: 'x' }), {});
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

// 6. THE STROKES ARE THE GAME'S OLD STROKES
{
	type Op = [string, ...unknown[]];
	const recorder = (): { g: WinLineGraphics; ops: Op[] } => {
		const ops: Op[] = [];
		return {
			ops,
			g: {
				moveTo: (x, y) => ops.push(['moveTo', x, y]),
				lineTo: (x, y) => ops.push(['lineTo', x, y]),
				arc: (x, y, r, a, b) => ops.push(['arc', x, y, r, a, b]),
				closePath: () => ops.push(['closePath']),
				stroke: (style) => ops.push(['stroke', style]),
				fill: (style) => ops.push(['fill', style]),
			},
		};
	};
	const SYMBOL_SIZE = 120;

	/** `WinLine.svelte`'s `paint` (and its helpers) before #1946's strokes moved to `engine-layout`. */
	function legacyPaint(
		graphics: WinLineGraphics,
		line: WinLinePaintStyle,
		entry: {
			points: WinLinePoint[];
			fullPoints: WinLinePoint[];
			progress: number;
			shape: WinLineShape;
			color?: string;
		},
		cellHalf: number,
		part: WinLinePaintPart,
	): void {
		const tapered = line.taper.alpha < 1 || line.taper.width < 1;
		const poseOf = (pts: WinLinePoint[], p: number): WinLineHeadPose =>
			pathHeadPose(pts, p) ?? { ...pts[0], angle: 0 };
		const tracePoints = (g: WinLineGraphics, pts: WinLinePoint[]) => {
			g.moveTo(pts[0].x, pts[0].y);
			for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i].x, pts[i].y);
		};
		const tracePath = (g: WinLineGraphics, pts: WinLinePoint[], p: number) =>
			tracePoints(g, pathSlice(pts, 0, p));
		const capArc = (
			g: WinLineGraphics,
			pose: WinLineHeadPose,
			radius: number,
			facing: 'tail' | 'head',
		) => {
			const start = pose.angle + (facing === 'head' ? -Math.PI / 2 : Math.PI / 2);
			g.moveTo(pose.x + Math.cos(start) * radius, pose.y + Math.sin(start) * radius);
			g.arc(pose.x, pose.y, radius, start, start + Math.PI);
			g.closePath();
		};
		const strokeRuns = (
			g: WinLineGraphics,
			runs: WinLineTaperRun[],
			ends: { tail: WinLineHeadPose; head: WinLineHeadPose },
			style: { color: string; width: number; alpha: number },
		) => {
			if (!runs.length) return;
			for (const run of runs) {
				tracePoints(g, run.points);
				g.stroke({
					color: style.color,
					width: style.width * run.width,
					alpha: style.alpha * run.alpha,
					cap: 'butt',
					join: 'round',
				});
			}
			const first = runs[0];
			const last = runs[runs.length - 1];
			capArc(g, ends.tail, (style.width * first.width) / 2, 'tail');
			g.fill({ color: style.color, alpha: style.alpha * first.alpha });
			capArc(g, ends.head, (style.width * last.width) / 2, 'head');
			g.fill({ color: style.color, alpha: style.alpha * last.alpha });
		};
		const traceColumns = (g: WinLineGraphics, pts: WinLinePoint[], half: number) => {
			for (const pt of pts) {
				g.moveTo(pt.x, pt.y - half);
				g.lineTo(pt.x, pt.y + half);
			}
		};
		const traceReels = (g: WinLineGraphics, pts: WinLinePoint[], half: number) => {
			const spans: { x: number; top: number; bottom: number }[] = [];
			for (const pt of pts) {
				const span = spans.find((candidate) => candidate.x === pt.x);
				if (!span) spans.push({ x: pt.x, top: pt.y, bottom: pt.y });
				else {
					span.top = Math.min(span.top, pt.y);
					span.bottom = Math.max(span.bottom, pt.y);
				}
			}
			for (const span of spans) {
				g.moveTo(span.x, span.top - half);
				g.lineTo(span.x, span.bottom + half);
			}
		};
		const pts = entry.points;
		const full = entry.fullPoints;
		const p = entry.progress;
		const drawn = entry.shape;
		const half = cellHalf;
		const coreWidth = SYMBOL_SIZE * line.width;
		const configColor = line.useConfigColor ? entry.color : undefined;
		const coreColor = configColor ?? line.color;
		const haloColor = configColor ?? line.glowColor;
		const trace = (g: WinLineGraphics) => {
			if (drawn === 'reels') return traceReels(g, pts, half);
			if (drawn === 'cells') return traceColumns(g, pts, half);
			return tracePath(g, pts, p);
		};
		const taper =
			tapered && drawn === 'path' && pts.length >= 2
				? {
						runs: taperRuns(
							pts,
							p,
							line.taper.alpha,
							line.taper.width,
							((line.glow ? 4.5 : 1) * coreWidth) / 2,
						),
						ends: { tail: poseOf(pts, 0), head: poseOf(pts, p) },
					}
				: undefined;
		const strokeLine = (g: WinLineGraphics, color: string, width: number, alpha: number) => {
			if (taper) return strokeRuns(g, taper.runs, taper.ends, { color, width, alpha });
			trace(g);
			g.stroke({ color, width, alpha, cap: 'round', join: 'round' });
		};
		if (part !== 'glow' && drawn === 'path' && line.fullPayline && full.length >= 2) {
			tracePath(graphics, full, 1);
			graphics.stroke({
				color: line.fullPaylineColor,
				width: coreWidth,
				alpha: 0.85,
				cap: 'round',
				join: 'round',
			});
		}
		if (pts.length < 2) return;
		if (line.glow && part !== 'line') {
			const halos = [
				{ w: coreWidth * 4.5, a: 0.08 },
				{ w: coreWidth * 3, a: 0.13 },
				{ w: coreWidth * 1.8, a: 0.2 },
			];
			for (const halo of halos) strokeLine(graphics, haloColor, halo.w, halo.a);
		}
		if (part === 'glow') return;
		strokeLine(graphics, coreColor, coreWidth, 0.95);
		if (line.coreColor) {
			strokeLine(graphics, line.coreColor, coreWidth * WIN_LINE_CORE_RATIO, 1);
		}
	}

	const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
	const randomStyle = (): WinLinePaintStyle => ({
		color: '#ffcc00',
		width: pick([0.005, 0.03, 0.12]),
		glow: random() < 0.5,
		glowColor: '#ff3300',
		fullPayline: random() < 0.3,
		fullPaylineColor: '#4a90d9',
		useConfigColor: random() < 0.5,
		coreColor: random() < 0.5 ? '#ffffff' : undefined,
		blend: random() < 0.5 ? 'add' : 'normal',
		taper:
			random() < 0.5
				? { alpha: 1, width: 1 }
				: { alpha: pick([0, 0.2, 1]), width: pick([0, 0.5, 1]) },
	});
	let same = 0;
	let tapered = 0;
	const runs = 2000;
	for (let n = 0; n < runs; n += 1) {
		const style = randomStyle();
		const points = n % 17 === 0 ? randomLine().slice(0, 1) : randomLine();
		const entry = {
			points,
			fullPoints: random() < 0.5 ? randomLine() : [],
			progress: n % 10 === 0 ? 1 : n % 13 === 0 ? 0 : random(),
			shape: pick(['path', 'path', 'cells', 'reels'] as const),
			color: random() < 0.5 ? '#00ff88' : undefined,
		};
		const part: WinLinePaintPart = winLineGlowAdditive(style) ? pick(['glow', 'line']) : 'both';
		const before = recorder();
		const after = recorder();
		legacyPaint(before.g, style, entry, 60, part);
		paintWinLine(after.g, style, { ...entry, cellHalf: 60, symbolSize: SYMBOL_SIZE }, part);
		if (JSON.stringify(before.ops) === JSON.stringify(after.ops)) same += 1;
		if (style.taper.alpha < 1 || style.taper.width < 1) tapered += 1;
	}
	check('paintWinLine makes the very calls the game’s paint made', same, runs);
	ok('…over tapered styles too', tapered > runs / 4);
	for (const [len, speed] of [
		[0, 1],
		[480, 1],
		[2400, 0.25],
		[9600, 4],
		[100000, 1],
	] as const) {
		check(
			`winLineDrawMs(${len}, ${speed}) is the old duration`,
			winLineDrawMs(len, speed, SYMBOL_SIZE),
			Math.min(2000, Math.max(180, ((len / (SYMBOL_SIZE * 4)) * 220) / speed)),
		);
	}
}

// A throw exits non-zero without Node's types, which this package does not carry.
if (failures) throw new Error(`winLineStyle.fixture: ${failures} of ${checks} FAILED`);
console.log(`winLineStyle.fixture: all ${checks} ok`);
