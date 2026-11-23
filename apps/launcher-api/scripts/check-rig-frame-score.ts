/**
 * Frame to rig's frame picker (docs/design/frame-to-rig.md §4.1, F1), offline:
 *   pnpm --filter launcher-api check:rig-frame-score
 *
 * On made-up tracks, each frame built from a pose drawn in pixels and its 3D world points:
 *  1. Every arm segment in the picture plane, both hands beside the body, the face found: 1, and
 *     nothing to say.
 *  2. A forearm pointing at the camera is scored by its drawn share of its 3D length, named by the
 *     picture's side (`_l` is the picture's left, pose 12 / 14 / 16).
 *  3. A hand over the body costs half the torso box it covers; over the face, twice as much.
 *  4. A hard-to-see arm joint costs 0.5; a missing face or hand 0.2 each; a frame with no body has
 *     no score and is never picked.
 *  5. Lengths are measured in pixels, so a tall frame scores as a square one; a segment never
 *     scores over 1 (shoulders turned away look short).
 *  6. The best frame is the highest score, the earliest on a tie.
 *  7. An arm segment with a joint past the frame's edge costs 0.5 and is named: the tracker places
 *     it at full visibility, but none of it is in the frame to cut (NellyAnimTest frame 113 scored
 *     1.00 with its right forearm outside the picture).
 *  8. Each part's best frame (F2g): each part scored on its own (an arm segment's drawn share,
 *     a hand over it, a palm edge-on, a face turned away), and the picks — a part another frame
 *     shows clearly better is taken from there (the nearest of equal frames), the neck with the
 *     head, a hand never, a gain under PICK_MARGIN not at all.
 * The scorer reproduced the proof's 130 rows on NellyAnimTest exactly (frame 0: 0.693, frame 114:
 * 0.986); that capture is the owner's, so it is not committed here.
 */
