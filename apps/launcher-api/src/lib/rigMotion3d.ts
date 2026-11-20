import type { BoneKeys3d, Quat, QuatKey } from './rig2p5d';
import {
	IDENTITY3,
	across,
	aimFrame,
	apply3,
	cross,
	localTurn,
	matOf,
	mul3,
	quatOf,
	qdot,
	rotZ,
	slerp,
	transpose3,
	turnBetween,
	twoBoneIk,
	unit,
	type M3,
	type V3,
} from './rig3dMath';
import {
	ROTATE_TOLERANCE,
	neutralFrames,
	oneEuro,
	type LandmarkRef,
	type MotionFilter,
	type MotionTrack,
} from './rigMotion';
import { handSides } from './rigMotionHand';

/**
 * Motion from video into a 2.5D rig's 3D keys (docs/design/rig-2p5d.md §8): each mapped bone's 3D
 * orientation, solved from the tracked points and Face Landmarker's transformation matrix and written
 * as `orient` quaternion keys (a turn from the setup). The bake (`rig2p5d.ts`) then turns them into
 * the 2D keys games play, so foreshortening, a hand passing behind the body, the head's parallax and
 * the body's turn are one projection, not four tricks. Pure: no DOM, no MediaPipe.
 *
 * A point is read in the picture and in depth: its x and y are the picture's (where the tracker put
 * it on the frame, so a bone points where the video's limb does), its depth the tracker's 3D estimate
 * (its world points, at the frame's pixels per metre). MediaPipe's world points alone do not project
 * onto its picture points: read that way, the arms on real footage pointed 2–5° off the video's.
 */

/** Points that turn a bone: its direction `from → to`, and a line across it for its turn. */
export interface Bone3dPoints {
	from: LandmarkRef;
	to: LandmarkRef;
	/** A line lying across the bone's card (it is `acrossRest` in the setup). */
	across?: [LandmarkRef, LandmarkRef];
	/**
	 * The same line on Hand Landmarker's points of the side's hand, `from` the point the pose's `from`
	 * is (the wrist): where that hand is found on it ({@link HAND_ON_WRIST}), the bone's direction in
	 * the picture is the hand's and its depth stays the pose's. The pose's own hand points are coarse:
	 * on footage of a performer gesturing they pointed a median 10° from the hand found on it, and
	 * over 45° on 5–16% of frames.
	 */
	hand?: { side: 'l' | 'r'; from: LandmarkRef; to: LandmarkRef };
}

/**
 * A hand found within this many shoulder widths of the pose's wrist is on it. Measured on footage
 * of a performer gesturing: the performer's own hands a median 0.07 and p90 0.13 away; a second hand
 * found on clasped hands, paired to the other wrist, 0.4–1.8.
 */
export const HAND_ON_WRIST = 0.3;

/**
 * One bone of a 2.5D template turned from the track: by Pose Landmarker's points (`pose`), by the
 * face's 3D pose (`face`), or to face the viewer (`viewer`).
 */
export interface Bone3dMotion {
	kind: 'bone3d';
	bone: string;
	/** Pose Landmarker's points. */
	pose?: Bone3dPoints;
	/** The head's turn: Face Landmarker's transformation matrix, against the performer's neutral. */
	face?: 'matrix';
	/**
	 * Square to the viewer, keeping its parent's turn in the picture: an image of something round (a
	 * head's outline) that a turning card would narrow.
	 */
	viewer?: 'square';
	/**
	 * With points and no line across: the card rolls about the bone to face the viewer as squarely as
	 * its direction allows — a limb, which looks the same from any side. Without it, it keeps its
	 * parent's card.
	 */
	roll?: 'viewer';
	/** The bone's direction in the setup; none = toward its first child. */
	rest?: [number, number];
	/** The direction `across` lies in, in the setup (needed with `across`). */
	acrossRest?: [number, number];
	/**
	 * The furthest the bone turns from its setup direction, in degrees: a reading past it (the
	 * tracker finding a body upside down across a camera cut, a spine bent double) is a gap, held
	 * from the frame before and reported. None = any turn.
	 */
	reach?: number;
}

/** A tracked point: Pose Landmarker's, or the middle of Face Landmarker's points. */
export type FollowPoint = { pose: LandmarkRef } | { face: number[] };

/** A bone placed on a tracked point. */
export interface FollowMark {
	point: FollowPoint;
	bone: string;
}

/** Two bones reaching a tracked point (an arm to the wrist, a leg to the ankle). */
export interface FollowLimb {
	upper: string;
	lower: string;
	/** The bone at the chain's end: it lands on the tracked end. */
	end: string;
	/** Pose Landmarker's points of the limb's root, middle (the bend's side) and end. */
	points: [LandmarkRef, LandmarkRef, LandmarkRef];
	/** Hand Landmarker's hand of this side: its wrist is the end where it is found on the pose's. */
	hand?: 'l' | 'r';
	/** The bend's side when the tracked limb is straight: this bone's place. */
	pole: string;
}

/**
 * Following positions (rig-templates §5.8): the root moves with the performer, limbs reach the
 * tracked ends, and the head is shifted onto the tracked face, on top of the bones' turns.
 */
