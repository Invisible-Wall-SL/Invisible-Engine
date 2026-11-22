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
 * - **The fingers** sit where the frame's hand has them, so the hand is one mesh weighted to them
 *   (`bends`, a branch per digit): a curl folds the drawn finger, not a bone beside it.
 * - **Where each part's image sits** in that pose (`framePlacements`): the attachment's world
 *   matrix, read off engine-rig posing the fitted rig, as a game poses it. atlas-tool cuts each
 *   part's canvas through its inverse (`rig_frame_parts.py`), so the rig posed as the frame draws
 *   the frame again.
 * - **Each taken prop hangs from a bone of its own** at its pivot (the middle of its pixels, the top
 *   of one that swings), a child of the bone its host is drawn on (`head_image` for glasses, so they
 *   stay on the drawn eyes; the finger it sits on for a ring).
 */
import * as rig from 'engine-rig';
import { templateRig, type RigTemplate, type TemplateRegion } from './rigTemplates';
import { boneWorld, type RigFit, type RigFitBend, type RigFitProp } from './rigTemplateFit';

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
/** Each digit's three bones at these hand landmarks (knuckle first); its tip is the next one. */
const DIGIT_JOINTS = {
	thumb: [1, 2, 3],
	index: [5, 6, 7],
	middle: [9, 10, 11],
	ring: [13, 14, 15],
	pinky: [17, 18, 19],
} as const;
/** The hand's mesh: columns × rows over its image (the image is centred on the wrist). */
const HAND_GRID: [number, number] = [24, 56];
/** A finger's weight ramps across this share of its width at the knuckle, and at the next joints. */
const KNUCKLE_RAMP = 0.9;
const JOINT_RAMP = 0.7;
/** An arm segment drawn shorter than this share of its length (the 3D points) is foreshortened. */
export const FORESHORTENED = 0.8;

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
	pose?: { landmarks?: (number[] | null)[]; world?: (number[] | null)[] } | null;
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
	const fit = fitFromJoints(t, J, aims, LENGTHS);
	const fingers: NonNullable<RigFit['fingers']> = {};
	const bends: NonNullable<RigFit['bends']> = {};
	for (const s of SIDES) {
		const hand = j.hands[s]?.map(R);
		const digits = Object.entries(DIGIT_JOINTS);
		const names = digits.flatMap(([d]) => [1, 2, 3].map((n) => `${d}_${n}_${s}`));
		if (!hand || !t.parts.some((p) => p.name === `hand_${s}`) || names.some((n) => !byName.has(n)))
			continue;
		// The hand's turn in the frame: a finger's place in it is the frame's, turned back to rest.
		let turn = 0;
		for (let b = byName.get(`hand_${s}`); b; b = b.parent ? byName.get(b.parent) : undefined)
			turn += fit.frame?.[b.name]?.rotate ?? 0;
		const placed: Record<string, { x: number; y: number }> = {};
		const anchors: RigFitBend['bones'] = [{ bone: `hand_${s}` }];
		const chains: NonNullable<RigFitBend['chains']> = [];
		const width = [5, 9, 13].reduce((sum, k) => sum + len(sub(hand[k + 4], hand[k])), 0) / 3;
		for (const [d, ks] of digits) {
			const chain = [0];
			ks.forEach((k, n) => {
				const [x, y] = rot(-turn, sub(hand[k], n === 0 ? hand[0] : hand[ks[n - 1]]));
				placed[`${d}_${n + 1}_${s}`] = { x, y };
				chain.push(anchors.length);
				anchors.push({ bone: `${d}_${n + 1}_${s}` });
			});
			chains.push({
				bones: chain,
				ramp: [KNUCKLE_RAMP * width, JOINT_RAMP * width, JOINT_RAMP * width],
			});
		}
		if (!(width > 1e-3) || Object.values(placed).some((p) => len([p.x, p.y]) < 1e-3)) continue;
		Object.assign(fingers, placed);
		bends[`hand_${s}`] = { bones: anchors, chains, grid: HAND_GRID };
	}
	if (Object.keys(fingers).length) Object.assign(fit, { fingers, bends });
	return { ok: true, value: { fit, scale: k, origin, joints: J } };
}

