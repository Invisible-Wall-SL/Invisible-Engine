/**
 * The 2.5D rig bake (docs/design/rig-2p5d.md §4): a rig whose bones carry a 3D orientation and a
 * depth, and a clip keyed in 3D, baked into ordinary 4.2-format timelines — rotate, translate,
 * scale, shearY, drawOrder and attachment keys — that engine-rig plays unchanged. Pure: no DOM and no
 * runtime import, so the gate (`tools/rigger-spike/rig-2p5d.mjs`) plays the result through the real
 * engine-rig and this file's model of how the runtime composes a bone (Inherit.Normal) is under test.
 *
 * A bone's 3D local transform is a translation (x, y, depth), an orientation and an in-plane scale.
 * A clip keys the orientation as quaternions (`orient`, a turn from the setup, slerped along the
 * shorter arc with a 4.2 curve shaping the progress); `translate`, `scale`, `depth` and a plain 2D
 * `rotate` are 4.2 channels sampled as engine-rig samples a timeline. Angles for people are
 * `Rz(rotate) · Ry(−tilt) · Rx(twist)` — `rotate` about the view axis, `tilt` about the bone's own y
 * (its tip toward the viewer, +), `twist` about its own length — converted by `orientOf` and
 * `anglesOf`. The art of a bone lies in its local x-y plane (its card).
 *
 * The bake, per bone, parents first:
 *   1. the bone's WORLD 3D frame, projected orthographically: its 2D world affine is the top-left
 *      2×2 of the world linear part and the x, y of the world origin;
 *   2. a FLOOR: the projected 2×2's smaller singular value is held at ≥ f × the larger, with the sign
 *      of its determinant (f = floor / the card's extent, so the card's own image moves ≤ floor); a
 *      card turning through edge-on flips that sign, which is a STEP (two keys at one time), as is a
 *      stepped 3D key and a drawing swap;
 *   3. its 2D local = inverse(the parent's PLAYED 2D world) × its own target, decomposed into rotate,
 *      scaleX, scaleY, shearY (shearX stays 0) and x, y, so whatever the parent's keys left, the
 *      child's keys put it back;
 *   4. keyed densely, then reduced: Douglas–Peucker on the WORLD error of its card's corners against
 *      what the runtime will play, then refined wherever even the dense keys miss (capped; a run past
 *      the cap is reported, never silently kept). The error is measured on a check set that holds
 *      the grid, the parent's checks, key times and key-run middles, subdivided wherever this card
 *      or its parent as played thins out. A run whose played card thins below half its floor or shows
 *      its other side is refused (its children could not follow).
 * Draw order comes from the cards' depth with a hysteresis. A slot with drawings by angle shows the
 * one that faces the viewer best (past a margin, held a minimum time), on an image bone that hangs
 * from a steady bone, follows the turning one in 3D and is turned back by the drawing's angle. Each
 * clip ends with its angles brought back into (−180°, 180°] by a step, so a crossfade does not spin.
 */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
/** A determinant above −EDGE counts as facing the viewer, so a card held exactly edge-on keeps one side. */
const EDGE = 1e-12;
/** How far either side of a step its two limits are read, in seconds. */
const LIMIT = 1e-6;
/** Steps closer than this are one event (a stepped key that also turns a card through edge-on). */
const SAME_STEP = 1e-8;
/** The largest change in a card's floored thinness (σ2 / σ1) between two check points. */
const THIN_STEP = 1.1;
/** engine-rig samples a bezier at t = 0.1 … 0.9 and is linear between the samples. */
const BEZIER_POINTS = 9;

// ── The rig and the clip ────────────────────────────────────────────────────────────────────────

/** A bone's art, in its local x-y plane: x from x0 to x1, y from −h to h. */
export interface Card {
	x0: number;
	x1: number;
	h: number;
}

/** 4.2's key curve: stepped, or a bezier's (cx1, cy1, cx2, cy2) per value. */
export type Curve = 'stepped' | number[];

export interface Key1 {
	time?: number;
	value?: number;
	curve?: Curve;
}

export interface Key2 {
	time?: number;
	x?: number;
	y?: number;
	curve?: Curve;
}

/** A unit quaternion [w, x, y, z]. */
export type Quat = [number, number, number, number];

/**
 * An orientation key: the bone's turn from its setup. To the next key it is slerped along the
 * shorter arc; `curve` is 4.2's 1D curve over the slerp's progress (0 at this key, 1 at the next).
 */
export interface QuatKey {
	time?: number;
	value: Quat;
	curve?: Curve;
}

/**
 * A bone's keys in a 3D clip: `orient` its 3D orientation from the setup; `rotate` (a 2D turn in its
 * parent's plane, for a bone with no `orient`), `translate` and `depth` offsets from the setup and
 * `scale` a multiple of it, as 4.2 keys them.
 */
export interface BoneKeys3d {
	orient?: QuatKey[];
	rotate?: Key1[];
	depth?: Key1[];
	translate?: Key2[];
	scale?: Key2[];
}

export type Inherit =
	'normal' | 'onlyTranslation' | 'noRotationOrReflection' | 'noScale' | 'noScaleOrReflection';

export interface Bone3d {
	name: string;
	parent?: string;
	/** Drawn on this bone in 3D, keyed against its 2D parent: an image bone for drawings by angle. */
	follow?: string;
	length?: number;
	x?: number;
	y?: number;
	rotate?: number;
	scaleX?: number;
	scaleY?: number;
	shearX?: number;
	shearY?: number;
	inherit?: Inherit;
	/** z in the parent's frame, toward the viewer. The setup is flat: no tilt, no twist. */
	depth?: number;
	/** Where its art lies; without one, a card along its length. */
	card?: Card;
}

/** A drawing made for one turn of its card about the card's y (front 0°, ¾ 45°, side 90°, back 180°). */
export interface Drawing {
	attachment: string;
	turn: number;
}

export interface Slot3d {
	name: string;
	bone: string;
	attachment?: string;
	drawings?: Drawing[];
	/** How much better (in its card normal's z) another drawing must face the viewer to swap… */
	margin?: number;
	/** …and how long a drawing is held at least, in seconds. */
	hold?: number;
}

/** A constraint, as far as the bake cares: the bones whose world it writes, and its setup mix. */
export interface Constraint3d {
	name: string;
	bones: string[];
	/** The largest of its mixes; 0 = off. */
	mix: number;
}

/**
 * How far a rig's drawings by angle go, chosen before it is drawn or animated: `side` stops at the
 * side views (past 90° a card shows a front-half drawing mirrored, as a card's back is), `full` turns
 * all the way round on back drawings.
 */
export type Turnaround = 'side' | 'full';

export interface Rig3d {
	bones: Bone3d[];
	slots: Slot3d[];
	constraints?: Constraint3d[];
	/** The rig's own tolerance, floor and hysteresis (`rig3d.json`); an option given to the bake wins. */
	tolerance?: number;
	floor?: number;
	hysteresis?: number;
	/** Required once a slot has drawings by angle. */
	turnaround?: Turnaround;
}

export interface MixKey {
	time?: number;
	mix: number;
}

export interface Clip3d {
	name: string;
	duration: number;
	bones: Record<string, BoneKeys3d>;
	/** Per constraint name, the clip's mix keys (the largest of its mixes per key). */
	constraints?: Record<string, MixKey[]>;
}

export interface BakeOptions {
	/** World error the reduced keys may leave, at any card corner, in rig units. */
	tolerance: number;
	/** How far the floor may move a card's own corner, in rig units (0: no floor). */
	floor: number;
	/** Depth (rig units) one card must pass another by before the draw order swaps. */
	hysteresis: number;
	/** A slot's drawing `margin` and `hold` when it sets none. */
	margin: number;
	hold: number;
	denseHz: number;
	checkHz: number;
	// The gate turns each of these off to show the step is needed (its mutation checks).
	shear: boolean;
	steps: boolean;
	dense: boolean;
	reduce: boolean;
	/** Each run between steps starts on the angle branch nearest the setup, and the clip ends in it. */
	wrap: boolean;
	/** 'world' = project each bone's world frame; 'local' = project its local transform alone. */
	project: 'world' | 'local';
}