export interface RigPositions3d {
	/** The root (no parent), translated so its anchors land on their points (their mean). */
	root: { bone: string; anchors: FollowMark[] };
	limbs: FollowLimb[];
	/**
	 * A bone translated in its parent (a flat bone the head hangs from) so its marks land on their
	 * points, at most `limit` rig units from its place.
	 */
	head?: { bone: string; marks: FollowMark[]; limit: number };
}

/** A template's 3D motion map: what turns each bone of its 2.5D rig. */
export interface RigMotion3d extends MotionFilter {
	/** A pose point below this visibility is a gap. */
	minVisibility: number;
	/** Parents first. */
	entries: Bone3dMotion[];
	/** What places the rig on the performer when an import follows positions. */
	positions?: RigPositions3d;
	/**
	 * The channels a 3D import leaves alone: their bones are turned in 3D, or what they fake (a limb's
	 * shortening, the draw order, the torso's ¾ image, the face's slide) is the bake's projection.
	 */
	replaces: string[];
	/** What a 3D import cannot take, said after it (in place of the map's 2D `cannot`). */
	cannot: string[];
}

/** What the 3D solve needs of a template. */
export interface Motion3dTemplate {
	bones: { name: string; parent?: string; x: number; y: number; rotation?: number }[];
}

/** The picture on the rig: a picture pixel (x right, y down) lands at (x0 + k·x, y0 − k·y). */
export interface LineUp {
	k: number;
	x0: number;
	y0: number;
}

/** What following positions needs besides the map. */
export interface Follow3d {
	/** Where the picture sits on the rig: the Rigger's reference overlay's line-up. */
	lineUp: LineUp;
	/** Bones' depths (z in their parent's frame): the rig's 3D data, or its template's. */
	depths: Record<string, number>;
	/** The root's scale on each frame (the import's nearer / further). */
	rootScale: number[];
}

/** A translate key (2D, rig units, added to the setup) from time 0. */
export interface FollowKey {
	time: number;
	x: number;
	y: number;
}

/** How following positions went, frame counts. */
export interface FollowReport {
	frames: number;
	lineUp: LineUp;
	/** Frames the root was placed on its anchors (the others hold the nearest). */
	placed: number;
	/** Per limb (its upper bone): frames reaching the end, and frames it was out of reach (turned as tracked). */
	limbs: Record<string, { reached: number; outOfReach: number }>;
	/** The head's shift in rig units (median, largest) and the frames held at its limit. */
	head?: { bone: string; median: number; max: number; clamped: number; limit: number };
}

export interface Solve3d {
	/** Per bone, its `orient` keys from time 0. */
	bones: Record<string, BoneKeys3d>;
	/** Following positions: per bone, its translate keys from time 0 (the root, the head's bone). */
	translate?: Record<string, FollowKey[]>;
	follow?: FollowReport;
	/** Bones never read (their points were never seen). */
	unseen: string[];
	/** Per bone with a `reach`, the share of frames read past it (held instead). */
	beyond: Record<string, number>;
	/** Per bone, its turn from the setup on every frame, before key reduction (for the gates). */
	turns?: Record<string, Quat[]>;
	/** Per bone, its world rotation on every frame as solved (for the gates). */
	worlds?: Record<string, M3[]>;
}

