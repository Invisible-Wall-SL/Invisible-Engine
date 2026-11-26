/**
 * Frame to rig, the face (docs/design/frame-to-rig.md §12 F2i). The cut makes the head one image;
 * the template's face block (rig-templates §4) moves bones that carry its own images, which a frame
 * does not make. So the face block's bones are placed on the features the frame draws (the face
 * mesh's points), and the head's mesh gives each feature's bone a region of the drawn head:
 *
 * - **Eyes**: the upper lid's skin to the lid's bone (a blink squashes the lid down over the eye),
 *   the iris to the pupil's (gaze).
 * - **Brows**: each brow to its outer and inner ends' bones, split along it.
 * - **Mouth**: the corners to theirs (smile, stretch), the lips to theirs, the chin to the jaw.
 * - **Nose** to the nose's; everything else stays on the head and the neck.
 *
 * Each region's share falls linearly to its edge, and each feature's moves are the drawn face's size
 * (its eyes apart over the template's), cut down where the skin around it has no room for the
 * template's whole move (`SAFE`), so no control folds the skin. On the CPU a blink is a squash, not
 * a drawn closed eye, and a mouth shape is the jaw, corners and lips moving, not a drawn mouth: those
 * wait for the GPU's face edits (F5).
 */
import type { RigTemplate } from './rigTemplates';
import {
	boneWorld,
	faceBones,
	fitRatios,
	fitTemplate,
	frameWorld,
	skinShares,
	type Affine,
	type RigFit,
	type RigSkinSpot,
} from './rigTemplateFit';

type P = [number, number];
type Side = 'l' | 'r';
const SIDES: Side[] = ['l', 'r'];

/** Face mesh points by the picture's side (`_l` is the performer's right): outer corner first. */
const EYE: Record<Side, [number, number]> = { l: [33, 133], r: [263, 362] };
const LID_UP: Record<Side, number> = { l: 159, r: 386 };
const LID_DOWN: Record<Side, number> = { l: 145, r: 374 };
/** The iris's middle; its ring is the next four points (the tracker's refined face, 478 points). */
const IRIS: Record<Side, number> = { l: 468, r: 473 };
/** Each brow from its outer end to its inner one, along its upper edge and its lower edge. */
const BROW: Record<Side, { upper: number[]; lower: number[] }> = {
	l: { upper: [70, 63, 105, 66, 107], lower: [46, 53, 52, 65, 55] },
	r: { upper: [300, 293, 334, 296, 336], lower: [276, 283, 282, 295, 285] },
};
const CORNER: Record<Side, number> = { l: 61, r: 291 };
const JAW_CORNER: Record<Side, number> = { l: 172, r: 397 };
/** The lips down their middle: the upper lip 0, 11, 12, 13 (its inner edge), the lower 14 … 17. */
const LIP = { upper: 13, upperMid: [11, 12], lower: 14, lowerMid: [15, 16], bottom: 17 };
const CHIN = 152;
const NOSE = 1;
/** The face mesh's points that outline the face (the tracker's 468; the iris points are inside). */
const MESH = 468;

/** The most a pose may squeeze the skin inside the face (a share of it): at 1 it folds. */
const SAFE = 0.85;
/** The lattice the squeeze is measured on: this many steps across the face's outline. */
const LATTICE = 120;
/** A region's edge, sampled by quarter (0 to a quarter turn), drawn in by this step until inside. */
const EDGE = Array.from({ length: 9 }, (_, i) => (i * Math.PI) / 16);
const CLAMP_STEP = 0.95;
const CLAMP_PASSES = 60;
/** A feature shares the room at a point it squeezes by at least this share of its worst squeeze. */
const SHARE = 0.1;
/**
 * A feature's claim on the room it shares with another (each group's own axis, 1 else): a blink
 * shares the eye with the gaze, the jaw and the corners the mouth with the lips.
 */
