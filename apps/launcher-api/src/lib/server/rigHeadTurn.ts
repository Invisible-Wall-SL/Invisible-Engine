/**
 * The head turn (docs/design/frame-to-rig.md §13.1g): a drawn head that turns round with a 3D
 * capture's yaw and nod, and with the Head turn and Head up / down controls, from its one front
 * drawing — the 2D cut-out way. The head's drawing is a mesh weighted in a dome about the face:
 *
 * - **The face's plateau** — the middle of the head (where the features are, drawn on it or apart)
 *   whole on `face`, which slides by the face's depth: the skin under each feature moves with it.
 * - **The ring** (`HEAD_TURN_BONES`: left, right, below, above) — the round of the head, from the
 *   plateau's edge out to the outline, on four bones under the head at a share of the face's depth:
 *   it slides part-way, so the side the head turns toward squashes and the far side stretches.
 * - **The outline** stays on the head's image (square to the viewer in 3D): it never thins or slides.
 *
 * Every bone is an ordinary bone at a depth (`rig3d.json`), so a 3D clip bakes it into plain keys as
 * it bakes the face's parallax, and the Head turn and Head up / down controls slide it by its depth
 * (`RigFit.turn`). The features keep their own depth in front of the face (the nose most); the lips,
 * the jaw and the glasses on the face come a little in front of the eyes, a prop drawn behind the
 * head sits behind it (it slides the other way). The face's depth is the template's round head at the
 * drawing's width, cut until a 40° turn or a 25° nod squeezes no skin past `SQUEEZE` (at 1× the mesh
 * never folds), times `strength` (past 1× a turn folds the skin sooner: 2× past about half the turn).
 */
import { NOD_3D, TURN_3D, convexHull, inside } from './rigFrameFace';
import {
	HEAD_TURN_BONES,
	fitTemplate,
	frameWorld,
	skinShares,
	type RigFit,
	type RigFitTurn,
	type RigSkinSpot,
} from './rigTemplateFit';
import type { RigTemplate } from './rigTemplates';

type P = [number, number];
/** Reaches to the left, right, below and above. */
type Quad = [number, number, number, number];

/** The strength a mapping that says none turns its head at; 0 turns it off. */
export const HEAD_TURN_DEFAULT = 1;
export const HEAD_TURN_MAX = 2;
/** The template's round head: its face this far in front of the head's middle per unit of half-width. */
const ROUND = 95 / 130;
/** Below the face the outline lies this much nearer than the drawing's edge (the chin turns too). */
const CHIN = 0.75;
/** The ring's depth, a share of the face's. */
const RING_DEPTH = 0.45;
/** How far in front of the face the lips and the jaw sit, and a prop worn on the face, shares of its depth. */
const NEAR = 0.12;
/** A prop drawn behind the head sits this share of its half-width behind its middle. */
const BACK = 0.5;
/** The most a 40° turn or a 25° nod may squeeze the head's skin (the face's controls keep the rest). */
const SQUEEZE = 0.9;
/** Lattice steps across the head the squeeze is measured on. */
const LATTICE = 40;

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
/** How far past the features the plateau is whole. */
const MARGIN = 1.1;
/**
 * The plateau is whole from this share of the way to the outline to the most: as far as the features
 * go, no further than leaves the fall to the outline room for a round turn.
 */
const PLATEAU_LEAST = 0.45;
const PLATEAU_MOST = 0.55;
/** Where the face is found on the head its features are its skin: the plateau may reach further. */
const PLATEAU_FOUND = 0.8;
const len = (a: P): number => Math.hypot(a[0], a[1]);
const round4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

export interface HeadTurnInput {
	t: RigTemplate;
	/** The fit so far: its lengths, its frame and the face's features where they are drawn. */
	fit: RigFit;
	/** The head drawing's ink, rig units in the frame's pose. */
	outline: readonly P[];
	/** The head's regions so far (the face's, `frameFace` / `apartFace`). */
	spots: readonly RigSkinSpot[];
	/** The face drawn apart from the head (its one region is the face's middle, replaced here). */
	apart: boolean;
	/** The ink of the features drawn apart (rig units, frame pose): the plateau holds them. */
	features: readonly P[];
	strength: number;
}

export interface HeadTurn {
	/** The head's regions: the face's own features, the face's plateau, the ring. */
	spots: RigSkinSpot[];
	/** The face's factor (`RigFit.features.scale.face`): its depth and its slides. */
	face: [number, number];
	turn: RigFitTurn;
	/** The face's depth, rig units: how far in front of the head's middle it turns. */
	depth: number;
	/** The head's own bone (the face's parent), where a prop worn on the head hangs to turn with it. */
	head: string;
	/** Where a prop worn on the head hangs and how deep: its pivot (rig world, frame pose) placed. */
	propAt: (where: P, behind: boolean) => { at: P; depth: number };
}