const DEG = 180 / Math.PI;
const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
const median = (xs: number[]) => {
	if (!xs.length) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The rotation of a Face Landmarker transformation matrix (column-major 4 × 4), its scale taken off. */
function faceRotation(m: readonly number[]): M3 | null {
	const x = unit([m[0], m[1], m[2]]);
	const z = unit([m[8], m[9], m[10]]);
	if (!x || !z) return null;
	const y = unit(cross(z, x));
	if (!y) return null;
	const xx = cross(y, z);
	return [xx[0], y[0], z[0], xx[1], y[1], z[1], xx[2], y[2], z[2]];
}

/** The mean of orientations near one another (sign-aligned, normalised). */
function meanTurn(qs: Quat[]): Quat | null {
	if (!qs.length) return null;
	const s: Quat = [0, 0, 0, 0];
	for (const q of qs) {
		const k = qdot(q, qs[0]) < 0 ? -1 : 1;
		for (let i = 0; i < 4; i++) s[i] += k * q[i];
	}
	const n = Math.hypot(...s);
	return n > 0 ? (s.map((v) => v / n) as Quat) : null;
}

/**
 * The samples a run of slerped `orient` keys needs to stay within `tol` degrees of every sample
 * (Ramer–Douglas–Peucker on the angle between the run and the sample); indices, first and last kept.
 */
export function reduceTurns(times: number[], turns: Quat[], tol: number): number[] {
	const n = turns.length;
	if (n <= 2) return Array.from({ length: n }, (_, i) => i);
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		let worst = -1;
		let at = -1;
		for (let i = a + 1; i < b; i++) {
			const u = (times[i] - times[a]) / (times[b] - times[a] || 1);
			const err = turnBetween(slerp(turns[a], turns[b], u), turns[i]);
			if (err > worst) {
				worst = err;
				at = i;
			}
		}
		if (at > 0 && worst > tol) {
			keep[at] = 1;
			stack.push([a, at], [at, b]);
		}
	}
	const out: number[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
	return out;
}

/** A series held through its gaps (leading gaps from the first measured value); null if none. */
function held<T>(values: (T | null)[]): T[] | null {
	const first = values.find((v): v is T => v !== null);
	if (first === undefined) return null;
	let last: T = first;
	return values.map((v) => (v === null ? last : (last = v)));
}

/** A point series smoothed by the One-Euro filter, a coordinate at a time (metres). */
function smoothPoints(series: (V3 | null)[], times: number[], filter: MotionFilter): (V3 | null)[] {
	const axes = [0, 1, 2].map((k) =>
		oneEuro(
			series.map((p) => (p ? p[k] : null)),
			times,
			filter,
			1,
		),
	);
	return series.map((p, i) => (p ? [axes[0][i]!, axes[1][i]!, axes[2][i]!] : null));
}

/** A series of turns smoothed by the One-Euro filter on their (sign-aligned) components. */
function smoothTurns(turns: Quat[], times: number[], filter: MotionFilter): Quat[] {
	const aligned: Quat[] = [];
	for (const q of turns) {
		const prev = aligned[aligned.length - 1];
		aligned.push(prev && qdot(q, prev) < 0 ? (q.map((v) => -v) as Quat) : q);
	}
	const comps = [0, 1, 2, 3].map((k) =>
		oneEuro(
			aligned.map((q) => q[k]),
			times,
			filter,
			1,
		),
	);
	return aligned.map((_, i) => {
		const q = comps.map((c) => c[i]!) as Quat;
		const n = Math.hypot(...q);
		return q.map((v) => v / n) as Quat;
	});
}

/** `orient` keys played at each of `times`, as the bake samples them (slerp between keys). */
function keyedTurns(times: number[], keys: QuatKey[]): Quat[] {
	let k = 0;
	return times.map((t) => {
		while (k + 1 < keys.length && (keys[k + 1].time ?? 0) <= t + 1e-9) k++;
		const a = keys[k];
		const b = keys[k + 1];
		if (!b) return a.value;
		const t0 = a.time ?? 0;
		return slerp(a.value, b.value, (t - t0) / ((b.time ?? 0) - t0 || 1));
	});
}

/** A turn series as `orient` keys: within {@link ROTATE_TOLERANCE} of every frame, as the 2D import's turns. */
function orientKeys(times: number[], turns: Quat[]): QuatKey[] {
	const out: QuatKey[] = [];
	for (const i of reduceTurns(times, turns, ROTATE_TOLERANCE)) {
		const prev = out[out.length - 1]?.value;
		const q = prev && qdot(turns[i], prev) < 0 ? turns[i].map((v) => -v) : turns[i];
		out.push({ time: round(times[i], 4), value: q.map((v) => round(v, 6)) as Quat });
	}
	return out;
}

/** Picture points (0…1, y down) and 3D points (metres, y down, z away), as a tracker answers them. */
type Seen = { pic: (readonly number[] | null)[]; world: (readonly number[] | null)[] };

/**
 * The frame's pixels per metre: the picture length of the lines given over their length across the
 * picture in the tracker's 3D points (a line turned in depth shortens in both alike).
 */
function pixelsPerMetre(s: Seen, lines: [number, number][], w: number, h: number, minVis = 0) {
	const k: number[] = [];
	for (const [a, b] of lines) {
		const [pa, pb, wa, wb] = [s.pic[a], s.pic[b], s.world[a], s.world[b]];
		if (!pa || !pb || !wa || !wb) continue;
		if (minVis > 0 && !((pa[2] ?? 1) >= minVis && (pb[2] ?? 1) >= minVis)) continue;
		const m = Math.hypot(wb[0] - wa[0], wb[1] - wa[1]);
		if (m > 0.03) k.push(Math.hypot((pb[0] - pa[0]) * w, (pb[1] - pa[1]) * h) / m);
	}
	return k.length ? median(k) : null;
}
/** Lines the body's scale is read on: the shoulders, the hips and the torso's sides. */
const BODY_LINES: [number, number][] = [
	[11, 12],
	[23, 24],
	[11, 23],
	[12, 24],
];

/** Rig units a run of translate keys may stray from a followed position (the bake's tolerance is 0.45). */
export const FOLLOW_TOLERANCE = 0.5;

/**
 * The head is shifted only while its parent's card faces the viewer at least this much (the share of
 * its area the picture shows): edge-on, a shift in the picture is a long way in the card.
 */
const HEAD_FACING = 0.25;

type Pic = [number, number];

/**
 * The tracked points following reads, in the picture's pixels, smoothed by the map's filter (at the
 * frame's pixels per metre, so it smooths as the bones' points are): a pose point below the map's
 * visibility is a gap, and one off the picture too when `inside` (an anchor the tracker guessed past
 * the frame's edge, as the hips of a performer cut at the waist).
 */
function followPictures(
	track: MotionTrack,
	bodies: (Seen | null)[],
	hands: ReturnType<typeof handSides>[],
	times: number[],
	filter: RigMotion3d,
	span: number,
) {
	const { frames, width: W, height: H } = track;
	const smooth = (raw: (Pic | null)[]): (Pic | null)[] => {
		const axes = [0, 1].map((k) =>
			oneEuro(
				raw.map((p) => (p ? p[k] : null)),
				times,
				filter,
				span,
			),
		);
		return raw.map((p, i) => (p ? [axes[0][i]!, axes[1][i]!] : null));
	};
	const posePic = (i: number, k: number, inside: boolean): Pic | null => {
		const p = bodies[i]?.pic[k];
		if (!p || !((p[2] ?? 1) >= filter.minVisibility)) return null;
		if (inside && !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) return null;
		return [p[0] * W, p[1] * H];
	};
	const pointPic = (i: number, pt: FollowPoint, inside: boolean): Pic | null => {
		if ('face' in pt) {
			const lm = frames[i].face?.landmarks;
			const ps = pt.face.map((k) => lm?.[k] ?? null);
			if (!ps.length || ps.some((p) => !p)) return null;
			const sum = (k: number) => ps.reduce((s, p) => s + p![k], 0) / ps.length;
			return [sum(0) * W, sum(1) * H];
		}
		const r = pt.pose;
		if (typeof r === 'number') return posePic(i, r, inside);
		const a = posePic(i, r[0], inside);
		const b = posePic(i, r[1], inside);
		return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
	};
	const cache = new Map<string, (Pic | null)[]>();
	const cached = (key: string, make: () => (Pic | null)[]) => {
		let s = cache.get(key);
		if (!s) cache.set(key, (s = make()));
		return s;
	};
	return {
		of: (pt: FollowPoint, inside: boolean) =>
			cached(JSON.stringify([pt, inside]), () =>
				smooth(frames.map((_, i) => pointPic(i, pt, inside))),
			),
		/** A limb's end: the wrist of the hand found on it ({@link HAND_ON_WRIST}), else the pose's. */
		end: (l: FollowLimb) =>
			cached(`end:${l.upper}`, () =>
				smooth(
					frames.map((_, i) => {
						const p = pointPic(i, { pose: l.points[2] }, false);
						const h = l.hand ? hands[i][l.hand]?.landmarks[0] : null;
						const s1 = posePic(i, 11, false);
						const s2 = posePic(i, 12, false);
						if (!p || !h || !s1 || !s2) return p;
						const hp: Pic = [h[0] * W, h[1] * H];
						const on =
							Math.hypot(hp[0] - p[0], hp[1] - p[1]) <=
							HAND_ON_WRIST * Math.hypot(s1[0] - s2[0], s1[1] - s2[1]);
						return on ? hp : p;
					}),
				),
			),
	};
}

/** Samples of the end's depth a limb's reach is chosen from, each refinement. */
const DEPTH_SAMPLES = 24;
/**
 * The share of the tracked depth a reaching end keeps at least, so a hand in front of the body (or
 * behind it) stays there.
 */
const DEPTH_KEPT = 0.5;
/** Per rig unit², what straying from the tracked depth costs against the middle joint's distance². */
const DEPTH_PULL = 0.02;

/**
 * A two-bone limb reaching `end` in the picture (its x and y), at the depth that brings its middle
 * joint nearest the tracked one (`mid`) in the picture: a limb shorter than the performer's would
 * otherwise reach straighter than theirs. The depth is kept on the tracked side and at least
 * {@link DEPTH_KEPT} of it, and pulled toward it ({@link DEPTH_PULL}); with no tracked middle, the
 * tracked depth. Null when out of reach.
 */
function reachInDepth(
	root: V3,
	end: V3,
	mid: V3 | null,
	l1: number,
	l2: number,
	poles: (V3 | null)[],
): { mid: V3; end: V3 } | null {
	if (!mid) return twoBoneIk(root, end, l1, l2, poles);
	const dz = end[2] - root[2];
	const flat = Math.hypot(end[0] - root[0], end[1] - root[1]);
	const room = Math.sqrt(Math.max(0, (l1 + l2) ** 2 - flat ** 2));
	const side = dz < 0 ? -1 : 1;
	const near = Math.min(Math.abs(dz) * DEPTH_KEPT, room);
	const cost = (z: number) => {
		const ik = twoBoneIk(root, [end[0], end[1], root[2] + side * z], l1, l2, poles);
		if (!ik) return { ik, c: Infinity };
		const c =
			(ik.mid[0] - mid[0]) ** 2 + (ik.mid[1] - mid[1]) ** 2 + DEPTH_PULL * (side * z - dz) ** 2;
		return { ik, c };
	};
	let lo = near;
	let hi = Math.max(near, room);
	let best = cost(Math.min(Math.abs(dz), hi));
	let at = Math.min(Math.abs(dz), hi);
	for (let round = 0; round < 3; round++) {
		const step = (hi - lo) / DEPTH_SAMPLES;
		for (let k = 0; k <= DEPTH_SAMPLES; k++) {
			const z = lo + k * step;
			const got = cost(z);
			if (got.c < best.c) {
				best = got;
				at = z;
			}
		}
		[lo, hi] = [Math.max(near, at - step), Math.min(Math.max(near, room), at + step)];
	}
	return best.ik;
}

/**
 * A followed position per frame as translate keys: gaps held (leading ones from the first), reduced
 * to the frames a linear run needs to stay within {@link FOLLOW_TOLERANCE}. Null when never placed.
 */
function pathKeys(times: number[], at: (Pic | null)[]): FollowKey[] | null {
	const filled = held(at);
	if (!filled) return null;
	const n = filled.length;
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = n > 2 ? [[0, n - 1]] : [];
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		let worst = -1;
		let worstAt = -1;
		for (let i = a + 1; i < b; i++) {
			const u = (times[i] - times[a]) / (times[b] - times[a] || 1);
			const err = Math.hypot(
				filled[a][0] + u * (filled[b][0] - filled[a][0]) - filled[i][0],
				filled[a][1] + u * (filled[b][1] - filled[a][1]) - filled[i][1],
			);
			if (err > worst) {
				worst = err;
				worstAt = i;
			}
		}
		if (worstAt > 0 && worst > FOLLOW_TOLERANCE) {
			keep[worstAt] = 1;
			stack.push([a, worstAt], [worstAt, b]);
		}
	}
	const out: FollowKey[] = [];
	for (let i = 0; i < n; i++)
		if (keep[i])
			out.push({ time: round(times[i], 4), x: round(filled[i][0], 2), y: round(filled[i][1], 2) });
	return out;
}