const PRIORITY: Record<string, number> = {
	'lid_upper.y': 3,
	'jaw.y': 3,
	'mouth_corner.x': 2,
	'mouth_corner.y': 2,
	'brow.y': 2,
	'lip_upper.y': 2,
};
/** How far past the tracker's outline a region may reach, as a share of the eyes' distance. */
const OUTLINE = 0.04;
/** A region reaches no less than this share of the eyes' distance (a feature drawn as a dot). */
const LEAST = 0.02;
/** The face's own region is whole over this share of its reach (the features inside it). */
const FACE_CORE = 0.6;
/** A head drawn without its face: the face's region reaches this share of the way to its ink. */
const APART_REACH = 0.9;
/** The furthest a 3D import turns and nods a drawn face (its cannot list: about 40°, and 25°). */
const TURN_3D = (40 * Math.PI) / 180;
const NOD_3D = (25 * Math.PI) / 180;

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const len = (a: P): number => Math.hypot(a[0], a[1]);
const mean = (ps: P[]): P =>
	mul(
		ps.reduce<P>((s, p) => add(s, p), [0, 0]),
		1 / ps.length,
	);

export interface FrameFace {
	features: NonNullable<RigFit['features']>;
	/** The head's regions, in order (each takes its share of what the ones before it left). */
	spots: RigSkinSpot[];
	/** The features the frame's face places, by what moves them (for the create report). */
	moves: string[];
}

/** What moves each region's bone, as the create report names it. */
const MOVES: Record<string, string> = {
	lid_upper: 'blink',
	pupil: 'gaze',
	brow_out: 'brows',
	mouth_corner: 'smile and stretch',
	lip_lower: 'the lips',
	lip_upper: 'the lips',
	jaw: 'the jaw',
	nose: 'the nose',
};

/**
 * The face of template `t` (fitted as `fit`, its frame pose `fit.frame`) placed on the frame's face
 * mesh `face` (rig units, y up: the rig's world in the frame's pose), and the head's regions there.
 * Null for a template without the face block's eyes, or a face the points do not span.
 */