export const BAKE_DEFAULTS: BakeOptions = {
	tolerance: 0.45,
	floor: 0.35,
	hysteresis: 6,
	margin: 0.03,
	hold: 0.1,
	denseHz: 120,
	checkHz: 480,
	shear: true,
	steps: true,
	dense: true,
	reduce: true,
	wrap: true,
	project: 'world',
};

// ── What the bake writes ────────────────────────────────────────────────────────────────────────

export interface BakedBoneTimelines {
	rotate?: Key1[];
	translate?: Key2[];
	scale?: Key2[];
	sheary?: Key1[];
}

export interface DrawOrderKey {
	time: number;
	offsets: { slot: string; offset: number }[];
}

/** One clip as an irig animation: what the bake owns of it. */
export interface BakedAnimation {
	bones: Record<string, BakedBoneTimelines>;
	drawOrder?: DrawOrderKey[];
	slots?: Record<string, { attachment: { time: number; name: string }[] }>;
}

/** A bone's 2D setup pose. A follower's is where its 3D setup projects, hung from its 2D parent. */
export interface Setup2d {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
}

export interface UnmetRun {
	bone: string;
	from: number;
	to: number;
	error: number;
}

export interface BakeReport {
	bones: Record<string, { keys: number; dense: number; steps: number; unmet: number }>;
	/** Per baked bone, where its card turns through edge-on. */
	flips: Record<string, number[]>;
	timelineKeys: Record<string, number>;
	/** Runs of keys that even the capped refinement could not bring within the tolerance. */
	unmet: UnmetRun[];
}

export interface DrawingKey {
	time: number;
	attachment: string;
	turn: number;
}

export interface Bake2p5d {
	animation: BakedAnimation;
	setup: Record<string, Setup2d>;
	/** The bones the bake keyed (the rest pass their 2D keys through). */
	baked: string[];
	report: BakeReport;
	/** Per slot with drawings, the drawing it shows from each time on. */
	drawings: Record<string, DrawingKey[]>;
	/** The slots' draw order at `t`, as keyed. */
	orderAt: (t: number) => string[];
}

/** A 3D frame: a row-major 3×3 linear part and an origin. */
export interface Frame3d {
	m: number[];
	o: number[];
}

// ── Channels: 4.2 keys, sampled as engine-rig samples a timeline ────────────────────────────────

type Run = 'linear' | 'stepped' | number[];

interface Channel {
	times: number[];
	values: number[];
	/** Per key, how it runs to the next: linear, stepped, or a bezier's samples (x, y pairs). */
	runs: Run[];
	/** The value before the first key: the setup's (4.2). */
	rest: number;
}

interface Keyed {
	time?: number;
	curve?: Curve;
}

function bezierSamples(
	t1: number,
	v1: number,
	cx1: number,
	cy1: number,
	cx2: number,
	cy2: number,
	t2: number,
	v2: number,
): number[] {
	const s: number[] = [];
	for (let k = 1; k <= BEZIER_POINTS; k++) {
		const t = k / 10;
		const u = 1 - t;
		const b0 = u * u * u;
		const b1 = 3 * u * u * t;
		const b2 = 3 * u * t * t;
		const b3 = t * t * t;
		s.push(b0 * t1 + b1 * cx1 + b2 * cx2 + b3 * t2, b0 * v1 + b1 * cy1 + b2 * cy2 + b3 * v2);
	}
	return s;
}

/** One value of a 4.2 key list (`at` = which value's curve numbers), as stored when `stored`. */
function channel<K extends Keyed>(
	keys: K[] | undefined,
	value: (k: K) => number,
	at: number,
	rest: number,
	stored: boolean,
): Channel | null {
	if (!keys?.length) return null;
	const fix = stored ? held : (v: number) => v;
	const times = keys.map((k) => fix(k.time ?? 0));
	const values = keys.map((k) => fix(value(k)));
	const runs = keys.map((k, i): Run => {
		const c = k.curve;
		if (i === keys.length - 1 || c === undefined) return 'linear';
		if (c === 'stepped') return 'stepped';
		const [cx1, cy1, cx2, cy2] = c.slice(at * 4, at * 4 + 4);
		return bezierSamples(times[i], values[i], cx1, cy1, cx2, cy2, times[i + 1], values[i + 1]);
	});
	return { times, values, runs, rest };
}

/** engine-rig's lookup: the setup before the first key, else the last key at or before `t` on to the next. */
function valueAt(ch: Channel | null, t: number, rest: number): number {
	if (!ch) return rest;
	const { times, values, runs } = ch;
	if (t < times[0]) return ch.rest;
	let lo = 0;
	let hi = times.length;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	if (lo === times.length - 1) return values[lo];
	return runAt(runs[lo], t, times[lo], times[lo + 1], values[lo], values[lo + 1]);
}

/** One run of a timeline at `t`, from (t0, v0) to (t1, v1), as engine-rig interpolates it. */
function runAt(run: Run, t: number, t0: number, t1: number, v0: number, v1: number): number {
	if (run === 'stepped') return v0;
	if (run === 'linear') return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
	if (run[0] > t) return v0 + ((t - t0) / (run[0] - t0)) * (run[1] - v0);
	const n = BEZIER_POINTS * 2;
	for (let k = 2; k < n; k += 2)
		if (run[k] >= t) {
			const x = run[k - 2];
			const y = run[k - 1];
			return y + ((t - x) / (run[k] - x)) * (run[k + 1] - y);
		}
	const x = run[n - 2];
	const y = run[n - 1];
	return y + ((t - x) / (t1 - x)) * (v1 - y);
}

/** Where a channel jumps: its first key off the setup, a stepped key, two keys at one time. */
function jumpsOf(ch: Channel | null): number[] {
	if (!ch) return [];
	const { times, values, runs } = ch;
	const out = times[0] > 0 && values[0] !== ch.rest ? [times[0]] : [];
	for (let i = 0; i + 1 < times.length; i++)
		if ((runs[i] === 'stepped' || times[i + 1] === times[i]) && values[i + 1] !== values[i])
			out.push(times[i + 1]);
	return out;
}

/** Orientation keys, compiled: unit quaternions and each key's run of progress (0 → 1). */
interface Spin {
	times: number[];
	quats: Quat[];
	runs: Run[];
}

