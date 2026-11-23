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
 * - **found**: the face and both hands, and how visible the six arm joints are;
 * - **in the picture**: an arm segment with a joint past the frame's edge is not in the frame to cut
 *   (the tracker still places it, at full visibility).
 *
 * `score = mean(foreshortening) − ½ · cover − 0.5 (an arm joint under 0.8 visibility) − 0.5 (an arm
 * segment out of the picture) − 0.2 · (3 − found)`. The best frame is preselected; the strip shows
 * each score and why.
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
	/** How many arm segments have a joint past the frame's edge. */
	outOfPicture: number;
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
		outOfPicture: 0,
		reasons: ['no body found'],
	};
	const P = f.pose?.landmarks;
	const Wd = f.pose?.world;
	const used = [11, 12, 13, 14, 15, 16, 23, 24];
	if (!P || !Wd || used.some((k) => !P[k] || !Wd[k])) return none;
	const px = (k: number) => [P[k]![0] * width, P[k]![1] * height] as [number, number];
	const pxPerM = dist(px(11), px(12)) / Math.max(dist3(Wd[11]!, Wd[12]!), 1e-6);
	const outside = (k: number) => P[k]![0] < 0 || P[k]![0] > 1 || P[k]![1] < 0 || P[k]![1] > 1;
	const fore: { v: number; side: 'l' | 'r'; name: string }[] = [];
	const out: string[] = [];
	for (const side of ['l', 'r'] as const) {
		for (const [a, b, name] of SEGMENTS) {
			const ia = ARM[side][a];
			const ib = ARM[side][b];
			const drawn = dist(px(ia), px(ib));
			const real = dist3(Wd[ia]!, Wd[ib]!) * pxPerM;
			fore.push({ v: Math.min(1, drawn / Math.max(real, 1e-6)), side, name });
			if (outside(ia) || outside(ib)) out.push(`${SIDE_WORD[side]} ${name}`);
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
	const score =
		mean -
		0.5 * cover -
		(visibility < VISIBLE ? 0.5 : 0) -
		(out.length ? 0.5 : 0) -
		0.2 * (3 - found);
	const reasons: string[] = [];
	if (out.length) reasons.push(`${out.join(', ')} out of the picture`);
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
		outOfPicture: out.length,
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

// ---- Each part's best frame (frame-to-rig §12 F2g) ------------------------------------------------

/** The parts the cut makes, in the order the table lists them (`_l` the picture's left). */
export const SCORED_PARTS = [
	'head',
	'neck',
	'torso',
	'upper_arm_l',
	'lower_arm_l',
	'hand_l',
	'upper_arm_r',
	'lower_arm_r',
	'hand_r',
] as const;
export type ScoredPart = (typeof SCORED_PARTS)[number];

/** How a part shows on one frame: 1 whole, flat to the camera, uncovered, its joints sure. */
export interface PartScore {
	score: number;
	reasons: string[];
}

/** A part's pick: the frame it is cut from, its score there and why, and its score on the main frame. */
export interface PartPick extends PartScore {
	frame: number;
	main: number;
	mainReasons: string[];
	/** Taken from another frame than the main one. */
	moved: boolean;
}

/** Another frame is taken for a part only when it beats the main frame by this much… */
export const PICK_MARGIN = 0.15;
/** …and the main frame shows the part worse than this. */
export const PICK_GOOD = 0.9;
/** A hand stays on the main frame: its fingers' bones are that frame's (F2d). */
const NEVER_MOVED = new Set<ScoredPart>(['hand_l', 'hand_r']);
/** A hand's palm spread (index to pinky knuckle) over its length (wrist to middle knuckle), open. */
const PALM_OPEN = 0.45;

/** The share of a segment's points, from `a` up to `upTo` of the way to `b`, in any of `boxes`. */
function segmentCover(a: [number, number], b: [number, number], boxes: Box[], upTo = 1): number {
	const n = 20;
	let hit = 0;
	for (let k = 0; k <= n; k++) {
		const t = (k / n) * upTo;
		const [x, y] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
		if (boxes.some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3])) hit++;
	}
	return hit / (n + 1);
}