/**
 * The 3D keys of a track (rig-2p5d §8). Entries are solved parents first, each against its parent's
 * world rotation as solved on the same frame: a limb along its two points, rolled to face the viewer;
 * a bone with a line across it (the shoulders, the hips, a palm's knuckles) turned to both; the head
 * to the face's 3D pose against the performer's neutral; an image turned square to the viewer. Points
 * are smoothed by the One-Euro filter first; a frame a bone's points are missing on holds its turn
 * from the frame before.
 */
export function solveBones3d(
	tpl: Motion3dTemplate,
	map: RigMotion3d,
	track: MotionTrack,
	times: number[],
	{ neutral, trace = false, follow }: { neutral?: number; trace?: boolean; follow?: Follow3d } = {},
): Solve3d {
	const { frames, width: W, height: H } = track;
	const n = frames.length;
	const byName = new Map(tpl.bones.map((b) => [b.name, b]));
	const entryOf = new Map(map.entries.map((e) => [e.bone, e]));
	const restOf = (bone: string, given?: [number, number]): V3 | null => {
		if (given) return unit([given[0], given[1], 0]);
		const child = tpl.bones.find((b) => b.parent === bone && (b.x !== 0 || b.y !== 0));
		return child ? unit([child.x, child.y, 0]) : null;
	};

	// Every point an entry reads, in the rig's frame (x right, y up, z toward the viewer; metres): the
	// picture's x and y at the frame's pixels per metre, the tracker's depth. Smoothed.
	const bodies: (Seen | null)[] = frames.map((f) =>
		f.pose?.landmarks && f.pose.world ? { pic: f.pose.landmarks, world: f.pose.world } : null,
	);
	const perFrame = bodies.map((s) =>
		s ? pixelsPerMetre(s, BODY_LINES, W, H, map.minVisibility) : null,
	);
	const typical = median(perFrame.filter((x): x is number => x !== null));
	const ppm = perFrame.map((x) => x ?? (Number.isFinite(typical) ? typical : null));
	const pointAt = (i: number, k: number): V3 | null => {
		const p = bodies[i]?.pic[k];
		const w = bodies[i]?.world[k];
		const scale = ppm[i];
		if (!p || !w || !scale || ![p[0], p[1], w[2]].every(Number.isFinite)) return null;
		if (!((p[2] ?? 1) >= map.minVisibility)) return null;
		return [(p[0] * W) / scale, (-p[1] * H) / scale, -w[2]];
	};
	const series = new Map<number, (V3 | null)[]>();
	const pointsOf = (k: number) => {
		let s = series.get(k);
		if (!s) {
			s = smoothPoints(
				frames.map((_, i) => pointAt(i, k)),
				times,
				map,
			);
			series.set(k, s);
		}
		return s;
	};
	const midOf = (a: (V3 | null)[], b: (V3 | null)[]): (V3 | null)[] =>
		a.map((p, i) => {
			const q = b[i];
			return p && q ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2] : null;
		});
	const ref = (r: LandmarkRef): (V3 | null)[] =>
		typeof r === 'number' ? pointsOf(r) : midOf(pointsOf(r[0]), pointsOf(r[1]));
	// Each side's hand as Hand Landmarker finds it (picture x, y at the frame's pixels per metre).
	const hands = frames.map((f) => handSides(f, W, H));
	const handSeries = new Map<string, (V3 | null)[]>();
	const handPointsOf = (side: 'l' | 'r', k: number) => {
		const key = `${side}${k}`;
		let s = handSeries.get(key);
		if (!s) {
			s = smoothPoints(
				frames.map((_, i) => {
					const p = hands[i][side]?.landmarks[k];
					const scale = ppm[i];
					return p && scale ? [(p[0] * W) / scale, (-p[1] * H) / scale, 0] : null;
				}),
				times,
				map,
			);
			handSeries.set(key, s);
		}
		return s;
	};
	const handRef = (side: 'l' | 'r', r: LandmarkRef): (V3 | null)[] =>
		typeof r === 'number'
			? handPointsOf(side, r)
			: midOf(handPointsOf(side, r[0]), handPointsOf(side, r[1]));
	/** An entry's direction and line across it on frame i (either may be missing). */
	const readPoints = (pts: Bone3dPoints, i: number) => {
		const line = (a: LandmarkRef, b: LandmarkRef) => {
			const p = ref(a)[i];
			const q = ref(b)[i];
			return p && q ? ([q[0] - p[0], q[1] - p[1], q[2] - p[2]] as V3) : null;
		};
		const posed = line(pts.from, pts.to);
		const h = pts.hand;
		const hp = h && hands[i][h.side] ? handRef(h.side, h.from)[i] : null;
		const hq = h && hp ? handRef(h.side, h.to)[i] : null;
		const at = ref(pts.from)[i];
		const [s1, s2] = [pointsOf(11)[i], pointsOf(12)[i]];
		const on =
			!!(hp && at && s1 && s2) &&
			Math.hypot(hp[0] - at[0], hp[1] - at[1]) <=
				HAND_ON_WRIST * Math.hypot(s1[0] - s2[0], s1[1] - s2[1]);
		const along: V3 | null =
			posed && on && hp && hq ? [hq[0] - hp[0], hq[1] - hp[1], posed[2]] : posed;
		const side = pts.across ? line(pts.across[0], pts.across[1]) : null;
		return along || side ? { along, side } : null;
	};

	// The head: the face's rotation against its neutral (the first second it is seen, or the moment
	// the author picked), as a turn of the world.
	const faceRot = frames.map((f) => (f.face?.matrix ? faceRotation(f.face.matrix) : null));
	const neutralAt = neutralFrames(
		times,
		faceRot.map((m) => m !== null),
		neutral,
	);
	const rest0 = meanTurn(neutralAt.map((i) => quatOf(faceRot[i]!)));
	const faceTurn = faceRot.map((m) =>
		m && rest0 ? quatOf(mul3(m, transpose3(matOf(rest0)))) : null,
	);
	const faceFilled = held(faceTurn);
	const faceSmooth = faceFilled ? smoothTurns(faceFilled, times, map) : null;

	// Following positions (rig-templates §5.8). The bones a limb reaches with are solved after every
	// other bone of the frame, so the root is placed on the solved body before an arm reaches from it.
	const fm = follow && map.positions ? map.positions : null;
	const limbOf = new Map((fm?.limbs ?? []).map((l) => [l.upper, l]));
	const underLimb = (name: string): boolean => {
		for (let b = byName.get(name); b; b = b.parent ? byName.get(b.parent) : undefined)
			if (limbOf.has(b.name)) return true;
		return false;
	};
	const order = fm
		? [
				...map.entries.filter((e) => !underLimb(e.bone)),
				...map.entries.filter((e) => underLimb(e.bone)),
			]
		: map.entries;
	const pic = followPictures(
		track,
		bodies,
		hands,
		times,
		map,
		Number.isFinite(typical) ? typical : 1,
	);
	const lineUp = follow?.lineUp ?? { k: 1, x0: 0, y0: 0 };
	const toRig = (p: readonly number[]): [number, number] => [
		lineUp.x0 + lineUp.k * p[0],
		lineUp.y0 - lineUp.k * p[1],
	];
	const offsetOf = (b: Motion3dTemplate['bones'][number]): V3 => [
		b.x,
		b.y,
		follow?.depths[b.name] ?? 0,
	];
	const rootBone = fm ? byName.get(fm.root.bone) : undefined;
	const rootAt: ([number, number] | null)[] = Array(n).fill(null);
	const headAt: ([number, number] | null)[] = Array(n).fill(null);
	const limbStats = new Map((fm?.limbs ?? []).map((l) => [l.upper, { reached: 0, outOfReach: 0 }]));
	let headClamped = 0;
	let lastRoot: [number, number] | null = null;

	// Solved frame by frame, parents first: each bone's turn from the setup and its world rotation.
	// With `fit`, the bones `played` names take those turns (the body as its keys play it) and the
	// rig is placed on the performer from them.
	const solvePass = (fit: RigPositions3d | null, played: Map<string, Quat[]> | null) => {
		const turns = new Map(map.entries.map((e) => [e.bone, Array<Quat | null>(n).fill(null)]));
		const worlds = new Map(map.entries.map((e) => [e.bone, [] as M3[]]));
		const normals = new Map<string, V3>();
		const facing = new Map<string, number>();
		const beyond = new Map<string, number>();
		const last = new Map<string, Quat>();
		for (let i = 0; i < n; i++) {
			const world = new Map<string, M3>();
			const worldOf = (name: string | undefined): M3 => {
				if (name === undefined) return IDENTITY3;
				const got = world.get(name);
				if (got) return got;
				const b = byName.get(name);
				if (!b) return IDENTITY3;
				const t = entryOf.has(name) ? last.get(name) : undefined;
				const w = mul3(mul3(worldOf(b.parent), rotZ(b.rotation ?? 0)), t ? matOf(t) : IDENTITY3);
				world.set(name, w);
				return w;
			};
			// A bone's place from the root's origin, before the root's own translate and scale.
			const posOf = (name: string): V3 => {
				const b = byName.get(name);
				if (!b || !b.parent || b === rootBone) return [0, 0, 0];
				const p = posOf(b.parent);
				const o = apply3(worldOf(b.parent), offsetOf(b));
				return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
			};
			const scale = follow?.rootScale[i] ?? 1;
			const origin: [number, number] = rootBone ? [rootBone.x, rootBone.y] : [0, 0];
			/** Where `bone` is on the rig, the root translated by `t`. */
			const placed = (bone: string, t: readonly number[]): [number, number] => {
				const q = posOf(bone);
				return [origin[0] + t[0] + scale * q[0], origin[1] + t[1] + scale * q[1]];
			};
			/** The mean of `marks`' tracked points less their bones' places (null: none seen). */
			const offBy = (marks: FollowMark[], t: readonly number[], inside: boolean) => {
				let x = 0;
				let y = 0;
				let k = 0;
				for (const m of marks) {
					const p = pic.of(m.point, inside)[i];
					if (!p) continue;
					const [rx, ry] = toRig(p);
					const [bx, by] = placed(m.bone, t);
					x += rx - bx;
					y += ry - by;
					k++;
				}
				return k ? ([x / k, y / k] as [number, number]) : null;
			};
			let root: [number, number] | null = null;
			const place = () => {
				if (!fit) return;
				const found = offBy(fit.root.anchors, [0, 0], true);
				root = found ?? lastRoot;
				if (found) rootAt[i] = lastRoot = found;
				const h = fit.head;
				const hb = h && byName.get(h.bone);
				const shift = h && hb && root ? offBy(h.marks, root, false) : null;
				if (!h || !hb || !shift) return;
				// The shift in the picture, as a translate in the parent's frame (as the bake projects it).
				const m = worldOf(hb.parent);
				const [a, b, c, d] = [m[0], m[1], m[3], m[4]].map((v) => v * scale);
				const det = a * d - b * c;
				if (!(Math.abs(det) > HEAD_FACING * scale * scale)) return;
				let x = (d * shift[0] - b * shift[1]) / det;
				let y = (a * shift[1] - c * shift[0]) / det;
				const len = Math.hypot(x, y);
				if (len > h.limit) {
					x *= h.limit / len;
					y *= h.limit / len;
					headClamped++;
				}
				headAt[i] = [x, y];
			};
			// Each limb's two bones aimed so its end lands on the tracked end (two-bone IK in 3D).
			const reach = new Map<string, V3>();
			const reachFor = (l: FollowLimb) => {
				const stat = limbStats.get(l.upper)!;
				const end = pic.end(l)[i];
				const lower = byName.get(l.lower);
				const tip = byName.get(l.end);
				if (!end || !root || !lower || !tip) return;
				const s = posOf(l.upper);
				const [rx, ry] = toRig(end);
				const perMetre = ((ppm[i] ?? typical) * lineUp.k) / scale;
				const [a3, m3, b3] = l.points.map((r) => ref(r)[i]);
				const local = (p: Pic, dz: number): V3 => {
					const [x, y] = toRig(p);
					return [
						(x - origin[0] - root![0]) / scale,
						(y - origin[1] - root![1]) / scale,
						s[2] + dz,
					];
				};
				const target = local(end, a3 && b3 ? (b3[2] - a3[2]) * perMetre : 0);
				const midPic = pic.of({ pose: l.points[1] }, false)[i];
				const mid = midPic ? local(midPic, a3 && m3 ? (m3[2] - a3[2]) * perMetre : 0) : null;
				const pole = posOf(l.pole);
				const poles = [
					mid ? ([mid[0] - s[0], mid[1] - s[1], mid[2] - s[2]] as V3) : null,
					[pole[0] - s[0], pole[1] - s[1], pole[2] - s[2]] as V3,
				];
				const l1 = Math.hypot(...offsetOf(lower));
				const l2 = Math.hypot(...offsetOf(tip));
				const ik = reachInDepth(s, target, mid, l1, l2, poles);
				if (!ik) {
					stat.outOfReach++;
					return;
				}
				stat.reached++;
				reach.set(l.upper, [ik.mid[0] - s[0], ik.mid[1] - s[1], ik.mid[2] - s[2]]);
				reach.set(l.lower, [ik.end[0] - ik.mid[0], ik.end[1] - ik.mid[1], ik.end[2] - ik.mid[2]]);
			};
			let isPlaced = false;
			for (const e of fit ? order : map.entries) {
				if (fit && !isPlaced && underLimb(e.bone)) {
					place();
					isPlaced = true;
				}
				const limb = fit && limbOf.get(e.bone);
				if (limb) reachFor(limb);
				const b = byName.get(e.bone);
				if (!b) continue;
				const keyed = played?.get(e.bone);
				if (keyed) {
					turns.get(e.bone)![i] = keyed[i];
					last.set(e.bone, keyed[i]);
					world.delete(e.bone);
					worlds.get(e.bone)!.push(worldOf(e.bone));
					continue;
				}
				const parent = worldOf(b.parent);
				const setup = b.rotation ?? 0;
				const base = mul3(parent, rotZ(setup));
				let turn: Quat | null = null;
				if (e.face) {
					if (faceTurn[i] && faceSmooth) turn = localTurn(parent, setup, matOf(faceSmooth[i]));
				} else if (e.viewer) {
					const up = apply3(base, [0, 1, 0]);
					const prev = facing.get(e.bone);
					const psi =
						Math.hypot(up[0], up[1]) > 1e-6 ? Math.atan2(up[1], up[0]) - Math.PI / 2 : prev;
					if (psi !== undefined) {
						facing.set(e.bone, psi);
						turn = localTurn(parent, setup, rotZ(psi * DEG));
					}
				} else {
					const rest = restOf(e.bone, e.rest);
					const read = rest && e.pose ? readPoints(e.pose, i) : null;
					const reached = reach.get(e.bone);
					const got = reached ? { along: reached, side: read?.side ?? null } : read;
					if (rest && got) {
						const restSide: V3 = e.acrossRest
							? (unit([e.acrossRest[0], e.acrossRest[1], 0]) ?? cross([0, 0, 1], rest))
							: cross([0, 0, 1], rest);
						const along = got.along ?? apply3(base, rest);
						let side = got.side ?? apply3(base, restSide);
						const a = e.roll === 'viewer' && !got.side ? unit(along) : null;
						if (a) {
							// The view direction made square to the limb is its card's normal; a limb pointing
							// straight at the viewer keeps the roll it had.
							const nz = across([0, 0, 1], a) ?? normals.get(e.bone);
							if (nz) {
								normals.set(e.bone, nz);
								side = cross(nz, a);
							}
						}
						const w = aimFrame({ along: rest, side: restSide }, along, side);
						if (w) turn = localTurn(parent, setup, w);
						if (turn && e.reach !== undefined) {
							const dir = apply3(matOf(turn), rest);
							const off =
								Math.acos(
									Math.max(-1, Math.min(1, dir[0] * rest[0] + dir[1] * rest[1] + dir[2] * rest[2])),
								) * DEG;
							if (off > e.reach) {
								beyond.set(e.bone, (beyond.get(e.bone) ?? 0) + 1);
								turn = null;
							}
						}
					}
				}
				const prev = last.get(e.bone);
				if (turn && prev && qdot(turn, prev) < 0) turn = turn.map((v) => -v) as Quat;
				turns.get(e.bone)![i] = turn;
				if (turn) last.set(e.bone, turn);
				world.delete(e.bone);
				worlds.get(e.bone)!.push(worldOf(e.bone));
			}
			if (fit && !isPlaced) place();
		}
		return { turns, worlds, beyond };
	};
	const first = solvePass(null, null);
	let { turns, worlds, beyond } = first;
	if (fm) {
		const played = new Map<string, Quat[]>();
		for (const e of map.entries) {
			const filled = underLimb(e.bone) ? null : held(first.turns.get(e.bone)!);
			if (filled) played.set(e.bone, keyedTurns(times, orientKeys(times, filled)));
		}
		const second = solvePass(fm, played);
		// The limbs as they reached, every other bone as first solved (its keys unchanged).
		const pick = <T>(a: Map<string, T>, b: Map<string, T>) => {
			const out = new Map<string, T>();
			for (const e of map.entries) {
				const v = (underLimb(e.bone) ? b : a).get(e.bone);
				if (v !== undefined) out.set(e.bone, v);
			}
			return out;
		};
		turns = pick(first.turns, second.turns);
		beyond = pick(first.beyond, second.beyond);
		worlds = second.worlds;
	}

	const out: Solve3d = {
		bones: {},
		unseen: [],
		beyond: Object.fromEntries([...beyond].map(([b, k]) => [b, round(k / Math.max(1, n), 3)])),
	};
	if (fm && follow) {
		out.translate = {};
		const rootKeys = pathKeys(times, rootAt);
		if (rootKeys) out.translate[fm.root.bone] = rootKeys;
		out.follow = {
			frames: n,
			lineUp,
			placed: rootAt.filter((p) => p !== null).length,
			limbs: Object.fromEntries(limbStats),
		};
		if (fm.head) {
			const headKeys = pathKeys(times, headAt);
			if (headKeys) out.translate[fm.head.bone] = headKeys;
			const sizes = headAt.filter((p) => p !== null).map((p) => Math.hypot(p[0], p[1]));
			out.follow.head = {
				bone: fm.head.bone,
				median: round(sizes.length ? median(sizes) : 0, 1),
				max: round(sizes.length ? Math.max(...sizes) : 0, 1),
				clamped: headClamped,
				limit: fm.head.limit,
			};
		}
	}
	if (trace) {
		out.turns = {};
		out.worlds = Object.fromEntries(worlds);
	}
	for (const e of map.entries) {
		const filled = held(turns.get(e.bone)!);
		// An image turned square to the viewer under parents that never turned stays at its setup.
		const still = !filled || (e.viewer && filled.every((q) => turnBetween(q, [1, 0, 0, 0]) < 1e-6));
		if (!filled || still) {
			if (!e.viewer) out.unseen.push(e.bone);
			continue;
		}
		out.bones[e.bone] = { orient: orientKeys(times, filled) };
		if (out.turns) out.turns[e.bone] = filled;
	}
	return out;
}
