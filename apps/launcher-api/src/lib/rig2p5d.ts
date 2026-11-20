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
 *   4. reduced to as few keys as hold the WORLD error of its card's corners, against what the runtime
 *      will play, within the tolerance: each run between two keys is the longest whose 4.2 bezier,
 *      fitted to the target and played as engine-rig plays it (nine samples, linear between), stays
 *      within it; then refined wherever a run still misses (capped; a run past the cap is reported,
 *      never silently kept). The error is measured on a check set that holds the grid, the parent's
 *      checks, key times, key-run middles and curve samples, subdivided wherever this card or its
 *      parent as played thins out. A run whose played card thins below half its floor or shows its
 *      other side is refused (its children could not follow).
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
/** The largest change in a card's floored thinness (σ2 / σ1) between two check points… */
const THIN_STEP = 1.1;
/** …below this thinness (of the card or its parent). */
const THIN = 0.5;
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
	/**
	 * Slots sharing a layer move in the draw order as one, at their mean depth, in their setup order:
	 * a face's parts or a hand's fingers, whose own depths differ but which need no order of their own.
	 * A layer's slots are next to each other in the setup order.
	 */
	layer?: string;
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
	/** Bezier runs between baked keys; off, every run is linear. */
	curves: boolean;
	/** Where a run's error is measured: the card as drawn ('world'), or under its own local pose alone. */
	measure: 'world' | 'local';
	/** A curve's handles written as values (4.2), or as progress 0 → 1 (as `orient` keys hold theirs). */
	curveSpace: 'value' | 'progress';
	/** A step written as its two keys at one time; off, only the key after it. */
	stepPairs: boolean;
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
	curves: true,
	measure: 'world',
	curveSpace: 'value',
	stepPairs: true,
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

/** A bone's keyed values at `t`, as the bake reads them (its setup's where a channel has no key). */
export interface BoneValues3d {
	orient: Quat;
	rotate: number;
	depth: number;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
}

/** What a bone's keys in a 3D clip give at `t`: the values its author sees and edits (§9). */
export function boneKeysAt(keys: BoneKeys3d, t: number): BoneValues3d {
	const m = motionOf(keys, false);
	return {
		orient: orientAt(m.orient, t),
		rotate: valueAt(m.rotate, t, 0),
		depth: valueAt(m.depth, t, 0),
		x: valueAt(m.x, t, 0),
		y: valueAt(m.y, t, 0),
		scaleX: valueAt(m.scaleX, t, 1),
		scaleY: valueAt(m.scaleY, t, 1),
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

/**
 * `orientOf` for a bone whose length runs `along` degrees from its x axis (a template's bones keep x
 * at 0° and their child below them): `tilt` tips its length toward the viewer and `twist` turns it
 * about its length, whichever way it lies in its own frame. The same turn from the setup, read in
 * the bone's terms; with `along` 0 it is `orientOf`.
 */
export const orientAlong = (rotate: number, tilt: number, twist: number, along: number): Quat =>
	qmul(qmul(qaxis(0, 0, 1, along), orientOf(rotate, tilt, twist)), qaxis(0, 0, 1, -along));

/** `anglesOf` in the terms of a bone whose length runs `along` degrees from its x axis (`orientAlong`). */
export const anglesAlong = (q: Quat, along: number, ref?: Angles): Angles =>
	anglesOf(qmul(qmul(qaxis(0, 0, 1, -along), q), qaxis(0, 0, 1, along)), ref);

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
		const local = local3d(b, motion.get(b.name), t, spin);
		out.set(b.name, b.parent ? compose3(get(b.parent), local) : local);
	}
	return out;
}

/** A bone's 3D local frame at `t`: translate (x, y, depth), then its turn, then its scale. */
function local3d(b: Bone3d, k: Motion | undefined, t: number, spin: number): Frame3d {
	const turned = k?.orient ? qmat(orientAt(k.orient, t)) : rz(valueAt(k?.rotate ?? null, t, 0));
	const m = mm(rz(b.rotate ?? 0), turned);
	const sx = (b.scaleX ?? 1) * valueAt(k?.scaleX ?? null, t, 1);
	const sy = (b.scaleY ?? 1) * valueAt(k?.scaleY ?? null, t, 1);
	for (let r = 0; r < 3; r++) {
		m[r * 3] *= sx;
		m[r * 3 + 1] *= sy;
	}
	return {
		m: spin ? mm(m, ry(spin)) : m,
		o: [
			(b.x ?? 0) + valueAt(k?.x ?? null, t, 0),
			(b.y ?? 0) + valueAt(k?.y ?? null, t, 0),
			(b.depth ?? 0) + valueAt(k?.depth ?? null, t, 0),
		],
	};
}

/**
 * One bone's 3D world frame at `t`, as `world3d` gives it, from its own chain alone (its 2D parents
 * and followed bones): a bone's checks need only that, and a rig has many bones.
 */
function boneWorld3d(
	bones: Map<string, Bone3d>,
	motion: Map<string, Motion>,
	t: number,
	turn: (bone: string) => number,
	name: string,
	memo = new Map<string, Frame3d>(),
): Frame3d {
	const got = memo.get(name);
	if (got) return got;
	const b = bones.get(name);
	if (!b) throw new Error(`rig2p5d: no bone ${name}`);
	const spin = turn(name);
	let f: Frame3d;
	if (b.follow) {
		const w = boneWorld3d(bones, motion, t, turn, b.follow, memo);
		f = spin ? { m: mm(w.m, ry(spin)), o: w.o } : w;
	} else {
		const local = local3d(b, motion.get(name), t, spin);
		f = b.parent ? compose3(boneWorld3d(bones, motion, t, turn, b.parent, memo), local) : local;
	}
	memo.set(name, f);
	return f;
}

const motionsOf = (clip: Clip3d, stored: boolean): Map<string, Motion> =>
	new Map(Object.entries(clip.bones).map(([name, keys]) => [name, motionOf(keys, stored)]));

/** Every bone's 3D world frame at `t` in a 3D clip (no drawing turned back): what the bake projects. */
export function pose3d(rig: Rig3d, clip: Clip3d, t: number): Map<string, Frame3d> {
	return world3d(rig, motionsOf(clip, false), t);
}

// ── Baked transitions (P7, §7) ──────────────────────────────────────────────────────────────────

/** A transition clip's name: what a game plays between `from` and `to`. */
export const transitionName = (from: string, to: string): string => `${from}_to_${to}`;

