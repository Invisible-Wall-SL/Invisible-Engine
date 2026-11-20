import type {
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplateClipKey,
} from './server/rigTemplates';
import type { BoneKeys3d, Quat } from './rig2p5d';
import type { M3 } from './rig3dMath';
import {
	solveBones3d,
	type FollowKey,
	type FollowReport,
	type LineUp,
	type RigMotion3d,
} from './rigMotion3d';
import { handSeries, type RigMotionHand, type TrackedHand } from './rigMotionHand';

/**
 * Motion from video or a Flipbook clip onto a template rig (rig templates T5 + T7b,
 * docs/design/rig-templates.md §5.3). The page tracks the frames with MediaPipe's Face Landmarker,
 * Pose Landmarker and Hand Landmarker (`rigMotionHand`); this module turns that track into channel keys — the same
 * `[time, channel, value]` shape a starter clip has — so the Rigger writes them through its one
 * keying path. Pure: no DOM, no MediaPipe, so a fixture runs it headless.
 *
 * Which landmark or blendshape drives which channel is the template's `motion` data, never decided
 * here. A 2D rig shows depth only as foreshortening, draw order, parallax and image swaps, so that is
 * what the depth entries key: a limb's shortening from its 3D direction, a hand in front of or behind
 * the body, the head's turn and nod from the face's 3D pose, the torso's turn and the body coming
 * nearer (docs/design/rig-templates.md §5.4).
 */

/** MediaPipe Face Landmarker's 52 blendshape names (Blendshape V2 model card, appendix). */
export const FACE_BLENDSHAPES = [
	'_neutral',
	'browDownLeft',
	'browDownRight',
	'browInnerUp',
	'browOuterUpLeft',
	'browOuterUpRight',
	'cheekPuff',
	'cheekSquintLeft',
	'cheekSquintRight',
	'eyeBlinkLeft',
	'eyeBlinkRight',
	'eyeLookDownLeft',
	'eyeLookDownRight',
	'eyeLookInLeft',
	'eyeLookInRight',
	'eyeLookOutLeft',
	'eyeLookOutRight',
	'eyeLookUpLeft',
	'eyeLookUpRight',
	'eyeSquintLeft',
	'eyeSquintRight',
	'eyeWideLeft',
	'eyeWideRight',
	'jawForward',
	'jawLeft',
	'jawOpen',
	'jawRight',
	'mouthClose',
	'mouthDimpleLeft',
	'mouthDimpleRight',
	'mouthFrownLeft',
	'mouthFrownRight',
	'mouthFunnel',
	'mouthLeft',
	'mouthLowerDownLeft',
	'mouthLowerDownRight',
	'mouthPressLeft',
	'mouthPressRight',
	'mouthPucker',
	'mouthRight',
	'mouthRollLower',
	'mouthRollUpper',
	'mouthShrugLower',
	'mouthShrugUpper',
	'mouthSmileLeft',
	'mouthSmileRight',
	'mouthStretchLeft',
	'mouthStretchRight',
	'mouthUpperUpLeft',
	'mouthUpperUpRight',
	'noseSneerLeft',
	'noseSneerRight',
] as const;

/** Face Landmarker answers 478 points (468 mesh + 10 iris); Pose Landmarker 33. */
export const FACE_LANDMARK_COUNT = 478;
export const POSE_LANDMARK_COUNT = 33;

/** A landmark by index, or the midpoint of two. */
export type LandmarkRef = number | [number, number];

/**
 * Which gain of the import row a face entry answers to, so an author can turn up a performer's
 * weak brows without the head swinging further.
 */
export const FACE_GROUPS = ['mouth', 'eyes', 'brows', 'gaze', 'head'] as const;
export type FaceGroup = (typeof FACE_GROUPS)[number];

/**
 * The groups auto-range is set for in the import row: the face's, the body's turns (torso, arms,
 * wrists) and the hands' curls.
 */
export const FIT_GROUPS = [...FACE_GROUPS, 'body', 'hands'] as const;
export type FitGroup = (typeof FIT_GROUPS)[number];

/**
 * The auto-range group an entry is fitted in, or null for one that is never fitted: a depth effect
 * (it has its own strength), a root move, a mouth shape (a part, not a number), a face entry with
 * no group.
 */
export function fitGroupOf(
	e: { kind: string; group?: string; axis?: string },
	map: 'face' | 'body' | 'hand',
): FitGroup | null {
	if (depthEffectOf(e)) return null;
	if (map === 'hand') return 'hands';
	if (map === 'body') return e.kind === 'bone' ? 'body' : null;
	if (e.kind === 'shape') return null;
	return (FACE_GROUPS as readonly string[]).includes(e.group ?? '') ? (e.group as FaceGroup) : null;
}

/**
 * Whether past the top of its channel an entry's reading is the top itself: a blink marked
 * `saturate`, and a finger's curl (past a fist is a fist).
 */
export const saturates = (e: { kind: string; saturate?: boolean }) =>
	e.kind === 'curl' || (e.kind === 'blend' && e.saturate === true);

/**
 * `offset + gain × (mean(plus) − mean(minus))` of the frame's blendshape scores, each score taken
 * against the performer's NEUTRAL (the same score on the neutral frames), so a face whose resting
 * eyes or brows already score high reads as the rig's rest. `rest: 'median'` takes the track's own
 * median off instead (a performance with no neutral moment); `'zero'` takes nothing off.
 */
export interface FaceBlendMotion {
	kind: 'blend';
	channel: string;
	group?: FaceGroup;
	plus: string[];
	minus?: string[];
	gain: number;
	offset?: number;
	rest?: 'zero' | 'median' | 'neutral';
	/**
	 * Past the channel's top the reading IS the top (an eye shut is shut): auto-range leaves that
	 * side as it is, and it is not reported as motion lost.
	 */
	saturate?: boolean;
}

/**
 * The line `from → to` in degrees (counter-clockwise on screen), × gain, against the neutral
 * frames (`neutral`), frame 0 (`first`) or the picture's horizontal (`level`).
 */
export interface FaceAngleMotion {
	kind: 'angle';
	channel: string;
	group?: FaceGroup;
	from: LandmarkRef;
	to: LandmarkRef;
	gain: number;
	rest: 'level' | 'first' | 'neutral';
}

/**
 * How far `point` sits off the middle of `between` along the picture's x or y (up), as a share of
 * the distance between them, × gain, against the neutral frames (frame 0 with `rest: 'first'`). A
 * nose off the eye line → a head turn.
 */
export interface FaceOffsetMotion {
	kind: 'offset';
	channel: string;
	group?: FaceGroup;
	point: LandmarkRef;
	between: [LandmarkRef, LandmarkRef];
	axis: 'x' | 'y';
	gain: number;
	rest?: 'first' | 'neutral';
}

/**
 * The nearest of a shapes channel's parts: each feature is the mean of its blendshapes (against the
 * neutral, × the group's gain), each part a point in that feature space (a feature it leaves out is
 * 0). A shape shown for less than `hold` seconds is skipped, so a mouth does not flicker between two
 * near shapes.
 */
export interface FaceShapeMotion {
	kind: 'shape';
	channel: string;
	group?: FaceGroup;
	features: Record<string, string[]>;
	shapes: Record<string, Record<string, number>>;
	hold: number;
}

/**
 * The head's turn (`yaw`, + toward the picture's right) or nod (`pitch`, + up) in degrees, or how
 * much nearer the face is (`near`, the log of the neutral distance over the frame's: 0.1 ≈ 10%
 * nearer), read from the face's 3D pose (Face Landmarker's transformation matrix) against the
 * neutral frames, × gain. `near` answers the import's approach strength, not a face group.
 */
export interface FacePoseMotion {
	kind: 'pose';
	channel: string;
	group?: FaceGroup;
	axis: 'yaw' | 'pitch' | 'near';
	gain: number;
}

export type FaceMotionEntry =
	FaceBlendMotion | FaceAngleMotion | FaceOffsetMotion | FaceShapeMotion | FacePoseMotion;

/**
 * A bone turned to lie along `from → to` in the picture, written through `channel` (which must
 * rotate this bone or one of its parents). `rest` is the bone's direction in the setup pose; none =
 * toward its first child.
 */
export interface BodyBoneMotion {
	kind: 'bone';
	channel: string;
	bone: string;
	from: LandmarkRef;
	to: LandmarkRef;
	rest?: [number, number];
	/**
	 * Shorter than this share of the body scale, the line is a gap: two ears that overlap when the
	 * performer turns side-on have no angle worth reading.
	 */
	minSpan?: number;
}