export function frameFace(
	t: RigTemplate,
	fit: RigFit,
	face: readonly P[],
	optional: ReadonlySet<string> = new Set(),
): FrameFace | null {
	const under = faceBones(t.bones, optional);
	if (!under.has('eye_l') || !under.has('eye_r') || face.length < MESH) return null;
	const W = frameWorld(fitTemplate(t, fit).bones, fit.frame);
	const Wf = W.get('face')!;
	const e: P = [Wf[0], Wf[2]];
	if (!(len(e) > 1e-9)) return null;
	const ex: P = mul(e, 1 / len(e));
	const up: P = [-ex[1], ex[0]];
	const along = (p: P, o: P) => (p[0] - o[0]) * ex[0] + (p[1] - o[1]) * ex[1];
	const above = (p: P, o: P) => (p[0] - o[0]) * up[0] + (p[1] - o[1]) * up[1];
	const at = (k: number): P => face[k] as P;

	const eye = { l: mid(at(EYE.l[0]), at(EYE.l[1])), r: mid(at(EYE.r[0]), at(EYE.r[1])) };
	const w0 = boneWorld(t.bones);
	const apart = len(sub(eye.r, eye.l));
	const s = apart / len(sub(w0.get('eye_r')!, w0.get('eye_l')!));
	if (!(s > 1e-6) || !Number.isFinite(s)) return null;
	const least = LEAST * apart;
	const reach = (v: number) => Math.max(least, v);

	// The face's outline: how far its points reach each way from `o`.
	const outline = (o: P): [number, number, number, number] => {
		let [l, r, d, u] = [0, 0, 0, 0];
		for (let k = 0; k < MESH; k++) {
			const [a, b] = [along(at(k), o), above(at(k), o)];
			[l, r, d, u] = [Math.max(l, -a), Math.max(r, a), Math.max(d, -b), Math.max(u, b)];
		}
		return [l, r, d, u];
	};

	const place: Record<string, P> = {};
	const spots: RigSkinSpot[] = [];
	const spot = (
		bone: string,
		o: P,
		extent: [number, number, number, number],
		core: number,
		more: Pick<RigSkinSpot, 'run' | 'then'> = {},
	) => {
		if (!under.has(bone) || ![...o, ...extent, more.run ?? 0].every(Number.isFinite)) return;
		spots.push({
			bone,
			at: o,
			dir: ex,
			extent: extent.map(reach) as [number, number, number, number],
			core,
			...(more.run ? { run: more.run } : {}),
			...(more.then ? { then: more.then } : {}),
		});
	};

	const nose = at(NOSE);
	const eyes = mid(eye.l, eye.r);
	const corner = { l: at(CORNER.l), r: at(CORNER.r) };
	const mouthW = len(sub(corner.r, corner.l));
	const U = mid(at(LIP.upperMid[0]), at(LIP.upperMid[1]));
	const M = mid(at(LIP.upper), at(LIP.lower));
	const Lw = mid(at(LIP.lowerMid[0]), at(LIP.lowerMid[1]));
	const chin = at(CHIN);
	// The mouth reads only drawn below the nose and above the chin, its lips in order.
	const mouth =
		mouthW > least &&
		above(nose, U) > least &&
		above(U, M) >= 0 &&
		above(M, Lw) >= 0 &&
		above(at(LIP.bottom), chin) > least;

	const brows: Partial<Record<Side, { mid: P; inner: P; outer: P; lower: P; thick: number }>> = {};
	for (const sd of SIDES) {
		const [o, i] = EYE[sd];
		const eyeW = len(sub(at(o), at(i)));
		const lidU = at(LID_UP[sd]);
		const lidD = at(LID_DOWN[sd]);
		const open = Math.max(above(lidU, lidD), 0.15 * eyeW);
		place[`eye_${sd}`] = eye[sd];
		place[`lid_upper_${sd}`] = lidU;
		place[`lid_lower_${sd}`] = lidD;
		const B = BROW[sd];
		const upper = B.upper.map(at);
		const lower = B.lower.map(at);
		const bMid = mean([...upper, ...lower]);
		const thick = Math.max(
			least,
			upper.reduce((sum, p, k) => sum + len(sub(p, lower[k])), 0) / upper.length,
		);
		const bLower = mean(lower);
		if (above(bLower, lidU) > least) {
			const brow = {
				mid: bMid,
				inner: mid(upper[4], lower[4]),
				outer: mid(upper[0], lower[0]),
				lower: bLower,
				thick,
			};
			brows[sd] = brow;
			place[`brow_${sd}`] = brow.mid;
			place[`brow_in_${sd}`] = brow.inner;
			place[`brow_out_${sd}`] = brow.outer;
		}
		// The upper lid: whole on its edge, down to the lower lid, up halfway to the brow, out past
		// both corners.
		const gap = brows[sd] ? above(brows[sd]!.lower, lidU) : 1.5 * open;
		const cu = [along(at(o), lidU), along(at(i), lidU)];
		spot(
			`lid_upper_${sd}`,
			lidU,
			[
				1.2 * Math.max(-Math.min(...cu), 0.25 * eyeW),
				1.2 * Math.max(Math.max(...cu), 0.25 * eyeW),
				open,
				Math.max(0.5 * gap, 0.25 * open),
			],
			0,
		);
		// The iris: whole across it, falling to the eye's corners and lids.
		const refined = face.length >= IRIS.r + 5 && face.length >= IRIS.l + 5;
		const ic = refined ? at(IRIS[sd]) : eye[sd];
		const ir = refined
			? Math.min(
					0.45 * eyeW,
					[1, 2, 3, 4].reduce((sum, k) => sum + len(sub(at(IRIS[sd] + k), ic)), 0) / 4,
				)
			: 0.22 * eyeW;
		place[`pupil_${sd}`] = ic;
		const ci = [along(at(o), ic), along(at(i), ic)];
		const [left, right] = [
			Math.max(-Math.min(...ci), 1.2 * ir),
			Math.max(Math.max(...ci), 1.2 * ir),
		];
		spot(
			`pupil_${sd}`,
			ic,
			[left, right, Math.max(above(ic, lidD), 0.5 * ir), Math.max(above(lidU, ic), 0.5 * ir)],
			Math.min(0.7, ir / Math.min(left, right)),
		);
	}
	for (const sd of SIDES) {
		const b = brows[sd];
		if (!b) continue;
		const run = len(sub(b.inner, b.outer));
		const lidU = at(LID_UP[sd]);
		// Whole along the brow to past its ends, falling halfway to the lid and up the forehead; it
		// splits its share from its outer end to its inner one, so each end moves on its own.
		spot(
			`brow_out_${sd}`,
			b.mid,
			[
				1.5 * b.thick,
				1.5 * b.thick,
				above(b.mid, b.lower) + 0.5 * above(b.lower, lidU),
				Math.max(2 * b.thick, Math.min(0.5 * outline(b.mid)[3], run)),
			],
			0.4,
			{
				run: run / 2,
				...(under.has(`brow_in_${sd}`) && run > least
					? {
							then: [
								{
									bone: `brow_in_${sd}`,
									at: b.mid,
									dir: sub(b.inner, b.outer),
									width: 0.8 * run,
									reach: 4 * (run + b.thick),
								},
							],
						}
					: {}),
			},
		);
	}
	if (mouth) {
		place.nose = nose;
		place.lip_upper = U;
		place.jaw = M;
		place.lip_lower = Lw;
		for (const sd of SIDES) {
			place[`mouth_corner_${sd}`] = corner[sd];
			const [out, inn] = [0.4 * mouthW, 0.45 * mouthW];
			spot(
				`mouth_corner_${sd}`,
				corner[sd],
				[
					sd === 'l' ? out : inn,
					sd === 'l' ? inn : out,
					0.6 * above(corner[sd], chin),
					0.6 * above(nose, corner[sd]),
				],
				0.25,
			);
		}
		// Each lip whole along its middle half, falling to the corners and to the lips' line.
		const [run, lips] = [0.25 * mouthW, 0.15 * mouthW];
		spot(
			'lip_lower',
			Lw,
			[lips, lips, 1.5 * above(Lw, at(LIP.bottom)) + least, above(M, Lw)],
			0.3,
			{
				run,
			},
		);
		spot('lip_upper', U, [lips, lips, above(U, M), 0.6 * above(nose, U)], 0.3, { run });
		// The chin rides the jaw whole, falling to the lips' line and toward the jaw's corners (on a
		// turned face the far one is drawn by the chin: the mouth's width at least).
		const C = mid(at(LIP.bottom), chin);
		const jl = Math.max(-along(at(JAW_CORNER.l), C), 0.6 * mouthW);
		const jr = Math.max(along(at(JAW_CORNER.r), C), 0.6 * mouthW);
		spot('jaw', C, [0.9 * jl, 0.9 * jr, 4 * above(C, chin), above(M, C)], 0.5);
		const nw = 0.22 * apart;
		spot('nose', nose, [nw, nw, 0.6 * above(nose, U), 0.6 * above(eyes, nose)], 0.3);
	}
	if (!spots.length) return null;
	// No region reaches past the face's outline (the tracker's, a little out: a drawn face runs past
	// it; a brow, two of its thicknesses: the skin about it is the face's, though the tracker's outline
	// cuts through the far brow of a turned face) but below its jaw (from one jaw corner to the chin
	// to the other, and straight under the chin: the head is not drawn there).
	const hull = convexHull(face.slice(0, MESH) as P[]);
	const jawLine = [at(JAW_CORNER.l), chin, at(JAW_CORNER.r)];
	const belowJaw = (p: P) => {
		const u = along(p, chin);
		// Straight under the chin (a turned face's chin is a corner of the outline).
		if (above(p, chin) < 0 && Math.abs(u) <= 0.6 * mouthW) return true;
		const [a, b] = u < 0 ? [jawLine[0], jawLine[1]] : [jawLine[1], jawLine[2]];
		const [ua, ub] = [along(a, chin), along(b, chin)];
		if (u < Math.min(ua, ub) || u > Math.max(ua, ub) || ua === ub) return false;
		const f = (u - ua) / (ub - ua);
		return above(p, add(a, mul(sub(b, a), f))) < 0;
	};
	const outward = (bone: string) => {
		const brow = /^brow_/.test(bone) ? brows[bone.slice(-1) as Side] : undefined;
		return Math.max(OUTLINE * apart, brow ? 2 * brow.thick : 0);
	};
	for (const sp of spots)
		drawIn(sp, (p) => inside(hull, p, outward(sp.bone)) || belowJaw(p), ex, up);

	// Each bone under the face where the frame draws it, else at its template place scaled to the
	// drawn face, in its parent's frame (the face's turn in the frame's pose, the parent where placed).
	const world = new Map<string, P>();
	const at0: NonNullable<RigFit['features']>['at'] = {};
	for (const b of t.bones) {
		if (!under.has(b.name) || b.name === 'face' || b.parent === undefined) continue;
		const Wp = W.get(b.parent)!;
		const origin = world.get(b.parent) ?? ([Wp[4], Wp[5]] as P);
		const P0: P = place[b.name] ?? [
			origin[0] + s * (Wp[0] * b.x + Wp[1] * b.y),
			origin[1] + s * (Wp[2] * b.x + Wp[3] * b.y),
		];
		world.set(b.name, P0);
		const [x, y] = toFrame(Wp, sub(P0, origin));
		at0[b.name] = { x: round4(x), y: round4(y) };
	}

	const scale = roomScales(
		t,
		under,
		spots,
		hull,
		Math.max(...spots.map((sp) => outward(sp.bone))),
		ex,
		up,
		s,
	);
	const moves = [
		...new Set(spots.map((sp) => MOVES[sp.bone.replace(/_[lr]$/, '')]).filter(Boolean)),
	];
	return { features: { at: at0, scale }, spots, moves };
}

