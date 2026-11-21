/**
 * Which frame of a clip to turn into a rig (docs/design/frame-to-rig.md §4.1, phase F1).
 *
 * Every frame 🎥 Motion tracked is scored from its own track, in the browser, as the proof's
 * `proof.py pick` does:
 *
 * - **foreshortening**: each arm segment's drawn length over its length in the pose's 3D world
 *   points, scaled by the shoulders (1 = in the picture plane). A part cut short stays short;
 * - **hands over the body or the face**: the share of the torso box, and twice the face box, the
 *   hand boxes cover — what is under a hand must be made;
 * - **found**: the face and both hands, and how visible the six arm joints are.
 *
 * `score = mean(foreshortening) − ½ · cover − 0.5 (an arm joint under 0.8 visibility) −
 * 0.2 · (3 − found)`. The best frame is preselected; the strip shows each score and why.
 */
import type { MotionFrame, MotionTrack } from './rigMotion';

/** The template's `_l` is the picture's left: the performer's right side (pose 12 / 14 / 16). */
const ARM = {
	l: { shoulder: 12, elbow: 14, wrist: 16 },
	r: { shoulder: 11, elbow: 13, wrist: 15 },
} as const;
const SIDE_WORD = { l: 'left', r: 'right' } as const;
const SEGMENTS = [
	['shoulder', 'elbow', 'upper arm'],
	['elbow', 'wrist', 'forearm'],
] as const;
/** A segment drawn shorter than this share of its length is named in the reasons. */
const SHORT = 0.8;
const COVER_NOTED = 0.02;
const VISIBLE = 0.8;

type Box = [number, number, number, number];

export interface FrameScore {
	i: number;
	/** null: no body (or no 3D world points) in the frame, so it cannot be scored. */
	score: number | null;
	foreshortenMin: number;
	foreshortenMean: number;
	handCover: number;
	found: number;
	visibility: number;
	/** Why it scores lower than a frame with every limb in the picture plane, in words. */
	reasons: string[];
}

export interface FrameScores {
	rows: FrameScore[];
	/** The best frame's index; null when no frame could be scored. */
	best: number | null;
}

function boxOf(pts: [number, number][]): Box {
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The share of box `b` that box `a` covers. */
function boxOverlap(a: Box, b: Box): number {
	const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
	const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
	const area = Math.max(1e-9, (b[2] - b[0]) * (b[3] - b[1]));
	return (ix * iy) / area;
}

const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dist3 = (a: readonly number[], b: readonly number[]) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** One frame's score; `width` and `height` turn its normalised points into pixels. */
export function scoreFrame(f: MotionFrame, i: number, width: number, height: number): FrameScore {
	const none: FrameScore = {
		i,
		score: null,
		foreshortenMin: 0,
		foreshortenMean: 0,
		handCover: 0,
		found: 0,
		visibility: 0,
		reasons: ['no body found'],
	};
	const P = f.pose?.landmarks;
	const Wd = f.pose?.world;
	const used = [11, 12, 13, 14, 15, 16, 23, 24];
	if (!P || !Wd || used.some((k) => !P[k] || !Wd[k])) return none;
	const px = (k: number) => [P[k]![0] * width, P[k]![1] * height] as [number, number];
	const pxPerM = dist(px(11), px(12)) / Math.max(dist3(Wd[11]!, Wd[12]!), 1e-6);
	const fore: { v: number; side: 'l' | 'r'; name: string }[] = [];
	for (const side of ['l', 'r'] as const) {
		for (const [a, b, name] of SEGMENTS) {
			const ia = ARM[side][a];
			const ib = ARM[side][b];
			const drawn = dist(px(ia), px(ib));
			const real = dist3(Wd[ia]!, Wd[ib]!) * pxPerM;
			fore.push({ v: Math.min(1, drawn / Math.max(real, 1e-6)), side, name });
		}
	}
	const hands = (f.hands ?? []).map((h) =>
		boxOf(
			h.landmarks
				.filter((p): p is [number, number] => !!p)
				.map(([x, y]) => [x * width, y * height]),
		),
	);
	const torso = boxOf([px(11), px(12), px(23), px(24)]);
	const facePts = (f.face?.landmarks ?? []).filter((p): p is [number, number] => !!p);
	const face = facePts.length ? boxOf(facePts.map(([x, y]) => [x * width, y * height])) : null;
	let cover = 0;
	let overFace = 0;
	for (const hb of hands) {
		const onFace = face ? 2 * boxOverlap(hb, face) : 0;
		cover += boxOverlap(hb, torso) + onFace;
		overFace += onFace;
	}
	const visibility = Math.min(...[11, 12, 13, 14, 15, 16].map((k) => P[k]![2]));
	const found = (facePts.length ? 1 : 0) + hands.length;
	const mean = fore.reduce((s, x) => s + x.v, 0) / fore.length;
	const score = mean - 0.5 * cover - (visibility < VISIBLE ? 0.5 : 0) - 0.2 * (3 - found);
	const reasons: string[] = [];
	for (const x of [...fore].sort((a, b) => a.v - b.v))
		if (x.v < SHORT)
			reasons.push(`${SIDE_WORD[x.side]} ${x.name} at ${x.v.toFixed(2)} of its length`);
	if (overFace > COVER_NOTED) reasons.push('a hand over the face');
	if (cover - overFace > COVER_NOTED)
		reasons.push(`a hand over the body (${Math.round((cover - overFace) * 100)}%)`);
	if (visibility < VISIBLE) reasons.push('an arm joint hard to see');
	if (!facePts.length) reasons.push('no face found');
	if (hands.length < 2) reasons.push(hands.length ? 'one hand not found' : 'no hands found');
	return {
		i,
		score: round(score, 3),
		foreshortenMin: round(Math.min(...fore.map((x) => x.v)), 2),
		foreshortenMean: round(mean, 2),
		handCover: round(cover, 3),
		found,
		visibility: round(visibility, 2),
		reasons,
	};
}

/** Every frame of a track scored; the best is the highest score, the earliest on a tie. */
export function scoreFrames(track: MotionTrack): FrameScores {
	const rows = track.frames.map((f, i) => scoreFrame(f, i, track.width, track.height));
	let best: number | null = null;
	for (const r of rows)
		if (r.score !== null && (best === null || r.score > rows[best].score!)) best = r.i;
	return { rows, best };
}