/** The root moved as `point` moves from frame 0, scaled to rig units, through a translate channel. */
export interface BodyRootMotion {
	kind: 'root';
	channel: string;
	point: LandmarkRef;
	axis: 'x' | 'y';
}

/**
 * A limb shortened as it points toward or away from the camera: `from → to`'s length in the picture
 * over its whole 3D length (the world points), written as `bone`'s scale along the limb through the
 * channel (its scaleX or scaleY drive on `bone`). The channel's range is the floor.
 */
export interface BodyForeshortenMotion {
	kind: 'foreshorten';
	channel: string;
	bone: string;
	from: LandmarkRef;
	to: LandmarkRef;
}

/**
 * `point` in front of or behind the body, in depth: each step is taken when `point` is deeper than
 * `behind` by more than `margin` metres (and, with `above` / `below`, higher / lower in the picture
 * than that point: a hand behind the head is above the shoulders, one behind the back below them),
 * deepest step first; the channel is set to that step's `at`, or to its rest. Read with
 * {@link DEPTH_HYSTERESIS} and held at least {@link DEPTH_HOLD}, so it never flickers. Drives a
 * draw-order channel (`order`) or a swap channel (a front and a behind slot).
 */
export interface BodyDepthMotion {
	kind: 'depth';
	channel: string;
	point: LandmarkRef;
	steps: {
		at: number;
		behind: LandmarkRef;
		margin: number;
		above?: LandmarkRef;
		below?: LandmarkRef;
	}[];
}

/**
 * The body turned toward the picture's right (+) or left, from how far one end of each line sits
 * behind the other (world points; the lines' turns are averaged): `yaw` reads its degrees × gain
 * (a ¾ or side image swap), `width` how much narrower it shows, 1 − cos(yaw), × gain.
 */
export interface BodyTurnMotion {
	kind: 'turn';
	channel: string;
	lines: [LandmarkRef, LandmarkRef][];
	read: 'yaw' | 'width';
	gain: number;
}

/**
 * The performer coming nearer or going away: the picture's length of each line over its length in
 * the world's picture plane (pixels per metre), against the first second, written as `bone`'s scale
 * through the channel (its scaleY drive on `bone`).
 */
export interface BodyApproachMotion {
	kind: 'approach';
	channel: string;
	bone: string;
	lines: [LandmarkRef, LandmarkRef][];
}

export type BodyMotionEntry =
	| BodyBoneMotion
	| BodyRootMotion
	| BodyForeshortenMotion
	| BodyDepthMotion
	| BodyTurnMotion
	| BodyApproachMotion;

/**
 * The depth effects an import can turn down or off, each answering one kind of entry: limbs
 * shortened, hands in front or behind, the torso's turn, the body's distance. The head's turn and nod
 * answer the face's `head` gain, as its tilt does.
 */
export const DEPTH_EFFECTS = ['foreshorten', 'order', 'turn', 'approach'] as const;
export type DepthEffect = (typeof DEPTH_EFFECTS)[number];

/** Which depth effect an entry answers to, or null for one that is not a depth reading. */
export function depthEffectOf(e: { kind: string; axis?: string }): DepthEffect | null {
	if (e.kind === 'foreshorten') return 'foreshorten';
	if (e.kind === 'depth') return 'order';
	if (e.kind === 'turn' || e.kind === 'approach') return e.kind;
	if (e.kind === 'pose' && e.axis === 'near') return 'approach';
	return null;
}

/**
 * How far a point must come back past a depth step's margin to leave it, in metres: two to six
 * times the frame-to-frame jitter of a wrist's depth against the shoulders on real footage (0.004 to
 * 0.026 m, §5.4), so tracker noise at the boundary does not swap the draw order back and forth.
 */
export const DEPTH_HYSTERESIS = 0.06;
/** A depth step shorter than this, in seconds, is not keyed (a one-frame swap is a tracker blip). */
export const DEPTH_HOLD = 0.15;
/**
 * A depth entry's point is read down to this visibility, below the body's own floor: a hand behind
 * the body is hidden by it, and on real footage the far arm of a performer turned side-on read
 * behind the torso at a median visibility of 0.22. Below it the point may be out of the picture.
 */
export const DEPTH_MIN_VISIBILITY = 0.1;

/**
 * The One-Euro filter's settings ({@link oneEuro}): `smooth` is its time constant at rest, in
 * seconds (how much tracker jitter it irons out while nothing moves); `follow` is how fast it opens
 * up with speed, per channel range per second, so a blink or a jaw snap keeps its peak.
 */
export interface MotionFilter {
	smooth: number;
	follow?: number;
}

export interface RigMotionFace extends MotionFilter {
	entries: FaceMotionEntry[];
}

export interface RigMotionBody extends MotionFilter {
	/** A landmark below this visibility is a gap, held from the frame before. */
	minVisibility: number;
	/** The picture's `from → to` length (median over the frames) equals `rig` rig units. */
	scale: { from: LandmarkRef; to: LandmarkRef; rig: number };
	entries: BodyMotionEntry[];
}

/** A template's motion mapping: which tracked points drive which channels. */
export interface RigMotionMap {
	face?: RigMotionFace;
	body?: RigMotionBody;
	hand?: RigMotionHand;
	/**
	 * A 2.5D template's 3D map (docs/design/rig-2p5d.md §8): each bone's 3D turn from the track, for
	 * the import with {@link MotionOptions.three}; the channels it `replaces` are then not keyed.
	 */
	bones3d?: RigMotion3d;
	/** What this template cannot take from a video, said to the author after every import. */
	cannot: string[];
}

/** One tracked frame. Landmarks are MediaPipe's normalised image coordinates (x right, y down). */
export interface MotionFrame {
	t: number;
	face?: {
		landmarks: ([number, number] | null)[];
		blend: Record<string, number>;
		/**
		 * Face Landmarker's facial transformation matrix (4 × 4, column-major: the canonical face to
		 * the camera, centimetres), the head's turn and distance in 3D.
		 */
		matrix?: number[];
	} | null;
	pose?: {
		landmarks: ([number, number, number] | null)[];
		/** Pose Landmarker's world points: metres from the hips' middle, y down, z away from the camera. */
		world?: ([number, number, number] | null)[];
	} | null;
	hands?: TrackedHand[] | null;
}

export interface MotionTrack {
	/** Picture size in pixels, so x and y are measured in the same unit. */
	width: number;
	height: number;
	frames: MotionFrame[];
}

/** What the solve needs of a template: its skeleton, channels and motion map. */
export interface MotionTemplate {
	bones: RigTemplateBone[];
	channels: RigTemplateChannel[];
	motion?: RigMotionMap;
}

export interface MotionClip {
	channel: string;
	/** Share of the tracked frames whose value was beyond the channel's range. */
	share: number;
	lo: number;
	hi: number;
	/** The depth effect the channel answers to (a limb past its shortest, a turn past its widest). */
	effect?: DepthEffect;
}

/**
 * A channel auto-range scaled into its range ({@link fitRange}): the performer's spread (its p2 and
 * p98, in the channel's units) and the factor each side of the rest was scaled by (1 = untouched).
 */
export interface MotionFit {
	channel: string;
	lo: number;
	hi: number;
	below: number;
	above: number;
}

/** One numeric channel through the solve, frame by frame (null = not measured on that frame). */
export interface MotionStages {
	/** The tracked reading before any scaling: a blendshape mix against the neutral, degrees, … */
	raw: (number | null)[];
	/** × the entry's and the group's gain (+ offset): the channel's value, before its range. */
	scaled: (number | null)[];
	/** After auto-range ({@link fitRange}); the scaled values where nothing was fitted. */
	fitted: (number | null)[];
	/** Held inside the channel's range. */
	clamped: (number | null)[];
	/** After the filter, gaps held. */
	smoothed: number[];
	/** What the reduced keys play back at each frame (linear between keys). */
	keyed: number[];
}