/**
 * The head turn of template `t` on the drawn head `outline`, or null: a template with no face on a
 * head (or no depth for it), a face outside the drawing, or a strength of 0.
 */
export function headTurn(x: HeadTurnInput): HeadTurn | null {
	const { t, fit, strength } = x;
	const faceDepth = t.rig3d?.depths.face;
	const head = t.bones.find((b) => b.name === 'face')?.parent;
	if (!(strength > 0) || !faceDepth || !head || x.outline.length < 3) return null;
	const W = frameWorld(fitTemplate(t, fit).bones, fit.frame);
	const Wf = W.get('face');
	const Wh = W.get(head);
	if (!Wf || !Wh) return null;
	const o: P = [Wf[4], Wf[5]];
	const e = len([Wf[0], Wf[2]]);
	if (!(e > 1e-9)) return null;
	const ex: P = [Wf[0] / e, Wf[2] / e];
	const up: P = [-ex[1], ex[0]];
	const hull = convexHull(x.outline);
	if (!inside(hull, o)) return null;
	// How far from the face's middle the drawing reaches each way (left, right, down, up).
	const reachTo = (d: P): number => {
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
		return Number.isFinite(best) ? best : 0;
	};
	const axes: P[] = [[-ex[0], -ex[1]], ex, [-up[0], -up[1]], up];
	const reach = axes.map(reachTo) as [number, number, number, number];
	if (!reach.every((r) => r > 1e-3)) return null;
	const half = Math.min(reach[0], reach[1]);

	// Two ellipses about the face, the plateau inside the ring. Below the face the ring is whole down
	// to the drawing's edge: the chin and the jaw line turn with the face over the neck, the skull's
	// top and sides keep the outline. The plateau is whole over the features (their regions where the
	// face is found on the head, their drawings where drawn apart) up to PLATEAU_MOST of the way to the
	// outline, so the skin under them moves with them; a feature further out slides a little on it.
	const [l, r, d, u] = reach;
	const rim: Quad = [l, r, d / CHIN, u];
	// In the face's frame from its middle; how far along the ellipse `e` a point (u, v) lies (1: on it).
	const local = (p: P): P => {
		const w = sub(p, o);
		return [w[0] * ex[0] + w[1] * ex[1], w[0] * up[0] + w[1] * up[1]];
	};
	const along = (e: Quad, [du, dv]: P) =>
		Math.hypot(du / e[du < 0 ? 0 : 1], dv / e[dv < 0 ? 2 : 3]);
	// The ring ends inside the drawing's edges above the chin (a drawing turned on its bones has its
	// sides at a slant to the face): drawn in until every edge point there lies on it or past it.
	const edge: P[] = hull.flatMap((a, i) => {
		const b = hull[(i + 1) % hull.length];
		return Array.from({ length: 16 }, (_, k): P =>
			local([a[0] + ((b[0] - a[0]) * k) / 16, a[1] + ((b[1] - a[1]) * k) / 16]),
		);
	});
	for (let pass = 0; pass < 8; pass++) {
		const k = Math.min(1, ...edge.filter(([, dv]) => dv >= -0.5 * d).map((p) => along(rim, p)));
		if (k > 1 - 1e-6) break;
		for (const i of [0, 1, 3]) rim[i] *= k;
	}
	const marks: P[] = [];
	for (const sp of x.apart ? [] : x.spots) {
		const k = len(sp.dir);
		const [sx, sy] = [sp.dir[0] / k, sp.dir[1] / k];
		const run = sp.run ?? 0;
		const [el, er, ed, eu] = sp.extent;
		for (const [a, b] of [
			[-(run + el), 0],
			[run + er, 0],
			[0, -ed],
			[0, eu],
		])
			marks.push([sp.at[0] + a * sx - b * sy, sp.at[1] + a * sy + b * sx]);
	}
	marks.push(...x.features);
	// The plateau is whole out to `c` of the way to the outline, falls to the ring by `m`, the ring to
	// the outline: the two falls as steep (the face's depth falls by 1 − RING_DEPTH over the first,
	// RING_DEPTH over the second).
	let c = PLATEAU_LEAST;
	for (const p of marks) c = Math.max(c, MARGIN * along(rim, local(p)));
	c = Math.min(c, x.apart ? PLATEAU_MOST : PLATEAU_FOUND);
	const m = c + (1 - RING_DEPTH) * (1 - c);
	const plateau: RigSkinSpot = {
		bone: 'face',
		at: o,
		dir: ex,
		extent: rim.map((v) => m * v) as Quad,
		core: c / m,
	};
	const ring: RigSkinSpot = {
		bone: HEAD_TURN_BONES[0],
		at: o,
		dir: ex,
		extent: [...rim],
		core: m,
		split: [...HEAD_TURN_BONES],
	};
	const spots = [...(x.apart ? [] : x.spots), plateau, ring];

	// Each weighted bone's depth as a + c × the face's (c: 1 the face and what rides it, the ring's
	// share, 0 the head's image): its own depths down from the face, each as the fit scales it.
	const byName = new Map(t.bones.map((b) => [b.name, b]));
	const scale = fit.features?.scale ?? {};
	const nearOf = (b: string) => (b === 'lip_upper' || b === 'jaw' ? NEAR : 0);
	const near = ['lip_upper', 'jaw'].filter((b) => byName.get(b)?.parent === 'face');
	const deep = (bone: string): [number, number] => {
		if ((HEAD_TURN_BONES as readonly string[]).includes(bone)) return [0, RING_DEPTH];
		let a = 0;
		let c = 0;
		for (let b = byName.get(bone); b && b.name !== head; b = byName.get(b.parent ?? '')) {
			if (b.name === 'face') {
				c += 1;
				break;
			}
			if (near.includes(b.name)) c += nearOf(b.name);
			else a += (t.rig3d?.depths[b.name] ?? 0) * (scale[b.name]?.[0] ?? 1);
		}
		return [a, c];
	};
	// The skin over the drawing as a turn moves it, sampled once on a lattice: its depth A + D × C,
	// and how much of it rides the head's card (S: all but the head's image, which stays square), whose
	// turn narrows it toward the head's bone by the cosine (at its offset there along the turn).
	const xs = hull.map((p) => p[0]);
	const ys = hull.map((p) => p[1]);
	const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
	const h = span / LATTICE;
	const step = h / 4;
	const hb: P = [Wh[4], Wh[5]];
	const sampled = (p: P): [number, number, number] => {
		let [a, c, s] = [0, 0, 0];
		for (const k of skinShares(spots, p[0], p[1])) {
			const [da, dc] = deep(k.bone);
			a += k.share * da;
			c += k.share * dc;
			s += k.share;
		}
		return [a, c, s];
	};
	/** A sample at `p` along `axis`: its depth (a, c) and its card's share times its offset that way. */
	const along3 = (p: P, axis: P, [a, c, s]: [number, number, number]) =>
		[a, c, s * ((p[0] - hb[0]) * axis[0] + (p[1] - hb[1]) * axis[1])] as const;
	// Each lattice point's slope along the face's x (a turn) and its up (a nod), each side: a squeeze
	// is the narrowing's slope × (1 − cos) less the depth's × sin, either way the head turns.
	const slopes: { a: number; c: number; n: number; sin: number }[] = [];
	for (let px = Math.min(...xs); px <= Math.max(...xs); px += h)
		for (let py = Math.min(...ys); py <= Math.max(...ys); py += h) {
			const p: P = [px, py];
			if (!inside(hull, p)) continue;
			const here = sampled(p);
			for (const [axis, turn] of [
				[ex, TURN_3D],
				[up, NOD_3D],
			] as const) {
				const s0 = along3(p, axis, here);
				for (const k of [1, -1]) {
					const q: P = [p[0] + k * step * axis[0], p[1] + k * step * axis[1]];
					const s1 = along3(q, axis, sampled(q));
					const [da, dc, dn] = [0, 1, 2].map((i) => (k * (s1[i] - s0[i])) / step);
					slopes.push({ a: da, c: dc, n: dn * (1 - Math.cos(turn)), sin: Math.sin(turn) });
				}
			}
		}
	const squeezed = (D: number) =>
		slopes.reduce((most, s) => Math.max(most, s.n + s.sin * Math.abs(s.a + D * s.c)), 0);
	let D = ROUND * half;
	if (squeezed(D) > SQUEEZE) {
		let [lo, hi] = [0, D];
		for (let i = 0; i < 30; i++) {
			const mid = (lo + hi) / 2;
			if (squeezed(mid) > SQUEEZE) hi = mid;
			else lo = mid;
		}
		D = lo;
	}
	D *= strength;
	if (!(D > 1e-3)) return null;

	// The ring's bones where it is whole, each way from the face; the head's frame for each.
	const det = Wh[0] * Wh[3] - Wh[1] * Wh[2];
	const inHead = (p: P): P => {
		const [dx, dy] = [p[0] - Wh[4], p[1] - Wh[5]];
		return [round4((Wh[3] * dx - Wh[1] * dy) / det), round4((Wh[0] * dy - Wh[2] * dx) / det)];
	};
	const bones = HEAD_TURN_BONES.map((name, i) => ({
		name,
		at: inHead([o[0] + m * rim[i] * axes[i][0], o[1] + m * rim[i] * axes[i][1]]),
		depth: round4(RING_DEPTH * D),
	}));
	const depths = Object.fromEntries(near.map((b) => [b, round4(NEAR * D)]));
	const k = round4(D / faceDepth);
	return {
		spots,
		face: [k, k],
		turn: { bones, ...(near.length ? { depths } : {}) },
		depth: D,
		head,
		propAt: (where, behind) => {
			const [a, c] = sampled(where);
			return {
				at: inHead(where),
				depth: round4(behind ? -BACK * half : a + D * (c + NEAR)),
			};
		},
	};
}