/**
 * A region drawn in until its edge lies inside the face (`inFace`), sampled by quarter: a quarter
 * reaching out is drawn in its side first (its run, when the run's own end is out), then its height,
 * then both.
 */
function drawIn(sp: RigSkinSpot, inFace: (p: P) => boolean, ex: P, up: P): void {
	let run = sp.run ?? 0;
	for (const [su, sv] of [
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	]) {
		const [iu, iv] = [su < 0 ? 0 : 1, sv < 0 ? 2 : 3];
		const edge = (a: number): P =>
			add(
				sp.at,
				add(
					mul(ex, su * (run + sp.extent[iu] * Math.cos(a))),
					mul(up, sv * sp.extent[iv] * Math.sin(a)),
				),
			);
		for (let pass = 0; pass < CLAMP_PASSES; pass++) {
			const out = EDGE.filter((a) => !inFace(edge(a)));
			if (!out.length) break;
			const side = out.includes(0);
			const height = out.includes(EDGE[EDGE.length - 1]);
			if (side && run > 0 && !inFace(add(sp.at, mul(ex, su * run)))) run *= CLAMP_STEP;
			else {
				if (side || !height) sp.extent[iu] *= CLAMP_STEP;
				if (height || !side) sp.extent[iv] *= CLAMP_STEP;
			}
		}
	}
	if (sp.run !== undefined) sp.run = run;
}