export interface MotionSolve {
	/** Channel keys from time 0 (the first frame), sorted by time. */
	keys: RigTemplateClipKey[];
	/** Seconds from the first to the last frame. */
	length: number;
	channels: string[];
	clipped: MotionClip[];
	/** Channels auto-range scaled into their range, and by how much. */
	fitted: MotionFit[];
	/**
	 * Frames whose body points the tracker named the other way round (the performer's right on the
	 * picture's right: a mirrored video, a turned back), read by where they are in the picture.
	 */
	swapped: number;
	/** Frames where nothing was found (no face, no body). */
	untracked: number;
	/** Channels never measured (their points were never seen). */
	unseen: string[];
	/** Seconds from the start of the frames the face's neutral was read on, or null (body only). */
	neutral: [number, number] | null;
	/** Every numeric channel stage by stage, when {@link MotionOptions.trace} asks for it. */
	stages?: Record<string, MotionStages>;
	/**
	 * With {@link MotionOptions.three}: each bone's 3D keys from time 0 — `orient` quaternions, a
	 * hinge's 2D `rotate` — for the 2.5D rig's sidecar, which the bake turns into 2D keys.
	 */
	bones3d?: Record<string, BoneKeys3d>;
	/** With `three`: per bone, the share of frames the tracker turned it past its reach (held instead). */
	beyond3d?: Record<string, number>;
	/** With `three` and `trace`: per bone, its turn from the setup and world rotation on every frame. */
	solved3d?: { turns: Record<string, Quat[]>; worlds: Record<string, M3[]> };
	/**
	 * With {@link MotionOptions.follow}: per bone, its translate keys from time 0 (the root, the bone
	 * the head hangs from), in place of the channels that translate them.
	 */
	translate?: Record<string, FollowKey[]>;
	follow?: FollowReport;
}

export interface MotionOptions {
	face?: boolean;
	body?: boolean;
	hand?: boolean;
	/** Key reduction tolerance, as a share of each channel's range. */
	tolerance?: number;
	/**
	 * Multiplies each face group's readings (against the neutral, so a resting face stays at rest).
	 * A drawn face scores its expressions weaker than a filmed one (drawn closed eyes read about
	 * 0.4), so a cartoon wants about 2 on the eyes and mouth. Unnamed groups are 1.
	 */
	gain?: Partial<Record<FaceGroup, number>>;
	/**
	 * Seconds from the start of the performance at which the performer's face is at rest: the
	 * neutral is read over the frames within {@link NEUTRAL_HALF} of it. None = the first
	 * {@link NEUTRAL_LEAD} seconds the face is seen.
	 */
	neutral?: number;
	/**
	 * Each depth effect's strength (0 = off, its channels are not keyed); unnamed effects are 1. It
	 * scales the effect against rest: a limb's shortening, a turn, the change in distance.
	 */
	depth?: Partial<Record<DepthEffect, number>>;
	/**
	 * Auto-range strength per group, 0 (off: past the range is held at its edge) to 1 (the
	 * performer's p2–p98 spread is scaled to fit the range); unnamed groups are off. Only ever scales
	 * down, never up: a control that barely moved would turn tracker noise into motion (the face's
	 * gains lift a weak performer).
	 */
	fit?: Partial<Record<FitGroup, number>>;
	/** Return {@link MotionSolve.stages}. */
	trace?: boolean;
	/**
	 * Solve the template's 3D map (`bones3d`) into {@link MotionSolve.bones3d}, and leave the channels
	 * it replaces unkeyed: an import into a 2.5D rig's 3D clip.
	 */
	three?: boolean;
	/**
	 * With {@link three}, on a template whose 3D map has `positions`: positions as well as turns
	 * (rig-templates §5.8) — the root moves with the performer, the limbs reach the tracked ends, the
	 * head goes onto the tracked face — through the picture's line-up on the rig (the reference
	 * overlay's), with the rig's depths.
	 */
	follow?: { lineUp: LineUp; depths: Record<string, number> };
}

/**
 * Degrees a reduced key run may stray from a turn's solved curve (key reduction's tolerance is
 * otherwise a share of the range: 2% of an elbow's ±168° is 6.7°).
 */
export const ROTATE_TOLERANCE = 1;

/** The share of frames auto-range lets past each edge: the performer's p2 and p98 meet the range. */
export const FIT_TAIL = 0.02;

/**
 * A channel's values scaled into its range about its rest, each side on its own: past the far edge,
 * the side's `tail`-quantile is brought to the edge at `strength` 1 (half-way at ½), so the motion
 * keeps its shape instead of flattening at the edge. A side with no room past the rest (a jaw's
 * closed edge), or the top with `keepTop` (a channel that saturates), is left as it is. Never
 * stretches. Null when nothing was scaled.
 */
export function fitRange(
	values: (number | null)[],
	ch: { min: number; max: number; rest: number },
	strength: number,
	{ tail = FIT_TAIL, keepTop = false }: { tail?: number; keepTop?: boolean } = {},
): { values: (number | null)[]; lo: number; hi: number; below: number; above: number } | null {
	const s = Math.min(1, Math.max(0, strength));
	const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
	if (!(s > 0) || nums.length < 10) return null;
	const sorted = [...nums].sort((a, b) => a - b);
	const at = (p: number) => sorted[Math.round(p * (sorted.length - 1))];
	const lo = at(tail);
	const hi = at(1 - tail);
	const side = (edge: number, far: number) => {
		const room = edge - ch.rest;
		const reach = far - ch.rest;
		if (room === 0 || Math.sign(room) !== Math.sign(reach) || Math.abs(reach) <= Math.abs(room))
			return 1;
		return 1 - s * (1 - room / reach);
	};
	const above = keepTop ? 1 : side(ch.max, hi);
	const below = side(ch.min, lo);
	if (above === 1 && below === 1) return null;
	const k = (v: number) => (v >= ch.rest ? above : below);
	return {
		values: values.map((v) => (v === null ? null : ch.rest + (v - ch.rest) * k(v))),
		lo,
		hi,
		below,
		above,
	};
}

/** Left/right pairs of Pose Landmarker's 33 points (performer's left first). */
const POSE_PAIRS: [number, number][] = [
	[1, 4],
	[2, 5],
	[3, 6],
	[7, 8],
	[9, 10],
	[11, 12],
	[13, 14],
	[15, 16],
	[17, 18],
	[19, 20],
	[21, 22],
	[23, 24],
	[25, 26],
	[27, 28],
	[29, 30],
	[31, 32],
];
/**
 * How far apart the shoulders must be in the picture, as a share of their median spread, before
 * their order decides the sides: closer is side-on, where the order wobbles.
 */
export const SIDE_MARGIN = 0.25;

/**
 * The track with each frame's body points named by the picture: a template's `_l` is the picture's
 * left, read from the performer's right (point 12) on an unmirrored, front-on video. Where the
 * tracker puts point 12 clearly right of 11 (a mirrored video, a turned back) the frame's left and
 * right points (and world points) are swapped, so an arm on the picture's left always drives the
 * rig's left arm; side-on, the order of the frame before holds.
 */
export function pictureSides(track: MotionTrack): { track: MotionTrack; swapped: number } {
	const spans: number[] = [];
	const gap = (f: MotionFrame) => {
		const p = f.pose?.landmarks;
		const a = p?.[11];
		const b = p?.[12];
		if (!a || !b || !((a[2] ?? 1) >= 0.5) || !((b[2] ?? 1) >= 0.5)) return null;
		return (b[0] - a[0]) * track.width;
	};
	for (const f of track.frames) {
		const g = gap(f);
		if (g !== null) spans.push(Math.abs(g));
	}
	const width = median(spans);
	if (!(width > 0)) return { track, swapped: 0 };
	let swap = false;
	let swapped = 0;
	const swapPts = <T>(pts: (T | null)[] | undefined) => {
		if (!pts) return pts;
		const out = [...pts];
		for (const [a, b] of POSE_PAIRS) [out[a], out[b]] = [pts[b] ?? null, pts[a] ?? null];
		return out;
	};
	const frames = track.frames.map((f) => {
		const g = gap(f);
		if (g !== null && Math.abs(g) > SIDE_MARGIN * width) swap = g > 0;
		if (!swap || !f.pose) return f;
		swapped++;
		return {
			...f,
			pose: {
				landmarks: swapPts(f.pose.landmarks) as ([number, number, number] | null)[],
				...(f.pose.world
					? { world: swapPts(f.pose.world) as ([number, number, number] | null)[] }
					: {}),
			},
		};
	});
	return { track: { ...track, frames }, swapped };
}

/**
 * How long the neutral is read over when it is the performance's first moments, in seconds: long
 * enough that a blink or a word inside it is outvoted by the median.
 */
