import type {
	RigTemplateBone,
	RigTemplateChannel,
	RigTemplateClipKey,
} from './server/rigTemplates';

/**
 * Motion from video or a Flipbook clip onto a template rig (rig templates T5 + T7b,
 * docs/design/rig-templates.md §5.3). The page tracks the frames with MediaPipe's Face Landmarker
 * and Pose Landmarker; this module turns that track into channel keys — the same
 * `[time, channel, value]` shape a starter clip has — so the Rigger writes them through its one
 * keying path. Pure: no DOM, no MediaPipe, so a fixture runs it headless.
 *
 * Which landmark or blendshape drives which channel is the template's `motion` data, never decided
 * here. Everything is read in the picture's plane: depth is not recovered.
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

export type FaceMotionEntry =
	FaceBlendMotion | FaceAngleMotion | FaceOffsetMotion | FaceShapeMotion;

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

export type BodyMotionEntry = BodyBoneMotion | BodyRootMotion;

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
	/** What this template cannot take from a video, said to the author after every import. */
	cannot: string[];
}

/** One tracked frame. Landmarks are MediaPipe's normalised image coordinates (x right, y down). */
export interface MotionFrame {
	t: number;
	face?: { landmarks: ([number, number] | null)[]; blend: Record<string, number> } | null;
	pose?: { landmarks: ([number, number, number] | null)[] } | null;
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
}

/** One numeric channel through the solve, frame by frame (null = not measured on that frame). */
export interface MotionStages {
	/** The tracked reading before any scaling: a blendshape mix against the neutral, degrees, … */
	raw: (number | null)[];
	/** × the entry's and the group's gain (+ offset): the channel's value, before its range. */
	scaled: (number | null)[];
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
	/** Frames where nothing was found (no face, no body). */
	untracked: number;
	/** Channels never measured (their points were never seen). */
	unseen: string[];
	/** Seconds from the start of the frames the face's neutral was read on, or null (body only). */
	neutral: [number, number] | null;
	/** Every numeric channel stage by stage, when {@link MotionOptions.trace} asks for it. */
	stages?: Record<string, MotionStages>;
}

