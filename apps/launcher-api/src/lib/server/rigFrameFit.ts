/**
 * Frame to rig, the fit and the frame's pose (docs/design/frame-to-rig.md §4.6, phase F2b).
 *
 * A cut (F1) keeps the joints it was made from (`track.json`, 🎥 Motion's frame with any joint the
 * author dragged). From them, as `tools/frame-to-rig/proof.py fit()` does:
 *
 * - **The scale**: the template's shoulder width over the frame's, so 1 rig unit is the same share
 *   of the character in both; the rig's origin sits at the hips' middle.
 * - **The fit** (`RigFit`): each chain bone keeps the template's direction and takes the frame's
 *   length (the chest's height, the neck to the head, the upper arms and forearms), and the frame's
 *   pose is the clip `frame`: every chain bone turned so its child lands on its joint. The chest
 *   follows the shoulder line, the head the eyes' line, each hand its middle finger's knuckle.
 * - **Where each part's image sits** in that pose (`framePlacements`): the attachment's world
 *   matrix, read off engine-rig posing the fitted rig, as a game poses it. atlas-tool cuts each
 *   part's canvas through its inverse (`rig_frame_parts.py`), so the rig posed as the frame draws
 *   the frame again.
 */
import * as rig from 'engine-rig';
import { templateRig, type RigTemplate, type TemplateRegion } from './rigTemplates';
import { boneWorld, type RigFit, type RigFitProp } from './rigTemplateFit';