export const NEUTRAL_LEAD = 1;
/** The half-width of the window a chosen neutral moment is read over, in seconds. */
export const NEUTRAL_HALF = 0.25;

const DEG = 180 / Math.PI;
const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;

type Pt = [number, number];

/** A landmark in picture pixels with y UP, or null when missing / not visible enough. */
function point(
	lms: readonly (readonly number[] | null)[] | undefined,
	ref: LandmarkRef,
	w: number,
	h: number,
	minVis = 0,
): Pt | null {
	const one = (i: number): Pt | null => {
		const p = lms?.[i];
		if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
		if (p.length > 2 && minVis > 0 && !((p[2] ?? 1) >= minVis)) return null;
		return [p[0] * w, -p[1] * h];
	};
	if (typeof ref === 'number') return one(ref);
	const a = one(ref[0]);
	const b = one(ref[1]);
	return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
}

const angleOf = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG;

/**
 * The head's turn and nod in degrees from Face Landmarker's transformation matrix (column-major; the
 * camera looks down −z, y up): where the face's front points. `yaw` + = toward the picture's right,
 * `pitch` + = up. Null for a matrix with no front.
 */
export function headPose(
	m: readonly number[],
): { yaw: number; pitch: number; near: number } | null {
	const [x, y, z] = [m[8], m[9], m[10]];
	if (![x, y, z].every(Number.isFinite) || !(Math.hypot(x, y, z) > 0)) return null;
	const far = -m[14];
	return {
		yaw: Math.atan2(x, z) * DEG,
		pitch: Math.atan2(y, Math.hypot(x, z)) * DEG,
		near: far > 0 ? -Math.log(far) : NaN,
	};
}
/** a − b folded into (−180, 180]. */
const angleDiff = (a: number, b: number) => {
	let d = (a - b) % 360;
	if (d > 180) d -= 360;
	if (d <= -180) d += 360;
	return d;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const median = (xs: number[]) => {
	if (!xs.length) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each bone's parent chain, nearest first. */
function ancestry(bones: RigTemplateBone[]): Map<string, string[]> {
	const parent = new Map(bones.map((b) => [b.name, b.parent]));
	const out = new Map<string, string[]>();
	for (const b of bones) {
		const chain: string[] = [];
		for (let p = b.parent; p !== undefined; p = parent.get(p)) chain.push(p);
		out.set(b.name, chain);
	}
	return out;
}

/** The setup direction of a bone: its `rest`, else toward its first child. */
export function boneRestDirection(
	bones: RigTemplateBone[],
	bone: string,
	rest?: [number, number],
): Pt | null {
	if (rest) return rest;
	const child = bones.find((b) => b.parent === bone && (b.x !== 0 || b.y !== 0));
	return child ? [child.x, child.y] : null;
}

/**
 * Degrees a channel turns `bone` in the world per unit of its value: its rotate drives on the bone
 * and on every parent (a turned parent carries the child).
 */
export function worldTurnPer(
	ch: RigTemplateChannel,
	bone: string,
	chain: Map<string, string[]>,
): number {
	const hit = new Set([bone, ...(chain.get(bone) ?? [])]);
	let per = 0;
	for (const d of ch.drives ?? []) if (d.prop === 'rotate' && hit.has(d.bone)) per += d.per;
	return per;
}

/** The One-Euro filter's default `follow` (beta), per channel range per second. */
export const ONE_EURO_FOLLOW = 4;

/**
 * The One-Euro filter (Casiez, Roussel & Vogel, CHI 2012) over a series with gaps: a low-pass whose
 * cutoff rises with the signal's speed, so a resting face loses its tracker jitter while a blink or
 * a jaw snap keeps its peak (a fixed Gaussian flattens both alike). Values are taken as shares of
 * `span` (the channel's range), so `follow` means the same on degrees and on 0…1. Run forward and
 * backward and averaged, so it adds no lag. A gap stays a gap and restarts the filter.
 */
export function oneEuro(
	values: (number | null)[],
	times: number[],
	{ smooth, follow = ONE_EURO_FOLLOW }: MotionFilter,
	span = 1,
): (number | null)[] {
	if (!(smooth > 0)) return [...values];
	const minCutoff = 1 / (2 * Math.PI * smooth);
	const dCutoff = 1;
	const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
	const k = span > 0 ? span : 1;
	const pass = (order: number[]) => {
		const out: (number | null)[] = values.map(() => null);
		let x: number | null = null;
		let dx = 0;
		let tPrev = 0;
		for (const i of order) {
			const v = values[i];
			if (v === null) {
				x = null;
				continue;
			}
			const raw = v / k;
			const dt = Math.abs(times[i] - tPrev);
			if (x === null || !(dt > 0)) {
				x = raw;
				dx = 0;
			} else {
				dx += alpha(dCutoff, dt) * ((raw - x) / dt - dx);
				x += alpha(minCutoff + follow * Math.abs(dx), dt) * (raw - x);
			}
			tPrev = times[i];
			out[i] = x * k;
		}
		return out;
	};
	const idx = values.map((_, i) => i);
	const fwd = pass(idx);
	const back = pass(idx.reverse());
	return fwd.map((f, i) => (f === null ? null : (f + (back[i] as number)) / 2));
}

/** Gaps held from the frame before (leading gaps from the first measured frame); null if none. */
export function fillGaps(values: (number | null)[]): number[] | null {
	const first = values.find((v) => v !== null);
	if (first === undefined || first === null) return null;
	let last = first;
	return values.map((v) => (v === null ? last : (last = v)));
}

/**
 * The turning points of a series that rise or fall at least `tol` against the turning points either
 * side (a zig-zag with that threshold): every peak and trough the motion really has, and none of the
 * tracker's wobble.
 */
export function turningPoints(values: number[], tol: number): number[] {
	const out: number[] = [];
	let dir = 0;
	let ext = 0;
	for (let i = 1; i < values.length; i++) {
		const v = values[i];
		if (dir === 0) {
			if (Math.abs(v - values[0]) > tol) {
				dir = v > values[0] ? 1 : -1;
				ext = i;
			}
		} else if (dir * (v - values[ext]) > 0) ext = i;
		else if (dir * (values[ext] - v) > tol) {
			out.push(ext);
			dir = -dir;
			ext = i;
		}
	}
	return out;
}

/**
 * The samples a linear key run needs to stay within `tol` of every sample: every turning point
 * ({@link turningPoints}), so a peak is never cut off, then Ramer–Douglas–Peucker between them;
 * indices, first and last always kept.
 */
export function reduceKeys(times: number[], values: number[], tol: number): number[] {
	const n = values.length;
	if (n <= 2) return Array.from({ length: n }, (_, i) => i);
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	for (const i of turningPoints(values, tol)) keep[i] = 1;
	const fixed: number[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) fixed.push(i);
	const stack: [number, number][] = [];
	for (let j = 1; j < fixed.length; j++) stack.push([fixed[j - 1], fixed[j]]);
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		let worst = -1;
		let at = -1;
		for (let i = a + 1; i < b; i++) {
			const f = (times[i] - times[a]) / (times[b] - times[a] || 1);
			const err = Math.abs(values[i] - (values[a] + f * (values[b] - values[a])));
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

/** The swap step a value shows (index into `swaps`, the last at or below it). */
const swapStep = (ch: RigTemplateChannel, v: number) => {
	let s = 0;
	for (const [i, w] of (ch.swaps ?? []).entries()) if (v >= w.at - 1e-9) s = i;
	return s;
};

/**
 * The frames the performer's neutral face is read on: those within {@link NEUTRAL_HALF} of `at`
 * seconds (the nearest seen frame when none is), else the first {@link NEUTRAL_LEAD} seconds the face
 * is seen. Indices into the frames; empty when no face is seen at all.
 */
export function neutralFrames(times: number[], seen: boolean[], at?: number): number[] {
	const idx = times.map((_, i) => i).filter((i) => seen[i]);
	if (!idx.length) return [];
	if (at === undefined || !Number.isFinite(at)) {
		const from = times[idx[0]];
		return idx.filter((i) => times[i] <= from + NEUTRAL_LEAD + 1e-9);
	}
	const near = idx.filter((i) => Math.abs(times[i] - at) <= NEUTRAL_HALF + 1e-9);
	if (near.length) return near;
	let best = idx[0];
	for (const i of idx) if (Math.abs(times[i] - at) < Math.abs(times[best] - at)) best = i;
	return [best];
}

interface FaceReading {
	entry: FaceMotionEntry;
	/** The reading against its rest, before any gain (a part name for a shape). */
	raw: (number | string | null)[];
	scaled: (number | string | null)[];
}

/**
 * Per-frame readings of every face entry (null = not measured on that frame). An angle (the head's
 * tilt) is the bone's turn in the picture, so the turn the body already gives that bone
 * (`parentTurn`, against the neutral frames) is taken off it: a head held level while the shoulders
 * tilt stays level.
 */
function faceSeries(
	track: MotionTrack,
	face: RigMotionFace,
	gains: Partial<Record<FaceGroup, number>>,
	neutral: number[],
	depth: Partial<Record<DepthEffect, number>>,
	parentTurn: (channel: string) => number[] | null,
): Map<string, FaceReading> {
	const { width: w, height: h, frames } = track;
	const out = new Map<string, FaceReading>();
	const rests = new Map<string, number>();
	/** A blendshape's score on the neutral frames (their median). */
	const rest = (n: string) => {
		let v = rests.get(n);
		if (v === undefined) {
			v = median(neutral.map((i) => frames[i].face?.blend[n] ?? 0));
			if (!Number.isFinite(v)) v = 0;
			rests.set(n, v);
		}
		return v;
	};
	for (const e of face.entries) {
		const effect = depthEffectOf(e);
		const g = effect
			? Math.max(0, depth[effect] ?? 1)
			: ((e.group ? gains[e.group] : undefined) ?? 1);
		if (effect && g === 0) continue;
		const againstNeutral =
			e.kind === 'shape' || (e.kind === 'blend' && (e.rest ?? 'neutral') === 'neutral');
		const score = (fc: { blend: Record<string, number> }, n: string) =>
			(fc.blend[n] ?? 0) - (againstNeutral ? rest(n) : 0);
		const reading = (f: MotionFrame): number | string | null => {
			const fc = f.face;
			if (!fc) return null;
			if (e.kind === 'blend') {
				const at = (names: string[]) => mean(names.map((n) => score(fc, n)));
				return at(e.plus) - (e.minus ? at(e.minus) : 0);
			}
			if (e.kind === 'shape') {
				const feat = Object.fromEntries(
					Object.entries(e.features).map(([k, names]) => [
						k,
						g * mean(names.map((n) => score(fc, n))),
					]),
				);
				let best: string | null = null;
				let bestD = Infinity;
				for (const [part, at] of Object.entries(e.shapes)) {
					let d = 0;
					for (const k of Object.keys(e.features)) d += (feat[k] - (at[k] ?? 0)) ** 2;
					if (d < bestD) {
						bestD = d;
						best = part;
					}
				}
				return best;
			}
			if (e.kind === 'angle') {
				const a = point(fc.landmarks, e.from, w, h);
				const b = point(fc.landmarks, e.to, w, h);
				return a && b ? angleOf(a, b) : null;
			}
			if (e.kind === 'pose') {
				const pose = fc.matrix ? headPose(fc.matrix) : null;
				return pose && Number.isFinite(pose[e.axis]) ? pose[e.axis] : null;
			}
			const p = point(fc.landmarks, e.point, w, h);
			const a = point(fc.landmarks, e.between[0], w, h);
			const b = point(fc.landmarks, e.between[1], w, h);
			if (!p || !a || !b) return null;
			const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
			if (!(span > 0)) return null;
			const k = e.axis === 'x' ? 0 : 1;
			return (p[k] - (a[k] + b[k]) / 2) / span;
		};
		let raw = frames.map(reading);
		if (e.kind === 'angle' || e.kind === 'offset' || e.kind === 'pose') {
			const nums = raw as (number | null)[];
			const firstSeen = nums.find((v): v is number => v !== null);
			const atNeutral = neutral.map((i) => nums[i]).filter((v): v is number => v !== null);
			const mode = e.kind === 'pose' ? 'neutral' : (e.rest ?? 'neutral');
			const turns = e.kind === 'angle' || (e.kind === 'pose' && e.axis !== 'near');
			// Angles are taken against their neutral through angleDiff, so a line near ±180° does not
			// average across the fold.
			const base =
				mode === 'level'
					? 0
					: mode === 'first' || !atNeutral.length
						? (firstSeen ?? 0)
						: turns
							? (atNeutral[0] ?? 0) + median(atNeutral.map((v) => angleDiff(v, atNeutral[0])))
							: median(atNeutral);
			raw = nums.map((v) => (v === null ? null : turns ? angleDiff(v, base) : v - base));
		}
		let scaled: (number | string | null)[] =
			e.kind === 'shape'
				? raw
				: (raw as (number | null)[]).map((v) =>
						v === null ? null : (e.kind === 'blend' ? (e.offset ?? 0) : 0) + e.gain * g * v,
					);
		if (e.kind === 'blend' && e.rest === 'median') {
			const nums = scaled as (number | null)[];
			const mid = median(nums.filter((v): v is number => v !== null));
			if (Number.isFinite(mid))
				scaled = nums.map((v) => (v === null ? null : v - mid + (e.offset ?? 0)));
		}
		const carried = e.kind === 'angle' ? parentTurn(e.channel) : null;
		if (carried) {
			const at = median(neutral.map((i) => carried[i]));
			const base = Number.isFinite(at) ? at : carried[0];
			scaled = (scaled as (number | null)[]).map((v, i) =>
				v === null ? null : v - (carried[i] - base),
			);
		}
		out.set(e.channel, { entry: e, raw, scaled });
	}
	return out;
}

type P3 = [number, number, number];

/** A world point (metres, y down, z away from the camera), or null when missing or not visible. */
function worldPoint(f: MotionFrame, ref: LandmarkRef, minVis: number): P3 | null {
	const one = (i: number): P3 | null => {
		const p = f.pose?.world?.[i];
		const seen = f.pose?.landmarks?.[i];
		if (!p || !p.every(Number.isFinite) || !seen || !((seen[2] ?? 1) >= minVis)) return null;
		return [p[0], p[1], p[2]];
	};
	if (typeof ref === 'number') return one(ref);
	const a = one(ref[0]);
	const b = one(ref[1]);
	return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;
}

/** A channel's scale per unit on `bone` (its scaleX or scaleY drive there), or 0. */
export function scalePer(ch: RigTemplateChannel, bone: string): number {
	return (
		ch.drives?.find((d) => d.bone === bone && (d.prop === 'scaleY' || d.prop === 'scaleX'))?.per ??
		0
	);
}

/**
 * A body series: its values, and whether they are steps (a draw order) rather than a curve; `raw` is
 * the reading before auto-range and the range, `fitted` after auto-range (a bone or a curl).
 */
interface BodyReading {
	values: (number | null)[];
	raw: (number | null)[];
	fitted: (number | null)[];
	stepped: boolean;
}

/**
 * A depth step series held through its blips: a run shorter than {@link DEPTH_HOLD} takes the run
 * before it, so a swap of draw order is keyed only when it lasts.
 */
export function holdSteps(values: (number | null)[], times: number[]): (number | null)[] {
	const out = [...values];
	let runStart = -1;
	let prev: number | null = null;
	const close = (end: number) => {
		if (runStart < 0 || prev === null) return;
		const len = times[Math.min(end, times.length - 1)] - times[runStart];
		if (end < times.length && len < DEPTH_HOLD - 1e-9) {
			const before = out.slice(0, runStart).findLast((v) => v !== null);
			if (before !== undefined && before !== null)
				for (let j = runStart; j < end; j++) if (out[j] !== null) out[j] = before;
		}
	};
	for (let i = 0; i < out.length; i++) {
		const v = out[i];
		if (v === null || v === prev) continue;
		close(i);
		runStart = i;
		prev = v;
	}
	return out;
}

/**
 * Per-frame values of every body entry, solved down the chain: a bone's channel value is the turn
 * it still needs once the channels already solved for its parents have turned it — at the values
 * they are keyed at, after auto-range and the range — so a child keeps its direction in the picture
 * whatever its parents could not follow. Depth entries read the world points (§5.4), each scaled by
 * its effect's strength; an effect at 0 is not read. `filled` gets each bone channel's gap-filled
 * series, for the face's head tilt to be solved under the body.
 */
function bodySeries(
	track: MotionTrack,
	tpl: MotionTemplate,
	body: RigMotionBody,
	clipCount: Map<string, number>,
	depth: Partial<Record<DepthEffect, number>>,
	times: number[],
	fit: Partial<Record<FitGroup, number>>,
	fits: MotionFit[],
	filled: Map<string, number[]>,
): Map<string, BodyReading> {
	const { width: w, height: h, frames } = track;
	const chain = ancestry(tpl.bones);
	const chan = new Map(tpl.channels.map((c) => [c.id, c]));
	const lms = (f: MotionFrame) => f.pose?.landmarks;
	const pt = (f: MotionFrame, ref: LandmarkRef) => point(lms(f), ref, w, h, body.minVisibility);
	const w3 = (f: MotionFrame, ref: LandmarkRef) => worldPoint(f, ref, body.minVisibility);
	const lengths: number[] = [];
	for (const f of frames) {
		const a = pt(f, body.scale.from);
		const b = pt(f, body.scale.to);
		if (a && b) lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
	}
	const unit = body.scale.rig / median(lengths);
	const strength = (e: BodyMotionEntry) => {
		const effect = depthEffectOf(e);
		return effect ? Math.max(0, depth[effect] ?? 1) : 1;
	};
	const entries = body.entries.filter((e) => strength(e) > 0);
	const out = new Map<string, BodyReading>();
	for (const e of entries) {
		const values = frames.map(() => null);
		out.set(e.channel, { values, raw: values, fitted: values, stepped: e.kind === 'depth' });
	}
	// Pixels per metre in the picture's plane, for the distance: each line's picture length over its
	// world length across the picture (a turned line shortens in both alike).
	const nearness = (f: MotionFrame, lines: [LandmarkRef, LandmarkRef][]) => {
		const k: number[] = [];
		for (const [from, to] of lines) {
			const a = pt(f, from);
			const b = pt(f, to);
			const wa = w3(f, from);
			const wb = w3(f, to);
			if (!a || !b || !wa || !wb) continue;
			const m = Math.hypot(wb[0] - wa[0], wb[1] - wa[1]);
			if (m > 0.02) k.push(Math.hypot(b[0] - a[0], b[1] - a[1]) / m);
		}
		return k.length ? median(k) : null;
	};
	// Entry by entry, parents first (`rigTemplateProblem` checks the order): a child is solved against
	// each parent's gap-filled series, the value the parent is keyed at, so a frame where a parent is
	// a gap does not solve the child as if the parent were at rest.
	for (const e of entries) {
		const ch = chan.get(e.channel);
		if (!ch) continue;
		const series = out.get(e.channel)!.values;
		const s = strength(e);
		if (e.kind === 'depth') {
			const steps = [...e.steps].sort((a, b) => b.at - a.at);
			let state: number = ch.rest;
			frames.forEach((f, i) => {
				const p = worldPoint(f, e.point, DEPTH_MIN_VISIBILITY);
				const p2 = point(lms(f), e.point, w, h, DEPTH_MIN_VISIBILITY);
				if (!p || !p2) return;
				let next: number = ch.rest;
				let read = false;
				for (const st of steps) {
					const b = w3(f, st.behind);
					if (!b) continue;
					read = true;
					const inside = state >= st.at - 1e-9;
					const deeper = p[2] - b[2] > st.margin + (inside ? -1 : 1) * (DEPTH_HYSTERESIS / 2);
					// Picture y is up here: above a point is a larger y.
					const up = st.above ? pt(f, st.above) : null;
					const down = st.below ? pt(f, st.below) : null;
					const placed =
						(!st.above || (!!up && p2[1] > up[1])) && (!st.below || (!!down && p2[1] < down[1]));
					if (deeper && placed) {
						next = st.at;
						break;
					}
				}
				if (!read) return;
				state = next;
				series[i] = next;
			});
			const held = holdSteps(series, times);
			held.forEach((v, i) => (series[i] = v));
			continue;
		}
		if (e.kind === 'turn') {
			frames.forEach((f, i) => {
				const yaws: number[] = [];
				for (const [from, to] of e.lines) {
					const a = w3(f, from);
					const b = w3(f, to);
					if (a && b && Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.02)
						yaws.push(Math.atan2(b[2] - a[2], b[0] - a[0]) * DEG);
				}
				if (!yaws.length) return;
				const yaw = mean(yaws) * s;
				const v = e.read === 'yaw' ? yaw * e.gain : (1 - Math.cos(yaw / DEG)) * e.gain;
				if (v < ch.min - 1e-6 || v > ch.max + 1e-6)
					clipCount.set(e.channel, (clipCount.get(e.channel) ?? 0) + 1);
				series[i] = Math.min(ch.max, Math.max(ch.min, v));
			});
			continue;
		}
		if (e.kind === 'approach') {
			const per = scalePer(ch, e.bone);
			const near = frames.map((f) => nearness(f, e.lines));
			const seen = near.map((v) => v !== null);
			const first = neutralFrames(times, seen);
			const base = median(first.map((i) => near[i] as number));
			if (!(per !== 0 && base > 0)) continue;
			near.forEach((k, i) => {
				if (k === null) return;
				const v = (s * (k / base - 1)) / per;
				if (v < ch.min - 1e-6 || v > ch.max + 1e-6)
					clipCount.set(e.channel, (clipCount.get(e.channel) ?? 0) + 1);
				series[i] = Math.min(ch.max, Math.max(ch.min, v));
			});
			continue;
		}
		if (e.kind === 'foreshorten') {
			const per = scalePer(ch, e.bone);
			if (per === 0) continue;
			frames.forEach((f, i) => {
				const a = w3(f, e.from);
				const b = w3(f, e.to);
				if (!a || !b) return;
				const full = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
				if (!(full > 0)) return;
				const ratio = Math.hypot(b[0] - a[0], b[1] - a[1]) / full;
				const v = (s * (ratio - 1)) / per;
				// Past the floor is lost shortening; the other edge is a limb at its full length.
				if (v > ch.max + 1e-6 || v < ch.min - 1e-6)
					clipCount.set(e.channel, (clipCount.get(e.channel) ?? 0) + 1);
				series[i] = Math.min(ch.max, Math.max(ch.min, v));
			});
			continue;
		}
		const parents =
			e.kind === 'bone'
				? [...filled]
						.filter(([id]) => id !== e.channel)
						.map(([id, vals]) => ({ vals, per: worldTurnPer(chan.get(id)!, e.bone, chain) }))
						.filter((p) => p.per !== 0)
				: [];
		let base: Pt | undefined;
		// A turn is one of d, d ± 360 within one gap of the channel's reach: inside the reach that is
		// d alone; in the gap past both edges (a forearm folded back on itself) the one nearer the
		// frame before, so it is held at the edge it came from instead of flipping to the far one, and
		// never winds up past a gap however the tracker spins it.
		let prev: number | null = null;
		const per0 = e.kind === 'bone' ? worldTurnPer(ch, e.bone, chain) : 0;
		const reach = [ch.min * per0, ch.max * per0].sort((a, b) => a - b);
		const gap = 360 - (reach[1] - reach[0]);
		const outside = (d: number) => Math.max(reach[0] - d, d - reach[1], 0);
		const raw: (number | null)[] = frames.map(() => null);
		frames.forEach((f, i) => {
			if (e.kind === 'root') {
				const p = pt(f, e.point);
				const per = ch.drives?.find((d) => d.prop === e.axis)?.per;
				if (p && per && Number.isFinite(unit)) {
					base ??= p;
					raw[i] = ((e.axis === 'x' ? p[0] - base[0] : p[1] - base[1]) * unit) / per;
				}
				return;
			}
			const a = pt(f, e.from);
			const b = pt(f, e.to);
			const rest = boneRestDirection(tpl.bones, e.bone, e.rest);
			const span = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
			if (!a || !b || !rest || per0 === 0 || span * unit < (e.minSpan ?? 0) * body.scale.rig)
				return;
			const carried = parents.reduce((sum, p) => sum + p.vals[i] * p.per, 0);
			const want = angleDiff(angleOf(a, b), angleOf([0, 0], rest));
			const turns = [0, 360, -360]
				.map((k) => angleDiff(want, carried) + k)
				.filter((d) => outside(d) <= gap + 1e-9)
				.sort((a, b) => outside(a) - outside(b));
			const last = prev;
			const d =
				last === null
					? turns[0]
					: turns.reduce((b, c) => (Math.abs(c - last) < Math.abs(b - last) ? c : b));
			prev = d;
			raw[i] = d / per0;
		});
		const group = fitGroupOf(e, 'body');
		const fitted = group ? fitRange(raw, ch, fit[group] ?? 0) : null;
		if (fitted) fits.push(fitOf(e.channel, fitted));
		const vals = fitted ? fitted.values : raw;
		vals.forEach((v, i) => {
			if (v === null) return;
			if (v < ch.min - 1e-6 || v > ch.max + 1e-6)
				clipCount.set(e.channel, (clipCount.get(e.channel) ?? 0) + 1);
			series[i] = Math.min(ch.max, Math.max(ch.min, v));
		});
		out.set(e.channel, { values: series, raw, fitted: vals, stepped: false });
		const held = fillGaps(series);
		if (held) filled.set(e.channel, held);
	}
	return out;
}

const fitOf = (
	channel: string,
	f: { lo: number; hi: number; below: number; above: number },
): MotionFit => ({
	channel,
	lo: round(f.lo, 3),
	hi: round(f.hi, 3),
	below: round(f.below, 3),
	above: round(f.above, 3),
});

/**
 * Per frame, how far the body's channels already turn the bone `id` rotates, in `id`'s own units
 * (null when no body channel turns it): a head tilt read from the eye line in the picture is the
 * head's turn in the picture, so the twist and lean it rides on are taken off.
 */
function parentTurnOf(
	id: string,
	tpl: MotionTemplate,
	filled: Map<string, number[]>,
): number[] | null {
	const chan = new Map(tpl.channels.map((c) => [c.id, c]));
	const ch = chan.get(id);
	const bone = ch?.drives?.find((d) => d.prop === 'rotate')?.bone;
	if (!ch || !bone) return null;
	const chain = ancestry(tpl.bones);
	const own = worldTurnPer(ch, bone, chain);
	if (own === 0) return null;
	let out: number[] | null = null;
	for (const [pid, vals] of filled) {
		const pc = chan.get(pid);
		if (pid === id || !pc) continue;
		const per = worldTurnPer(pc, bone, chain);
		if (per === 0) continue;
		out ??= vals.map(() => 0);
		vals.forEach((v, i) => ((out as number[])[i] += (v * per) / own));
	}
	return out;
}

/**
 * The track as channel keys. Face readings are taken against the performer's neutral and scaled by
 * the entry's and its group's gain; every numeric channel is clamped to its range, smoothed by the
 * One-Euro filter and reduced to the keys a linear run needs plus every turning point; a swap
 * channel also keeps the frame each swap happens on; channels that share a bone timeline (gaze x/y
 * on the pupils) are keyed at the same times, because each key carries both axes. A shapes channel
 * keys a part name at each change it holds long enough.
 */
export function solveMotion(
	tpl: MotionTemplate,
	given: MotionTrack,
	opts: MotionOptions = {},
): MotionSolve {
	const given3d = opts.three === true ? tpl.motion?.bones3d : undefined;
	const motion = given3d ? withoutReplaced(tpl.motion!, new Set(given3d.replaces)) : tpl.motion;
	const empty: MotionSolve = {
		keys: [],
		length: 0,
		channels: [],
		clipped: [],
		fitted: [],
		swapped: 0,
		untracked: given.frames.length,
		unseen: [],
		neutral: null,
	};
	if (!motion || !given.frames.length) return empty;
	const sided =
		opts.body !== false && (motion.body || motion.hand || given3d)
			? pictureSides(given)
			: { track: given, swapped: 0 };
	const track = sided.track;
	const frames = track.frames;
	const t0 = frames[0].t;
	const times = frames.map((f) => round(f.t - t0, 4));
	const dt =
		frames.length > 1 ? (times[times.length - 1] - times[0]) / (frames.length - 1) : 1 / 24;
	const useFace = opts.face !== false && !!motion.face;
	const useBody = opts.body !== false && !!motion.body;
	const useHand = opts.hand !== false && !!motion.hand;
	const chan = new Map(tpl.channels.map((c) => [c.id, c]));
	const clipCount = new Map<string, number>();
	const numeric = new Map<
		string,
		{
			raw: (number | null)[];
			scaled: (number | null)[];
			fitted: (number | null)[];
			clamped: (number | null)[];
			filter: MotionFilter;
			/** Steps (a draw order): never filtered, keyed only where they change. */
			stepped?: boolean;
		}
	>();
	const depth = opts.depth ?? {};
	const fit = opts.fit ?? {};
	const fits: MotionFit[] = [];
	/** Auto-range for one entry's values, recorded when it scaled anything. */
	const fitted = (
		e: { kind: string; group?: string; axis?: string; saturate?: boolean },
		map: 'face' | 'hand',
		ch: RigTemplateChannel,
		vals: (number | null)[],
	) => {
		const group = fitGroupOf(e, map);
		const f = group ? fitRange(vals, ch, fit[group] ?? 0, { keepTop: saturates(e) }) : null;
		if (!f) return vals;
		fits.push(fitOf(ch.id, f));
		return f.values;
	};
	const shaped: { ch: RigTemplateChannel; raw: (string | null)[]; hold: number }[] = [];
	// Held at the edge the rest sits on (a jaw more closed than the performer's neutral) is the rest,
	// not motion lost, so only the far edge counts as clipped.
	// So is a saturating channel held at its top (an eye shut).
	const clamp = (ch: RigTemplateChannel, v: number | null, top = false) => {
		if (v === null) return null;
		if ((v < ch.min - 1e-6 && ch.rest > ch.min) || (v > ch.max + 1e-6 && ch.rest < ch.max && !top))
			clipCount.set(ch.id, (clipCount.get(ch.id) ?? 0) + 1);
		return Math.min(ch.max, Math.max(ch.min, v));
	};

	// The body first: the face's head tilt is solved under the turn the body gives the head.
	const bodyFilled = new Map<string, number[]>();
	if (useBody && motion.body) {
		for (const [id, { values, raw, fitted: inRange, stepped }] of bodySeries(
			track,
			tpl,
			motion.body,
			clipCount,
			depth,
			times,
			fit,
			fits,
			bodyFilled,
		))
			numeric.set(id, {
				raw,
				scaled: raw,
				fitted: inRange,
				clamped: values,
				filter: stepped ? { smooth: 0 } : motion.body,
				stepped,
			});
	}
	let neutral: [number, number] | null = null;
	if (useFace && motion.face) {
		const at = neutralFrames(
			times,
			frames.map((f) => !!f.face),
			opts.neutral,
		);
		if (at.length) neutral = [times[at[0]], times[at[at.length - 1]]];
		for (const [id, { entry, raw, scaled }] of faceSeries(
			track,
			motion.face,
			opts.gain ?? {},
			at,
			depth,
			(channel) => parentTurnOf(channel, tpl, bodyFilled),
		)) {
			const ch = chan.get(id);
			if (!ch) continue;
			if (entry.kind === 'shape') {
				shaped.push({ ch, raw: raw as (string | null)[], hold: entry.hold });
				continue;
			}
			const nums = scaled as (number | null)[];
			const inRange = fitted(entry, 'face', ch, nums);
			numeric.set(id, {
				raw: raw as (number | null)[],
				scaled: nums,
				fitted: inRange,
				clamped: inRange.map((v) => clamp(ch, v, saturates(entry))),
				filter: motion.face,
			});
		}
	}
	if (useHand && motion.hand) {
		const kinds = new Map(motion.hand.entries.map((e) => [e.channel, e]));
		for (const [id, raw] of handSeries(track, motion.hand)) {
			const ch = chan.get(id);
			const e = kinds.get(id);
			if (!ch || !e) continue;
			const inRange = fitted(e, 'hand', ch, raw);
			numeric.set(id, {
				raw,
				scaled: raw,
				fitted: inRange,
				clamped: inRange.map((v) => clamp(ch, v, saturates(e))),
				filter: motion.hand,
			});
		}
	}

	const untracked = frames.filter(
		(f) =>
			!(
				(useFace && f.face) ||
				((useBody || given3d) && f.pose?.landmarks?.some((p) => p)) ||
				(useHand && f.hands?.length)
			),
	).length;
	const unseen: string[] = [];
	const curves = new Map<string, number[]>();
	for (const [id, { clamped, filter }] of numeric) {
		const ch = chan.get(id)!;
		const filled = fillGaps(oneEuro(clamped, times, filter, ch.max - ch.min));
		if (!filled) unseen.push(id);
		else curves.set(id, filled);
	}

	const tol = opts.tolerance ?? 0.02;
	// A share of the range is degrees on a turn, and a wide one (an elbow's ±168°) would let a held
	// pose drift by several: a turn is kept within ROTATE_TOLERANCE as well.
	const tolOf = (ch: RigTemplateChannel) => {
		const turn = Math.max(
			0,
			...(ch.drives ?? []).filter((d) => d.prop === 'rotate').map((d) => Math.abs(d.per)),
		);
		const share = tol * (ch.max - ch.min);
		return turn > 0 ? Math.min(share, ROTATE_TOLERANCE / turn) : share;
	};
	const keyIdx = new Map<string, Set<number>>();
	// An image swap held at least DEPTH_HOLD, like a draw order: a reading hovering at a step's
	// threshold (a body turned just about ¾) swapped the torso for single frames on real footage.
	const swapHeld = new Map<string, number[]>();
	for (const [id, vals] of curves) {
		const ch = chan.get(id)!;
		const idx = new Set<number>();
		if (numeric.get(id)?.stepped) {
			idx.add(0);
			for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1]) idx.add(i);
			idx.add(vals.length - 1);
		} else if (ch.swaps && !ch.drives?.length) {
			const steps = holdSteps(
				vals.map((v) => swapStep(ch, v)),
				times,
			) as number[];
			swapHeld.set(id, steps);
			idx.add(0);
			for (let i = 1; i < steps.length; i++) if (steps[i] !== steps[i - 1]) idx.add(i);
			idx.add(vals.length - 1);
		} else {
			for (const i of reduceKeys(times, vals, tolOf(ch))) idx.add(i);
			if (ch.swaps)
				for (let i = 1; i < vals.length; i++)
					if (swapStep(ch, vals[i]) !== swapStep(ch, vals[i - 1])) idx.add(i);
		}
		keyIdx.set(id, idx);
	}
	// Channels writing one bone timeline share their key times (translate x + y, both pupils).
	const timeline = (ch: RigTemplateChannel) =>
		(ch.drives ?? [])
			.filter((d) => d.prop !== 'rotate')
			.map(
				(d) => `${d.bone}.${d.prop === 'scaleX' || d.prop === 'scaleY' ? 'scale' : 'translate'}`,
			);
	// Grouped through every timeline they reach, so three or more channels chained by shared
	// timelines all end on the same key times.
	const left = new Set(keyIdx.keys());
	while (left.size) {
		const [start] = left;
		left.delete(start);
		const group = [start];
		const reached = new Set(timeline(chan.get(start)!));
		for (let grew = true; grew;) {
			grew = false;
			for (const id of left) {
				const tl = timeline(chan.get(id)!);
				if (!tl.some((x) => reached.has(x))) continue;
				for (const x of tl) reached.add(x);
				group.push(id);
				left.delete(id);
				grew = true;
			}
		}
		if (group.length < 2) continue;
		const u = new Set(group.flatMap((id) => [...keyIdx.get(id)!]));
		for (const id of group) keyIdx.set(id, new Set(u));
	}

	const keys: RigTemplateClipKey[] = [];
	for (const [id, idx] of keyIdx) {
		const ch = chan.get(id)!;
		const vals = curves.get(id)!;
		const swapOnly = !!ch.swaps && !ch.drives?.length;
		for (const i of [...idx].sort((a, b) => a - b)) {
			const v = swapOnly ? ch.swaps![swapHeld.get(id)![i]].at : round(vals[i], 3);
			keys.push([times[i], id, v]);
		}
	}
	for (const { ch, raw, hold } of shaped) {
		const held = Math.max(1, Math.round(hold / dt));
		let cur: string | null = null;
		let n = 0;
		for (let i = 0; i < raw.length; i++) {
			const s = raw[i];
			if (s === null) continue;
			let run = 1;
			while (run < held && raw[i + run] === s) run++;
			if (s !== cur && (run >= held || cur === null)) {
				keys.push([times[i], ch.id, s]);
				cur = s;
				n++;
			}
		}
		if (!n) unseen.push(ch.id);
	}
	keys.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

	const effects = new Map<string, DepthEffect>();
	for (const e of [
		...(motion.face?.entries ?? []),
		...(motion.body?.entries ?? []),
		...(motion.hand?.entries ?? []),
	]) {
		const effect = depthEffectOf(e);
		if (effect) effects.set(e.channel, effect);
	}
	const clipped: MotionClip[] = [];
	for (const [id, n] of clipCount) {
		const ch = chan.get(id)!;
		const effect = effects.get(id);
		clipped.push({
			channel: id,
			share: round(n / frames.length, 3),
			lo: ch.min,
			hi: ch.max,
			...(effect ? { effect } : {}),
		});
	}
	const solved: MotionSolve = {
		keys,
		length: times[times.length - 1],
		channels: [...new Set(keys.map((k) => k[1]))],
		clipped,
		fitted: fits,
		swapped: sided.swapped,
		untracked,
		unseen,
		neutral,
	};
	if (given3d) {
		const fm = opts.follow && given3d.positions;
		const s3 = solveBones3d(tpl, given3d, track, times, {
			neutral: opts.neutral,
			trace: opts.trace,
			follow:
				opts.follow && fm
					? { ...opts.follow, rootScale: rootScales(tpl.channels, keys, times, fm.root.bone) }
					: undefined,
		});
		solved.bones3d = s3.bones;
		solved.beyond3d = s3.beyond;
		solved.unseen.push(...s3.unseen);
		if (s3.turns && s3.worlds) solved.solved3d = { turns: s3.turns, worlds: s3.worlds };
		if (s3.translate) {
			// The bones it places are translated by the fit, not by the channels that moved them.
			const moved = new Set(Object.keys(s3.translate));
			const placing = new Set(
				tpl.channels
					.filter((c) =>
						c.drives?.some((d) => moved.has(d.bone) && (d.prop === 'x' || d.prop === 'y')),
					)
					.map((c) => c.id),
			);
			solved.keys = solved.keys.filter((k) => !placing.has(k[1]));
			solved.channels = [...new Set(solved.keys.map((k) => k[1]))];
			solved.translate = s3.translate;
			solved.follow = s3.follow;
		}
	}
	if (opts.trace) {
		solved.stages = {};
		for (const [id, n] of numeric) {
			const smoothed = curves.get(id);
			if (!smoothed) continue;
			const ch = chan.get(id)!;
			const own = keys.filter((k) => k[1] === id) as [number, string, number][];
			solved.stages[id] = {
				raw: n.raw,
				scaled: n.scaled,
				fitted: n.fitted,
				clamped: n.clamped,
				smoothed,
				keyed: times.map((t) => playKeys(own, t, !!ch.swaps && !ch.drives?.length)),
			};
		}
	}
	return solved;
}

/** The root's scale on each frame, as the keyed channels that scale it play (nearer / further). */
function rootScales(
	channels: RigTemplateChannel[],
	keys: RigTemplateClipKey[],
	times: number[],
	root: string,
): number[] {
	const scaling = channels
		.map((c) => ({ id: c.id, per: scalePer(c, root) }))
		.filter((c) => c.per !== 0);
	const own = scaling.map(({ id, per }) => ({
		per,
		keys: keys.filter((k) => k[1] === id) as [number, string, number][],
	}));
	return times.map((t) =>
		own.reduce((s, c) => (c.keys.length ? s * (1 + c.per * playKeys(c.keys, t, false)) : s), 1),
	);
}

/** The 2D map without the entries of the channels a 3D import replaces. */
function withoutReplaced(m: RigMotionMap, replaced: Set<string>): RigMotionMap {
	const keep = <P extends { entries: { channel: string }[] }>(part: P): P => ({
		...part,
		entries: part.entries.filter((e) => !replaced.has(e.channel)),
	});
	const out: RigMotionMap = { ...m };
	if (m.face) out.face = keep(m.face);
	if (m.body) out.body = keep(m.body);
	if (m.hand) out.hand = keep(m.hand);
	return out;
}

/** A channel's keys played back at `t`: linear between keys, or held (a swap-only channel). */
function playKeys(keys: [number, string, number][], t: number, stepped: boolean): number {
	let i = 0;
	while (i < keys.length && keys[i][0] <= t + 1e-9) i++;
	if (i === 0) return keys[0]?.[2] ?? 0;
	const a = keys[i - 1];
	const b = keys[i];
	if (!b || stepped) return a[2];
	return a[2] + ((t - a[0]) / (b[0] - a[0] || 1)) * (b[2] - a[2]);
}