export interface MotionOptions {
	face?: boolean;
	body?: boolean;
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
	/** Return {@link MotionSolve.stages}. */
	trace?: boolean;
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

/** Per-frame readings of every face entry (null = not measured on that frame). */
function faceSeries(
	track: MotionTrack,
	face: RigMotionFace,
	gains: Partial<Record<FaceGroup, number>>,
	neutral: number[],
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
		const g = (e.group ? gains[e.group] : undefined) ?? 1;
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
		if (e.kind === 'angle' || e.kind === 'offset') {
			const nums = raw as (number | null)[];
			const firstSeen = nums.find((v): v is number => v !== null);
			const atNeutral = neutral.map((i) => nums[i]).filter((v): v is number => v !== null);
			const mode = e.rest ?? 'neutral';
			// Angles are taken against their neutral through angleDiff, so a line near ±180° does not
			// average across the fold.
			const base =
				mode === 'level'
					? 0
					: mode === 'first' || !atNeutral.length
						? (firstSeen ?? 0)
						: e.kind === 'angle'
							? (atNeutral[0] ?? 0) + median(atNeutral.map((v) => angleDiff(v, atNeutral[0])))
							: median(atNeutral);
			raw = nums.map((v) =>
				v === null ? null : e.kind === 'angle' ? angleDiff(v, base) : v - base,
			);
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
		out.set(e.channel, { entry: e, raw, scaled });
	}
	return out;
}

/**
 * Per-frame values of every body entry, solved down the chain: a bone's channel value is the turn
 * it still needs once the channels already solved for its parents have turned it.
 */
function bodySeries(
	track: MotionTrack,
	tpl: MotionTemplate,
	body: RigMotionBody,
	clipCount: Map<string, number>,
): Map<string, (number | null)[]> {
	const { width: w, height: h, frames } = track;
	const chain = ancestry(tpl.bones);
	const chan = new Map(tpl.channels.map((c) => [c.id, c]));
	const lms = (f: MotionFrame) => f.pose?.landmarks;
	const pt = (f: MotionFrame, ref: LandmarkRef) => point(lms(f), ref, w, h, body.minVisibility);
	const lengths: number[] = [];
	for (const f of frames) {
		const a = pt(f, body.scale.from);
		const b = pt(f, body.scale.to);
		if (a && b) lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
	}
	const unit = body.scale.rig / median(lengths);
	const out = new Map<string, (number | null)[]>();
	for (const e of body.entries)
		out.set(
			e.channel,
			frames.map(() => null),
		);
	// Entry by entry, parents first (`rigTemplateProblem` checks the order): a child is solved against
	// each parent's gap-filled series, the value the parent is keyed at, so a frame where a parent is
	// a gap does not solve the child as if the parent were at rest.
	const filled = new Map<string, number[]>();
	for (const e of body.entries) {
		const ch = chan.get(e.channel);
		if (!ch) continue;
		const series = out.get(e.channel)!;
		const parents =
			e.kind === 'bone'
				? [...filled]
						.filter(([id]) => id !== e.channel)
						.map(([id, vals]) => ({ vals, per: worldTurnPer(chan.get(id)!, e.bone, chain) }))
						.filter((p) => p.per !== 0)
				: [];
		let base: Pt | undefined;
		frames.forEach((f, i) => {
			let v: number | null = null;
			if (e.kind === 'root') {
				const p = pt(f, e.point);
				const per = ch.drives?.find((d) => d.prop === e.axis)?.per;
				if (p && per && Number.isFinite(unit)) {
					base ??= p;
					v = ((e.axis === 'x' ? p[0] - base[0] : p[1] - base[1]) * unit) / per;
				}
			} else {
				const a = pt(f, e.from);
				const b = pt(f, e.to);
				const rest = boneRestDirection(tpl.bones, e.bone, e.rest);
				const per = worldTurnPer(ch, e.bone, chain);
				const span = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
				if (a && b && rest && per !== 0 && !(span * unit < (e.minSpan ?? 0) * body.scale.rig)) {
					const carried = parents.reduce((sum, p) => sum + p.vals[i] * p.per, 0);
					const want = angleDiff(angleOf(a, b), angleOf([0, 0], rest));
					v = angleDiff(want, carried) / per;
				}
			}
			if (v === null) return;
			if (v < ch.min - 1e-6 || v > ch.max + 1e-6)
				clipCount.set(e.channel, (clipCount.get(e.channel) ?? 0) + 1);
			series[i] = Math.min(ch.max, Math.max(ch.min, v));
		});
		const held = fillGaps(series);
		if (held) filled.set(e.channel, held);
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
	track: MotionTrack,
	opts: MotionOptions = {},
): MotionSolve {
	const motion = tpl.motion;
	const frames = track.frames;
	const empty: MotionSolve = {
		keys: [],
		length: 0,
		channels: [],
		clipped: [],
		untracked: frames.length,
		unseen: [],
		neutral: null,
	};
	if (!motion || !frames.length) return empty;
	const t0 = frames[0].t;
	const times = frames.map((f) => round(f.t - t0, 4));
	const dt =
		frames.length > 1 ? (times[times.length - 1] - times[0]) / (frames.length - 1) : 1 / 24;
	const useFace = opts.face !== false && !!motion.face;
	const useBody = opts.body !== false && !!motion.body;
	const chan = new Map(tpl.channels.map((c) => [c.id, c]));
	const clipCount = new Map<string, number>();
	const numeric = new Map<
		string,
		{
			raw: (number | null)[];
			scaled: (number | null)[];
			clamped: (number | null)[];
			filter: MotionFilter;
		}
	>();
	const shaped: { ch: RigTemplateChannel; raw: (string | null)[]; hold: number }[] = [];
	// Held at the edge the rest sits on (a jaw more closed than the performer's neutral) is the rest,
	// not motion lost, so only the far edge counts as clipped.
	const clamp = (ch: RigTemplateChannel, v: number | null) => {
		if (v === null) return null;
		if ((v < ch.min - 1e-6 && ch.rest > ch.min) || (v > ch.max + 1e-6 && ch.rest < ch.max))
			clipCount.set(ch.id, (clipCount.get(ch.id) ?? 0) + 1);
		return Math.min(ch.max, Math.max(ch.min, v));
	};

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
		)) {
			const ch = chan.get(id);
			if (!ch) continue;
			if (entry.kind === 'shape') {
				shaped.push({ ch, raw: raw as (string | null)[], hold: entry.hold });
				continue;
			}
			const nums = scaled as (number | null)[];
			numeric.set(id, {
				raw: raw as (number | null)[],
				scaled: nums,
				clamped: nums.map((v) => clamp(ch, v)),
				filter: motion.face,
			});
		}
	}
	if (useBody && motion.body) {
		for (const [id, raw] of bodySeries(track, tpl, motion.body, clipCount))
			numeric.set(id, { raw, scaled: raw, clamped: raw, filter: motion.body });
	}

	const untracked = frames.filter(
		(f) => !((useFace && f.face) || (useBody && f.pose?.landmarks?.some((p) => p))),
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
	const keyIdx = new Map<string, Set<number>>();
	for (const [id, vals] of curves) {
		const ch = chan.get(id)!;
		const idx = new Set<number>();
		if (ch.swaps && !ch.drives?.length) {
			idx.add(0);
			for (let i = 1; i < vals.length; i++)
				if (swapStep(ch, vals[i]) !== swapStep(ch, vals[i - 1])) idx.add(i);
			idx.add(vals.length - 1);
		} else {
			for (const i of reduceKeys(times, vals, tol * (ch.max - ch.min))) idx.add(i);
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
			.map((d) => `${d.bone}.${d.prop === 'scaleY' ? 'scale' : 'translate'}`);
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
			const v = swapOnly ? ch.swaps![swapStep(ch, vals[i])].at : round(vals[i], 3);
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

	const clipped: MotionClip[] = [];
	for (const [id, n] of clipCount) {
		const ch = chan.get(id)!;
		clipped.push({ channel: id, share: round(n / frames.length, 3), lo: ch.min, hi: ch.max });
	}
	const solved: MotionSolve = {
		keys,
		length: times[times.length - 1],
		channels: [...new Set(keys.map((k) => k[1]))],
		clipped,
		untracked,
		unseen,
		neutral,
	};
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
				clamped: n.clamped,
				smoothed,
				keyed: times.map((t) => playKeys(own, t, !!ch.swaps && !ch.drives?.length)),
			};
		}
	}
	return solved;
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