export interface TransitionOptions {
	// The gate switches these to show each step is needed (its mutation checks).
	/** Each 3D bone's turn: slerped, or its quaternion lerped component by component. */
	spin: 'slerp' | 'lerp';
	/** Where the transition starts: the from-clip's 3D pose at its time, or the setup. */
	start: 'clip' | 'setup';
}

export const TRANSITION_DEFAULTS: TransitionOptions = { spin: 'slerp', start: 'clip' };

const turnFrom = (m: Motion | undefined, t: number): Quat =>
	m?.orient ? orientAt(m.orient, t) : qaxis(0, 0, 1, valueAt(m?.rotate ?? null, t, 0));

function mixAt(keys: MixKey[] | undefined, t: number, rest: number): number {
	if (!keys?.length || t < (keys[0].time ?? 0)) return rest;
	let i = 0;
	while (i + 1 < keys.length && (keys[i + 1].time ?? 0) <= t) i++;
	const k0 = keys[i];
	const k1 = keys[i + 1];
	if (!k1) return k0.mix;
	const t0 = k0.time ?? 0;
	const t1 = k1.time ?? 0;
	return t1 > t0 ? k0.mix + ((k1.mix - k0.mix) * (t - t0)) / (t1 - t0) : k1.mix;
}

/**
 * A transition as a 3D clip of its own, baked like any other: from clip `from`'s 3D pose at `at`
 * to clip `to`'s at its start, over `duration`. Each bone turned in 3D in either clip slerps from
 * one turn to the other along the shorter arc (a 2D `rotate` read as a turn about the view axis); a
 * bone turned only in 2D takes the short way round; depth, translate, scale and constraint mixes
 * blend linearly. Unlike a 2D crossfade it never blends the clips' baked locals, which near an
 * edge-on card are huge (§4.3).
 */
export function transition3d(
	rig: Rig3d,
	from: Clip3d,
	to: Clip3d,
	at: number,
	duration: number,
	name: string,
	options: Partial<TransitionOptions> = {},
): Clip3d {
	const o: TransitionOptions = { ...TRANSITION_DEFAULTS, ...options };
	const a = motionsOf(from, false);
	const b = motionsOf(to, false);
	const startOf = (n: string) => (o.start === 'clip' ? a.get(n) : undefined);
	const line = (v0: number, v1: number): Key1[] => [
		{ time: 0, value: v0 },
		{ time: duration, value: v1 },
	];
	const bones: Record<string, BoneKeys3d> = {};
	for (const { name: n } of rig.bones) {
		const ka = from.bones[n];
		const kb = to.bones[n];
		if (!ka && !kb) continue;
		const ma = startOf(n);
		const mb = b.get(n);
		const has = (k: keyof BoneKeys3d) => Boolean(ka?.[k]?.length || kb?.[k]?.length);
		const keys: BoneKeys3d = {};
		if (has('orient')) {
			const qa = turnFrom(ma, at);
			const qb = turnFrom(mb, 0);
			if (o.spin === 'slerp')
				keys.orient = [
					{ time: 0, value: qa },
					{ time: duration, value: qb },
				];
			else {
				const qc = qdot(qa, qb) < 0 ? (qb.map((v) => -v) as Quat) : qb;
				const steps = Math.max(1, Math.ceil(duration * 120));
				keys.orient = Array.from({ length: steps + 1 }, (_, i) => {
					const u = i / steps;
					return { time: u * duration, value: unit(qa.map((v, j) => v + (qc[j] - v) * u) as Quat) };
				});
			}
		} else if (has('rotate')) {
			const ra = valueAt(ma?.rotate ?? null, at, 0);
			keys.rotate = line(ra, nearest(valueAt(mb?.rotate ?? null, 0, 0), ra));
		}
		if (has('depth'))
			keys.depth = line(valueAt(ma?.depth ?? null, at, 0), valueAt(mb?.depth ?? null, 0, 0));
		for (const [ch, x, y, rest] of [
			['translate', 'x', 'y', 0],
			['scale', 'scaleX', 'scaleY', 1],
		] as const) {
			if (!has(ch)) continue;
			const v = (m: Motion | undefined, c: typeof x | typeof y, t: number) =>
				valueAt(m?.[c] ?? null, t, rest);
			keys[ch] = [
				{ time: 0, x: v(ma, x, at), y: v(ma, y, at) },
				{ time: duration, x: v(mb, x, 0), y: v(mb, y, 0) },
			];
		}
		bones[n] = keys;
	}
	const constraints: Record<string, MixKey[]> = {};
	for (const c of rig.constraints ?? []) {
		const ka = from.constraints?.[c.name];
		const kb = to.constraints?.[c.name];
		if (!ka?.length && !kb?.length) continue;
		constraints[c.name] = [
			{ time: 0, mix: mixAt(o.start === 'clip' ? ka : undefined, at, c.mix) },
			{ time: duration, mix: mixAt(kb, 0, c.mix) },
		];
	}
	return { name, duration, bones, constraints };
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
/** Whether an affine is thinner than `f`; σ1² is at most the sum of squares, so most need no SVD. */
function thinner(A: Affine, f: number): boolean {
	const det = Math.abs(A.a * A.d - A.b * A.c);
	return det < f * (A.a * A.a + A.b * A.b + A.c * A.c + A.d * A.d) && thinness(A) < f;
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

/** What the file stores (7 significant digits, rounded by arithmetic: no string round trip) … */
function store(v: number): number {
	if (v === 0 || !Number.isFinite(v)) return v;
	const e = Math.floor(Math.log10(Math.abs(v))) - 6;
	return e < 0 ? Math.round(v * 10 ** -e) / 10 ** -e : Math.round(v / 10 ** e) * 10 ** e;
}
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

/** Every channel a finite number: none is where a parent is seen exactly edge-on. */
const sound = (l: Pose2): boolean => CHANNELS.every((c) => Number.isFinite(l[c]));

type TimelineName = 'rotate' | 'translate' | 'scale' | 'sheary';
/** The 4.2 bone timelines the bake writes, and the channels each holds (one curve per channel). */
const TIMELINES: Record<TimelineName, PoseChannel[]> = {
	rotate: ['rotation'],
	translate: ['x', 'y'],
	scale: ['scaleX', 'scaleY'],
	sheary: ['shearY'],
};
const scaled = (c: PoseChannel): boolean => c === 'scaleX' || c === 'scaleY';
/** A channel's value as the file stores it: an offset from the setup, or a factor of it for scale… */
const written = (setup: Pose2, c: PoseChannel, v: number): number =>
	store(scaled(c) ? v / setup[c] : v - setup[c]);
/** …and as the runtime plays a stored value. */
const replayed = (setup: Pose2, c: PoseChannel, w: number): number =>
	scaled(c) ? setup[c] * w : setup[c] + w;

/**
 * A run's bezier on some of its channels: the time handles as written, and per channel its value
 * handles as written and the nine (time, value) samples engine-rig plays it through (float32, as
 * played: the curve is linear between them).
 */
interface Bez {
	cx: [number, number];
	/** Per channel, in CHANNELS order; a channel without them runs linearly. */
	cy: Array<[number, number] | undefined>;
	s: Array<number[] | undefined>;
}

interface BakedKey {
	time: number;
	/** Which run between steps it belongs to: keys are only interpolated within one. */
	seg: number;
	pose: Pose2;
	/** How the run to the next key plays: along a bezier on these channels, linearly on the rest. */
	bez?: Bez;
}

/** A run's pose at `t` as the runtime plays it, from key k0 to k1. */
function runPose(k0: BakedKey, k1: BakedKey, t: number): Pose2 {
	const u = (t - k0.time) / (k1.time - k0.time);
	const out = { ...k0.pose };
	CHANNELS.forEach((c, j) => {
		const s = k0.bez?.s[j];
		out[c] = s
			? runAt(s, t, k0.time, k1.time, k0.pose[c], k1.pose[c])
			: k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
	});
	return out;
}

/** One key of one baked timeline, and how that timeline runs on to its next key. */
interface LineKey {
	k: BakedKey;
	bez?: Bez;
}
/** A baked bone as the file holds it: each timeline with its own keys. */
type Lines = Record<TimelineName, LineKey[]>;
const LINE_NAMES = Object.keys(TIMELINES) as TimelineName[];
/** Per timeline, its channels' places in CHANNELS. */
const LINE_CHANNELS = Object.fromEntries(
	LINE_NAMES.map((n) => [n, TIMELINES[n].map((c) => CHANNELS.indexOf(c))]),
) as Record<TimelineName, number[]>;

/** One timeline's channels at `t`, as the runtime plays them, written into `out`. */
function lineAt(keys: LineKey[], js: number[], t: number, out: Pose2): void {
	let lo = 0;
	let hi = keys.length - 1;
	const set = (k: BakedKey) => {
		for (const j of js) out[CHANNELS[j]] = k.pose[CHANNELS[j]];
	};
	if (t >= keys[hi].k.time || t < keys[0].k.time) {
		set(keys[t < keys[0].k.time ? 0 : hi].k);
		return;
	}
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (keys[mid].k.time <= t) lo = mid;
		else hi = mid;
	}
	const { k: k0, bez } = keys[lo];
	const k1 = keys[hi].k;
	const u = (t - k0.time) / (k1.time - k0.time);
	for (const j of js) {
		const c = CHANNELS[j];
		const s = bez?.s[j];
		out[c] = s
			? runAt(s, t, k0.time, k1.time, k0.pose[c], k1.pose[c])
			: k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
	}
}
/** The runtime's lookup on a baked bone's timelines: each one's last key at or before `t`, on to its next. */
function linesAt(lines: Lines, t: number): Pose2 {
	const out: Pose2 = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearY: 0 };
	for (const n of LINE_NAMES) lineAt(lines[n], LINE_CHANNELS[n], t, out);
	return out;
}