/**
 * The face of template `t` (fitted as `fit`) on a drawn head the tracker found no face on — its
 * features drawn apart, or not drawn — inside `outline` (the head drawing's ink, rig units in the
 * frame's pose): its bones where the fit puts them, and one region of the head, the face's, whole
 * about the face bone and falling to `APART_REACH` of the way to the outline, so a head turn and
 * nod carry the head's middle with the face (and the features drawn on its bones) while its outline
 * stays; the face's move cut to the room that leaves (`roomScales`, from its fitted length's).
 */
export function apartFace(
	t: RigTemplate,
	fit: RigFit,
	outline: readonly P[],
	optional: ReadonlySet<string> = new Set(),
): FrameFace | null {
	const under = faceBones(t.bones, optional);
	if (!under.has('face') || outline.length < 3) return null;
	const Wf = frameWorld(fitTemplate(t, fit).bones, fit.frame).get('face')!;
	const e: P = [Wf[0], Wf[2]];
	if (!(len(e) > 1e-9)) return null;
	const ex: P = mul(e, 1 / len(e));
	const up: P = [-ex[1], ex[0]];
	const o: P = [Wf[4], Wf[5]];
	const hull = convexHull(outline);
	if (!inside(hull, o)) return null;
	// How far from `o` along `d` the outline is.
	const reach = (d: P): number => {
		let best = Infinity;
		for (let i = 0; i < hull.length; i++) {
			const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
			const edge = sub(b, a);
			const den = d[0] * edge[1] - d[1] * edge[0];
			if (Math.abs(den) < 1e-12) continue;
			const w = sub(a, o);
			const tt = (w[0] * edge[1] - w[1] * edge[0]) / den;
			const ss = (w[0] * d[1] - w[1] * d[0]) / den;
			if (tt > 0 && ss >= 0 && ss <= 1) best = Math.min(best, tt);
		}
		return Number.isFinite(best) ? APART_REACH * best : 0;
	};
	const extent = [reach(mul(ex, -1)), reach(ex), reach(mul(up, -1)), reach(up)];
	if (!extent.every((v) => v > 1e-3)) return null;
	const sp: RigSkinSpot = {
		bone: 'face',
		at: o,
		dir: ex,
		extent: extent as [number, number, number, number],
		core: FACE_CORE,
	};
	drawIn(sp, (p) => inside(hull, p), ex, up);
	const s = fitRatios(t.bones, fit.bones).get('face') ?? 1;
	const scale = roomScales(t, under, [sp], hull, 0, ex, up, s);
	return {
		features: { at: {}, scale: { face: scale.face } },
		spots: [sp],
		moves: ['the head turn and nod'],
	};
}