/** The share of segment `a`→`b`'s points within `r` of segment `c`→`d`: a limb across it. */
function segmentCrossed(
	a: [number, number],
	b: [number, number],
	c: [number, number],
	d: [number, number],
	r: number,
): number {
	const n = 20;
	let hit = 0;
	const [dx, dy] = [d[0] - c[0], d[1] - c[1]];
	const l2 = dx * dx + dy * dy || 1;
	for (let k = 0; k <= n; k++) {
		const [x, y] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
		const t = Math.min(1, Math.max(0, ((x - c[0]) * dx + (y - c[1]) * dy) / l2));
		if (Math.hypot(x - c[0] - t * dx, y - c[1] - t * dy) < r) hit++;
	}
	return hit / (n + 1);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * How each part shows on one frame (null: no body). An arm segment: its drawn share of its length
 * (pointing at the camera it is cut short), a hand or the other arm over it, its joints' visibility,
 * in the picture. A hand: found, its palm open to the camera, the other hand over it. The head (the
 * neck goes with it): the face found and turned to the camera, a hand over it. The torso: its
 * shoulders square to the camera, a hand or a forearm over it.
 */
export function scoreParts(
	f: MotionFrame,
	width: number,
	height: number,
): Record<ScoredPart, PartScore> | null {
	const P = f.pose?.landmarks;
	const Wd = f.pose?.world;
	const used = [11, 12, 13, 14, 15, 16, 23, 24];
	if (!P || !Wd || used.some((k) => !P[k] || !Wd[k])) return null;
	const px = (k: number) => [P[k]![0] * width, P[k]![1] * height] as [number, number];
	const shoulderPx = dist(px(11), px(12));
	const pxPerM = shoulderPx / Math.max(dist3(Wd[11]!, Wd[12]!), 1e-6);
	const outside = (k: number) => P[k]![0] < 0 || P[k]![0] > 1 || P[k]![1] < 0 || P[k]![1] > 1;
	// Each tracked hand to the side of the nearer pose wrist.
	const hands: Partial<Record<'l' | 'r', [number, number][]>> = {};
	for (const h of f.hands ?? []) {
		const pts = h.landmarks
			.filter((p): p is [number, number] => !!p)
			.map(([x, y]) => [x * width, y * height] as [number, number]);
		if (pts.length < 21) continue;
		const side = dist(pts[0], px(ARM.l.wrist)) <= dist(pts[0], px(ARM.r.wrist)) ? 'l' : 'r';
		hands[side] ??= pts;
	}
	const handBox = { l: hands.l ? boxOf(hands.l) : null, r: hands.r ? boxOf(hands.r) : null };
	const facePts = (f.face?.landmarks ?? []).filter((p): p is [number, number] => !!p);
	const face = facePts.length
		? facePts.map(([x, y]) => [x * width, y * height] as [number, number])
		: null;
	const out = {} as Record<ScoredPart, PartScore>;
	const limbR = 0.12 * shoulderPx;
	for (const s of ['l', 'r'] as const) {
		const o = s === 'l' ? 'r' : 'l';
		const other = [px(ARM[o].shoulder), px(ARM[o].elbow), px(ARM[o].wrist)];
		for (const [a, b, name] of SEGMENTS) {
			const [ia, ib] = [ARM[s][a], ARM[s][b]];
			const part = `${name === 'upper arm' ? 'upper_arm' : 'lower_arm'}_${s}` as const;
			const reasons: string[] = [];
			const drawn = dist(px(ia), px(ib));
			const fore = Math.min(1, drawn / Math.max(dist3(Wd[ia]!, Wd[ib]!) * pxPerM, 1e-6));
			if (fore < SHORT) reasons.push(`at ${fore.toFixed(2)} of its length`);
			// Its own hand at the wrist is where a forearm ends, not over it.
			const boxes = [handBox[o], name === 'upper arm' ? handBox[s] : null].filter(
				(q): q is Box => !!q,
			);
			const covered = segmentCover(px(ia), px(ib), boxes, name === 'forearm' ? 0.85 : 1);
			const crossed = Math.max(
				segmentCrossed(px(ia), px(ib), other[0], other[1], limbR),
				segmentCrossed(px(ia), px(ib), other[1], other[2], limbR),
			);
			if (covered > COVER_NOTED) reasons.push(`a hand over it (${pct(covered)})`);
			if (crossed > COVER_NOTED) reasons.push(`the other arm across it (${pct(crossed)})`);
			let score = fore - 0.8 * covered - 0.5 * crossed;
			const vis = Math.min(P[ia]![2], P[ib]![2]);
			if (vis < VISIBLE) {
				reasons.push(`its joints hard to see (${vis.toFixed(2)})`);
				score -= 0.5;
			}
			if (outside(ia) || outside(ib)) {
				reasons.push('out of the picture');
				score -= 1;
			}
			out[part] = { score: round(score, 3), reasons };
		}
		const hand = hands[s];
		if (!hand) out[`hand_${s}`] = { score: -1, reasons: ['not found'] };
		else {
			const reasons: string[] = [];
			const open = Math.min(
				1,
				dist(hand[5], hand[17]) / Math.max(dist(hand[0], hand[9]), 1e-6) / PALM_OPEN,
			);
			let score = 0.4 + 0.6 * open;
			if (open < 0.6) reasons.push(`its palm edge-on (${open.toFixed(2)})`);
			const over = handBox[o];
			const covered = over ? boxOverlap(over, boxOf(hand)) : 0;
			if (covered > COVER_NOTED) {
				reasons.push(`the other hand over it (${pct(covered)})`);
				score -= covered;
			}
			if (hand.some(([x, y]) => x < 0 || y < 0 || x > width || y > height)) {
				reasons.push('out of the picture');
				score -= 1;
			}
			out[`hand_${s}`] = { score: round(score, 3), reasons };
		}
	}
	if (!face) out.head = { score: -1, reasons: ['no face found'] };
	else {
		const reasons: string[] = [];
		// Turned to the camera: the face's forward axis against the camera's (its 3D matrix), else
		// the nose between the eyes' outer corners.
		const m = f.face?.matrix;
		const [l, r, nose] = [face[33], face[263], face[1]];
		const facing =
			m && m.length === 16
				? Math.abs(m[10]) / Math.max(Math.hypot(m[8], m[9], m[10]), 1e-9)
				: l && r && nose
					? Math.min(dist(nose, l), dist(nose, r)) / Math.max(dist(nose, l), dist(nose, r), 1e-9)
					: 1;
		if (facing < 0.85) reasons.push(`turned from the camera (${facing.toFixed(2)})`);
		const fb = boxOf(face);
		const covered = Math.min(
			1,
			[handBox.l, handBox.r].reduce((sum, q) => sum + (q ? boxOverlap(q, fb) : 0), 0),
		);
		if (covered > COVER_NOTED) reasons.push(`a hand over the face (${pct(covered)})`);
		out.head = { score: round(facing - 1.5 * covered, 3), reasons };
	}
	out.neck = { score: out.head.score, reasons: ['taken with the head'] };
	const square = Math.min(1, shoulderPx / Math.max(dist3(Wd[11]!, Wd[12]!) * pxPerM, 1e-6));
	const torso = boxOf([px(11), px(12), px(23), px(24)]);
	const handsOver = Math.min(
		1,
		[handBox.l, handBox.r].reduce((sum, q) => sum + (q ? boxOverlap(q, torso) : 0), 0),
	);
	const armsOver = Math.max(
		...(['l', 'r'] as const).map((s) => segmentCover(px(ARM[s].elbow), px(ARM[s].wrist), [torso])),
	);
	const reasons: string[] = [];
	if (handsOver > COVER_NOTED) reasons.push(`a hand over it (${pct(handsOver)})`);
	if (armsOver > 0.2) reasons.push(`a forearm across it (${pct(armsOver)})`);
	out.torso = { score: round(Math.max(-1, square - handsOver - 0.3 * armsOver), 3), reasons };
	return out;
}

/**
 * Each part's frame: the frame `main` is cut from, unless another shows the part clearly better (by
 * PICK_MARGIN, where `main` shows it under PICK_GOOD), the earliest best on a tie. The neck goes
 * with the head; a hand stays on `main`. Null when `main` has no body.
 */
export function bestPartFrames(
	track: MotionTrack,
	main: number,
): Record<ScoredPart, PartPick> | null {
	const scored = track.frames.map((f) => scoreParts(f, track.width, track.height));
	const here = scored[main];
	if (!here) return null;
	const out = {} as Record<ScoredPart, PartPick>;
	for (const part of SCORED_PARTS) {
		if (part === 'neck') continue;
		let best = main;
		if (!NEVER_MOVED.has(part) && here[part].score < PICK_GOOD)
			scored.forEach((s, i) => {
				if (!s) return;
				const [v, b] = [s[part].score, scored[best]![part].score];
				// On a tie the frame nearest the main one: its drawing is likeliest to match the rest.
				if (v > b + 1e-3 || (v >= b - 1e-3 && Math.abs(i - main) < Math.abs(best - main))) best = i;
			});
		if (scored[best]![part].score < here[part].score + PICK_MARGIN) best = main;
		out[part] = {
			...scored[best]![part],
			frame: best,
			main: here[part].score,
			mainReasons: here[part].reasons,
			moved: best !== main,
		};
	}
	out.neck = {
		...out.head,
		reasons: ['taken with the head'],
		main: here.neck.score,
		mainReasons: here.neck.reasons,
	};
	return out;
}
