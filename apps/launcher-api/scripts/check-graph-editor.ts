/**
 * The Timeline's Graph Editor (game-families P10.9), headless:
 *   pnpm --filter launcher-api check:graph-editor
 *
 *  1. WHAT IT DRAWS IS WHAT PLAYS: the graph's points are the game's own samples of the channel
 *     (`sampleNodeActor`, the function a screen timeline is played with), on a cubic, a hold, an
 *     Elastic and a Bounce segment; an overshoot is inside the drawn range.
 *  2. HANDLES: a cubic's handles sit at its control points in time × value and dragging one back
 *     to where it is gives the same cubic; a drag writes the time share (clamped to 0..1) and the
 *     value share (free to overshoot); a segment with no value change has nothing to shape.
 *  3. PRESETS: every cubic preset is a valid cubic the evaluator plays, Overshoot passes the next
 *     key and Anticipate dips below the last one.
 *  4. ABSENT ⇒ UNCHANGED: mounting with `graph` and editing nothing leaves the doc byte-identical;
 *     the format has no new field (an authored graph edit is the key's ordinary `ease`).
 */
import * as EV from '../../../packages/engine-cinematic/src/cinematicEval.js';
import {
	CUBIC_PRESETS,
	cubicFromHandle,
	cubicHandlePoints,
	graphGeometry,
	mount,
} from '../src/lib/timeline/timeline.js';

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
	if (cond) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};
const eq = (label: string, actual: unknown, expected: unknown): void =>
	ok(
		label,
		JSON.stringify(actual) === JSON.stringify(expected),
		`expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`,
	);

Object.assign(globalThis, {
	window: { addEventListener: () => {}, removeEventListener: () => {} },
	document: { activeElement: null },
});

type Ease = 'linear' | 'hold' | 'elastic' | 'bounce' | [number, number, number, number];
const keysWith = (ease: Ease) => [
	{ time: 0, value: 0, ease },
	{ time: 1, value: 100 },
	{ time: 1.5, value: 40, ease: 'hold' as const },
	{ time: 2, value: 60 },
];
const docWith = (keys: ReturnType<typeof keysWith>) => ({
	id: 'tl',
	duration: 2,
	fps: 30,
	stage: { cast: [{ actorId: 'n1', kind: 'node', z: 0 }] },
	tracks: [{ id: 'p', kind: 'property', actorId: 'n1', channels: { x: keys } }],
});

console.log('1. what the graph draws is what the game plays');
for (const ease of [[0.42, 0, 0.58, 1], 'hold', 'elastic', 'bounce', 'linear'] as Ease[]) {
	const keys = keysWith(ease);
	const doc = docWith(keys);
	const geo = graphGeometry(keys, EV, doc.duration, 120);
	const off = geo.points.filter((p) => {
		const played = EV.sampleNodeActor(doc.tracks as never, p.t).x;
		return typeof played !== 'number' || Math.abs(played - p.v) > 1e-9;
	});
	ok(
		`${JSON.stringify(ease)}: every point is the game's sample (${geo.points.length})`,
		off.length === 0,
		`${off.length} differ`,
	);
	ok(
		`${JSON.stringify(ease)}: every key time is a point`,
		keys.every((k) => geo.points.some((p) => p.t === k.time)),
	);
	ok(
		`${JSON.stringify(ease)}: the range holds every point`,
		geo.points.every((p) => p.v >= geo.min - 1e-9 && p.v <= geo.max + 1e-9),
	);
}
{
	const geo = graphGeometry(keysWith('elastic'), EV, 2, 120);
	ok('an elastic overshoot widens the range past the key', geo.max > 130, `max ${geo.max}`);
	eq('y and valueAt are inverses', +geo.valueAt(geo.y(37.5)).toFixed(9), 37.5);
	const flat = graphGeometry(
		[
			{ time: 0, value: 5 },
			{ time: 1, value: 5 },
		],
		EV,
		1,
		100,
	);
	eq('a flat channel still gets a range', [flat.min, flat.max], [4, 6]);
}