/**
 * The arm segments the frame draws shorter than FORESHORTENED of their length (the tracker's 3D
 * points, scaled by the shoulders as the picker does): cut from this frame, such a part is short at
 * rest and the rig never stretches it to its length (the report says so; another frame shows it).
 */
export function foreshortened(
	f: TrackFrame,
	w: number,
	h: number,
): { part: string; ratio: number }[] {
	const P = f.pose?.landmarks;
	const W3 = f.pose?.world;
	const used = [11, 12, 13, 14, 15, 16];
	if (!P || !W3 || used.some((k) => !finitePoint(P[k]) || !finitePoint(W3[k]))) return [];
	const px = (k: number): P => [P[k]![0] * w, P[k]![1] * h];
	const d3 = (a: number, b: number) =>
		Math.hypot(W3[a]![0] - W3[b]![0], W3[a]![1] - W3[b]![1], (W3[a]![2] ?? 0) - (W3[b]![2] ?? 0));
	const perM = len(sub(px(11), px(12))) / Math.max(d3(11, 12), 1e-6);
	const out: { part: string; ratio: number }[] = [];
	for (const s of SIDES)
		for (const [part, a, b] of [
			[`upper_arm_${s}`, POSE[s].shoulder, POSE[s].elbow],
			[`lower_arm_${s}`, POSE[s].elbow, POSE[s].wrist],
		] as const) {
			const ratio = len(sub(px(a), px(b))) / Math.max(d3(a, b) * perM, 1e-6);
			if (ratio < FORESHORTENED) out.push({ part, ratio: Math.round(ratio * 100) / 100 });
		}
	return out;
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
 * The fitted rig with placeholder images of `parts`, posed by its `frame` clip as a game poses it.
 * Bends are left out: each image is a region on its slot's bone, as it is before it bends.
 */
function framePose(
	t: RigTemplate,
	fit: RigFit,
	parts: readonly string[],
): Fitted<{ skel: rig.Skeleton; slotIndex: Map<string, number> }> {
	const regions: TemplateRegion[] = parts.map((name) => ({
		name,
		w: PLACEHOLDER,
		h: PLACEHOLDER,
	}));
	let made: ReturnType<typeof templateRig>;
	try {
		made = templateRig(t, regions, { ...fit, bends: {} });
	} catch (e) {
		return { ok: false, problem: e instanceof Error ? e.message : String(e) };
	}
	const lines = [
		'page.png',
		`size:${PLACEHOLDER * Math.max(1, parts.length)},${PLACEHOLDER}`,
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
	return {
		ok: true,
		value: { skel, slotIndex: new Map(data.slots.map((s) => [s.name, s.index])) },
	};
}

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
	const posed = framePose(t, fit, parts);
	if (!posed.ok) return posed;
	const { skel, slotIndex } = posed.value;
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
		(a, b) => (slotIndex.get(partSlot.get(a)!) ?? 0) - (slotIndex.get(partSlot.get(b)!) ?? 0),
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

/** A prop of a cut, as `cut.json` keeps it. `boneSet`: the author chose `bone`, so it is kept. */
export interface CutProp extends RigFitProp {
	host: string;
	take?: boolean;
	motion?: string;
	boneSet?: boolean;
}

/** Another frame's kept cut a part is taken from (per-part frames): its job, cut and joints. */
export interface PartSource {
	job: string;
	cut: { names: string[]; size: [number, number] };
	track: TrackFrame;
}

/** The bone whose offset is a part's length (an arm segment's next joint). */
const LENGTH_OF: Record<string, string> = Object.fromEntries(
	SIDES.flatMap((s) => [
		[`upper_arm_${s}`, `lower_arm_${s}`],
		[`lower_arm_${s}`, `hand_${s}`],
	]),
);

/**
 * The bone a taken prop hangs from: the bone its host part is drawn on, when the cut named that
 * bone or the one it hangs from (the glasses on `head` ride `head_image`, which carries the drawn
 * eyes and every 3D turn of the drawing; `face`, a cut's name before, too); a ring on the hand's
 * finger nearest its pivot, when the fingers are placed; else the bone the cut named, or the one
 * the author chose.
 */
export function propParent(
	t: RigTemplate,
	p: CutProp,
	fingerAt?: (pivot: P) => string | null,
	pivot?: P,
): string {
	const host = t.slots.find((s) => s.name === p.host)?.bone;
	if (!host || p.boneSet) return p.bone;
	const above = t.bones.find((b) => b.name === host)?.parent;
	const drawn = p.bone === host || p.bone === above || (p.host === 'head' && p.bone === 'face');
	if (!drawn) return p.bone;
	if (/^hand_[lr]$/.test(p.host) && fingerAt && pivot) return fingerAt(pivot) ?? host;
	return host;
}

/**
 * Each taken prop's pivot in the frame's pixels, from the cut's label map (8-bit, each pixel the
 * index of its part or prop in `names`): the middle of its pixels' box, the top middle of one that
 * swings (it hangs from there).
 */
export function propPivots(
	labels: Uint8Array,
	width: number,
	cut: { names: string[]; props?: CutProp[] },
): Record<string, P> {
	const index = new Map((cut.props ?? []).map((p) => [cut.names.indexOf(p.name), p]));
	const box = new Map<number, [number, number, number, number]>();
	for (let i = 0; i < labels.length; i++) {
		if (!index.has(labels[i])) continue;
		const x = i % width;
		const y = (i - x) / width;
		const b = box.get(labels[i]);
		if (!b) box.set(labels[i], [x, y, x, y]);
		else {
			b[0] = Math.min(b[0], x);
			b[1] = Math.min(b[1], y);
			b[2] = Math.max(b[2], x);
			b[3] = Math.max(b[3], y);
		}
	}
	const out: Record<string, P> = {};
	for (const [k, [x0, y0, x1, y1]] of box) {
		const p = index.get(k)!;
		out[p.name] = [(x0 + x1 + 1) / 2, p.motion === 'swings' ? y0 : (y0 + y1 + 1) / 2];
	}
	return out;
}

/** What `rig_frame_parts.py` is asked for (less the job and the sheet), and the fit it serves. */
export interface PartsRequest {
	fit: RigFit;
	scale: number;
	origin: P;
	parts: {
		name: string;
		matrix: number[];
		/** A part taken from another frame: its cut, and that frame's scale and origin. */
		source?: { job: string; scale: number; origin: P };
	}[];
	order: string[];
	joints: Record<string, P>;
	/** Arm segments the frame draws foreshortened (`foreshortened`), for the report. */
	foreshortened: { part: string; ratio: number }[];
}

/**
 * The parts request for a cut: the template fitted to the cut's joints with its taken props, each
 * on a bone of its own at its pivot (`pivots`, frame pixels; at its parent's joint without one), and
 * every part and taken prop placed in the frame's pose. A prop left ✗ is drawn into its host, so it
 * is neither a slot nor an image.
 *
 * A part in `sources` is cut from another frame: placed by that frame's own fit (so its canvas is
 * read off that frame), and an arm segment's length is that frame's, the frame clip bringing its
 * next joint in to where this frame draws it (the image squeezed along it, as the template's
 * shortening does), so the rig still poses as this frame and every other part comes back.
 */
export function framePartsRequest(
	t: RigTemplate,
	cut: { names: string[]; size: [number, number]; props?: CutProp[] },
	track: TrackFrame,
	pivots: Record<string, P> = {},
	sources: Record<string, PartSource> = {},
): Fitted<PartsRequest> {
	const j = frameJoints(track, cut.size[0], cut.size[1]);
	if (!j.ok) return j;
	const ff = frameFit(t, j.value);
	if (!ff.ok) return ff;
	const { scale: k, origin } = ff.value;
	const props = (cut.props ?? []).filter((p) => p.take !== false);
	const propNames = new Set((cut.props ?? []).map((p) => p.name));
	const own = cut.names.filter((n) => !propNames.has(n));
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const base = ff.value.fit;
	const lengthened: RigFit = { ...base, bones: { ...base.bones }, frame: { ...base.frame } };
	const fromSource: Record<
		string,
		NonNullable<PartsRequest['parts'][number]['source']> & { matrix: number[] }
	> = {};
	for (const [part, src] of Object.entries(sources)) {
		if (!own.includes(part)) return { ok: false, problem: `the cut has no part ${part}` };
		if (!src.cut.names.includes(part))
			return { ok: false, problem: `the frame ${part} is taken from has no ${part}` };
		const j2 = frameJoints(src.track, src.cut.size[0], src.cut.size[1]);
		if (!j2.ok) return { ok: false, problem: `${part}'s frame: ${j2.problem}` };
		const f2 = frameFit(t, j2.value);
		if (!f2.ok) return { ok: false, problem: `${part}'s frame: ${f2.problem}` };
		const lb = LENGTH_OF[part];
		const tb = lb ? byName.get(lb) : undefined;
		if (lb && tb) {
			const L = f2.value.fit.bones[lb] ?? { x: tb.x, y: tb.y };
			const d = base.bones[lb] ?? { x: tb.x, y: tb.y };
			const f = len([d.x, d.y]) / len([L.x, L.y]);
			lengthened.bones[lb] = L;
			if (Math.abs(f - 1) > 1e-9) {
				const at = lengthened.frame![lb] ?? { rotate: 0 };
				lengthened.frame![lb] = { ...at, x: L.x * (f - 1), y: L.y * (f - 1) };
				const img = `${part}_image`;
				if (byName.has(img))
					lengthened.frame![img] = { ...(lengthened.frame![img] ?? { rotate: 0 }), scaleY: f };
			}
		}
		const there = framePlacements(t, f2.value.fit, [part]);
		if (!there.ok) return there;
		fromSource[part] = {
			job: src.job,
			matrix: there.value.matrices[part],
			scale: f2.value.scale,
			origin: f2.value.origin,
		};
	}
	const bare = framePose(t, lengthened, own);
	if (!bare.ok) return bare;
	const skel = bare.value.skel;
	const fingerAt = (s: string) => (q: P) => {
		let best: string | null = null;
		let bestD = Infinity;
		const at = (n: string): P | null => {
			const b = skel.findBone(n);
			return b ? [b.worldX, b.worldY] : null;
		};
		for (const d of Object.keys(DIGIT_JOINTS)) {
			const pts = [1, 2, 3].map((n) => at(`${d}_${n}_${s}`));
			if (pts.some((x) => !x)) return null;
			const [p1, p2, p3] = pts as P[];
			const segs: [string, P, P][] = [
				[`${d}_1_${s}`, p1, p2],
				[`${d}_2_${s}`, p2, p3],
				[`${d}_3_${s}`, p3, add(p3, sub(p3, p2))],
			];
			for (const [bone, a, b] of segs) {
				const ab = sub(b, a);
				const tt = Math.min(
					1,
					Math.max(
						0,
						((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1),
					),
				);
				const dd = len(sub(q, add(a, [ab[0] * tt, ab[1] * tt])));
				if (dd < bestD) [bestD, best] = [dd, bone];
			}
		}
		return best;
	};
	const R = (p: P): P => [k * (p[0] - origin[0]), -k * (p[1] - origin[1])];
	const fitProps: RigFitProp[] = [];
	for (const p of props) {
		const pivot = pivots[p.name] ? R(pivots[p.name]) : undefined;
		const placedFingers = !!ff.value.fit.fingers?.[`index_1_${p.host.slice(-1)}`];
		const parent = propParent(t, p, placedFingers ? fingerAt(p.host.slice(-1)) : undefined, pivot);
		const bone = skel.findBone(parent);
		if (!bone)
			return { ok: false, problem: `the prop ${p.name} rides a bone ${parent} the rig has not` };
		const local = pivot ? bone.worldToLocal(new rig.Vector2(pivot[0], pivot[1])) : { x: 0, y: 0 };
		fitProps.push({
			name: p.name,
			bone: parent,
			...(p.before !== undefined ? { before: p.before } : { after: p.after }),
			at: [Math.round(local.x * 1e4) / 1e4, Math.round(local.y * 1e4) / 1e4],
		});
	}
	const fit: RigFit = { ...lengthened, ...(fitProps.length ? { props: fitProps } : {}) };
	const parts = [...own, ...props.map((p) => p.name)];
	const placed = framePlacements(t, fit, parts);
	if (!placed.ok) return placed;
	return {
		ok: true,
		value: {
			fit,
			scale: k,
			origin,
			parts: parts.map((name) => {
				const from = fromSource[name];
				return from
					? {
							name,
							matrix: from.matrix,
							source: { job: from.job, scale: from.scale, origin: from.origin },
						}
					: { name, matrix: placed.value.matrices[name] };
			}),
			order: placed.value.order,
			joints: ff.value.joints,
			foreshortened: foreshortened(track, cut.size[0], cut.size[1]).filter((f) => !sources[f.part]),
		},
	};
}