/**
 * The Bernstein weights of engine-rig's samples of a bezier, the run's two ends included: with its
 * time handles at thirds, sample k falls at k / 10 of the run's time.
 */
const KNOTS = Array.from({ length: BEZIER_POINTS + 2 }, (_, k) => {
	const u = k / 10;
	const v = 1 - u;
	return [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
});

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
	/**
	 * Bones under a 3D one that lie in their parent's card — no turn out of it, no depth, not drawn on
	 * another bone: each projects as its own 2D local under its parent as played, so it keeps its 2D
	 * keys, and its art counts toward the error of the baked bone it hangs from (§4.3).
	 */
	flat: Set<string>;
	/** The baked bones, every 2D ancestor of one and the flat bones: what the played pose depends on. */
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
	// At or under a bone keyed in 3D (`orient`), or a follower (it hangs from one bone and is drawn on
	// another, which only the bake can key): a bone is baked when it turns in 3D itself, follows, or sits
	// at a depth (it moves against its parent's card as that turns); one lying flat in its parent's card
	// keeps its 2D keys. The rest of the rig keeps its keys.
	const own3d = (b: Bone3d): boolean =>
		Boolean(b.follow) ||
		moves3d(b.name) ||
		(b.depth ?? 0) !== 0 ||
		Boolean(motion.get(b.name)?.depth);
	const under = rig.bones.filter((b) => animated(b.name));
	const baked = under.filter(own3d).map((b) => b.name);
	const flat = new Set(under.filter((b) => !own3d(b)).map((b) => b.name));
	const carried = new Set<string>(flat);
	for (const name of baked)
		for (let b = bones.get(name); b; b = bones.get(b.parent ?? '')) carried.add(b.name);
	return { bones, motion, baked, flat, carried };
}