console.log('2. handles');
{
	const a = { time: 0.5, value: 10 };
	const b = { time: 1.5, value: 110 };
	const c: [number, number, number, number] = [0.25, 0.1, 0.75, 1.3];
	const [h1, h2] = cubicHandlePoints(a, b, c);
	eq('handle 1 at its control point', [h1.t, +h1.v.toFixed(9)], [0.75, 20]);
	eq('handle 2 at its control point', [h2.t, +h2.v.toFixed(9)], [1.25, 140]);
	eq(
		'dragging handle 1 back to itself keeps the cubic',
		cubicFromHandle(a, b, c, 1, h1.t, h1.v),
		c,
	);
	eq(
		'dragging handle 2 back to itself keeps the cubic',
		cubicFromHandle(a, b, c, 2, h2.t, h2.v),
		c,
	);
	eq(
		'a drag writes the time and value shares',
		cubicFromHandle(a, b, c, 1, 1, 60),
		[0.5, 0.5, 0.75, 1.3],
	);
	eq('time is clamped to the segment', cubicFromHandle(a, b, c, 2, 9, 110), [0.25, 0.1, 1, 1]);
	eq('value may overshoot both ways', cubicFromHandle(a, b, c, 1, 0.5, -40), [0, -0.5, 0.75, 1.3]);
	eq(
		'no value change ⇒ nothing to shape',
		cubicFromHandle(a, { time: 1.5, value: 10 }, c, 1, 1, 1),
		null,
	);
	const down = cubicFromHandle({ time: 0, value: 100 }, { time: 1, value: 0 }, c, 1, 0.5, 20);
	eq(
		'a falling segment: the value share runs from the first key to the next',
		down,
		[0.5, 0.8, 0.75, 1.3],
	);
	const keys = [
		{ time: 0, value: 0, ease: down as Ease },
		{ time: 1, value: 100 },
	];
	ok(
		'what a drag writes plays as that cubic in the game',
		Math.abs((EV.sampleChannel(keys, 0.5) ?? NaN) - 100 * EV.easeShape(down)(0.5)) < 1e-9,
	);
}

console.log('3. presets');
for (const p of CUBIC_PRESETS) {
	ok(
		`${p.label}: a cubic the evaluator plays`,
		EV.isCubicEase(p.cubic) &&
			p.cubic[0] >= 0 &&
			p.cubic[0] <= 1 &&
			p.cubic[2] >= 0 &&
			p.cubic[2] <= 1,
	);
	const shape = EV.easeShape(p.cubic);
	ok(
		`${p.label}: starts and ends on its keys`,
		Math.abs(shape(0)) < 1e-6 && Math.abs(shape(1) - 1) < 1e-6,
	);
}
{
	const peak = (id: string, pick: (a: number, b: number) => number) => {
		const shape = EV.easeShape(CUBIC_PRESETS.find((p) => p.id === id)!.cubic);
		let v = shape(0.5);
		for (let i = 1; i < 100; i++) v = pick(v, shape(i / 100));
		return v;
	};
	ok('Overshoot passes the next key', peak('overshoot', Math.max) > 1.05);
	ok('Anticipate dips below the last key first', peak('anticipate', Math.min) < -0.05);
}

console.log('4. absent ⇒ unchanged');
{
	const doc = docWith(keysWith([0.42, 0, 0.58, 1]));
	const before = JSON.stringify(doc);
	const tl = mount(null, { doc: doc as never, ev: EV, interpolation: true, graph: true });
	tl.setActive(true);
	tl.setTime(0.7);
	eq(
		'mounting with the Graph Editor and editing nothing leaves the doc byte-identical',
		JSON.stringify(tl.doc()),
		before,
	);
}

if (failures) {
	console.error(`\n✗ graph editor: ${failures} failed`);
	process.exit(1);
}
console.log('\n✓ graph editor: all checks pass');
