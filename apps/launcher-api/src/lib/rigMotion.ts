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
 * `offset + gain × (mean(plus) − mean(minus))` of the frame's blendshape scores. `rest: 'median'`
 * first takes off the performer's own median over the track, so a face whose resting brows score
 * high (a drawn character's often do) reads as the rig's neutral.
 */
export interface FaceBlendMotion {
	kind: 'blend';
	channel: string;
	plus: string[];
	minus?: string[];
	gain: number;
	offset?: number;
	rest?: 'zero' | 'median';
}

/** The line `from → to` in degrees (counter-clockwise on screen), × gain; `first` = from frame 0. */
export interface FaceAngleMotion {
	kind: 'angle';
	channel: string;
	from: LandmarkRef;
	to: LandmarkRef;
	gain: number;
	rest: 'level' | 'first';
}

/**
 * How far `point` sits off the middle of `between` along the picture's x or y (up), as a share of
 * the distance between them, against frame 0, × gain. A nose off the eye line → a head turn.
 */
export interface FaceOffsetMotion {
	kind: 'offset';
	channel: string;
	point: LandmarkRef;
	between: [LandmarkRef, LandmarkRef];
	axis: 'x' | 'y';
	gain: number;
}

/**
 * The nearest of a shapes channel's parts: each feature is the mean of its blendshapes, each part a
 * point in that feature space (a feature it leaves out is 0). A shape shown for less than `hold`
 * seconds is skipped, so a mouth does not flicker between two near shapes.
 */
export interface FaceShapeMotion {
	kind: 'shape';
	channel: string;
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

export interface RigMotionFace {
	/** Gaussian smoothing, seconds. */
	smooth: number;
	entries: FaceMotionEntry[];
}

export interface RigMotionBody {
	smooth: number;
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
}

export interface MotionOptions {
	face?: boolean;
	body?: boolean;
	/** Key reduction tolerance, as a share of each channel's range. */
	tolerance?: number;
	/**
	 * Scales every blendshape score before it is read. A drawn face scores its expressions weaker
	 * than a filmed one (closed eyes drawn over the whole eye read about 0.4), so a cartoon source
	 * wants about 2. Landmark angles and offsets are not scaled.
	 */
	strength?: number;
}

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

/** Gaussian smoothing over a series with gaps (null); a gap stays a gap. */
export function smooth(values: (number | null)[], sigmaFrames: number): (number | null)[] {
	if (!(sigmaFrames > 0.25)) return [...values];
	const r = Math.ceil(sigmaFrames * 3);
	const wts = Array.from({ length: 2 * r + 1 }, (_, i) =>
		Math.exp(-((i - r) ** 2) / (2 * sigmaFrames ** 2)),
	);
	return values.map((v, i) => {
		if (v === null) return null;
		let s = 0;
		let n = 0;
		for (let k = -r; k <= r; k++) {
			const x = values[i + k];
			if (x === null || x === undefined) continue;
			s += x * wts[k + r];
			n += wts[k + r];
		}
		return s / n;
	});
}

/** Gaps held from the frame before (leading gaps from the first measured frame); null if none. */
export function fillGaps(values: (number | null)[]): number[] | null {
	const first = values.find((v) => v !== null);
	if (first === undefined || first === null) return null;
	let last = first;
	return values.map((v) => (v === null ? last : (last = v)));
}

/**
 * The samples a linear key run needs to stay within `tol` of every sample (Ramer–Douglas–Peucker);
 * indices, first and last always kept.
 */
export function reduceKeys(times: number[], values: number[], tol: number): number[] {
	const n = values.length;
	if (n <= 2) return Array.from({ length: n }, (_, i) => i);
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
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

/** Per-frame raw values of every face entry (null = not measured on that frame). */
function faceSeries(
	track: MotionTrack,
	face: RigMotionFace,
	strength: number,
): Map<string, { entry: FaceMotionEntry; raw: (number | string | null)[] }> {
	const { width: w, height: h, frames } = track;
	const out = new Map<string, { entry: FaceMotionEntry; raw: (number | string | null)[] }>();
	for (const e of face.entries) {
		let base: number | null = null;
		const raw = frames.map((f): number | string | null => {
			const fc = f.face;
			if (!fc) return null;
			if (e.kind === 'blend') {
				const at = (names: string[]) => strength * mean(names.map((n) => fc.blend[n] ?? 0));
				return (e.offset ?? 0) + e.gain * (at(e.plus) - (e.minus ? at(e.minus) : 0));
			}
			if (e.kind === 'shape') {
				const feat = Object.fromEntries(
					Object.entries(e.features).map(([k, names]) => [
						k,
						strength * mean(names.map((n) => fc.blend[n] ?? 0)),
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
				if (!a || !b) return null;
				const ang = angleOf(a, b);
				if (e.rest === 'level') return e.gain * angleDiff(ang, 0);
				base ??= ang;
				return e.gain * angleDiff(ang, base);
			}
			const p = point(fc.landmarks, e.point, w, h);
			const a = point(fc.landmarks, e.between[0], w, h);
			const b = point(fc.landmarks, e.between[1], w, h);
			if (!p || !a || !b) return null;
			const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
			if (!(span > 0)) return null;
			const k = e.axis === 'x' ? 0 : 1;
			const off = (p[k] - (a[k] + b[k]) / 2) / span;
			base ??= off;
			return e.gain * (off - base);
		});
		if (e.kind === 'blend' && e.rest === 'median') {
			const mid = median(raw.filter((v): v is number => typeof v === 'number'));
			if (Number.isFinite(mid))
				for (let i = 0; i < raw.length; i++)
					if (typeof raw[i] === 'number') raw[i] = (raw[i] as number) - mid + (e.offset ?? 0);
		}
		out.set(e.channel, { entry: e, raw });
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
 * The track as channel keys. Numeric channels are smoothed, clamped to their range and reduced to
 * the keys a linear run needs; a swap channel also keeps the frame each swap happens on; channels
 * that share a bone timeline (gaze x/y on the pupils) are keyed at the same times, because each key
 * carries both axes. A shapes channel keys a part name at each change it holds long enough.
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
	const numeric = new Map<string, { raw: (number | null)[]; sigma: number }>();
	const shaped: { ch: RigTemplateChannel; raw: (string | null)[]; hold: number }[] = [];

	if (useFace && motion.face) {
		const sigma = motion.face.smooth / dt;
		for (const [id, { entry, raw }] of faceSeries(track, motion.face, opts.strength ?? 1)) {
			const ch = chan.get(id);
			if (!ch) continue;
			if (entry.kind === 'shape') {
				shaped.push({ ch, raw: raw as (string | null)[], hold: entry.hold });
				continue;
			}
			const nums = (raw as (number | null)[]).map((v) => {
				if (v === null) return null;
				if (v < ch.min - 1e-6 || v > ch.max + 1e-6) clipCount.set(id, (clipCount.get(id) ?? 0) + 1);
				return Math.min(ch.max, Math.max(ch.min, v));
			});
			numeric.set(id, { raw: nums, sigma });
		}
	}
	if (useBody && motion.body) {
		const sigma = motion.body.smooth / dt;
		for (const [id, raw] of bodySeries(track, tpl, motion.body, clipCount))
			numeric.set(id, { raw, sigma });
	}

	const untracked = frames.filter(
		(f) => !((useFace && f.face) || (useBody && f.pose?.landmarks?.some((p) => p))),
	).length;
	const unseen: string[] = [];
	const curves = new Map<string, number[]>();
	for (const [id, { raw, sigma }] of numeric) {
		const filled = fillGaps(smooth(raw, sigma));
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
	const ids = [...keyIdx.keys()];
	for (const a of ids)
		for (const b of ids) {
			if (a >= b) continue;
			const ta = timeline(chan.get(a)!);
			if (!timeline(chan.get(b)!).some((x) => ta.includes(x))) continue;
			const u = new Set([...keyIdx.get(a)!, ...keyIdx.get(b)!]);
			keyIdx.set(a, u);
			keyIdx.set(b, new Set(u));
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
	return {
		keys,
		length: times[times.length - 1],
		channels: [...new Set(keys.map((k) => k[1]))],
		clipped,
		untracked,
		unseen,
	};
}