import {
	PICK_MARGIN,
	SCORED_PARTS,
	bestPartFrames,
	scoreFrame,
	scoreFrames,
	scoreParts,
} from '../src/lib/rigFrameScore';
import type { MotionFrame } from '../src/lib/rigMotion';

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : '  ' + detail}`);
	if (!ok) failed++;
}
const near = (a: number | null, b: number, tol = 0.011) => a !== null && Math.abs(a - b) <= tol;

type Pt = [number, number];
interface Pose {
	/** Pixels by pose index; z (metres, toward the camera negative) only for the world points. */
	px: Record<number, Pt>;
	z?: Record<number, number>;
	hands?: Pt[][];
	face?: Pt[] | null;
	visibility?: number;
}

/** A frame `w` × `h` from pixel points; the world points are the same, 100 px to the metre. */
function frame(
	{ px, z = {}, hands, face, visibility = 0.99 }: Pose,
	w: number,
	h: number,
): MotionFrame {
	const landmarks: [number, number, number][] = [];
	const world: [number, number, number][] = [];
	for (let k = 0; k < 33; k++) {
		const p = px[k] ?? [w / 2, h / 2];
		landmarks.push([p[0] / w, p[1] / h, [11, 12, 13, 14, 15, 16].includes(k) ? visibility : 0.99]);
		world.push([(p[0] - w / 2) / 100, (p[1] - h / 2) / 100, z[k] ?? 0]);
	}
	const norm = (pts: Pt[]) => pts.map(([x, y]) => [x / w, y / h] as [number, number]);
	return {
		t: 0,
		pose: { landmarks, world },
		hands: (hands ?? []).map((pts) => ({ landmarks: norm(pts), world: [] })),
		face: face === null ? null : { landmarks: norm(face ?? box(300, 60, 360, 140)), blend: {} },
	};
}

/** The four corners of a box, as a hand's or a face's points. */
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
	[x0, y0],
	[x1, y0],
	[x0, y1],
	[x1, y1],
];

// A T-ish pose on 640 × 640: shoulders 240 → 400, arms hanging out at the sides, hands beside the
// hips, the face above the shoulders. Upper arms 100 px, forearms 90 px, all in the picture plane.
const BASE: Record<number, Pt> = {
	11: [400, 200],
	12: [240, 200],
	13: [460, 280],
	14: [180, 280],
	15: [460, 370],
	16: [180, 370],
	23: [380, 420],
	24: [260, 420],
};
const HANDS: Pt[][] = [box(160, 375, 200, 430), box(440, 375, 480, 430)];
const W = 640;

const plane = scoreFrame(frame({ px: BASE, hands: HANDS }, W, W), 0, W, W);
check(
	'1. every limb in the picture plane, nothing covered, all found: 1',
	near(plane.score, 1, 1e-6),
	JSON.stringify(plane),
);
check('1. … and nothing to say', plane.reasons.length === 0, JSON.stringify(plane.reasons));

// 2. The right forearm (picture right: pose 13 → 15) points at the camera: drawn 30 px of 90.
const toward = { ...BASE, 15: [460, 310] as Pt };
const real = Math.sqrt(0.9 ** 2 - 0.3 ** 2);
const fore = scoreFrame(frame({ px: toward, z: { 15: -real }, hands: HANDS }, W, W), 0, W, W);
check(
	'2. a forearm toward the camera scores its drawn share of its length',
	near(fore.foreshortenMin, 1 / 3),
	JSON.stringify(fore),
);
check(
	'2. … the mean over the four segments is the score',
	near(fore.score, (3 + 1 / 3) / 4),
	String(fore.score),
);
check(
	"2. … named by the picture's side",
	fore.reasons[0] === 'right forearm at 0.33 of its length',
	JSON.stringify(fore.reasons),
);
const left = scoreFrame(
	frame({ px: { ...BASE, 16: [180, 310] }, z: { 16: -real }, hands: HANDS }, W, W),
	0,
	W,
	W,
);
check(
	"2. pose 12 / 14 / 16 is the template's left",
	left.reasons[0]?.startsWith('left forearm') === true,
	JSON.stringify(left.reasons),
);

// 3. A hand over the torso box (240..400 × 200..420): a 40 × 55 box inside it covers 2200 / 35200.
const overBody = scoreFrame(
	frame({ px: BASE, hands: [HANDS[0], box(300, 300, 340, 355)] }, W, W),
	0,
	W,
	W,
);
check(
	'3. a hand over the body costs half the share of the torso it covers',
	near(overBody.score, 1 - 0.5 * (2200 / 35200), 1e-3) &&
		near(overBody.handCover, 2200 / 35200, 1e-3),
	JSON.stringify(overBody),
);
check(
	'3. … and says so',
	overBody.reasons.includes('a hand over the body (6%)'),
	JSON.stringify(overBody.reasons),
);
const overFace = scoreFrame(
	frame({ px: BASE, hands: [HANDS[0], box(320, 80, 340, 100)] }, W, W),
	0,
	W,
	W,
);
check(
	'3. a hand over the face costs twice its share of the face',
	near(overFace.handCover, 2 * (400 / 4800), 1e-3),
	JSON.stringify(overFace),
);
check(
	'3. … and says so',
	overFace.reasons.includes('a hand over the face'),
	JSON.stringify(overFace.reasons),
);

// 4. Visibility, what was found, no body.
const hidden = scoreFrame(frame({ px: BASE, hands: HANDS, visibility: 0.5 }, W, W), 0, W, W);
check(
	'4. a hard-to-see arm joint costs 0.5',
	near(hidden.score, 0.5, 1e-6) && hidden.reasons.includes('an arm joint hard to see'),
	JSON.stringify(hidden),
);
const faceless = scoreFrame(frame({ px: BASE, hands: [HANDS[0]], face: null }, W, W), 0, W, W);
check(
	'4. no face and one hand cost 0.2 each',
	near(faceless.score, 0.6, 1e-6) && faceless.found === 1,
	JSON.stringify(faceless),
);
check(
	'4. … and say so',
	faceless.reasons.includes('no face found') && faceless.reasons.includes('one hand not found'),
	JSON.stringify(faceless.reasons),
);
const empty: MotionFrame = { t: 0, pose: null, face: null, hands: [] };
check('4. a frame with no body has no score', scoreFrame(empty, 3, W, W).score === null);

// 5. The same pose on a 640 × 1280 frame: lengths are pixels, not shares of the picture.
const tall = scoreFrame(frame({ px: BASE, hands: HANDS }, 640, 1280), 0, 640, 1280);
check('5. a tall frame scores as a square one', near(tall.score, 1, 1e-6), JSON.stringify(tall));
// Shoulders turned from the camera look short, so the arms look long against them: held at 1.
const turned = scoreFrame(
	frame({ px: BASE, z: { 11: 0.6, 13: 0.6, 15: 0.6 }, hands: HANDS }, W, W),
	0,
	W,
	W,
);
check(
	'5. a segment never scores over its whole length',
	near(turned.score, 1, 1e-6),
	JSON.stringify(turned),
);

// 6. The best frame.
const all = scoreFrames({
	width: W,
	height: W,
	frames: [
		empty,
		frame({ px: toward, z: { 15: -real }, hands: HANDS }, W, W),
		frame({ px: BASE, hands: HANDS }, W, W),
		frame({ px: BASE, hands: HANDS }, W, W),
	],
});
check(
	'6. the best frame is the highest score, the earliest on a tie',
	all.best === 2,
	String(all.best),
);
check(
	'6. no frame to score: none is picked',
	scoreFrames({ width: W, height: W, frames: [empty] }).best === null,
);

// 7. NellyAnimTest frame 113: the right arm reaches past the frame's edge, elbow and wrist outside
// it, the tracker still sure of both. Nothing of that forearm is in the frame to cut.
const pastEdge = { ...BASE, 13: [700, 280] as Pt, 15: [690, 190] as Pt };
const edge = scoreFrame(frame({ px: pastEdge, hands: HANDS }, W, W), 0, W, W);
check(
	'7. an arm segment with a joint past the frame costs 0.5',
	near(edge.score, 0.5, 1e-6) && edge.outOfPicture === 2,
	JSON.stringify(edge),
);
check(
	'7. … and says which',
	edge.reasons.includes('right upper arm, right forearm out of the picture'),
	JSON.stringify(edge.reasons),
);
check(
	'7. … so a frame with a forearm toward the camera beats it',
	scoreFrames({
		width: W,
		height: W,
		frames: [
			frame({ px: pastEdge, hands: HANDS }, W, W),
			frame({ px: toward, z: { 15: -real }, hands: HANDS }, W, W),
		],
	}).best === 1,
);

// 8. Each part's best frame (F2g). Hands and the face as the trackers give them: a hand's 21 points
// hanging from its wrist (open to the camera, or edge-on), the face's mesh with its eyes' outer
// corners (33, 263) and the nose tip (1).
function hand21([x, y]: Pt, open = true): Pt[] {
	const pts: Pt[] = Array.from({ length: 21 }, () => [x, y + 30] as Pt);
	pts[0] = [x, y];
	pts[9] = [x, y + 40];
	pts[5] = open ? [x - 9, y + 38] : [x - 1, y + 38];
	pts[17] = open ? [x + 9, y + 36] : [x + 1, y + 36];
	return pts;
}
function face478(noseX = 330): Pt[] {
	const pts: Pt[] = Array.from({ length: 478 }, () => [330, 100] as Pt);
	pts[33] = [305, 90];
	pts[263] = [355, 90];
	pts[1] = [noseX, 110];
	pts[10] = [330, 60];
	pts[152] = [330, 140];
	return pts;
}
const HANDS21 = [hand21(BASE[16]), hand21(BASE[15])];
const whole = (o: Partial<Pose> = {}) =>
	frame({ px: BASE, hands: HANDS21, face: face478(), ...o }, W, W);
const parts0 = scoreParts(whole(), W, W)!;
check(
	'8. every part whole, uncovered, facing the camera: 1 each, nothing to say',
	SCORED_PARTS.every(
		(p) => near(parts0[p].score, 1, 1e-6) && (p === 'neck' || !parts0[p].reasons.length),
	),
	JSON.stringify(parts0),
);
const short = scoreParts(
	frame({ px: toward, z: { 15: -real }, hands: HANDS21, face: face478() }, W, W),
	W,
	W,
)!;
check(
	'8. a forearm toward the camera scores its drawn share there, and says so',
	near(short.lower_arm_r.score, 1 / 3) &&
		short.lower_arm_r.reasons.includes('at 0.33 of its length') &&
		near(short.lower_arm_l.score, 1, 1e-6),
	JSON.stringify(short.lower_arm_r),
);
const handOnArm = scoreParts(whole({ hands: [hand21([205, 235]), hand21(BASE[15])] }), W, W)!;
check(
	'8. a hand over an upper arm costs it the share it covers, and says so',
	handOnArm.upper_arm_l.score < 0.9 &&
		handOnArm.upper_arm_l.reasons.some((r) => r.startsWith('a hand over it')),
	JSON.stringify(handOnArm.upper_arm_l),
);
const edgeOn = scoreParts(whole({ hands: [hand21(BASE[16], false), hand21(BASE[15])] }), W, W)!;
check(
	'8. a hand edge-on to the camera scores lower, and says so',
	edgeOn.hand_l.score < 0.6 && edgeOn.hand_l.reasons.some((r) => r.startsWith('its palm edge-on')),
	JSON.stringify(edgeOn.hand_l),
);
const away = scoreParts(whole({ face: face478(312) }), W, W)!;
check(
	'8. a face turned from the camera scores the head lower, the neck with it',
	away.head.score < 0.5 &&
		away.head.reasons.some((r) => r.startsWith('turned from the camera')) &&
		away.neck.score === away.head.score,
	JSON.stringify(away.head),
);
const picks = bestPartFrames(
	{
		width: W,
		height: W,
		// The main frame last: of two equal frames the nearer (1) is taken, not the earlier (0).
		frames: [
			whole(),
			whole(),
			frame(
				{
					px: toward,
					z: { 15: -real },
					hands: [hand21(BASE[16], false), hand21(BASE[15])],
					face: face478(312),
				},
				W,
				W,
			),
		],
	},
	2,
)!;
check(
	'8. a part another frame shows clearly better is taken from it (the nearest on a tie)',
	picks.lower_arm_r.frame === 1 &&
		picks.lower_arm_r.moved &&
		near(picks.lower_arm_r.main, 1 / 3) &&
		picks.lower_arm_r.mainReasons.includes('at 0.33 of its length') &&
		picks.head.frame === 1,
	JSON.stringify(picks.lower_arm_r),
);
check(
	'8. the neck goes with the head',
	picks.neck.frame === picks.head.frame && picks.neck.moved,
	JSON.stringify(picks.neck),
);
check(
	"8. a hand stays on the main frame (its fingers' bones are that frame's)",
	picks.hand_l.frame === 2 && !picks.hand_l.moved,
	JSON.stringify(picks.hand_l),
);
check(
	'8. a part the main frame shows well stays there',
	picks.upper_arm_l.frame === 2 && picks.torso.frame === 2,
	JSON.stringify([picks.upper_arm_l, picks.torso]),
);
// The forearm at 0.88 of its length here, whole in the next frame: better, not clearly.
const slight = Math.sqrt(0.9 ** 2 - (0.88 * 0.9) ** 2);
const nearly = bestPartFrames(
	{
		width: W,
		height: W,
		frames: [
			frame(
				{
					px: { ...BASE, 15: [460, 280 + 0.88 * 90] },
					z: { 15: -slight },
					hands: HANDS21,
					face: face478(),
				},
				W,
				W,
			),
			whole(),
		],
	},
	0,
)!;
check(
	`8. a frame better by under ${PICK_MARGIN} leaves the part on the main frame`,
	near(nearly.lower_arm_r.score, 0.88) && nearly.lower_arm_r.frame === 0,
	JSON.stringify(nearly.lower_arm_r),
);
check(
	'8. a main frame with no body has no picks',
	bestPartFrames({ width: W, height: W, frames: [empty, whole()] }, 0) === null,
);

if (failed) {
	console.error(`\n${failed} failed`);
	process.exit(1);
}
console.log('\nall passed');
