import type { Rig3dDoc } from './rig3d';
import { pictureSides, type LandmarkRef, type MotionTrack, type RigMotionMap } from './rigMotion';
import { BODY_LINES, pixelsPerMetre } from './rigMotion3d';
import type { RigTemplateBone, RigTemplateTimelines } from './server/rigTemplates';
import {
	controlTarget,
	depthRatio,
	fitLengths,
	fitTimelines,
	type LengthBearing,
	type RigFit,
} from './server/rigTemplateFit';

/**
 * ⤢ Fit rig to the capture (docs/design/frame-to-rig.md §4.6a): an existing template rig takes the
 * limb lengths of the performer a 🎥 Motion capture tracked, so following positions reaches the
 * tracked elbows and wrists and the reference overlay lines up. Lengths, never directions: each
 * limb bone keeps its own direction and every clip and control keeps working. The art stretches
 * with the limb (the owner's choice): the limb's image bone is scaled along it by the same ratio, so
 * no gap opens at a joint. Pure: no DOM, no R2 — the Rigger runs it on the open rig, and the
 * template route answers a rig's template on its saved lengths (`mergeRigLengths`).
 */

/** A length the capture measures: the setup offset of `bone`, the joint at the end of `along`. */
export interface CaptureSegment {
	bone: string;
	/** The bone the length runs along, whose art stretches with it. */
	along: string;
	from: LandmarkRef;
	to: LandmarkRef;
}

/**
 * The lengths following positions reaches with (rig-templates §5.8): per limb of the template's
 * positions map, its upper bone's (the offset of its lower bone) and its lower bone's (the offset
 * of the bone at its end), each between the two tracked points it runs between.
 */
export function captureSegments(motion: RigMotionMap | null | undefined): CaptureSegment[] {
	return (motion?.bones3d?.positions?.limbs ?? []).flatMap((l) => [
		{ bone: l.lower, along: l.upper, from: l.points[0], to: l.points[1] },
		{ bone: l.end, along: l.lower, from: l.points[1], to: l.points[2] },
	]);
}

/** A pose point counts on frames it has at least this visibility (both ends of a length). */
export const CAPTURE_MIN_VISIBILITY = 0.5;
/** A length is fitted only from at least this many frames. */
export const CAPTURE_MIN_FRAMES = 8;
/**
 * A spread (interquartile range over the median) past this is said: a glitch, a cut, two performers.
 * The tracker's depth alone spreads a real clip's lengths 18–31% (measured on two).
 */
export const CAPTURE_WIDE_SPREAD = 0.4;
/** Left and right further apart than this (over their mean) are said. */
export const CAPTURE_SIDES_APART = 0.2;

/** A length as measured, rig units. */
export interface CaptureLength {
	bone: string;
	along: string;
	/** Per counted frame. */
	samples: number[];
	median: number;
	q1: number;
	q3: number;
}

export interface CaptureMeasure {
	frames: number;
	/** Rig units per picture pixel: the reference overlay's line-up, or the template's own scale. */
	k: number;
	/** Seen on enough frames, in `captureSegments` order. */
	lengths: CaptureLength[];
	/** Seen on too few: the frames counted. */
	unseen: { bone: string; along: string; frames: number }[];
	/** Frames the tracker named the sides the other way round (read by where they are). */
	swapped: number;
}

const quantile = (sorted: number[], q: number) => {
	const at = (sorted.length - 1) * q;
	const i = Math.floor(at);
	return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i);
};

/**
 * The performer's limb lengths in rig units, each as following positions reaches it: on each frame
 * where both of its ends are seen, its length in the picture on the reference overlay's line-up
 * (`lineUp.k` rig units a pixel; none: the template's own scale, `motion.body.scale`, as the
 * overlay's default) with the tracker's depth between its ends at the frame's pixels per metre — the
 * point following positions aims each joint at (`rigMotion3d.ts`). The picture alone draws a limb
 * pointing at the camera short; the tracker's 3D points alone put a performer's arms 20–35% shorter
 * against their shoulders than the picture does (measured on two clips), so a rig fitted to them
 * still misses the tracked elbows. Null when the track has no body to scale by.
 */