type Side = 'l' | 'r';
type P = [number, number];
const SIDES: Side[] = ['l', 'r'];
/** The template's `_l` is the PICTURE's left: the performer's right side (pose 12 / 14 / 16). */
const POSE: Record<Side, { shoulder: number; elbow: number; wrist: number; hip: number }> = {
	l: { shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
	r: { shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
};
/** Each eye's corners in the face mesh, by the picture's side. */
const EYE: Record<Side, [number, number]> = { l: [33, 133], r: [263, 362] };
/** The middle finger's knuckle: the hand turns to it. */
const KNUCKLE = 9;
/** The bones the fit places, and the chain bones whose lengths it takes from the frame. */
const NEEDS = [
	'spine',
	'chest',
	'neck',
	'head',
	'face',
	'eye_l',
	'eye_r',
	...SIDES.flatMap((s) => [`upper_arm_${s}`, `lower_arm_${s}`, `hand_${s}`]),
];
const LENGTHS = ['chest', 'head', ...SIDES.flatMap((s) => [`lower_arm_${s}`, `hand_${s}`])];

/** The joints of one frame, in the frame's pixels (y down), by template side. */
export interface FrameJoints {
	shoulder: Record<Side, P>;
	elbow: Record<Side, P>;
	wrist: Record<Side, P>;
	hip: Record<Side, P>;
	hands: Partial<Record<Side, P[]>>;
	face: P[];
}

/** A 🎥 Motion track frame, as a cut keeps it. */
export interface TrackFrame {
	pose?: { landmarks?: (number[] | null)[] } | null;
	hands?: { landmarks?: (number[] | null)[] }[] | null;
	face?: { landmarks?: (number[] | null)[] } | null;
}

export type Fitted<T> = { ok: true; value: T } | { ok: false; problem: string };

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const len = (a: P): number => Math.hypot(a[0], a[1]);
const deg = (a: P): number => (Math.atan2(a[1], a[0]) * 180) / Math.PI;
const wrap = (d: number): number => d - 360 * Math.round(d / 360);
function rot(d: number, [x, y]: P): P {
	const r = (d * Math.PI) / 180;
	return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}
const finitePoint = (p: unknown): p is number[] =>
	Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** The frame's joints in pixels, as the cut reads them (`rig_from_frame.joints_of`). */
export function frameJoints(f: TrackFrame, w: number, h: number): Fitted<FrameJoints> {
	const pose = f.pose?.landmarks ?? [];
	if (pose.length !== 33 || !pose.every(finitePoint))
		return { ok: false, problem: 'The cut has no body tracked.' };
	const at = (k: number): P => [pose[k]![0] * w, pose[k]![1] * h];
	const per = (key: keyof (typeof POSE)['l']) =>
		Object.fromEntries(SIDES.map((s) => [s, at(POSE[s][key])])) as Record<Side, P>;
	const wrist = per('wrist');
	const hands: Partial<Record<Side, P[]>> = {};
	for (const hand of f.hands ?? []) {
		const pts = hand.landmarks ?? [];
		if (pts.length !== 21 || !pts.every(finitePoint)) continue;
		const px = pts.map((p): P => [p![0] * w, p![1] * h]);
		// Each hand goes to the side of the nearer pose wrist (as rigMotionHand does).
		const side = SIDES.reduce((a, b) =>
			len(sub(px[0], wrist[b])) < len(sub(px[0], wrist[a])) ? b : a,
		);
		hands[side] ??= px;
	}
	const face = f.face?.landmarks ?? [];
	if (face.length < 468 || !face.every(finitePoint))
		return { ok: false, problem: 'The cut has no face tracked.' };
	return {
		ok: true,
		value: {
			shoulder: per('shoulder'),
			elbow: per('elbow'),
			wrist,
			hip: per('hip'),
			hands,
			face: face.map((p): P => [p![0] * w, p![1] * h]),
		},
	};
}

/** The wrist a forearm ends at: the tracked hand's, else the body's. */
export function wristOf(j: FrameJoints, s: Side): P {
	return j.hands[s]?.[0] ?? j.wrist[s];
}

export interface FrameFit {
	/** The template's bones with the frame's lengths, and the frame's pose as the clip `frame`. */
	fit: RigFit;
	/** Rig units per frame pixel. */
	scale: number;
	/** The frame pixel at the rig's origin (the hips' middle). */
	origin: P;
	/** Where each joint the fit aims at lies, in rig units (y up). */
	joints: Record<string, P>;
}

/**
 * A fit from tracked joints: each bone in `lengths` takes the distance from its parent's joint,
 * along the template's direction; each bone in `aims` is turned so its child lands on that child's
 * joint. The bones' world turns add up from the root, so every key is relative to its parent.
 */
export function fitFromJoints(
	t: RigTemplate,
	J: Record<string, P>,
	aims: Record<string, string>,
	lengths: readonly string[],
): RigFit {
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const turn = new Map<string, number>();
	const fit: RigFit = { bones: {}, frame: {} };
	for (const b of t.bones) {
		const pw = b.parent ? (turn.get(b.parent) ?? 0) : 0;
		if (lengths.includes(b.name) && b.parent && J[b.name] && J[b.parent]) {
			const l = len(sub(J[b.name], J[b.parent]));
			const tl = Math.hypot(b.x, b.y);
			if (tl > 0 && Math.abs(l - tl) > 1e-6)
				fit.bones[b.name] = { x: (b.x / tl) * l, y: (b.y / tl) * l };
		}
		let r = 0;
		const aim = aims[b.name];
		const child = aim ? byName.get(aim) : undefined;
		if (aim && child && J[aim] && J[b.name]) {
			r = wrap(deg(sub(J[aim], J[b.name])) - deg([child.x, child.y]) - pw);
			fit.frame![b.name] = { rotate: r };
		}
		turn.set(b.name, pw + r);
	}
	return fit;
}

/**
 * The template fitted to one frame's joints (§4.6): its scale, origin, the fit and the joints it
 * aims at. Refused, with the reason, for a template the fit cannot place (a bone it needs missing or
 * turned at setup) or joints that do not span the shoulders.
 */
export function frameFit(t: RigTemplate, j: FrameJoints): Fitted<FrameFit> {
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const missing = NEEDS.filter((n) => !byName.has(n));
	if (missing.length)
		return { ok: false, problem: `the template has no ${missing.join(', ')} bone to fit` };
	const chain = new Set<string>();
	for (const n of NEEDS)
		for (let b = byName.get(n); b; b = b.parent ? byName.get(b.parent) : undefined)
			chain.add(b.name);
	const turned = [...chain].filter((n) => {
		const b = byName.get(n)!;
		return (b.rotation ?? 0) !== 0 || (b.scaleX ?? 1) !== 1 || (b.scaleY ?? 1) !== 1;
	});
	if (turned.length)
		return {
			ok: false,
			problem: `the template's ${turned.join(', ')} are turned or scaled at setup`,
		};
	const W0 = boneWorld(t.bones);
	const w0 = (n: string): P => W0.get(n)!;
	const shoulders = sub(w0('upper_arm_r'), w0('upper_arm_l'));
	const framed = sub(j.shoulder.r, j.shoulder.l);
	if (len(shoulders) < 1e-6 || len(framed) < 1)
		return { ok: false, problem: 'the shoulders are on top of each other' };
	const k = len(shoulders) / len(framed);
	const origin = mid(j.hip.l, j.hip.r);
	const R = (p: P): P => [k * (p[0] - origin[0]), -k * (p[1] - origin[1])];
	const eye = (s: Side): P => R(mid(j.face[EYE[s][0]], j.face[EYE[s][1]]));

	const S = { l: R(j.shoulder.l), r: R(j.shoulder.r) };
	const tc = deg(sub(S.r, S.l)) - deg(shoulders);
	const C = sub(
		mid(S.l, S.r),
		rot(tc, sub(mid(w0('upper_arm_l'), w0('upper_arm_r')), w0('chest'))),
	);
	const N = add(C, rot(tc, sub(w0('neck'), w0('chest'))));
	const tau = deg(sub(eye('r'), eye('l'))) - deg(sub(w0('eye_r'), w0('eye_l')));
	const Hd = sub(mid(eye('l'), eye('r')), rot(tau, sub(mid(w0('eye_l'), w0('eye_r')), w0('head'))));
	const J: Record<string, P> = {
		spine: w0('spine'),
		chest: C,
		neck: N,
		head: Hd,
		face: add(Hd, rot(tau, sub(w0('face'), w0('head')))),
	};
	const aims: Record<string, string> = {
		spine: 'chest',
		chest: 'neck',
		neck: 'head',
		head: 'face',
	};
	for (const s of SIDES) {
		J[`upper_arm_${s}`] = S[s];
		J[`lower_arm_${s}`] = R(j.elbow[s]);
		J[`hand_${s}`] = R(wristOf(j, s));
		aims[`upper_arm_${s}`] = `lower_arm_${s}`;
		aims[`lower_arm_${s}`] = `hand_${s}`;
		const hand = j.hands[s];
		if (hand && byName.has(`middle_1_${s}`)) {
			J[`middle_1_${s}`] = R(hand[KNUCKLE]);
			aims[`hand_${s}`] = `middle_1_${s}`;
		}
	}
	const short = LENGTHS.filter((n) => len(sub(J[n], J[byName.get(n)!.parent!])) < 1e-3);
	if (short.length)
		return { ok: false, problem: `the joints of ${short.join(', ')} are on top of each other` };
	return {
		ok: true,
		value: { fit: fitFromJoints(t, J, aims, LENGTHS), scale: k, origin, joints: J },
	};
}

const stubTexture = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
/** The placeholder size each part is posed at: a region's place does not depend on its size. */
const PLACEHOLDER = 64;

/**
 * Each part's attachment in the fitted rig posed as the frame: `[a, b, c, d, x, y]`, taking a point
 * of the image (rig units from its centre, y up) to the rig's world. And the draw order, back to
 * front, of the parts given.
 */
export function framePlacements(
	t: RigTemplate,
	fit: RigFit,
	parts: readonly string[],
): Fitted<{ matrices: Record<string, number[]>; order: string[] }> {
	const regions: TemplateRegion[] = parts.map((name) => ({
		name,
		w: PLACEHOLDER,
		h: PLACEHOLDER,
	}));
	let made: ReturnType<typeof templateRig>;
	try {
		made = templateRig(t, regions, fit);
	} catch (e) {
		return { ok: false, problem: e instanceof Error ? e.message : String(e) };
	}
	const lines = [
		'page.png',
		`size:${PLACEHOLDER * parts.length},${PLACEHOLDER}`,
		'filter:Linear,Linear',
	];
	parts.forEach((name, i) =>
		lines.push(name, `bounds:${i * PLACEHOLDER},0,${PLACEHOLDER},${PLACEHOLDER}`),
	);
	const atlas = new rig.TextureAtlas(lines.join('\n') + '\n');
	for (const page of atlas.pages) page.setTexture(stubTexture as never);
	const data = new rig.SkeletonJson(new rig.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(made.skeleton)),
	);
	const skel = new rig.Skeleton(data);
	skel.setToSetupPose();
	data
		.findAnimation('frame')
		?.apply(skel, 0, 0, false, [], 1, rig.MixBlend.setup, rig.MixDirection.mixIn);
	skel.updateWorldTransform(rig.Physics.update);
	const slotOf = new Map(data.slots.map((s) => [s.name, s.index]));
	const partSlot = new Map(fitPartsSlots(t, fit).map((p) => [p.name, p.slot]));
	const matrices: Record<string, number[]> = {};
	const v = new Float32Array(8);
	for (const name of parts) {
		const slotName = partSlot.get(name);
		const slot = slotName === undefined ? undefined : skel.findSlot(slotName);
		const att = slot ? skel.getAttachmentByName(slot.data.name, name) : null;
		if (!slot || !(att instanceof rig.RegionAttachment))
			return { ok: false, problem: `the template draws no image ${name}` };
		att.computeWorldVertices(slot, v, 0, 2);
		// Corners: bottom-left, top-left, top-right, bottom-right.
		const u: P = [(v[6] - v[0]) / PLACEHOLDER, (v[7] - v[1]) / PLACEHOLDER];
		const up: P = [(v[2] - v[0]) / PLACEHOLDER, (v[3] - v[1]) / PLACEHOLDER];
		const c: P = [(v[2] + v[6]) / 2, (v[3] + v[7]) / 2];
		const m = [u[0], up[0], u[1], up[1], c[0], c[1]];
		if (!m.every(Number.isFinite)) return { ok: false, problem: `the image ${name} does not pose` };
		matrices[name] = m;
	}
	const order = [...parts].sort(
		(a, b) => (slotOf.get(partSlot.get(a)!) ?? 0) - (slotOf.get(partSlot.get(b)!) ?? 0),
	);
	return { ok: true, value: { matrices, order } };
}

/** The template's parts and the fit's props, each with the slot it is drawn in. */
function fitPartsSlots(t: RigTemplate, fit: RigFit): { name: string; slot: string }[] {
	return [
		...t.parts.map((p) => ({ name: p.name, slot: p.slot })),
		...(fit.props ?? []).map((p) => ({ name: p.name, slot: p.name })),
	];
}

/** A prop of a cut, as `cut.json` keeps it. */
export interface CutProp extends RigFitProp {
	host: string;
	take?: boolean;
	motion?: string;
}

/** What `rig_frame_parts.py` is asked for (less the job and the sheet), and the fit it serves. */
export interface PartsRequest {
	fit: RigFit;
	scale: number;
	origin: P;
	parts: { name: string; matrix: number[] }[];
	order: string[];
	joints: Record<string, P>;
}

/**
 * The parts request for a cut: the template fitted to the cut's joints with its taken props, and
 * every part and taken prop placed in the frame's pose. A prop left ✗ is drawn into its host, so it
 * is neither a slot nor an image.
 */
export function framePartsRequest(
	t: RigTemplate,
	cut: { names: string[]; size: [number, number]; props?: CutProp[] },
	track: TrackFrame,
): Fitted<PartsRequest> {
	const j = frameJoints(track, cut.size[0], cut.size[1]);
	if (!j.ok) return j;
	const ff = frameFit(t, j.value);
	if (!ff.ok) return ff;
	const props = (cut.props ?? []).filter((p) => p.take !== false);
	const fit: RigFit = {
		...ff.value.fit,
		...(props.length
			? {
					props: props.map((p) => ({
						name: p.name,
						bone: p.bone,
						...(p.before !== undefined ? { before: p.before } : { after: p.after }),
					})),
				}
			: {}),
	};
	const propNames = new Set((cut.props ?? []).map((p) => p.name));
	const parts = [...cut.names.filter((n) => !propNames.has(n)), ...props.map((p) => p.name)];
	const placed = framePlacements(t, fit, parts);
	if (!placed.ok) return placed;
	return {
		ok: true,
		value: {
			fit,
			scale: ff.value.scale,
			origin: ff.value.origin,
			parts: parts.map((name) => ({ name, matrix: placed.value.matrices[name] })),
			order: placed.value.order,
			joints: ff.value.joints,
		},
	};
}