/**
 * The factors each bone under the face moves by along x and along y: `s` (the drawn face's size),
 * cut down until no pose squeezes the skin inside the face's outline by more than SAFE, along the
 * face or across it. A pose is every control under the face at either end of its range at once,
 * and a 3D import's turn and nod of the head as far as a drawn face takes (each bone sliding by its
 * depth, which its x factor scales). Measured on a lattice over the outline, where each region's
 * weight is differentiated: a move's squeeze there is the weight's slope times the move.
 *
 * The factors are per bone a control moves (an undriven bone takes the nearest one's above it) and
 * axis: the upper lid, what follows the gaze, the iris, a brow and each of its ends, a mouth corner,
 * each lip, the jaw, the nose, and `face`, whose move carries them all. Where they meet, each takes
 * a share of the room by its squeeze there and its PRIORITY (a blink before the gaze that shares
 * the eye with it); `face` takes what room is left.
 */
function roomScales(
	t: RigTemplate,
	under: Set<string>,
	spots: readonly RigSkinSpot[],
	hull: readonly P[],
	margin: number,
	ex: P,
	up: P,
	s: number,
): Record<string, [number, number]> {
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const driven = new Set(
		t.channels.flatMap((c) =>
			(c.drives ?? []).filter((d) => d.prop === 'x' || d.prop === 'y').map((d) => d.bone),
		),
	);
	const chain = (bone: string): string[] => {
		const out: string[] = [];
		for (let b = byName.get(bone); b && under.has(b.name); b = byName.get(b.parent ?? ''))
			out.push(b.name);
		return out;
	};
	// A bone's group: itself when a control moves it, else the nearest such bone above it under the
	// face, else the face's child it hangs from.
	const groupOf = (bone: string): string => {
		if (bone === 'face') return bone;
		const above = chain(bone).filter((b) => b !== 'face');
		return above.find((b) => driven.has(b)) ?? above[above.length - 1];
	};
	const groups = [...new Set([...under].map(groupOf))];
	// The variables: each group along x (with its depth) and along y.
	const vars = groups.flatMap((g) => [0, 1].map((axis) => ({ g, axis })));
	// Each control's move of each bone per unit of it, along the face's x and y, and its range.
	const controls: { min: number; max: number; move: Map<string, P>; depth?: boolean }[] = [];
	for (const c of t.channels) {
		const move = new Map<string, P>();
		for (const d of c.drives ?? [])
			if (under.has(d.bone) && (d.prop === 'x' || d.prop === 'y')) {
				const m = move.get(d.bone) ?? [0, 0];
				move.set(d.bone, d.prop === 'x' ? [m[0] + d.per, m[1]] : [m[0], m[1] + d.per]);
			}
		if (move.size) controls.push({ min: c.min, max: c.max, move });
	}
	for (const [axis, turn] of [
		[0, TURN_3D],
		[1, NOD_3D],
	] as const) {
		const move = new Map<string, P>();
		for (const b of under) {
			const z = (t.rig3d?.depths[b] ?? 0) * Math.sin(turn);
			if (z) move.set(b, axis === 0 ? [z, 0] : [0, z]);
		}
		if (move.size) controls.push({ min: -1, max: 1, move, depth: true });
	}
	const weighted = [
		...new Set(spots.flatMap((j) => [j.bone, ...(j.then ?? []).map((k) => k.bone)])),
	];
	// Per axis and control, the moves that are not nil: of each weighted bone's pixels, by a
	// variable's group's bones on its own bone and those above it, along the axis per unit of the
	// control (a depth's slide either way, by the x factor).
	const axes: P[] = [ex, up];
	const chains = weighted.map((b) => chain(b).map((x) => ({ bone: x, group: groupOf(x) })));
	const terms = axes.map((a) =>
		controls.map((c) => {
			const list: { v: number; b: number; m: number }[] = [];
			vars.forEach(({ g, axis }, v) =>
				chains.forEach((ch, b) => {
					let [mx, my] = [0, 0];
					for (const x of ch) {
						const m = x.group === g ? c.move.get(x.bone) : undefined;
						if (!m) continue;
						if (axis === 0) mx += m[0];
						if (c.depth ? axis === 0 : axis === 1) my += m[1];
					}
					const w = add(mul(ex, mx), mul(up, my));
					const m = w[0] * a[0] + w[1] * a[1];
					if (m) list.push({ v, b, m });
				}),
			);
			return { list, vs: [...new Set(list.map((x) => x.v))] };
		}),
	);

	const xs = hull.map((p) => p[0]);
	const ys = hull.map((p) => p[1]);
	const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
	const h = span / LATTICE;
	// A weight's slope is read over a quarter step, so a step straddling a region's edge reads it whole.
	const step = h / 4;
	const [x0, y0] = [Math.min(...xs) - margin - h, Math.min(...ys) - margin - h];
	const [nx, ny] = [
		Math.ceil((Math.max(...xs) + margin - x0) / h) + 2,
		Math.ceil((Math.max(...ys) + margin - y0) / h) + 2,
	];
	const index = new Map(weighted.map((b, i) => [b, i]));
	const sharesAt = (p: P) => {
		const w = new Float64Array(weighted.length);
		for (const sh of skinShares(spots, p[0], p[1])) w[index.get(sh.bone)!] += sh.share;
		return w;
	};
	// The worst squeeze each variable gives each lattice point along each axis, at a factor of 1, a
	// step ahead and a step behind, each its own constraint (a region's edge is a kink a centred step
	// halves).
	const squeeze = vars.map(() => [] as number[]);
	const G = new Float64Array(vars.length);
	const sum = new Float64Array(vars.length);
	const slope = new Float64Array(weighted.length);
	for (let j = 1; j < ny - 1; j++)
		for (let i = 1; i < nx - 1; i++) {
			const p: P = [x0 + i * h, y0 + j * h];
			if (!inside(hull, p, margin)) continue;
			const here = sharesAt(p);
			axes.forEach((a, ai) => {
				const [ahead, behind] = [sharesAt(add(p, mul(a, step))), sharesAt(sub(p, mul(a, step)))];
				for (const side of [1, -1]) {
					for (let b = 0; b < weighted.length; b++)
						slope[b] = side > 0 ? (ahead[b] - here[b]) / step : (here[b] - behind[b]) / step;
					sum.fill(0);
					terms[ai].forEach(({ list, vs }, ci) => {
						for (const v of vs) G[v] = 0;
						for (const t of list) G[t.v] += slope[t.b] * t.m;
						const c = controls[ci];
						for (const v of vs) sum[v] += Math.min(0, c.min * G[v], c.max * G[v]);
					});
					for (let v = 0; v < vars.length; v++) squeeze[v].push(sum[v]);
				}
			});
		}
	const k = vars.map(() => s);
	const points = squeeze[0]?.length ?? 0;
	const own = vars.map((v) => v.g !== 'face');
	const pri = vars.map(({ g, axis }) => PRIORITY[`${g.replace(/_[lr]$/, '')}.${'xy'[axis]}`] ?? 1);
	const worst = squeeze.map((q) => Math.min(0, ...q));
	for (let n = 0; n < points; n++) {
		let total = 0;
		for (let v = 0; v < vars.length; v++) if (own[v]) total -= pri[v] * squeeze[v][n];
		if (!(total > 0)) continue;
		for (let v = 0; v < vars.length; v++)
			if (own[v] && squeeze[v][n] < 0 && squeeze[v][n] <= SHARE * worst[v])
				k[v] = Math.min(k[v], (SAFE * pri[v]) / total);
	}
	let most = 0;
	for (let n = 0; n < points; n++) {
		let total = 0;
		for (let v = 0; v < vars.length; v++) if (own[v]) total += k[v] * squeeze[v][n];
		most = Math.min(most, total);
	}
	if (most < -SAFE) for (let v = 0; v < vars.length; v++) if (own[v]) k[v] *= SAFE / -most;
	// The face's room: what each point has left, shared between its two axes alike.
	const face = vars.map((v, i) => (v.g === 'face' ? i : -1)).filter((i) => i >= 0);
	for (let n = 0; n < points && face.length; n++) {
		let rest = SAFE;
		for (let v = 0; v < vars.length; v++) if (own[v]) rest += k[v] * squeeze[v][n];
		const total = face.reduce((sum, v) => sum - squeeze[v][n], 0);
		if (!(total > 0)) continue;
		for (const v of face) k[v] = Math.min(k[v], Math.max(0, rest) / total);
	}
	const at = (b: string, axis: number) =>
		Math.round(k[vars.findIndex((v) => v.g === groupOf(b) && v.axis === axis)] * 1e6) / 1e6;
	return Object.fromEntries([...under].map((b) => [b, [at(b, 0), at(b, 1)]]));
}