export function measureCapture(
	track: MotionTrack,
	motion: RigMotionMap,
	lineUp?: { k: number },
): CaptureMeasure | null {
	const scale = motion.body?.scale;
	if (!scale) return null;
	const { track: sided, swapped } = pictureSides(track);
	const { width: W, height: H } = sided;
	const one = (f: (typeof sided.frames)[number], k: number) => {
		const p = f.pose?.landmarks[k];
		const w = f.pose?.world?.[k];
		if (!p || !w || !((p[2] ?? 1) >= CAPTURE_MIN_VISIBILITY) || !Number.isFinite(w[2])) return null;
		return [p[0] * W, p[1] * H, w[2]] as const;
	};
	const point = (f: (typeof sided.frames)[number], r: LandmarkRef) => {
		if (typeof r === 'number') return one(f, r);
		const a = one(f, r[0]);
		const b = one(f, r[1]);
		return a && b ? ([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as const) : null;
	};
	const across = sided.frames
		.map((f) => {
			const a = point(f, scale.from);
			const b = point(f, scale.to);
			return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : NaN;
		})
		.filter((x) => x > 0)
		.sort((x, y) => x - y);
	const k = lineUp?.k ?? (across.length ? scale.rig / quantile(across, 0.5) : NaN);
	if (!(k > 0)) return null;
	const perFrame = sided.frames.map((f) =>
		f.pose?.landmarks && f.pose.world
			? pixelsPerMetre(
					{ pic: f.pose.landmarks, world: f.pose.world },
					BODY_LINES,
					W,
					H,
					CAPTURE_MIN_VISIBILITY,
				)
			: null,
	);
	const known = perFrame.filter((x): x is number => x !== null).sort((x, y) => x - y);
	const typical = known.length ? quantile(known, 0.5) : null;
	const lengths: CaptureLength[] = [];
	const unseen: CaptureMeasure['unseen'] = [];
	for (const s of captureSegments(motion)) {
		const samples: number[] = [];
		sided.frames.forEach((f, i) => {
			const ppm = perFrame[i] ?? typical;
			const a = point(f, s.from);
			const b = point(f, s.to);
			if (!ppm || !a || !b) return;
			samples.push(k * Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] - a[2]) * ppm));
		});
		if (samples.length < CAPTURE_MIN_FRAMES) {
			unseen.push({ bone: s.bone, along: s.along, frames: samples.length });
			continue;
		}
		const sorted = [...samples].sort((x, y) => x - y);
		lengths.push({
			bone: s.bone,
			along: s.along,
			samples,
			median: quantile(sorted, 0.5),
			q1: quantile(sorted, 0.25),
			q3: quantile(sorted, 0.75),
		});
	}
	return { frames: sided.frames.length, k, lengths, unseen, swapped };
}

/** One bone's new length. */
export interface CaptureFitBone {
	bone: string;
	along: string;
	/** Its length on the rig now, and as fitted. */
	from: number;
	to: number;
	/** Frames counted (both sides', when pooled) and their spread (IQR over the median). */
	frames: number;
	spread: number;
	/** The other side's bone, measured with it: a performer's two arms are one length. */
	pooled?: string;
}

/** A side's twin: `lower_arm_l` ↔ `lower_arm_r`; null for a bone with no side. */
const twinOf = (bone: string) => {
	const m = /^(.*_)([lr])$/.exec(bone);
	return m ? `${m[1]}${m[2] === 'l' ? 'r' : 'l'}` : null;
};
const lengthOf = (b: { x?: number; y?: number }) => Math.hypot(b.x ?? 0, b.y ?? 0);

/**
 * The lengths a rig takes from a measure: each measured bone's median, both sides pooled when both
 * were measured (left and right are one length, and the tracker's noise differs between them). A
 * bone the rig lacks, or one sitting on its parent (no length to scale), is left out.
 */