const IDENTITY: Quat = [1, 0, 0, 0];
const qdot = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const unit = (q: Quat): Quat => {
	const n = Math.hypot(...q);
	return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
/** Two quaternions name the same rotation (q and −q do). */
const sameTurn = (a: Quat, b: Quat): boolean => Math.abs(qdot(a, b)) >= 1 - 1e-12;

function spinOf(keys: QuatKey[] | undefined): Spin | null {
	if (!keys?.length) return null;
	const times = keys.map((k) => k.time ?? 0);
	const runs = keys.map((k, i): Run => {
		const c = k.curve;
		if (i === keys.length - 1 || c === undefined) return 'linear';
		if (c === 'stepped') return 'stepped';
		return bezierSamples(times[i], 0, c[0], c[1], c[2], c[3], times[i + 1], 1);
	});
	return { times, quats: keys.map((k) => unit(k.value)), runs };
}

/** Spherical interpolation along the shorter arc; `u` past 0 or 1 goes on along the same arc. */
function slerp(a: Quat, b: Quat, u: number): Quat {
	let d = qdot(a, b);
	let c = b;
	if (d < 0) {
		c = [-b[0], -b[1], -b[2], -b[3]];
		d = -d;
	}
	const mix = (wa: number, wb: number): Quat => [
		a[0] * wa + c[0] * wb,
		a[1] * wa + c[1] * wb,
		a[2] * wa + c[2] * wb,
		a[3] * wa + c[3] * wb,
	];
	if (d > 0.99999) return unit(mix(1 - u, u));
	const th = Math.acos(d);
	const s = Math.sin(th);
	return mix(Math.sin((1 - u) * th) / s, Math.sin(u * th) / s);
}

/** The orientation at `t`: the setup's before the first key, else slerped key to key. */
function orientAt(s: Spin | null, t: number): Quat {
	if (!s || t < s.times[0]) return IDENTITY;
	const { times, quats, runs } = s;
	let lo = 0;
	let hi = times.length;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	if (lo === times.length - 1 || runs[lo] === 'stepped') return quats[lo];
	return slerp(quats[lo], quats[lo + 1], runAt(runs[lo], t, times[lo], times[lo + 1], 0, 1));
}

/** Where orientation keys jump: the first off the setup, a stepped key, two keys at one time. */
function spinJumps(s: Spin | null): number[] {
	if (!s) return [];
	const { times, quats, runs } = s;
	const out = times[0] > 0 && !sameTurn(quats[0], IDENTITY) ? [times[0]] : [];
	for (let i = 0; i + 1 < times.length; i++)
		if ((runs[i] === 'stepped' || times[i + 1] === times[i]) && !sameTurn(quats[i], quats[i + 1]))
			out.push(times[i + 1]);
	return out;
}

interface Motion {
	orient: Spin | null;
	rotate: Channel | null;
	depth: Channel | null;
	x: Channel | null;
	y: Channel | null;
	scaleX: Channel | null;
	scaleY: Channel | null;
}

function motionOf(keys: BoneKeys3d, stored: boolean): Motion {
	const one = (ks: Key1[] | undefined) => channel(ks, (k) => k.value ?? 0, 0, 0, stored);
	return {
		orient: spinOf(keys.orient),
		rotate: one(keys.rotate),
		depth: one(keys.depth),
		x: channel(keys.translate, (k) => k.x ?? 0, 0, 0, stored),
		y: channel(keys.translate, (k) => k.y ?? 0, 1, 0, stored),
		scaleX: channel(keys.scale, (k) => k.x ?? 1, 0, 1, stored),
		scaleY: channel(keys.scale, (k) => k.y ?? 1, 1, 1, stored),
	};
}

const channelsOf = (m: Motion): Array<Channel | null> => [
	m.rotate,
	m.depth,
	m.x,
	m.y,
	m.scaleX,
	m.scaleY,
];
/** Every key time of a bone's motion, and every time it jumps. */
const keyTimesOf = (m: Motion): number[] => [
	...(m.orient?.times ?? []),
	...channelsOf(m).flatMap((ch) => ch?.times ?? []),
];
const jumpTimesOf = (m: Motion): number[] => [
	...spinJumps(m.orient),
	...channelsOf(m).flatMap(jumpsOf),
];

// ── 3D ──────────────────────────────────────────────────────────────────────────────────────────

const mm = (p: number[], c: number[]): number[] => {
	const m = new Array<number>(9);
	for (let r = 0; r < 3; r++)
		for (let k = 0; k < 3; k++)
			m[r * 3 + k] = p[r * 3] * c[k] + p[r * 3 + 1] * c[3 + k] + p[r * 3 + 2] * c[6 + k];
	return m;
};
const rz = (deg: number): number[] => {
	const c = Math.cos(deg * RAD);
	const s = Math.sin(deg * RAD);
	return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const ry = (deg: number): number[] => {
	const c = Math.cos(deg * RAD);
	const s = Math.sin(deg * RAD);
	return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const rx = (deg: number): number[] => {
	const c = Math.cos(deg * RAD);
	const s = Math.sin(deg * RAD);
	return [1, 0, 0, 0, c, -s, 0, s, c];
};
/** A unit quaternion's rotation matrix (row-major). */
const qmat = ([w, x, y, z]: Quat): number[] => [
	1 - 2 * (y * y + z * z),
	2 * (x * y - w * z),
	2 * (x * z + w * y),
	2 * (x * y + w * z),
	1 - 2 * (x * x + z * z),
	2 * (y * z - w * x),
	2 * (x * z - w * y),
	2 * (y * z + w * x),
	1 - 2 * (x * x + y * y),
];
const qmul = (a: Quat, b: Quat): Quat => [
	a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
	a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
	a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
	a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qaxis = (x: number, y: number, z: number, deg: number): Quat => {
	const h = (deg * RAD) / 2;
	return [Math.cos(h), x * Math.sin(h), y * Math.sin(h), z * Math.sin(h)];
};

export interface Angles {
	rotate: number;
	tilt: number;
	twist: number;
}

/**
 * The orientation `Rz(rotate) · Ry(−tilt) · Rx(twist)`: `rotate` about the view axis, then `tilt`
 * about the bone's y (its tip toward the viewer, +), then `twist` about its length.
 */
export const orientOf = (rotate: number, tilt: number, twist: number): Quat =>
	qmul(qmul(qaxis(0, 0, 1, rotate), qaxis(0, 1, 0, -tilt)), qaxis(1, 0, 0, twist));

/**
 * The angles of an orientation, for the graph editor: of its two readings (tilt and 180° − tilt),
 * the one nearest `ref`, each angle unwrapped toward it; without `ref`, |tilt| ≤ 90° in
 * (−180°, 180°]. At tilt ±90° (where rotate and twist turn about one axis) twist is `ref`'s.
 */
export function anglesOf(q: Quat, ref?: Angles): Angles {
	const m = qmat(unit(q));
	const locked = Math.abs(m[6]) > 1 - 1e-12;
	const tilt = locked ? Math.sign(m[6]) * 90 : Math.asin(m[6]) * DEG;
	const near = (v: number, r = 0) => v + 360 * Math.round((r - v) / 360);
	let readings: Angles[];
	if (locked) {
		const twist = ref?.twist ?? 0;
		const z = mm(mm(m, rx(-twist)), ry(tilt));
		readings = [{ rotate: Math.atan2(z[3], z[0]) * DEG, tilt, twist }];
	} else {
		const rotate = Math.atan2(m[3], m[0]) * DEG;
		const twist = Math.atan2(m[7], m[8]) * DEG;
		readings = [
			{ rotate, tilt, twist },
			{ rotate: rotate + 180, tilt: 180 - tilt, twist: twist + 180 },
		];
	}
	const fitted = readings.map((a) => ({
		rotate: near(a.rotate, ref?.rotate),
		tilt: near(a.tilt, ref?.tilt),
		twist: near(a.twist, ref?.twist),
	}));
	if (!ref) return fitted[0];
	const off = (a: Angles) =>
		(a.rotate - ref.rotate) ** 2 + (a.tilt - ref.tilt) ** 2 + (a.twist - ref.twist) ** 2;
	return fitted.reduce((x, y) => (off(y) < off(x) ? y : x));
}

const compose3 = (p: Frame3d, c: Frame3d): Frame3d => ({
	m: mm(p.m, c.m),
	o: [0, 1, 2].map(
		(r) => p.m[r * 3] * c.o[0] + p.m[r * 3 + 1] * c.o[1] + p.m[r * 3 + 2] * c.o[2] + p.o[r],
	),
});

/** inverse(p) × c, for the 'local' projection the gate shows is wrong. */
function relative(p: Frame3d, c: Frame3d): Frame3d {
	const [a, b, cc, d, e, f, g, h, i] = p.m;
	const A = e * i - f * h;
	const B = f * g - d * i;
	const C = d * h - e * g;
	const det = a * A + b * B + cc * C;
	const inv = [
		A / det,
		(cc * h - b * i) / det,
		(b * f - cc * e) / det,
		B / det,
		(a * i - cc * g) / det,
		(cc * d - a * f) / det,
		C / det,
		(b * g - a * h) / det,
		(a * e - b * d) / det,
	];
	return compose3({ m: inv, o: [0, 0, 0] }, { m: c.m, o: c.o.map((v, k) => v - p.o[k]) });
}

/** The z of a frame's card normal (1 = facing the viewer, 0 = edge-on, < 0 its back). */
function normalZ(m: number[]): number {
	const nx = m[3] * m[7] - m[6] * m[4];
	const ny = m[6] * m[1] - m[0] * m[7];
	const nz = m[0] * m[4] - m[3] * m[1];
	const n = Math.hypot(nx, ny, nz);
	return n > 0 ? nz / n : 0;
}

interface Affine {
	a: number;
	b: number;
	c: number;
	d: number;
	x: number;
	y: number;
}

/** The orthographic picture of a 3D frame: its 2D world affine, as engine-rig stores a bone's. */
const project = (w: Frame3d): Affine => ({
	a: w.m[0],
	b: w.m[1],
	c: w.m[3],
	d: w.m[4],
	x: w.o[0],
	y: w.o[1],
});

const NO_TURN = (): number => 0;

/**
 * Every bone's 3D world frame at `t`. A bone that `follow`s another is placed on it in 3D whatever
 * its 2D parent; `turn` gives a bone its drawing's turn-back (about the card's y).
 */
function world3d(
	rig: Rig3d,
	motion: Map<string, Motion>,
	t: number,
	turn: (bone: string) => number = NO_TURN,
): Map<string, Frame3d> {
	const out = new Map<string, Frame3d>();
	const get = (name: string): Frame3d => {
		const f = out.get(name);
		if (!f) throw new Error(`rig2p5d: ${name} posed before it is listed`);
		return f;
	};
	for (const b of rig.bones) {
		const spin = turn(b.name);
		if (b.follow) {
			const f = get(b.follow);
			out.set(b.name, spin ? { m: mm(f.m, ry(spin)), o: f.o } : f);
			continue;
		}
		const k = motion.get(b.name);
		const turned = k?.orient ? qmat(orientAt(k.orient, t)) : rz(valueAt(k?.rotate ?? null, t, 0));
		const m = mm(rz(b.rotate ?? 0), turned);
		const sx = (b.scaleX ?? 1) * valueAt(k?.scaleX ?? null, t, 1);
		const sy = (b.scaleY ?? 1) * valueAt(k?.scaleY ?? null, t, 1);
		for (let r = 0; r < 3; r++) {
			m[r * 3] *= sx;
			m[r * 3 + 1] *= sy;
		}
		const local: Frame3d = {
			m: spin ? mm(m, ry(spin)) : m,
			o: [
				(b.x ?? 0) + valueAt(k?.x ?? null, t, 0),
				(b.y ?? 0) + valueAt(k?.y ?? null, t, 0),
				(b.depth ?? 0) + valueAt(k?.depth ?? null, t, 0),
			],
		};
		out.set(b.name, b.parent ? compose3(get(b.parent), local) : local);
	}
	return out;
}

const motionsOf = (clip: Clip3d, stored: boolean): Map<string, Motion> =>
	new Map(Object.entries(clip.bones).map(([name, keys]) => [name, motionOf(keys, stored)]));

/** Every bone's 3D world frame at `t` in a 3D clip (no drawing turned back): what the bake projects. */
export function pose3d(rig: Rig3d, clip: Clip3d, t: number): Map<string, Frame3d> {
	return world3d(rig, motionsOf(clip, false), t);
}

// ── 2D ──────────────────────────────────────────────────────────────────────────────────────────

/** The 2×2's singular values (σ1 ≥ |σ2|, σ2 carrying the determinant's sign) and directions. */
function svd2(A: Affine): { s1: number; s2: number; v: number[]; u: number[] } {
	const { a, b, c, d } = A;
	const p = a * a + c * c;
	const q = a * b + c * d;
	const r = b * b + d * d;
	const s1 = Math.sqrt((p + r) / 2 + Math.hypot((p - r) / 2, q));
	let vx = q;
	let vy = s1 * s1 - p;
	if (Math.hypot(vx, vy) < 1e-12 * (p + r)) [vx, vy] = p >= r ? [1, 0] : [0, 1];
	const n = Math.hypot(vx, vy);
	vx /= n;
	vy /= n;
	return {
		s1,
		s2: (a * d - b * c) / s1,
		v: [vx, vy],
		u: [(a * vx + b * vy) / s1, (c * vx + d * vy) / s1],
	};
}

/** How thin a 2D affine is: σ2 / σ1 (1 = a card facing the viewer, 0 = edge-on). */
function thinness(A: Affine): number {
	const s = svd2(A);
	return s.s1 > 0 ? Math.abs(s.s2) / s.s1 : 0;
}

/**
 * The affine with its smaller singular value held at ≥ f × the larger, keeping the determinant's
 * sign (≥ −EDGE counts as +). The change is along the thin direction only: a point p of the card
 * moves by at most (f·σ1 − |σ2|)·|p|.
 */
function floored(A: Affine, f: number): Affine {
	const { s1, s2, u, v } = svd2(A);
	if (!(s1 > 0)) return A;
	const det = A.a * A.d - A.b * A.c;
	const want = (det >= -EDGE ? 1 : -1) * Math.max(Math.abs(s2), f * s1);
	const k = want - s2;
	if (k === 0) return A;
	// σ2's directions are the larger ones turned 90°: u2 = (−u_y, u_x), v2 = (−v_y, v_x).
	return {
		...A,
		a: A.a + k * u[1] * v[1],
		b: A.b - k * u[1] * v[0],
		c: A.c - k * u[0] * v[1],
		d: A.d + k * u[0] * v[0],
	};
}
const facing = (A: Affine): boolean => A.a * A.d - A.b * A.c >= -EDGE;

const nearest = (v: number, ref: number): number => v + 360 * Math.round((ref - v) / 360);
/** An angle brought into (−180°, 180°]. */
const wrap180 = (v: number): number => v - 360 * Math.ceil(v / 360 - 0.5);

interface Pose2 {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
	shearY: number;
}
type PoseChannel = keyof Pose2;
const CHANNELS: PoseChannel[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearY'];

/** engine-rig's Inherit.Normal, shearX = 0: the world a local pose gives under `p` (null = root). */
function compose(p: Affine | null, l: Pose2): Affine {
	const rxr = l.rotation * RAD;
	const ryr = (l.rotation + 90 + l.shearY) * RAD;
	const la = Math.cos(rxr) * l.scaleX;
	const lc = Math.sin(rxr) * l.scaleX;
	const lb = Math.cos(ryr) * l.scaleY;
	const ld = Math.sin(ryr) * l.scaleY;
	if (!p) return { a: la, b: lb, c: lc, d: ld, x: l.x, y: l.y };
	return {
		a: p.a * la + p.b * lc,
		b: p.a * lb + p.b * ld,
		c: p.c * la + p.d * lc,
		d: p.c * lb + p.d * ld,
		x: p.a * l.x + p.b * l.y + p.x,
		y: p.c * l.x + p.d * l.y + p.y,
	};
}

/** The local pose that puts a bone at world `w` under parent world `p`, its angles near `ref`'s. */
function localOf(p: Affine | null, w: Affine, ref: Pose2, shear: boolean): Pose2 {
	let M = w;
	if (p) {
		const det = p.a * p.d - p.b * p.c;
		const ia = p.d / det;
		const ib = -p.b / det;
		const ic = -p.c / det;
		const id = p.a / det;
		const dx = w.x - p.x;
		const dy = w.y - p.y;
		M = {
			a: ia * w.a + ib * w.c,
			b: ia * w.b + ib * w.d,
			c: ic * w.a + id * w.c,
			d: ic * w.b + id * w.d,
			x: ia * dx + ib * dy,
			y: ic * dx + id * dy,
		};
	}
	const rotation = nearest(Math.atan2(M.c, M.a) * DEG, ref.rotation);
	const shearY = shear ? nearest(Math.atan2(M.d, M.b) * DEG - rotation - 90, ref.shearY) : 0;
	return {
		x: M.x,
		y: M.y,
		rotation,
		scaleX: Math.hypot(M.a, M.c),
		scaleY: Math.hypot(M.b, M.d),
		shearY,
	};
}

/** What the file stores (7 significant digits) … */
const store = (v: number): number => Number(v.toPrecision(7));
/** … as the runtime holds it (a float32). */
const held = (v: number): number => Math.fround(store(v));

/** A key's pose as the runtime will play it: setup + stored offset; scale = setup × stored factor. */
function asPlayed(setup: Pose2, l: Pose2): Pose2 {
	return {
		x: setup.x + held(l.x - setup.x),
		y: setup.y + held(l.y - setup.y),
		rotation: setup.rotation + held(l.rotation - setup.rotation),
		scaleX: setup.scaleX * held(l.scaleX / setup.scaleX),
		scaleY: setup.scaleY * held(l.scaleY / setup.scaleY),
		shearY: held(l.shearY),
	};
}

interface BakedKey {
	time: number;
	/** Which run between steps it belongs to: keys are only interpolated within one. */
	seg: number;
	pose: Pose2;
}

/** The runtime's lookup on baked keys: the last key at or before `t`, linear to the next. */
function poseAt(keys: BakedKey[], t: number): Pose2 {
	let lo = 0;
	let hi = keys.length - 1;
	if (t >= keys[hi].time) return keys[hi].pose;
	if (t < keys[0].time) return keys[0].pose;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (keys[mid].time <= t) lo = mid;
		else hi = mid;
	}
	const k0 = keys[lo];
	const k1 = keys[hi];
	const u = (t - k0.time) / (k1.time - k0.time);
	const out = { ...k0.pose };
	for (const c of CHANNELS) out[c] = k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
	return out;
}

/** The largest distance, in rig units, between where two affines put a card's corners. */
export function cornerError(w: Affine, ref: Affine, card: Card): number {
	let e = 0;
	for (const px of [card.x0, card.x1])
		for (const py of [-card.h, card.h]) {
			const dx = w.a * px + w.b * py + w.x - (ref.a * px + ref.b * py + ref.x);
			const dy = w.c * px + w.d * py + w.y - (ref.c * px + ref.d * py + ref.y);
			const d = Math.hypot(dx, dy);
			e = Number.isNaN(d) ? Infinity : Math.max(e, d);
		}
	return e;
}
const cardOf = (b: Bone3d): Card => {
	if (b.card) return b.card;
	const l = Math.max(b.length ?? 0, 1);
	return { x0: 0, x1: l, h: l / 4 };
};
const cardExtent = (card: Card): number =>
	Math.hypot(Math.max(Math.abs(card.x0), Math.abs(card.x1)), card.h);

// ── Which bones, and what a clip may not do ─────────────────────────────────────────────────────

interface Plan {
	bones: Map<string, Bone3d>;
	motion: Map<string, Motion>;
	/** Bones the bake keys, in rig order. */
	baked: string[];
	/** The baked bones and every 2D ancestor of one: what their played pose depends on. */
	carried: Set<string>;
}

function planOf(rig: Rig3d, clip: Clip3d): Plan {
	const bones = new Map(rig.bones.map((b) => [b.name, b]));
	const motion = motionsOf(clip, false);
	const moves3d = (n: string): boolean => {
		return (
			Boolean(motion.get(n)?.orient) || rig.slots.some((s) => s.bone === n && s.drawings?.length)
		);
	};
	const animated = (name: string): boolean => {
		for (let b = bones.get(name); b; b = bones.get(b.follow ?? b.parent ?? ''))
			if (b.follow || moves3d(b.name)) return true;
		return false;
	};
	// Every bone at or under a bone keyed in 3D (`orient`) is baked, and every follower (it hangs from one
	// bone and is drawn on another, which only the bake can key) and what hangs from it; the rest keep
	// their keys.
	const baked = rig.bones.filter((b) => animated(b.name)).map((b) => b.name);
	const carried = new Set<string>();
	for (const name of baked)
		for (let b = bones.get(name); b; b = bones.get(b.parent ?? '')) carried.add(b.name);
	return { bones, motion, baked, carried };
}

const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/**
 * Why a rig and its 3D clip cannot be baked, or `[]`. Besides malformed data: the setup must be
 * flat; a baked bone, and every bone it hangs from, must compose as Inherit.Normal with no setup
 * shear; and none may carry a constraint at a non-zero mix during the clip — a constraint writes
 * the world after the timelines and would overwrite the bake (design §4.6).
 */
export function rig2p5dProblems(rig: Rig3d, clip: Clip3d): string[] {
	const problems: string[] = [];
	const at = new Map<string, number>();
	rig.bones.forEach((b, i) => {
		if (at.has(b.name)) problems.push(`bone ${b.name} is listed twice`);
		at.set(b.name, i);
	});
	rig.bones.forEach((b, i) => {
		for (const [link, name] of [
			['parent', b.parent],
			['follow', b.follow],
		] as const) {
			if (name === undefined) continue;
			const j = at.get(name);
			if (j === undefined) problems.push(`bone ${b.name}: its ${link} ${name} is missing`);
			else if (j >= i) problems.push(`bone ${b.name}: listed before its ${link} ${name}`);
		}
		if (b.follow && clip.bones[b.name])
			problems.push(`bone ${b.name} follows ${b.follow}: a follower takes no keys of its own`);
	});
	for (const [field, value, least] of [
		['tolerance', rig.tolerance, Number.MIN_VALUE],
		['floor', rig.floor, 0],
		['hysteresis', rig.hysteresis, 0],
	] as const)
		if (value !== undefined && !(finite(value) && value >= least))
			problems.push(`the rig's ${field} must be a number ${least ? 'above' : 'of at least'} 0`);
	const turnaround = rig.turnaround;
	if (turnaround !== undefined && turnaround !== 'side' && turnaround !== 'full')
		problems.push(`the rig's turnaround must be 'side' or 'full'`);
	const withDrawings = new Set<string>();
	for (const s of rig.slots) {
		if (!at.has(s.bone)) problems.push(`slot ${s.name}: its bone ${s.bone} is missing`);
		if (!s.drawings?.length) continue;
		if (withDrawings.has(s.bone))
			problems.push(`slot ${s.name}: bone ${s.bone} already turns another slot's drawings`);
		withDrawings.add(s.bone);
		const turns = s.drawings.map((d) => d.turn);
		if (!turns.every((t) => finite(t) && t > -180 && t <= 180))
			problems.push(`slot ${s.name}: a drawing's turn must be a number in (−180°, 180°]`);
		const back = turns.some((t) => Math.abs(t) > 90);
		if (turnaround === undefined)
			problems.push(
				`slot ${s.name} has drawings by angle: choose the rig's turnaround (side or full) first`,
			);
		else if (turnaround === 'side' && back)
			problems.push(`slot ${s.name}: a back drawing (past ±90°) needs a full turnaround`);
		else if (turnaround === 'full' && !back)
			problems.push(`slot ${s.name}: a full turnaround needs back drawings (past ±90°)`);
	}
	if (!finite(clip.duration) || clip.duration <= 0)
		problems.push(`clip ${clip.name}: its duration must be a positive number`);
	const keyProblems = (where: string, keys: Keyed[], values: (k: Keyed) => unknown[]) => {
		const quat = where.endsWith('.orient');
		let last = 0;
		keys.forEach((k, i) => {
			const t = k.time ?? 0;
			if (!finite(t) || t < 0 || t > clip.duration)
				problems.push(`${where}: key ${i} is outside the clip (time ${t})`);
			else if (t < last) problems.push(`${where}: key ${i} is before the key ahead of it`);
			else last = t;
			if (!values(k).every(finite))
				problems.push(`${where}: key ${i} has a value that is not a number`);
			const c = k.curve;
			if (
				c !== undefined &&
				c !== 'stepped' &&
				!(Array.isArray(c) && c.length >= (quat ? 4 : values(k).length * 4) && c.every(finite))
			)
				problems.push(`${where}: key ${i} has a malformed curve`);
		});
	};
	for (const [name, keys] of Object.entries(clip.bones)) {
		if (!at.has(name)) {
			problems.push(`clip ${clip.name}: bone ${name} is not in the rig`);
			continue;
		}
		if (keys.orient?.length && keys.rotate?.length)
			problems.push(`${name}: keys \`orient\` or \`rotate\`, not both`);
		keyProblems(`${name}.orient`, keys.orient ?? [], (k) => (k as QuatKey).value ?? [NaN]);
		for (const [i, k] of (keys.orient ?? []).entries())
			if (!(Array.isArray(k.value) && k.value.length === 4 && Math.hypot(...k.value) > 1e-9))
				problems.push(`${name}.orient: key ${i} is not a quaternion`);
		for (const ch of ['rotate', 'depth'] as const)
			keyProblems(`${name}.${ch}`, keys[ch] ?? [], (k) => [(k as Key1).value ?? 0]);
		for (const ch of ['translate', 'scale'] as const)
			keyProblems(`${name}.${ch}`, keys[ch] ?? [], (k) => [(k as Key2).x ?? 0, (k as Key2).y ?? 0]);
	}
	if (problems.length) return problems;

	const { bones, carried } = planOf(rig, clip);
	for (const name of carried) {
		const b = bones.get(name);
		if (!b) continue;
		if ((b.inherit ?? 'normal') !== 'normal')
			problems.push(`bone ${name}: a baked bone and its parents must inherit normally`);
		if ((b.shearX ?? 0) !== 0 || (b.shearY ?? 0) !== 0)
			problems.push(`bone ${name}: a baked bone and its parents carry no setup shear`);
		if ((b.scaleX ?? 1) === 0 || (b.scaleY ?? 1) === 0)
			problems.push(`bone ${name}: a baked bone and its parents need a non-zero setup scale`);
	}
	for (const c of rig.constraints ?? []) {
		const hit = c.bones.find((n) => carried.has(n));
		if (hit === undefined) continue;
		const keys = clip.constraints?.[c.name];
		const live = keys?.length
			? keys.some((k) => k.mix !== 0) || ((keys[0].time ?? 0) > 0 && c.mix !== 0)
			: c.mix !== 0;
		if (live)
			problems.push(
				`constraint ${c.name} acts on ${hit}, which clip ${clip.name} bakes: a constraint writes after the timelines and would overwrite the bake (key its mix to 0 for the clip)`,
			);
	}
	return problems;
}

// ── The bake ────────────────────────────────────────────────────────────────────────────────────

/** Bake a 3D clip into 4.2 timelines. Throws on a rig or clip `rig2p5dProblems` refuses. */
export function bake2p5d(rig: Rig3d, clip: Clip3d, options: Partial<BakeOptions> = {}): Bake2p5d {
	const problems = rig2p5dProblems(rig, clip);
	if (problems.length) throw new Error(`rig2p5d: ${problems.join('; ')}`);
	const own: Partial<BakeOptions> = {};
	if (rig.tolerance !== undefined) own.tolerance = rig.tolerance;
	if (rig.floor !== undefined) own.floor = rig.floor;
	if (rig.hysteresis !== undefined) own.hysteresis = rig.hysteresis;
	const o: BakeOptions = { ...BAKE_DEFAULTS, ...own, ...options };
	const D = clip.duration;
	const { bones, motion, baked } = planOf(rig, clip);
	const bone = (name: string): Bone3d => {
		const b = bones.get(name);
		if (!b) throw new Error(`rig2p5d: no bone ${name}`);
		return b;
	};
	const frame = (w: Map<string, Frame3d>, name: string): Frame3d => {
		const f = w.get(name);
		if (!f) throw new Error(`rig2p5d: no frame for ${name}`);
		return f;
	};
	/** The passthrough bones' 2D keys as the runtime holds them. */
	const played = motionsOf(clip, true);

	const N = Math.ceil(D * o.checkHz - 1e-9);
	const every = Math.max(1, Math.round(o.checkHz / o.denseHz));
	const grid = Array.from({ length: N + 1 }, (_, i) => Math.min(D, i / o.checkHz));
	const dense = grid.filter((_, i) => i % every === 0);

	// Drawings by angle: each slot shows the drawing that faces the viewer best, chosen on the dense
	// grid, swapped only past the margin and after the hold. On a side turnaround a drawing may face
	// the viewer from behind too (shown mirrored, as a card's back is), its front preferred on a tie.
	const full = rig.turnaround === 'full';
	const swaps = new Map<string, { slot: string; sched: { time: number; drawing: Drawing }[] }>();
	for (const slot of rig.slots) {
		const drawings = slot.drawings;
		if (!drawings?.length) continue;
		const margin = slot.margin ?? o.margin;
		const hold = slot.hold ?? o.hold;
		const sched: { time: number; drawing: Drawing }[] = [];
		for (const t of dense) {
			// How squarely a drawing faces the viewer once its card is turned back by the drawing's turn.
			const w = frame(world3d(rig, motion, t), slot.bone);
			const nz = (d: Drawing) => {
				const n = normalZ(mm(w.m, ry(d.turn)));
				return full ? n : Math.abs(n) + (n > 0 ? 1e-9 : 0);
			};
			const best = drawings.reduce((x, y) => (nz(y) > nz(x) ? y : x));
			const last = sched[sched.length - 1];
			if (!last) sched.push({ time: held(t), drawing: best });
			else if (
				best !== last.drawing &&
				nz(best) > nz(last.drawing) + margin &&
				t - last.time >= hold
			)
				sched.push({ time: held(t), drawing: best });
		}
		swaps.set(slot.bone, { slot: slot.name, sched });
	}
	const turns = (name: string, t: number): number => {
		const s = swaps.get(name);
		if (!s) return 0;
		let d = s.sched[0].drawing;
		for (const e of s.sched) if (e.time <= t) d = e.drawing;
		return d.turn;
	};
	const worlds = (t: number) => world3d(rig, motion, t, (name) => turns(name, t));
	const floorOf = (name: string): number => o.floor / cardExtent(cardOf(bone(name)));

	// Flips: where a card's projection changes side (its determinant's sign), found to 1e-9 s.
	const gridWorlds = grid.map((t) => worlds(t));
	const flips: Record<string, number[]> = {};
	for (const name of baked) {
		flips[name] = [];
		for (let i = 1; i <= N; i++) {
			const s0 = facing(project(frame(gridWorlds[i - 1], name)));
			if (s0 === facing(project(frame(gridWorlds[i], name)))) continue;
			let lo = grid[i - 1];
			let hi = grid[i];
			while (hi - lo > 1e-9) {
				const mid = (lo + hi) / 2;
				if (facing(project(frame(worlds(mid), name))) === s0) lo = mid;
				else hi = mid;
			}
			flips[name].push(hi);
		}
	}
	const swapTimes = (name: string): number[] =>
		swaps
			.get(name)
			?.sched.slice(1)
			.map((e) => e.time) ?? [];
	/** Where a channel jumps on this bone or anything it is drawn from (2D parents, followed bones). */
	const jumps = (name: string): number[] => {
		const seen = new Set<string>();
		const out: number[] = [];
		const walk = (n: string | undefined) => {
			if (n === undefined || seen.has(n)) return;
			seen.add(n);
			const m = motion.get(n);
			if (m) out.push(...jumpTimesOf(m));
			walk(bone(n).parent);
			walk(bone(n).follow);
		};
		walk(name);
		return out;
	};
	const targetOf = (name: string, w: Map<string, Frame3d>): Affine =>
		floored(project(frame(w, name)), floorOf(name));

	// The 2D setup pose: as authored, except a follower's, which is where its 3D setup projects.
	const setup2d = new Map<string, { pose: Pose2; world: Affine }>();
	const setupWorld = world3d(rig, new Map(), 0);
	for (const b of rig.bones) {
		const own: Pose2 = {
			x: b.x ?? 0,
			y: b.y ?? 0,
			rotation: b.rotate ?? 0,
			scaleX: b.scaleX ?? 1,
			scaleY: b.scaleY ?? 1,
			shearY: 0,
		};
		const parent = b.parent ? (setup2d.get(b.parent)?.world ?? null) : null;
		let pose = own;
		if (b.follow) {
			const l = localOf(parent, project(frame(setupWorld, b.name)), own, true);
			pose = {
				x: store(l.x),
				y: store(l.y),
				rotation: store(l.rotation),
				scaleX: store(l.scaleX),
				scaleY: store(l.scaleY),
				shearY: 0,
			};
		}
		setup2d.set(b.name, { pose, world: compose(parent, pose) });
	}
	const setupOf = (name: string): Pose2 => {
		const s = setup2d.get(name);
		if (!s) throw new Error(`rig2p5d: no setup for ${name}`);
		return s.pose;
	};
	const result = new Map<string, { keys: BakedKey[]; steps: number[]; checks: number[] }>();
	/** A bone's 2D local as the runtime plays it: its baked keys, else its own 2D keys on its setup. */
	const localPlayed = (name: string, t: number): Pose2 => {
		const r = result.get(name);
		if (r) return poseAt(r.keys, t);
		const s = setupOf(name);
		const m = played.get(name);
		if (!m) return s;
		return {
			x: s.x + valueAt(m.x, t, 0),
			y: s.y + valueAt(m.y, t, 0),
			rotation: s.rotation + valueAt(m.rotate, t, 0),
			scaleX: s.scaleX * valueAt(m.scaleX, t, 1),
			scaleY: s.scaleY * valueAt(m.scaleY, t, 1),
			shearY: 0,
		};
	};
	/** A bone's 2D world as the runtime plays it, composed from the root. */
	const playedAt = (name: string, t: number): Affine => {
		const p = bone(name).parent;
		return compose(p ? playedAt(p, t) : null, localPlayed(name, t));
	};
	const report: BakeReport = { bones: {}, flips, timelineKeys: {}, unmet: [] };

	for (const name of baked) {
		const b = bone(name);
		const card = cardOf(b);
		const setup = setupOf(name);
		const floor = floorOf(name);
		const parentAt = (t: number): Affine | null => (b.parent ? playedAt(b.parent, t) : null);

		// Where the error is measured: the check grid, the parent's checks, key times and the middle of
		// each of its key runs (where its interpolation error peaks, which this bone's keys must put
		// back), subdivided down to 1 µs wherever this card's target or its parent AS PLAYED thins out
		// (σ2 / σ1) by more than THIN_STEP between neighbours: this bone's locals grow like 1 / that.
		const ct: number[] = [];
		const cp: Array<Affine | null> = [];
		const cg: Affine[] = [];
		interface Check {
			t: number;
			p: Affine | null;
			g: Affine;
			r: number[];
		}
		const point = (t: number, w = worlds(t)): Check => {
			const p = parentAt(t);
			const g = targetOf(name, w);
			return { t, p, g, r: [p ? thinness(p) : 1, thinness(g)] };
		};
		const wide = (a: Check, z: Check): boolean =>
			a.r.some((x, k) => {
				const lo = Math.max(Math.min(x, z.r[k]), 1e-9);
				return Math.max(x, z.r[k]) / lo > THIN_STEP;
			});
		const subdivide = (a: Check, z: Check): void => {
			if (z.t - a.t <= 1e-6 || Math.min(...a.r, ...z.r) >= 0.5) return;
			const m = point((a.t + z.t) / 2);
			if (!wide(a, m) && !wide(m, z)) return;
			subdivide(a, m);
			ct.push(m.t);
			cp.push(m.p);
			cg.push(m.g);
			subdivide(m, z);
		};
		const pr = b.parent ? result.get(b.parent) : undefined;
		// Steps: where this card or its parent jumps — its own flips, drawing swaps and stepped keys, and
		// every step of its parent's (the parent's played world jumps there).
		const own = [...flips[name], ...swapTimes(name), ...jumps(name)];
		const inherited = pr?.steps ?? [];
		const steps = o.steps
			? [...new Set([...own, ...inherited])].filter((t) => t > 0 && t <= D).sort((x, y) => x - y)
			: [];
		// Steps closer than their two limits can be read apart (or than the file's float32 times can
		// tell apart) are one: keyed after the last and before the first.
		const slop = (t: number): number => Math.abs(held(t) - t);
		const clusters: { lo: number; hi: number }[] = [];
		for (const t of steps) {
			const c = clusters[clusters.length - 1];
			if (c && t - c.hi <= 2 * LIMIT + slop(t) + slop(c.hi)) c.hi = t;
			else clusters.push({ lo: t, hi: t });
		}
		/**
		 * Whether `t` lies inside a step: between its first and last time, and the times the file
		 * holds them at (float32). There the runtime shows one side while the 3D pose shows the other,
		 * whatever the keys.
		 */
		const blind = (t: number): boolean =>
			clusters.some(
				(c) =>
					t >= Math.min(c.lo, held(c.lo)) - SAME_STEP &&
					t <= Math.max(c.hi, held(c.hi)) + SAME_STEP,
			);

		const base = new Set(grid);
		if (pr) {
			for (const t of pr.checks) base.add(t);
			pr.keys.forEach((k, i) => {
				base.add(k.time);
				if (i > 0) base.add((k.time + pr.keys[i - 1].time) / 2);
			});
		}
		const onGrid = new Map(grid.map((t, i) => [t, gridWorlds[i]]));
		let last: Check | null = null;
		for (const t of [...base].filter((x) => x >= 0 && x <= D).sort((x, y) => x - y)) {
			const at = point(t, onGrid.get(t));
			if (last) subdivide(last, at);
			ct.push(at.t);
			cp.push(at.p);
			cg.push(at.g);
			last = at;
		}
		const seen = ct.map((t) => !blind(t));
		const checkAfter = (t: number): number => {
			let lo = 0;
			let hi = ct.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (ct[mid] <= t) lo = mid + 1;
				else hi = mid;
			}
			return lo;
		};

		// One key: the local that puts the bone on its target under its parent AS PLAYED, so whatever
		// the parent's keys left, this bone's keys put it back. Angles near the previous key's.
		let ref = setup;
		const keyAt = (time: number, at: number, seg: number): BakedKey => {
			const w = worlds(at);
			const l =
				o.project === 'local'
					? localOf(
							null,
							project(b.parent ? relative(frame(w, b.parent), frame(w, name)) : frame(w, name)),
							ref,
							o.shear,
						)
					: localOf(parentAt(at), targetOf(name, w), ref, o.shear);
			ref = l;
			return { time: held(time), seg, pose: asPlayed(setup, l) };
		};

		const authored = new Set<number>();
		for (let n: string | undefined = name; n; n = bone(n).parent) {
			const m = motion.get(n);
			if (m) for (const t of keyTimesOf(m)) authored.add(t);
		}
		const keys: BakedKey[] = [];
		for (let s = 0; s <= clusters.length; s++) {
			// A run between steps: its first key on the step before (read just after it), its last on the
			// step after (read just before it), so each step is two keys at one time.
			const from = clusters[s - 1];
			const to = clusters[s];
			const t0 = from ? held(from.hi) : 0;
			const t1 = held(to ? to.hi : D);
			const first = from ? Math.max(from.hi, t0) + LIMIT : 0;
			const last = to ? Math.min(to.lo, held(to.lo)) - LIMIT : D;
			// Nothing is interpolated across a step, so the run after it may start on any angle branch:
			// the one nearest the setup keeps shearY, which a crossfade mixes linearly, within a turn.
			if (o.wrap) ref = setup;
			keys.push(keyAt(t0, first, s));
			const inner = (o.dense ? dense : [...authored]).filter((t) => t > first && t < last);
			for (const t of inner.sort((x, y) => x - y)) keys.push(keyAt(t, t, s));
			keys.push(keyAt(t1, last, s));
		}

		// A run k0 → k1 is as bad as its worst corner error at the checks between — and unusable if
		// this card, as played, thins below half its floor or shows its other side, because its
		// children would then need locals past any bound.
		const runError = (k0: BakedKey, k1: BakedKey, t: number, p: Affine | null, g: Affine) => {
			const u = (t - k0.time) / (k1.time - k0.time);
			const l = { ...k0.pose };
			for (const c of CHANNELS) l[c] = k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
			const w = compose(p, l);
			const e = cornerError(w, g, card);
			if (floor > 0 && (facing(w) !== facing(g) || thinness(w) < floor / 2)) return Infinity;
			return Number.isNaN(e) ? Infinity : e;
		};
		const worstBetween = (k0: BakedKey, k1: BakedKey, quarters = false) => {
			let worst = -1;
			let at = 0;
			for (let i = checkAfter(k0.time); i < ct.length && ct[i] < k1.time; i++) {
				if (!seen[i]) continue;
				const e = runError(k0, k1, ct[i], cp[i], cg[i]);
				if (e > worst) [worst, at] = [e, ct[i]];
			}
			if (quarters)
				for (const u of [0.25, 0.5, 0.75]) {
					const t = k0.time + (k1.time - k0.time) * u;
					if (blind(t)) continue;
					const e = runError(k0, k1, t, parentAt(t), targetOf(name, worlds(t)));
					if (e > worst) [worst, at] = [e, t];
				}
			return { worst, at };
		};

		// Douglas–Peucker inside each run between steps, on that error.
		const keep = new Array<boolean>(keys.length).fill(true);
		if (o.dense && o.reduce) {
			const rdp = (i: number, j: number): void => {
				if (j - i < 2) return;
				const { worst, at } = worstBetween(keys[i], keys[j]);
				if (worst <= o.tolerance) {
					for (let k = i + 1; k < j; k++) keep[k] = false;
					return;
				}
				let split = i + 1;
				for (let k = i + 1; k < j; k++)
					if (Math.abs(keys[k].time - at) < Math.abs(keys[split].time - at)) split = k;
				rdp(i, split);
				rdp(split, j);
			};
			let start = 0;
			for (let k = 1; k <= keys.length; k++)
				if (k === keys.length || keys[k].seg !== keys[start].seg) {
					rdp(start, k - 1);
					start = k;
				}
		}
		let kept = keys.filter((_, k) => keep[k]);
		let unmet = 0;
		if (o.dense) {
			// Where the kept keys (even every dense one) leave more than the tolerance, key the worst
			// point — at most as many new keys as the dense bake had; past that the run is reported.
			const refined = [kept[0]];
			let budget = keys.length;
			const refine = (k0: BakedKey, k1: BakedKey, depth: number): void => {
				const { worst, at } = worstBetween(k0, k1, true);
				if (worst > o.tolerance) {
					let mid: BakedKey | null = null;
					if (depth < 24 && k1.time - k0.time > 1e-6 && budget > 0) {
						budget--;
						ref = k0.pose;
						mid = keyAt(at, at, k0.seg);
					}
					// A key the file's float32 times cannot place between the two is no key either.
					if (mid && mid.time > k0.time && mid.time < k1.time) {
						refine(k0, mid, depth + 1);
						refine(mid, k1, depth + 1);
						return;
					}
					unmet++;
					report.unmet.push({ bone: name, from: k0.time, to: k1.time, error: worst });
				}
				refined.push(k1);
			};
			for (let k = 1; k < kept.length; k++) {
				if (kept[k].time === kept[k - 1].time) refined.push(kept[k]);
				else refine(kept[k - 1], kept[k], 0);
			}
			kept = refined;
		}
		result.set(name, { keys: kept, steps, checks: ct });
		report.bones[name] = { keys: kept.length, dense: keys.length, steps: clusters.length, unmet };
	}

	// Draw order: each card's centre depth on the dense grid; two cards swap only past the hysteresis.
	const slotNames = rig.slots.map((s) => s.name);
	const depthOf = (w: Map<string, Frame3d>, slot: Slot3d): number => {
		const c = cardOf(bone(slot.bone));
		const bw = frame(w, slot.bone);
		return bw.m[6] * ((c.x0 + c.x1) / 2) + bw.o[2];
	};
	const orderKeys: DrawOrderKey[] = [];
	const orderSched: { time: number; order: number[] }[] = [];
	let order = slotNames.map((_, i) => i);
	for (let i = 0; i <= N; i += every) {
		// A card's depth is its bone's as the clip moves it, before any drawing is turned to face.
		const w = world3d(rig, motion, grid[i]);
		const z = rig.slots.map((s) => depthOf(w, s));
		const next = [...order];
		for (let moved = true; moved;) {
			moved = false;
			for (let k = 0; k + 1 < next.length; k++)
				if (z[next[k]] > z[next[k + 1]] + o.hysteresis) {
					[next[k], next[k + 1]] = [next[k + 1], next[k]];
					moved = true;
				}
		}
		if (i === 0 || next.join() !== order.join()) {
			order = next;
			orderSched.push({ time: held(grid[i]), order: [...order] });
			if (i > 0 || order.some((s, k) => s !== k))
				orderKeys.push({
					time: store(grid[i]),
					offsets: order
						.map((slot, place) => ({ slot, place }))
						.sort((x, y) => x.slot - y.slot)
						.filter((e) => e.place !== e.slot)
						.map((e) => ({ slot: slotNames[e.slot], offset: e.place - e.slot })),
				});
		}
	}

	// The timelines: every baked bone's (a constant channel dropped), its angles brought back into
	// (−180°, 180°] by a second key at the clip's end; every other bone's own 2D keys, as they are.
	const bonesOut: Record<string, BakedBoneTimelines> = {};
	for (const [n, { keys }] of result) {
		const setup = setupOf(n);
		const offset = (k: BakedKey, c: PoseChannel): number =>
			c === 'scaleX' || c === 'scaleY' ? k.pose[c] / setup[c] : k.pose[c] - setup[c];
		const rest = (c: PoseChannel): number => (c === 'scaleX' || c === 'scaleY' ? 1 : 0);
		const differs = (c: PoseChannel) => keys.some((k) => Math.abs(offset(k, c) - rest(c)) > 1e-9);
		const value = (k: BakedKey, c: PoseChannel) => store(offset(k, c));
		const angle = (c: PoseChannel): Key1[] => {
			const out = keys.map((k) => ({ time: store(k.time), value: value(k, c) }));
			const end = out[out.length - 1];
			const wrapped = store(wrap180(end.value));
			if (o.wrap && wrapped !== end.value) out.push({ time: end.time, value: wrapped });
			return out;
		};
		const t: BakedBoneTimelines = {};
		if (differs('rotation')) t.rotate = angle('rotation');
		if (differs('x') || differs('y'))
			t.translate = keys.map((k) => ({ time: store(k.time), x: value(k, 'x'), y: value(k, 'y') }));
		if (differs('scaleX') || differs('scaleY'))
			t.scale = keys.map((k) => ({
				time: store(k.time),
				x: value(k, 'scaleX'),
				y: value(k, 'scaleY'),
			}));
		if (differs('shearY')) t.sheary = angle('shearY');
		bonesOut[n] = t;
		report.timelineKeys[n] = Object.values(t).reduce(
			(sum: number, ks: unknown[]) => sum + ks.length,
			0,
		);
	}
	const copy1 = (ks: Key1[]): Key1[] =>
		ks.map((k) => ({
			time: k.time ?? 0,
			value: k.value ?? 0,
			...(k.curve ? { curve: k.curve } : {}),
		}));
	const copy2 = (ks: Key2[], rest: number): Key2[] =>
		ks.map((k) => ({
			time: k.time ?? 0,
			x: k.x ?? rest,
			y: k.y ?? rest,
			...(k.curve ? { curve: k.curve } : {}),
		}));
	for (const [n, keys] of Object.entries(clip.bones)) {
		if (result.has(n)) continue;
		const t: BakedBoneTimelines = {};
		if (keys.rotate?.length) t.rotate = copy1(keys.rotate);
		if (keys.translate?.length) t.translate = copy2(keys.translate, 0);
		if (keys.scale?.length) t.scale = copy2(keys.scale, 1);
		if (Object.keys(t).length) bonesOut[n] = t;
	}
	const animation: BakedAnimation = { bones: bonesOut };
	if (orderKeys.length) animation.drawOrder = orderKeys;
	const slotsOut: NonNullable<BakedAnimation['slots']> = {};
	const drawings: Record<string, DrawingKey[]> = {};
	for (const { slot, sched } of swaps.values()) {
		slotsOut[slot] = {
			attachment: sched.map((e) => ({ time: store(e.time), name: e.drawing.attachment })),
		};
		drawings[slot] = sched.map((e) => ({
			time: e.time,
			attachment: e.drawing.attachment,
			turn: e.drawing.turn,
		}));
	}
	if (Object.keys(slotsOut).length) animation.slots = slotsOut;

	const setup: Record<string, Setup2d> = {};
	for (const b of rig.bones) {
		const { x, y, rotation, scaleX, scaleY } = setupOf(b.name);
		setup[b.name] = { x, y, rotation, scaleX, scaleY };
	}
	return {
		animation,
		setup,
		baked,
		report,
		drawings,
		orderAt: (t: number) => {
			let cur = orderSched[0].order;
			for (const e of orderSched) if (e.time <= t) cur = e.order;
			return cur.map((i) => slotNames[i]);
		},
	};
}