/** The convex hull of `pts`, counter-clockwise (Andrew's monotone chain). */
function convexHull(pts: readonly P[]): P[] {
	const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list: P[]) => {
		const out: P[] = [];
		for (const p of list) {
			while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
			out.push(p);
		}
		out.pop();
		return out;
	};
	return [...half(sorted), ...half([...sorted].reverse())];
}

/** Whether `p` lies inside the counter-clockwise convex polygon `hull`, or within `margin` of it. */
function inside(hull: readonly P[], p: P, margin = 0): boolean {
	for (let i = 0; i < hull.length; i++) {
		const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
		const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
		if (cross < -margin * len(sub(b, a))) return false;
	}
	return hull.length >= 3;
}

/** A world offset in the frame of a bone whose world transform is `m` (its turn and scale). */
function toFrame(m: Affine, [dx, dy]: P): P {
	const det = m[0] * m[3] - m[1] * m[2];
	return [(m[3] * dx - m[1] * dy) / det, (m[0] * dy - m[2] * dx) / det];
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

/** The create report's line on the face of a rig made from a frame. */
export function faceNote(moves: readonly string[]): string {
	if (!moves.length)
		return 'The face carries no part of the drawn head: the frame’s face points do not span it.';
	return `The face moves on the drawn head (${moves.join(', ')}). A blink squashes the lid down over the eye and a mouth shape moves the jaw, lips and corners: the drawn closed eye and mouth shapes wait for the GPU face edits (F5).`;
}