export function captureFit(
	measure: CaptureMeasure,
	rigBones: readonly { name: string; x?: number; y?: number }[],
): CaptureFitBone[] {
	const byName = new Map(rigBones.map((b) => [b.name, b]));
	const measured = new Map(measure.lengths.map((l) => [l.bone, l]));
	const out: CaptureFitBone[] = [];
	for (const l of measure.lengths) {
		const b = byName.get(l.bone);
		if (!b || !(lengthOf(b) > 0)) continue;
		const twin = twinOf(l.bone);
		const other = twin ? measured.get(twin) : undefined;
		const samples = other ? [...l.samples, ...other.samples] : l.samples;
		const sorted = [...samples].sort((x, y) => x - y);
		const median = quantile(sorted, 0.5);
		out.push({
			bone: l.bone,
			along: l.along,
			from: lengthOf(b),
			to: round2(median),
			frames: samples.length,
			spread: (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / median,
			...(other ? { pooled: other.bone } : {}),
		});
	}
	return out;
}

/** "Left upper arm", from a bone's name. */
export function limbLabel(bone: string): string {
	const m = /^(.*)_([lr])$/.exec(bone);
	const name = (m ? m[1] : bone).replace(/_image$/, '').replace(/_/g, ' ');
	return m ? `${m[2] === 'l' ? 'Left' : 'Right'} ${name}` : name[0].toUpperCase() + name.slice(1);
}

/** What the author is told about a measure and the lengths taken from it. */
export function captureFitLines(measure: CaptureMeasure, fit: readonly CaptureFitBone[]): string[] {
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	const lines: string[] = [];
	const pooled = fit.some((f) => f.pooled);
	lines.push(
		`⤢ Fitted the rig to the capture: ${fit.length} limb lengths as 📍 Follow positions reaches them (the picture on the reference's line-up, with the tracker's depth), over ${measure.frames} frames${pooled ? ', each side with its twin (a performer’s two arms are one length)' : ''}. The art stretches with each limb.`,
	);
	for (const f of fit)
		lines.push(
			`${limbLabel(f.along)}: ${round1(f.from)} → ${round1(f.to)} (×${(f.to / f.from).toFixed(2)}; ${f.frames} frames, spread ${pct(f.spread)}).`,
		);
	for (const f of fit)
		if (f.spread > CAPTURE_WIDE_SPREAD)
			lines.push(
				`${limbLabel(f.along)}: its length varies ${pct(f.spread)} across the frames — a tracker glitch, a camera cut or another performer in the clip. Check it against the reference; ↶ Undo takes the fit back.`,
			);
	const byBone = new Map(measure.lengths.map((l) => [l.bone, l]));
	const said = new Set<string>();
	for (const f of fit) {
		if (!f.pooled || said.has(f.bone)) continue;
		said.add(f.pooled);
		const [a, b] = [byBone.get(f.bone)!, byBone.get(f.pooled)!];
		if (Math.abs(a.median - b.median) / ((a.median + b.median) / 2) > CAPTURE_SIDES_APART)
			lines.push(
				`${limbLabel(a.along)} read ${round1(a.median)} and ${limbLabel(b.along).toLowerCase()} ${round1(b.median)}: the tracker saw one side worse (turned away or hidden); both took ${round1(f.to)}.`,
			);
	}
	for (const u of measure.unseen)
		lines.push(
			`${limbLabel(u.along)}: seen on ${u.frames} frame${u.frames === 1 ? '' : 's'} (both ends at visibility ${CAPTURE_MIN_VISIBILITY} or more), too few to fit; kept as it is.`,
		);
	if (fit.length)
		lines.push(
			'Clips imported before keep their keys on the new lengths: 🎥 Key at playhead again to solve them on the new limbs. The Controls take the new lengths now, and in every tab once the rig is saved.',
		);
	return lines;
}

// ── The rig ────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
interface IrigBone {
	name: string;
	parent?: string;
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	shearX?: number;
	shearY?: number;
}
type Affine = [number, number, number, number, number, number];
const RAD = Math.PI / 180;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

function localOf(b: IrigBone): Affine {
	const r = b.rotation ?? 0;
	const [sx, sy] = [b.scaleX ?? 1, b.scaleY ?? 1];
	const [hx, hy] = [b.shearX ?? 0, b.shearY ?? 0];
	return [
		Math.cos((r + hx) * RAD) * sx,
		Math.cos((r + 90 + hy) * RAD) * sy,
		Math.sin((r + hx) * RAD) * sx,
		Math.sin((r + 90 + hy) * RAD) * sy,
		b.x ?? 0,
		b.y ?? 0,
	];
}
const compose = (p: Affine, l: Affine): Affine => [
	p[0] * l[0] + p[1] * l[2],
	p[0] * l[1] + p[1] * l[3],
	p[2] * l[0] + p[3] * l[2],
	p[2] * l[1] + p[3] * l[3],
	p[0] * l[4] + p[1] * l[5] + p[4],
	p[2] * l[4] + p[3] * l[5] + p[5],
];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** The bones' setup world frames (parents listed first, as a rig lists them). */
function setupWorld(bones: readonly IrigBone[]): Map<string, Affine> {
	const out = new Map<string, Affine>();
	for (const b of bones)
		out.set(b.name, compose(b.parent ? (out.get(b.parent) ?? IDENTITY) : IDENTITY, localOf(b)));
	return out;
}

/** `v` stretched by `r` along the unit `axis`. */
const along = (v: [number, number], axis: [number, number], r: number): [number, number] => {
	const d = (v[0] * axis[0] + v[1] * axis[1]) * (r - 1);
	return [v[0] + d * axis[0], v[1] + d * axis[1]];
};

/** What a refit did. */
export interface RigRefit {
	/** Per refitted bone, new length over old. */
	ratios: Map<string, number>;
	/** Art stretched: on an image bone's setup scale, or in the limb bone's own frame. */
	stretched: { bone: string; by: number; how: 'scaleX' | 'scaleY' | 'attachments' }[];
	/** Art that rides the limb but could not stretch with it, and why. */
	unstretched: { bone: string; why: string }[];
	/** Control bones moved to stay on what they mark. */
	controls: string[];
	/** Translate keys scaled with their bone. */
	keys: number;
}

const SLOT_ATT_TYPES = new Set(['region', 'mesh', 'boundingbox', 'clipping', 'path', 'point']);

/**
 * `doc` (an `.irig`, edited in place) with `lengths` (bone → new length; its direction kept), and
 * what carries a length following it, as `fitLengths` does for a template: the translate keys of a
 * refitted bone in every animation (bezier values too), except in the animations `keep` names it
 * for (a 3D clip's tracks the bake owns, which the bake writes again); and the control bones, each
 * kept on what it marks (`controlTarget`). The art of the limb whose length changed stretches with
 * it: its image bone (a child at the limb bone's origin carrying a slot, with no bones of its own)
 * takes the ratio on its setup scale along the limb, and what is drawn in the limb bone's own
 * frame (its slots' attachments and their deform keys, and the vertices any mesh weights to it) is
 * stretched along it there.
 */
export function refitIrig(
	doc: Json,
	lengths: Record<string, number>,
	keep: Record<string, readonly string[]> = {},
): RigRefit {
	const bones = (Array.isArray(doc.bones) ? doc.bones : []) as IrigBone[];
	const byName = new Map(bones.map((b) => [b.name, b]));
	const ratios = new Map<string, number>();
	for (const [name, to] of Object.entries(lengths)) {
		const b = byName.get(name);
		const from = b ? lengthOf(b) : 0;
		if (!b || !(from > 0) || !(to > 0) || Math.abs(to / from - 1) < 1e-5) continue;
		ratios.set(name, to / from);
	}
	const out: RigRefit = { ratios, stretched: [], unstretched: [], controls: [], keys: 0 };
	if (!ratios.size) return out;

	// Lengths, then each control back on what it marks.
	const before = setupWorld(bones);
	for (const [name, r] of ratios) {
		const b = byName.get(name)!;
		b.x = round4((b.x ?? 0) * r);
		b.y = round4((b.y ?? 0) * r);
	}
	const plain = setupWorld(bones);
	const after = new Map<string, Affine>();
	for (const b of bones) {
		const target = controlTarget(b.name);
		const p = b.parent ? (after.get(b.parent) ?? IDENTITY) : IDENTITY;
		if (target && before.has(target) && before.has(b.name)) {
			const [t0, t1, c0] = [before.get(target)!, plain.get(target)!, before.get(b.name)!];
			const wx = c0[4] + t1[4] - t0[4];
			const wy = c0[5] + t1[5] - t0[5];
			const det = p[0] * p[3] - p[1] * p[2];
			const [dx, dy] = [wx - p[4], wy - p[5]];
			const x = round4((p[3] * dx - p[1] * dy) / det);
			const y = round4((p[0] * dy - p[2] * dx) / det);
			if (Math.abs(x - (b.x ?? 0)) > 1e-4 || Math.abs(y - (b.y ?? 0)) > 1e-4) {
				b.x = x;
				b.y = y;
				out.controls.push(b.name);
			}
		}
		after.set(b.name, compose(p, localOf(b)));
	}

	// Each refitted bone's keys, in every animation that does not leave them to its bake.
	const animations = isObj(doc.animations) ? doc.animations : {};
	for (const [name, a] of Object.entries(animations)) {
		if (!isObj(a)) continue;
		const kept = new Set(keep[name] ?? []);
		const scaled = new Map([...ratios].filter(([b]) => !kept.has(b)));
		const tls = isObj(a.bones) ? a.bones : {};
		for (const [b] of scaled)
			for (const [tl, keys] of Object.entries(isObj(tls[b]) ? (tls[b] as Json) : {}))
				if (/^translate[xy]?$/.test(tl) && Array.isArray(keys)) out.keys += keys.length;
		animations[name] = fitTimelines(a as { bones?: Record<string, Record<string, []>> }, scaled);
	}

	// The art: per limb bone whose length changed (the parent of a refitted bone), along that length.
	const slots = (Array.isArray(doc.slots) ? doc.slots : []) as { name: string; bone: string }[];
	const slotsOn = (bone: string) => slots.filter((s) => s.bone === bone);
	const limbs = new Map<string, { axis: [number, number]; r: number; child: string }>();
	for (const [name, r] of ratios) {
		const b = byName.get(name)!;
		if (!b.parent) continue;
		const len = lengthOf(b);
		const prev = limbs.get(b.parent);
		if (prev && Math.abs(prev.r - r) > 1e-5) {
			out.unstretched.push({
				bone: b.parent,
				why: `two of its children (${prev.child}, ${name}) took different lengths`,
			});
			limbs.delete(b.parent);
			continue;
		}
		limbs.set(b.parent, { axis: [(b.x ?? 0) / len, (b.y ?? 0) / len], r, child: name });
	}
	const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
	const inFrame = new Map<number, { axis: [number, number]; r: number }>();
	for (const [limb, { axis, r }] of limbs) {
		const images = bones.filter(
			(b) =>
				b.parent === limb &&
				Math.abs(b.x ?? 0) < 1e-6 &&
				Math.abs(b.y ?? 0) < 1e-6 &&
				!bones.some((c) => c.parent === b.name) &&
				slotsOn(b.name).length > 0,
		);
		for (const img of images) {
			if ((img.shearX ?? 0) !== 0 || (img.shearY ?? 0) !== 0) {
				out.unstretched.push({ bone: img.name, why: 'it is sheared' });
				continue;
			}
			// The limb's direction in the image bone's own frame.
			const t = -(img.rotation ?? 0) * RAD;
			const ax = axis[0] * Math.cos(t) - axis[1] * Math.sin(t);
			const ay = axis[0] * Math.sin(t) + axis[1] * Math.cos(t);
			const how = Math.abs(ax) < 1e-3 ? 'scaleY' : Math.abs(ay) < 1e-3 ? 'scaleX' : null;
			if (!how) {
				out.unstretched.push({ bone: img.name, why: 'it is turned off the limb' });
				continue;
			}
			img[how] = round4((img[how] ?? 1) * r);
			out.stretched.push({ bone: img.name, by: r, how });
		}
		if (slotsOn(limb).length) out.stretched.push({ bone: limb, by: r, how: 'attachments' });
		inFrame.set(boneIndex.get(limb)!, { axis, r });
	}
	if (inFrame.size) stretchInFrame(doc, slots, bones, inFrame, out);
	out.stretched = out.stretched.filter(
		(s, i, all) => all.findIndex((x) => x.bone === s.bone && x.how === s.how) === i,
	);
	return out;
}

/**
 * The geometry drawn in a limb bone's own frame, stretched along the limb: the attachments of the
 * slots on it (a region's place, and its size when it lies along the limb; a vertex attachment's
 * vertices) and their deform keys, and in every weighted attachment the vertices weighted to it.
 */
function stretchInFrame(
	doc: Json,
	slots: readonly { name: string; bone: string }[],
	bones: readonly IrigBone[],
	byIndex: Map<number, { axis: [number, number]; r: number }>,
	out: RigRefit,
) {
	const slotBone = new Map(slots.map((s) => [s.name, bones.findIndex((b) => b.name === s.bone)]));
	const skins = (Array.isArray(doc.skins) ? doc.skins : []) as Json[];
	/** A vertex list stretched: weighted (bone, x, y, weight runs) or in `own` bone's frame. */
	const vertices = (vs: number[], count: number, own: number): number[] => {
		if (vs.length === count * 2) {
			const s = byIndex.get(own);
			if (!s) return vs;
			const o = [...vs];
			for (let i = 0; i < o.length; i += 2)
				[o[i], o[i + 1]] = along([o[i], o[i + 1]], s.axis, s.r).map(round4);
			return o;
		}
		const o = [...vs];
		for (let i = 0; i < o.length;) {
			const n = o[i++];
			for (let k = 0; k < n; k++, i += 4) {
				const s = byIndex.get(o[i]);
				if (s) [o[i + 1], o[i + 2]] = along([o[i + 1], o[i + 2]], s.axis, s.r).map(round4);
			}
		}
		return o;
	};
	const counts = new Map<string, { count: number; weighted: number[] | null; own: number }>();
	for (const skin of skins) {
		const bySlot = isObj(skin.attachments) ? skin.attachments : {};
		for (const [slot, byName] of Object.entries(bySlot)) {
			const own = slotBone.get(slot) ?? -1;
			if (!isObj(byName)) continue;
			for (const [name, att] of Object.entries(byName)) {
				if (!isObj(att)) continue;
				const type = typeof att.type === 'string' ? att.type : 'region';
				if (!SLOT_ATT_TYPES.has(type)) continue;
				const s = byIndex.get(own);
				if (type === 'region' || type === 'point') {
					if (!s) continue;
					const [x, y] = along([Number(att.x ?? 0), Number(att.y ?? 0)], s.axis, s.r);
					att.x = round4(x);
					att.y = round4(y);
					if (type === 'point') continue;
					const t = Number(att.rotation ?? 0) * RAD;
					const ax = s.axis[0] * Math.cos(-t) - s.axis[1] * Math.sin(-t);
					const ay = s.axis[0] * Math.sin(-t) + s.axis[1] * Math.cos(-t);
					const key = Math.abs(ax) < 1e-3 ? 'scaleY' : Math.abs(ay) < 1e-3 ? 'scaleX' : null;
					if (key) att[key] = round4(Number(att[key] ?? 1) * s.r);
					else out.unstretched.push({ bone: bones[own].name, why: `${name} lies across the limb` });
					continue;
				}
				if (!Array.isArray(att.vertices)) continue;
				const vs = att.vertices as number[];
				const count =
					type === 'mesh'
						? (Array.isArray(att.uvs) ? att.uvs.length : 0) / 2
						: Number(att.vertexCount ?? 0);
				att.vertices = vertices(vs, count, own);
				counts.set(`${String(skin.name)}|${slot}|${name}`, {
					count,
					weighted: vs.length === count * 2 ? null : vs,
					own,
				});
			}
		}
	}
	// Deform keys offset each vertex (weighted: each of its bone entries) in the same frames.
	const animations = isObj(doc.animations) ? doc.animations : {};
	for (const a of Object.values(animations)) {
		if (!isObj(a) || !isObj(a.attachments)) continue;
		for (const [skin, bySlot] of Object.entries(a.attachments)) {
			if (!isObj(bySlot)) continue;
			for (const [slot, byName] of Object.entries(bySlot)) {
				if (!isObj(byName)) continue;
				for (const [name, tls] of Object.entries(byName)) {
					const m = counts.get(`${skin}|${slot}|${name}`);
					const deform = isObj(tls) ? tls.deform : undefined;
					if (!m || !Array.isArray(deform)) continue;
					// Each offset pair's frame: the slot bone's, or the bone of its weighted entry.
					const frames: number[] = [];
					if (m.weighted)
						for (let i = 0; i < m.weighted.length;) {
							const n = m.weighted[i++];
							for (let k = 0; k < n; k++, i += 4) frames.push(m.weighted[i]);
						}
					else for (let k = 0; k < m.count; k++) frames.push(m.own);
					for (const key of deform as Json[]) {
						if (!Array.isArray(key.vertices)) continue;
						const start = Number(key.offset ?? 0);
						const v = [...(key.vertices as number[])];
						for (let j = 0; j + 1 < v.length; j += 2) {
							const pair = (start + j) >> 1;
							const s = byIndex.get(frames[pair]);
							if (s) [v[j], v[j + 1]] = along([v[j], v[j + 1]], s.axis, s.r).map(round4);
						}
						key.vertices = v;
					}
				}
			}
		}
	}
}

/**
 * The rig's 3D data (`rig3d.json`, edited in place) with the refit's lengths: each refitted bone's
 * depth by its ratio and a control's by what it marks (`depthRatio`, as a fitted template's), and in
 * each 3D clip the refitted bones' authored translate keys (bezier values too) and depth keys.
 */
export function refitRig3d(doc: Rig3dDoc, ratios: Map<string, number>): void {
	for (const [name, b] of Object.entries(doc.bones ?? {})) {
		const k = depthRatio(ratios, name);
		if (b.depth !== undefined && k !== 1) b.depth = round4(b.depth * k);
	}
	for (const clip of Object.values(doc.clips ?? {})) {
		const timelines = { bones: clip.bones } as unknown as RigTemplateTimelines;
		clip.bones = fitTimelines(timelines, ratios).bones as unknown as typeof clip.bones;
		for (const [bone, r] of ratios)
			for (const key of clip.bones[bone]?.depth ?? [])
				if (key.value !== undefined) key.value = round4(key.value * r);
	}
}

/** The template's lengths as the rig has them: per capture length, the rig's own when it differs. */
export function rigLengths(
	t: { bones: readonly RigTemplateBone[]; motion: RigMotionMap | null | undefined },
	rigBones: readonly { name: string; x?: number; y?: number }[],
): RigFit['bones'] {
	const byName = new Map(rigBones.map((b) => [b.name, b]));
	const fit: RigFit['bones'] = {};
	for (const s of captureSegments(t.motion)) {
		const tb = t.bones.find((b) => b.name === s.bone);
		const rb = byName.get(s.bone);
		const tl = tb ? lengthOf(tb) : 0;
		const rl = rb ? lengthOf(rb) : 0;
		if (!tb || !(tl > 0) || !(rl > 0) || Math.abs(rl - tl) < 1e-3) continue;
		fit[s.bone] = { x: round4((tb.x / tl) * rl), y: round4((tb.y / tl) * rl) };
	}
	return fit;
}

/**
 * The template the Rigger drives a rig with (its Controls, the motion solve), on the rig's own limb
 * lengths: `t` (as its `template.json` fits it) refitted where the rig's lengths differ, so a
 * refit not yet saved, and its undo, are followed. `t` itself when they agree.
 */
export function templateOnRig<T extends LengthBearing & { motion: RigMotionMap | null }>(
	t: T,
	rigBones: readonly { name: string; x?: number; y?: number }[],
): T {
	const fit = rigLengths(t, rigBones);
	return Object.keys(fit).length ? fitLengths(t, fit) : t;
}

/**
 * The fit a rig's template is read with (`sidecarOnRig`): `fit` (its `template.json`'s, or none)
 * with each capture length of the template `t` (its own, unfitted) set to the rig's, or dropped
 * where the rig's is the template's. Null when nothing is left of it.
 */
export function mergeRigLengths(
	t: { bones: readonly RigTemplateBone[]; motion?: RigMotionMap | null },
	fit: RigFit | null,
	rigBones: readonly { name: string; x?: number; y?: number }[],
): RigFit | null {
	const own = rigLengths({ bones: t.bones, motion: t.motion ?? null }, rigBones);
	const bones = { ...(fit?.bones ?? {}) };
	for (const s of captureSegments(t.motion)) delete bones[s.bone];
	Object.assign(bones, own);
	const next: RigFit = { ...(fit ?? {}), bones };
	const empty =
		!Object.keys(bones).length &&
		!Object.keys(next.frame ?? {}).length &&
		!(next.props ?? []).length &&
		!Object.keys(next.bends ?? {}).length;
	return empty ? null : next;
}
