import type { MotionFilter, MotionFrame, MotionTrack } from './rigMotion';

/**
 * Hands from video onto a template rig (docs/design/rig-templates.md §5.3): MediaPipe's Hand
 * Landmarker answers 21 points per hand, in the picture and in the hand's own 3D space. Each entry
 * turns one of those hands into a 0…1 channel value; `rigMotion.solveMotion` smooths, clamps and keys
 * it like any other. Pure, so a fixture runs it headless.
 */

/** Hand Landmarker's points per hand: 0 wrist, 1–4 thumb, then index, middle, ring, pinky (4 each). */
export const HAND_LANDMARK_COUNT = 21;

/**
 * How far a digit bends: the sum of its joints' flexion, each `[a, b, c]` the turn at `b` from
 * `a → b` to `b → c` (0° straight). `rest` degrees reads as 0, `full` as 1.
 */
export interface HandCurlMotion {
	kind: 'curl';
	channel: string;
	/** Which of the picture's hands: `l` the picture's left, as the template's `_l`. */
	side: 'l' | 'r';
	joints: [number, number, number][];
	rest: number;
	full: number;
}

/** The angle between the lines `from` and `to` of one hand: `rest` degrees reads as 0, `full` as 1. */
export interface HandSpreadMotion {
	kind: 'spread';
	channel: string;
	side: 'l' | 'r';
	from: [number, number];
	to: [number, number];
	rest: number;
	full: number;
}

export type HandMotionEntry = HandCurlMotion | HandSpreadMotion;

export interface RigMotionHand extends MotionFilter {
	entries: HandMotionEntry[];
}

/** One hand found on a frame. */
export interface TrackedHand {
	/** MediaPipe's handedness, which assumes a mirrored (selfie) picture. */
	label?: 'Left' | 'Right';
	/** Normalised picture coordinates, x right and y down. */
	landmarks: ([number, number] | null)[];
	/** The hand's own 3D points (metres, origin near the palm): angles are read here. */
	world: ([number, number, number] | null)[];
}

type Sides = { l?: TrackedHand; r?: TrackedHand };
type P3 = readonly [number, number, number];

const DEG = 180 / Math.PI;
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Degrees between two directions, or null when either has no length. */
function between(u: P3, v: P3): number | null {
	const lu = Math.hypot(...u);
	const lv = Math.hypot(...v);
	if (!(lu > 0 && lv > 0)) return null;
	const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
	return Math.acos(Math.min(1, Math.max(-1, c))) * DEG;
}

/** Pose Landmarker's wrists: 16 is the performer's right, on the picture's left. */
const POSE_WRIST = { l: 16, r: 15 } as const;
const POSE_MIN_VISIBILITY = 0.5;

/**
 * Which found hand is the picture's left and which its right. With both of the body's wrists in
 * sight, each hand goes to the nearer wrist (both hands as the cheaper pairing); without them, two
 * hands go by where they are in the picture, and one by its handedness, read as an unmirrored video
 * (MediaPipe's "Left" there is the performer's right hand, on the picture's left).
 */
export function handSides(f: MotionFrame, width: number, height: number): Sides {
	const hands = (f.hands ?? []).filter((h) => h.landmarks[0]);
	if (!hands.length) return {};
	const at = (h: TrackedHand) => {
		const p = h.landmarks[0]!;
		return [p[0] * width, p[1] * height] as const;
	};
	const wrist = (side: 'l' | 'r') => {
		const p = f.pose?.landmarks[POSE_WRIST[side]];
		return p && (p[2] ?? 1) >= POSE_MIN_VISIBILITY
			? ([p[0] * width, p[1] * height] as const)
			: null;
	};
	const wl = wrist('l');
	const wr = wrist('r');
	if (wl && wr) {
		const d = (h: TrackedHand, w: readonly [number, number]) =>
			Math.hypot(at(h)[0] - w[0], at(h)[1] - w[1]);
		const [a, b] = hands;
		if (!b) return d(a, wl) <= d(a, wr) ? { l: a } : { r: a };
		return d(a, wl) + d(b, wr) <= d(a, wr) + d(b, wl) ? { l: a, r: b } : { l: b, r: a };
	}
	if (hands.length >= 2) {
		const [a, b] = [...hands].sort((x, y) => at(x)[0] - at(y)[0]);
		return { l: a, r: b };
	}
	return hands[0].label === 'Right' ? { r: hands[0] } : { l: hands[0] };
}

/** One entry's degrees on one hand, or null when a point it reads is missing. */
function degrees(e: HandMotionEntry, h: TrackedHand): number | null {
	const pt = (i: number) => h.world[i] ?? null;
	if (e.kind === 'spread') {
		const [a, b, c, d] = [...e.from, ...e.to].map(pt);
		return a && b && c && d ? between(sub(b, a), sub(d, c)) : null;
	}
	let sum = 0;
	for (const [i, j, k] of e.joints) {
		const [a, b, c] = [pt(i), pt(j), pt(k)];
		const flex = a && b && c ? between(sub(b, a), sub(c, b)) : null;
		if (flex === null) return null;
		sum += flex;
	}
	return sum;
}

/** Per-frame raw values of every hand entry (null = that hand not seen on that frame). */
export function handSeries(
	track: MotionTrack,
	hand: RigMotionHand,
): Map<string, (number | null)[]> {
	const sides = track.frames.map((f) => handSides(f, track.width, track.height));
	const out = new Map<string, (number | null)[]>();
	for (const e of hand.entries)
		out.set(
			e.channel,
			sides.map((s) => {
				const h = s[e.side];
				const deg = h ? degrees(e, h) : null;
				return deg === null ? null : (deg - e.rest) / (e.full - e.rest);
			}),
		);
	return out;
}