/** The bones a clip's bake keys (§4.1), in rig order: the save owns their 2D timelines. */
export const bakedBonesOf = (rig: Rig3d, clip: Clip3d): string[] => planOf(rig, clip).baked;
/** The bones a clip's bake leaves flat (§4.1), in rig order: their own 2D keys are its input. */
export const flatBonesOf = (rig: Rig3d, clip: Clip3d): string[] => [...planOf(rig, clip).flat];

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
	const layered = new Map<string, number[]>();
	rig.slots.forEach((s, i) => {
		if (s.layer !== undefined) layered.set(s.layer, [...(layered.get(s.layer) ?? []), i]);
	});
	for (const [layer, at] of layered)
		if (at[at.length - 1] - at[0] !== at.length - 1)
			problems.push(`layer ${layer}: its slots must be next to each other in the draw order`);
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
	const { bones, motion, baked, flat } = planOf(rig, clip);
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
	const worldOf = (name: string, t: number): Frame3d =>
		boneWorld3d(bones, motion, t, (n) => turns(n, t), name);
	/**
	 * Where a baked bone's error is measured and its floor sized: its own card and wherever the art of
	 * the flat bones hanging from it goes during the clip (through flat bones, each at its own 2D keys),
	 * which the runtime draws under it as played.
	 */
	const children = new Map<string, Bone3d[]>();
	for (const b of rig.bones)
		if (b.parent) children.set(b.parent, [...(children.get(b.parent) ?? []), b]);
	const flatTimes = [
		...new Set([
			...dense,
			...[...flat].flatMap((n) => {
				const m = motion.get(n);
				return m ? keyTimesOf(m) : [];
			}),
		]),
	].filter((t) => t >= 0 && t <= D);
	const reachOf = (name: string): Card => {
		const card = { ...cardOf(bone(name)) };
		const visit = (n: string, m: number[], t: number): void => {
			for (const c of children.get(n) ?? []) {
				if (!flat.has(c.name)) continue;
				const k = motion.get(c.name);
				const r = ((c.rotate ?? 0) + valueAt(k?.rotate ?? null, t, 0)) * RAD;
				const sx = (c.scaleX ?? 1) * valueAt(k?.scaleX ?? null, t, 1);
				const sy = (c.scaleY ?? 1) * valueAt(k?.scaleY ?? null, t, 1);
				const l = [
					Math.cos(r) * sx,
					-Math.sin(r) * sy,
					(c.x ?? 0) + valueAt(k?.x ?? null, t, 0),
					Math.sin(r) * sx,
					Math.cos(r) * sy,
					(c.y ?? 0) + valueAt(k?.y ?? null, t, 0),
				];
				const at = [
					m[0] * l[0] + m[1] * l[3],
					m[0] * l[1] + m[1] * l[4],
					m[0] * l[2] + m[1] * l[5] + m[2],
					m[3] * l[0] + m[4] * l[3],
					m[3] * l[1] + m[4] * l[4],
					m[3] * l[2] + m[4] * l[5] + m[5],
				];
				const own = cardOf(c);
				for (const [px, py] of [
					[own.x0, -own.h],
					[own.x0, own.h],
					[own.x1, -own.h],
					[own.x1, own.h],
				]) {
					const x = at[0] * px + at[1] * py + at[2];
					const y = at[3] * px + at[4] * py + at[5];
					card.x0 = Math.min(card.x0, x);
					card.x1 = Math.max(card.x1, x);
					card.h = Math.max(card.h, Math.abs(y));
				}
				visit(c.name, at, t);
			}
		};
		if ((children.get(name) ?? []).some((c) => flat.has(c.name)))
			for (const t of flatTimes) visit(name, [1, 0, 0, 0, 1, 0], t);
		return card;
	};
	const reach = new Map(baked.map((name) => [name, reachOf(name)]));
	const floorOf = (name: string): number =>
		o.floor / cardExtent(reach.get(name) ?? cardOf(bone(name)));

	// Flips: where a card's projection changes side (its determinant's sign), found to 1e-9 s.
	const flips: Record<string, number[]> = Object.fromEntries(baked.map((name) => [name, []]));
	let sides: boolean[] = [];
	grid.forEach((t, i) => {
		const memo = new Map<string, Frame3d>();
		const now = baked.map((name) =>
			facing(project(boneWorld3d(bones, motion, t, (n) => turns(n, t), name, memo))),
		);
		if (i > 0)
			baked.forEach((name, j) => {
				const s0 = sides[j];
				if (s0 === now[j]) return;
				let lo = grid[i - 1];
				let hi = t;
				while (hi - lo > 1e-9) {
					const mid = (lo + hi) / 2;
					if (facing(project(worldOf(name, mid))) === s0) lo = mid;
					else hi = mid;
				}
				flips[name].push(hi);
			});
		sides = now;
	});
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
	const result = new Map<string, { lines: Lines; steps: number[]; checks: number[] }>();
	/** A bone's 2D local as the runtime plays it: its baked keys, else its own 2D keys on its setup. */
	const localPlayed = (name: string, t: number): Pose2 => {
		const r = result.get(name);
		if (r) return linesAt(r.lines, t);
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
		const card = reach.get(name) ?? cardOf(b);
		const setup = setupOf(name);
		const floor = floorOf(name);
		const parentAt = (t: number): Affine | null => (b.parent ? playedAt(b.parent, t) : null);

		// Where the error is measured: the check grid, the parent's checks, key times, the middle of each
		// of its key runs and its curves' samples (where its interpolation error peaks or turns, which
		// this bone's keys must put back), subdivided down to 1 µs wherever this card's target or its
		// parent AS PLAYED thins out (σ2 / σ1) by more than THIN_STEP between neighbours: this bone's
		// locals grow like 1 / that. Each check holds the parent as played, the target (floored) and
		// what a key run's error is measured against: the 3D pose itself, so the floor and the key
		// reduction together miss it by no more than the tolerance — unless the floor alone moves the
		// card that far, where the floored target is the best any key can do.
		const ct: number[] = [];
		const cc: Check[] = [];
		interface Check {
			t: number;
			p: Affine | null;
			g: Affine;
			m: Affine;
			r: number[];
		}
		const point = (t: number): Check => {
			const p = parentAt(t);
			const u = project(worldOf(name, t));
			const g = floored(u, floor);
			const m = cornerError(u, g, card) < o.tolerance ? u : g;
			return { t, p, g, m, r: [p ? thinness(p) : 1, thinness(g)] };
		};
		const wide = (a: Check, z: Check): boolean =>
			a.r.some((x, k) => {
				const lo = Math.max(Math.min(x, z.r[k]), 1e-9);
				return Math.max(x, z.r[k]) / lo > THIN_STEP;
			});
		const keep = (c: Check): void => {
			ct.push(c.t);
			cc.push(c);
		};
		const subdivide = (a: Check, z: Check): void => {
			if (z.t - a.t <= 1e-6 || Math.min(...a.r, ...z.r) >= THIN) return;
			const mid = point((a.t + z.t) / 2);
			if (!wide(a, mid) && !wide(mid, z)) return;
			subdivide(a, mid);
			keep(mid);
			subdivide(mid, z);
		};
		// The nearest baked bone this one hangs from (through flat bones, whose own 2D keys move it too).
		let up = b.parent;
		const flatAbove: string[] = [];
		while (up !== undefined && flat.has(up)) {
			flatAbove.push(up);
			up = bone(up).parent;
		}
		const pr = up === undefined ? undefined : result.get(up);
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
		for (const n of flatAbove) {
			const m = motion.get(n);
			if (!m) continue;
			const times = [...new Set(keyTimesOf(m))].sort((x, y) => x - y);
			times.forEach((t, i) => {
				base.add(t);
				if (i > 0) base.add((t + times[i - 1]) / 2);
			});
		}
		if (pr) {
			for (const t of pr.checks) base.add(t);
			for (const line of Object.values(pr.lines))
				line.forEach(({ k, bez }, i) => {
					base.add(k.time);
					if (i > 0) base.add((k.time + line[i - 1].k.time) / 2);
					const s = bez?.s.find(Boolean);
					if (s) for (let j = 0; j < s.length; j += 2) base.add(s[j]);
				});
		}
		let last: Check | null = null;
		for (const t of [...base].filter((x) => x >= 0 && x <= D).sort((x, y) => x - y)) {
			const at = point(t);
			if (last) subdivide(last, at);
			keep(at);
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
		const targetLocal = (at: number, p: Affine | null, g: Affine): Pose2 => {
			let l: Pose2;
			if (o.project === 'local') {
				const w = worlds(at);
				const own = b.parent ? relative(frame(w, b.parent), frame(w, name)) : frame(w, name);
				l = localOf(null, project(own), ref, o.shear);
			} else l = localOf(p, g, ref, o.shear);
			if (sound(l)) ref = l;
			return l;
		};
		const keyAt = (time: number, at: number, seg: number): BakedKey => {
			const c = point(at);
			return { time: held(time), seg, pose: asPlayed(setup, targetLocal(at, c.p, c.g)) };
		};

		/**
		 * Where a run between steps knows its target: its two limits and every check between, in time
		 * order, each with the local that puts the bone on it. A key may sit on a limit, or on a check
		 * whose float32 time lies strictly inside the run and past the last such.
		 */
		interface Sample {
			time: number;
			key: boolean;
			l: Pose2;
			c: Check;
		}
		const authored = new Set<number>();
		for (let n: string | undefined = name; n; n = bone(n).parent) {
			const m = motion.get(n);
			if (m) for (const t of keyTimesOf(m)) authored.add(t);
		}
		const reduce = o.dense && o.reduce;
		const keys: BakedKey[] = [];
		const runs: Sample[][] = [];
		let denseKeys = 0;
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
			const inner = (o.dense ? dense : [...authored]).filter((t) => t > first && t < last);
			denseKeys += inner.length + 2;
			if (reduce) {
				const S: Sample[] = [];
				const add = (c: Check, time: number, key: boolean) => {
					const l = targetLocal(c.t, c.p, c.g);
					S.push({ time, key: key && sound(asPlayed(setup, l)), l, c });
				};
				add(point(first), t0, true);
				let prev = t0;
				for (let i = checkAfter(first); i < ct.length && ct[i] < last; i++) {
					if (!seen[i]) continue;
					const time = held(ct[i]);
					add(cc[i], time, time > prev && time < t1);
					if (S[S.length - 1].key) prev = time;
				}
				add(point(last), t1, true);
				S[0].key = true;
				S[S.length - 1].key = true;
				runs.push(S);
				continue;
			}
			keys.push(keyAt(t0, first, s));
			for (const t of inner.sort((x, y) => x - y)) keys.push(keyAt(t, t, s));
			keys.push(keyAt(t1, last, s));
		}

		// A pose's error at a check: its card's worst corner miss — and unusable if this card, as
		// played, thins below half its floor or shows its other side, because its children would then
		// need locals past any bound.
		const errorOf = (l: Pose2, { p, g, m }: Check): number => {
			const w = compose(p, l);
			if (floor > 0 && (facing(w) !== facing(g) || thinner(w, floor / 2))) return Infinity;
			const e =
				o.measure === 'local'
					? cornerError(compose(null, l), compose(null, localOf(p, m, l, true)), card)
					: cornerError(w, m, card);
			return Number.isNaN(e) ? Infinity : e;
		};
		/** Checks off the check set (a run's quarters, where a curve kinks), kept by time. */
		const fresh = new Map<number, Check>();
		const pointAt = (t: number): Check => {
			const c = fresh.get(t) ?? point(t);
			fresh.set(t, c);
			return c;
		};
		const kinksOf = (bez: Bez | undefined): number[] =>
			bez?.s.find(Boolean)?.filter((_, j) => j % 2 === 0) ?? [];
		const quartersOf = (t0: number, t1: number): number[] =>
			[0.25, 0.5, 0.75].map((u) => t0 + (t1 - t0) * u);
		/**
		 * A pose's worst error over the checks strictly between two times and the fresh points given,
		 * and where; given up on once past `limit`.
		 */
		const worstOver = (
			t0: number,
			t1: number,
			extra: number[],
			pose: (t: number, check: number) => Pose2,
			limit = Infinity,
		) => {
			let worst = -1;
			let at = 0;
			for (let i = checkAfter(t0); i < ct.length && ct[i] < t1 && worst <= limit; i++) {
				if (!seen[i]) continue;
				const e = errorOf(pose(ct[i], i), cc[i]);
				if (e > worst) [worst, at] = [e, ct[i]];
			}
			for (const t of extra) {
				if (worst > limit) break;
				if (t <= t0 || t >= t1 || blind(t)) continue;
				const e = errorOf(pose(t, -1), pointAt(t));
				if (e > worst) [worst, at] = [e, t];
			}
			return { worst, at };
		};
		const worstBetween = (k0: BakedKey, k1: BakedKey, quarters = false) =>
			worstOver(
				k0.time,
				k1.time,
				quarters ? [...quartersOf(k0.time, k1.time), ...kinksOf(k0.bez)] : [],
				(t) => runPose(k0, k1, t),
			);

		const tol = o.tolerance;
		const ALL = CHANNELS.map((_, j) => j);
		/**
		 * A run's worst error over samples lo … hi − 1, given up on once past the tolerance: every
		 * eighth sample first, so a run that misses is told so early.
		 */
		const sampleWorst = (k0: BakedKey, k1: BakedKey, S: Sample[], lo: number, hi: number) => {
			let worst = 0;
			for (const [from, step] of [
				[lo, 8],
				[lo + 1, 1],
			])
				for (let i = from; i < hi && worst <= tol; i += step)
					if (step === 8 || (i - lo) % 8)
						worst = Math.max(worst, errorOf(runPose(k0, k1, S[i].c.t), S[i].c));
			return worst;
		};
		/**
		 * The value handles, with the time handles at thirds, that best fit samples lo … hi − 1 of a run
		 * from k0 to k1, for the channels `js`: least squares on the curve as engine-rig plays it —
		 * linear between its nine samples, so linear in the two handles.
		 */
		const handlesOf = (
			k0: BakedKey,
			k1: BakedKey,
			S: Sample[],
			lo: number,
			hi: number,
			js: number[],
		): Array<[number, number] | undefined> => {
			let a11 = 0;
			let a12 = 0;
			let a22 = 0;
			const r1 = CHANNELS.map(() => 0);
			const r2 = CHANNELS.map(() => 0);
			const span = k1.time - k0.time;
			for (let i = lo; i < hi; i++) {
				const f = Math.min(1, Math.max(0, (S[i].c.t - k0.time) / span));
				const k = Math.min(KNOTS.length - 2, Math.floor(f * 10));
				const g = f * 10 - k;
				const [w0, w1] = [KNOTS[k], KNOTS[k + 1]];
				const b1 = w0[1] + (w1[1] - w0[1]) * g;
				const b2 = w0[2] + (w1[2] - w0[2]) * g;
				a11 += b1 * b1;
				a12 += b1 * b2;
				a22 += b2 * b2;
				for (const j of js) {
					const c = CHANNELS[j];
					const v0 = k0.pose[c];
					const r = S[i].l[c] - (v0 + (k1.pose[c] - v0) * f);
					r1[j] += b1 * r;
					r2[j] += b2 * r;
				}
			}
			// As offsets from the straight run's handles, with a whisker of ridge for a run whose
			// samples cannot tell the two apart.
			const ridge = 1e-9 * (a11 + a22) + 1e-300;
			const det = (a11 + ridge) * (a22 + ridge) - a12 * a12;
			return CHANNELS.map((c, j): [number, number] | undefined => {
				if (!js.includes(j)) return undefined;
				const v0 = k0.pose[c];
				const dv = k1.pose[c] - v0;
				return [
					v0 + dv / 3 + ((a22 + ridge) * r1[j] - a12 * r2[j]) / det,
					v0 + (2 * dv) / 3 + ((a11 + ridge) * r2[j] - a12 * r1[j]) / det,
				];
			});
		};
		/** A run's bezier through k0 → k1 on the channels given handles, as the file and engine-rig hold it. */
		const bezOf = (
			k0: BakedKey,
			k1: BakedKey,
			handles: Array<[number, number] | undefined>,
		): Bez => {
			const T0 = store(k0.time);
			const T1 = store(k1.time);
			const cx: [number, number] = [store(T0 + (T1 - T0) / 3), store(T0 + (2 * (T1 - T0)) / 3)];
			const cy = CHANNELS.map((c, j): [number, number] | undefined => {
				const h = handles[j];
				return h && [written(setup, c, h[0]), written(setup, c, h[1])];
			});
			const s = CHANNELS.map((c, j) => {
				const h = cy[j];
				return (
					h &&
					bezierSamples(
						T0,
						written(setup, c, k0.pose[c]),
						cx[0],
						h[0],
						cx[1],
						h[1],
						T1,
						written(setup, c, k1.pose[c]),
					).map((v, i) => (i % 2 ? replayed(setup, c, Math.fround(v)) : Math.fround(v)))
				);
			});
			return { cx, cy, s };
		};
		/** A bezier on the channels `js` only (none left: a straight run). */
		const only = (bez: Bez | undefined, js: number[]): Bez | undefined =>
			bez && js.some((j) => bez.s[j])
				? {
						cx: bez.cx,
						cy: bez.cy.map((h, j) => (js.includes(j) ? h : undefined)),
						s: bez.s.map((h, j) => (js.includes(j) ? h : undefined)),
					}
				: undefined;
		/** The samples strictly between two times, as an index range. */
		const between = (S: Sample[], t0: number, t1: number): [number, number] => {
			const firstAt = (ok: (t: number) => boolean) => {
				let lo = 0;
				let hi = S.length;
				while (lo < hi) {
					const mid = (lo + hi) >> 1;
					if (ok(S[mid].c.t)) hi = mid;
					else lo = mid + 1;
				}
				return lo;
			};
			return [firstAt((t) => t > t0), firstAt((t) => t >= t1)];
		};
		/**
		 * The run k0 → k1 over samples lo … hi − 1: a bezier fitted to them if within the tolerance
		 * (`undefined` = a straight run is), else `null`.
		 */
		const fitRun = (
			k0: BakedKey,
			k1: BakedKey,
			S: Sample[],
			lo: number,
			hi: number,
		): Bez | undefined | null => {
			const bez =
				o.curves && hi - lo >= 2 ? bezOf(k0, k1, handlesOf(k0, k1, S, lo, hi, ALL)) : undefined;
			if (sampleWorst({ ...k0, bez }, k1, S, lo, hi) <= tol) return bez;
			return bez && sampleWorst({ ...k0, bez: undefined }, k1, S, lo, hi) <= tol ? undefined : null;
		};
		/** A run's bezier without each timeline a straight run serves as well (a smaller file). */
		const prune = (k0: BakedKey, k1: BakedKey, bez: Bez | undefined, S: Sample[]) => {
			const [lo, hi] = between(S, k0.time, k1.time);
			let out = bez;
			for (const n of LINE_NAMES) {
				const less = only(
					out,
					ALL.filter((j) => !LINE_CHANNELS[n].includes(j)),
				);
				if (out && sampleWorst({ ...k0, bez: less }, k1, S, lo, hi) <= tol) out = less;
			}
			return out;
		};
		/**
		 * The keys of one run between steps: from each key, the next is the furthest sample the run to
		 * it holds within the tolerance (galloping out, then bisecting back).
		 */
		const reduceRun = (S: Sample[], seg: number): BakedKey[] => {
			const at = S.flatMap((x, i) => (x.key ? [i] : []));
			const made = new Map<number, BakedKey>();
			const keyOf = (n: number): BakedKey => {
				const k = made.get(n) ?? { time: S[at[n]].time, seg, pose: asPlayed(setup, S[at[n]].l) };
				made.set(n, k);
				return k;
			};
			const out = [keyOf(0)];
			const end = at.length - 1;
			let stride = 2;
			for (let a = 0; a < end;) {
				const k0 = out[out.length - 1];
				const tried = new Map<number, Bez | undefined | null>();
				const to = (n: number) => {
					const r = tried.has(n) ? tried.get(n) : fitRun(k0, keyOf(n), S, at[a] + 1, at[n]);
					tried.set(n, r);
					return r;
				};
				// The next sample always takes a key (whatever its run misses, the refinement keys); out
				// from there as far as the last run reached, galloping on while it holds, bisecting back.
				let good = a + 1;
				let bad = end + 1;
				for (let n = Math.min(a + stride, end); n > good; n = Math.min(a + 2 * (n - a), end)) {
					if (to(n) === null) {
						bad = n;
						break;
					}
					good = n;
				}
				while (bad - good > 1) {
					const n = (good + bad) >> 1;
					if (to(n) === null) bad = n;
					else good = n;
				}
				k0.bez = prune(k0, keyOf(good), to(good) ?? undefined, S);
				out.push(keyOf(good));
				stride = Math.max(2, good - a);
				a = good;
			}
			return out;
		};
		const refit = (k0: BakedKey, k1: BakedKey): void => {
			const S = runs[k0.seg];
			k0.bez = prune(k0, k1, fitRun(k0, k1, S, ...between(S, k0.time, k1.time)) ?? undefined, S);
		};

		let kept = reduce ? runs.flatMap(reduceRun) : keys;
		let unmet = 0;
		if (o.dense) {
			// Where the kept keys (even every dense one) leave more than the tolerance, key the worst
			// point and fit the two runs either side again — at most as many new keys as the dense bake
			// had; past that the run is reported.
			const refined = [kept[0]];
			let budget = denseKeys;
			const refine = (k0: BakedKey, k1: BakedKey, depth: number): void => {
				const { worst, at } = worstBetween(k0, k1, true);
				if (worst > tol) {
					let mid: BakedKey | null = null;
					if (depth < 24 && k1.time - k0.time > 1e-6 && budget > 0) {
						budget--;
						ref = k0.pose;
						mid = keyAt(at, at, k0.seg);
					}
					// A key the file's float32 times cannot place between the two is no key either, nor one
					// whose local is past any bound (a parent seen exactly edge-on).
					if (mid && sound(mid.pose) && mid.time > k0.time && mid.time < k1.time) {
						if (reduce) {
							refit(k0, mid);
							refit(mid, k1);
						}
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

		// Each timeline its own keys: from each of its keys, the next is the furthest key whose run,
		// fitted again for this timeline alone, keeps the card within the tolerance with the other
		// timelines as they are. Each run's two ends (the steps) stay on every timeline.
		const lines = Object.fromEntries(
			LINE_NAMES.map((n) => [n, kept.map((k) => ({ k, bez: only(k.bez, LINE_CHANNELS[n]) }))]),
		) as Lines;
		if (reduce) {
			// Where this card or its parent is thin, the check set is only as fine as the target needs: a
			// timeline's long run beside another's short ones can peak between two checks, so there the
			// error between neighbouring checks is bisected wherever it bulges.
			const thin = [0];
			cc.forEach((c, i) => thin.push(thin[i] + (Math.min(...c.r) < THIN ? 1 : 0)));
			for (const n of LINE_NAMES) {
				const js = LINE_CHANNELS[n];
				const others = LINE_NAMES.filter((x) => x !== n);
				// While one timeline is thinned the others stand still: their pose at a check is read once,
				// and where they kink (their keys and curve samples) is listed once.
				const still: Array<Pose2 | undefined> = [];
				const kinks = others
					.flatMap((x) => lines[x].flatMap((lk) => [lk.k.time, ...kinksOf(lk.bez)]))
					.sort((x, y) => x - y);
				const kinksIn = (t0: number, t1: number) => {
					let lo = 0;
					let hi = kinks.length;
					while (lo < hi) {
						const mid = (lo + hi) >> 1;
						if (kinks[mid] <= t0) lo = mid + 1;
						else hi = mid;
					}
					const out: number[] = [];
					for (let i = lo; i < kinks.length && kinks[i] < t1; i++) out.push(kinks[i]);
					return out;
				};
				/** Whether this timeline's run k0 → k1, the others as they are, holds the tolerance. */
				const holds = (k0: BakedKey, k1: BakedKey, bez: Bez | undefined): boolean => {
					const [t0, t1] = [k0.time, k1.time];
					const now = (t: number, i: number): Pose2 => {
						let base = i < 0 ? undefined : still[i];
						if (!base) {
							base = linesAt(lines, t);
							if (i >= 0) still[i] = base;
						}
						const out = { ...base };
						const u = (t - t0) / (t1 - t0);
						for (const j of js) {
							const c = CHANNELS[j];
							const s = bez?.s[j];
							out[c] = s
								? runAt(s, t, t0, t1, k0.pose[c], k1.pose[c])
								: k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
						}
						return out;
					};
					const extra = [...quartersOf(t0, t1), ...kinksOf(bez), ...kinksIn(t0, t1)];
					if (worstOver(t0, t1, extra, now, tol).worst > tol) return false;
					if (thin[checkAfter(t1)] === thin[checkAfter(t0)]) return true;
					let worst = 0;
					const dig = (a: number, ea: number, b: number, eb: number, depth: number): void => {
						const t = (a + b) / 2;
						if (worst > tol || b - a <= 1e-6 || depth > 8 || blind(t)) return;
						const e = errorOf(now(t, -1), pointAt(t));
						worst = Math.max(worst, e);
						if (e <= (ea + eb) / 2 + 0.05 * tol) return;
						dig(a, ea, t, e, depth + 1);
						dig(t, e, b, eb, depth + 1);
					};
					let prev = -1;
					for (let i = checkAfter(t0); i < ct.length && ct[i] < t1 && worst <= tol; i++) {
						if (!seen[i]) continue;
						if (prev >= 0 && Math.min(...cc[prev].r, ...cc[i].r) < THIN) {
							const ea = errorOf(now(ct[prev], prev), cc[prev]);
							dig(ct[prev], ea, ct[i], errorOf(now(ct[i], i), cc[i]), 0);
						}
						prev = i;
					}
					return worst <= tol;
				};
				const line = lines[n];
				const out: LineKey[] = [line[0]];
				let stride = 2;
				for (let a = 0; a + 1 < line.length;) {
					const k0 = line[a].k;
					let last = a + 1;
					while (last + 1 < line.length && line[last + 1].k.seg === k0.seg) last++;
					if (line[a + 1].k.seg !== k0.seg || last === a + 1) {
						// Across a step, or a run with no key to spare: as it was.
						out.push(line[a + 1]);
						a++;
						continue;
					}
					const tried = new Map<number, Bez | undefined | null>();
					const to = (z: number) => {
						if (z === a + 1) return line[a].bez;
						if (tried.has(z)) return tried.get(z);
						const k1 = line[z].k;
						const S = runs[k0.seg];
						const [lo, hi] = between(S, k0.time, k1.time);
						let r: Bez | undefined | null = null;
						if (holds(k0, k1, undefined)) r = undefined;
						else if (o.curves && hi - lo >= 2) {
							const bez = bezOf(k0, k1, handlesOf(k0, k1, S, lo, hi, js));
							if (holds(k0, k1, bez)) r = bez;
						}
						tried.set(z, r);
						return r;
					};
					let good = a + 1;
					let bad = last + 1;
					for (let z = Math.min(a + stride, last); z > good; z = Math.min(a + 2 * (z - a), last)) {
						if (to(z) === null) {
							bad = z;
							break;
						}
						good = z;
					}
					while (bad - good > 1) {
						const z = (good + bad) >> 1;
						if (to(z) === null) bad = z;
						else good = z;
					}
					out[out.length - 1] = { k: k0, bez: to(good) ?? undefined };
					out.push(line[good]);
					stride = Math.max(2, good - a);
					a = good;
				}
				lines[n] = out;
			}
		}
		const frames = [...new Set(LINE_NAMES.flatMap((n) => lines[n].map((lk) => lk.k)))];
		result.set(name, { lines, steps, checks: ct });
		report.bones[name] = { keys: frames.length, dense: denseKeys, steps: clusters.length, unmet };
	}

	// Draw order: each card's centre depth on the dense grid; two cards swap only past the hysteresis.
	// A layer moves as one card at its slots' mean depth, its slots in their setup order.
	const slotNames = rig.slots.map((s) => s.name);
	const units: number[][] = [];
	const unitOf = new Map<string, number[]>();
	rig.slots.forEach((s, i) => {
		const u = s.layer === undefined ? undefined : unitOf.get(s.layer);
		if (u) u.push(i);
		else {
			const fresh = [i];
			units.push(fresh);
			if (s.layer !== undefined) unitOf.set(s.layer, fresh);
		}
	});
	const depthOf = (w: Map<string, Frame3d>, slot: Slot3d): number => {
		const c = cardOf(bone(slot.bone));
		const bw = frame(w, slot.bone);
		return bw.m[6] * ((c.x0 + c.x1) / 2) + bw.o[2];
	};
	const orderKeys: DrawOrderKey[] = [];
	const orderSched: { time: number; order: number[] }[] = [];
	let order = slotNames.map((_, i) => i);
	let unitOrder = units.map((_, i) => i);
	for (let i = 0; i <= N; i += every) {
		// A card's depth is its bone's as the clip moves it, before any drawing is turned to face.
		const w = world3d(rig, motion, grid[i]);
		const zs = rig.slots.map((s) => depthOf(w, s));
		const z = units.map((u) => u.reduce((sum, k) => sum + zs[k], 0) / u.length);
		const nextUnits = [...unitOrder];
		for (let moved = true; moved;) {
			moved = false;
			for (let k = 0; k + 1 < nextUnits.length; k++)
				if (z[nextUnits[k]] > z[nextUnits[k + 1]] + o.hysteresis) {
					[nextUnits[k], nextUnits[k + 1]] = [nextUnits[k + 1], nextUnits[k]];
					moved = true;
				}
		}
		unitOrder = nextUnits;
		const next = nextUnits.flatMap((u) => units[u]);
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

	// The timelines: every baked bone's, each with its own keys and every key with its run's curve (a
	// constant timeline dropped), its angles brought back into (−180°, 180°] by a second key at the
	// clip's end; every other bone's own 2D keys, as they are.
	const bonesOut: Record<string, BakedBoneTimelines> = {};
	for (const [n, { lines }] of result) {
		const setup = setupOf(n);
		const rest = (c: PoseChannel): number => (scaled(c) ? 1 : 0);
		const value = (k: BakedKey, c: PoseChannel) => written(setup, c, k.pose[c]);
		const t: BakedBoneTimelines = {};
		for (const line of LINE_NAMES) {
			const kept = lines[line];
			const keys = o.stepPairs ? kept : kept.filter((lk, i) => kept[i + 1]?.k.time !== lk.k.time);
			const chans = TIMELINES[line];
			const constant = keys.every(({ k, bez }) =>
				chans.every((c) => {
					const near = (v: number) => Math.abs(v - rest(c)) <= 1e-9;
					const h = bez?.cy[CHANNELS.indexOf(c)];
					return near(value(k, c)) && (!h || h.every(near));
				}),
			);
			if (constant) continue;
			/** A key's 4.2 curve: per channel, its time handle and value handle pairs. */
			const curveOf = (i: number): { curve?: number[] } => {
				const { k, bez } = keys[i];
				const next = keys[i + 1]?.k;
				if (!bez || !next) return {};
				const curve: number[] = [];
				for (const c of chans) {
					const h = bez.cy[CHANNELS.indexOf(c)];
					if (!h) return {};
					const v0 = value(k, c);
					const span = value(next, c) - v0 || 1;
					const [h1, h2] = o.curveSpace === 'progress' ? h.map((v) => store((v - v0) / span)) : h;
					curve.push(bez.cx[0], h1, bez.cx[1], h2);
				}
				return { curve };
			};
			if (line === 'rotate' || line === 'sheary') {
				const out: Key1[] = keys.map(({ k }, i) => ({
					time: store(k.time),
					value: value(k, chans[0]),
					...curveOf(i),
				}));
				const end = out[out.length - 1];
				const wrapped = store(wrap180(end.value ?? 0));
				if (o.wrap && wrapped !== end.value) out.push({ time: end.time, value: wrapped });
				t[line] = out;
			} else
				t[line] = keys.map(({ k }, i) => ({
					time: store(k.time),
					x: value(k, chans[0]),
					y: value(k, chans[1]),
					...curveOf(i),
				}));
		}
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
