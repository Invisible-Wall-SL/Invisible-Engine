/**
 * The Rigger's stage for a 2.5D rig (docs/design/rig-2p5d.md §9, P3b). Pure, so the page (through
 * `vendor/rigger-2p5d.js`) and the gates run the same code.
 *
 * - **The turned view** (`viewPose`): the rig held at its pose at the playhead (`heldOf`: each bone's
 *   keys there), its roots turned about the vertical by the view's angle, baked by the bake every clip
 *   is baked by, so the stage draws through engine-rig the 2D pose a game would play for that camera:
 *   each baked bone's local, the draw order from depth and the drawings by angle.
 * - **The gizmo in 3D** (its parts are rig-controls §5.8's): the rotate, tilt and twist rings and the
 *   X, Y and depth arrows, along and about the bone's own axes (its length frame, as its tilt and
 *   twist are read: `orientAlong`) or the stage's, on the rig as the stage draws it (`heldFrames`).
 *
 * Every direction of the gizmo is in the DRAWN world: the rig's world turned by the view, so a
 * direction's x and y are where it points on the stage (the projection is orthographic) and its z is
 * toward the viewer.
 */
import {
	bake2p5d,
	boneKeysAt,
	orientOf,
	pose3d,
	rig2p5dProblems,
	type BoneKeys3d,
	type Clip3d,
	type Frame3d,
	type Quat,
	type Rig3d,
} from './rig2p5d';
import { matOf, mul3, quatOf, rotZ, rotationOf, type M3, type V3 } from './rig3dMath';

export { rotationOf };

/** How long a held pose lasts: the bake needs a clip of some length, and one check of it is enough. */
const HOLD = 1 / 480;

/** A bone's channels at one time: its turn from the setup and its offsets (scale a multiple). */
export interface Held3d {
	/** Its turn from the setup, for a bone keying `orient`… */
	orient?: Quat;
	/** …or its 2D turn (degrees about its parent's z), for one that does not. */
	rotate?: number;
	depth: number;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
}

/** A bone's keys (in the 3D data, or its 2D keys) held at `t`. */
export function heldOf(keys: BoneKeys3d, t: number): Held3d {
	const v = boneKeysAt(keys, t);
	const turn = keys.orient?.length ? { orient: v.orient } : { rotate: v.rotate };
	return { ...turn, depth: v.depth, x: v.x, y: v.y, scaleX: v.scaleX, scaleY: v.scaleY };
}

/** What else a held pose holds: each 3D IK's mix, and each space's (by its `Constraint3d` name). */
export interface HeldMixes {
	ik?: Record<string, number>;
	constraints?: Record<string, number>;
}

/** A rig's pose at one time as a clip of that length: every channel one key at 0. */
export function heldClip(bones: Record<string, Held3d>, mixes: HeldMixes = {}): Clip3d {
	const out: Clip3d['bones'] = {};
	for (const [name, h] of Object.entries(bones)) {
		const k: BoneKeys3d = {};
		if (h.orient) k.orient = [{ time: 0, value: h.orient }];
		else if (h.rotate) k.rotate = [{ time: 0, value: h.rotate }];
		if (h.depth) k.depth = [{ time: 0, value: h.depth }];
		if (h.x || h.y) k.translate = [{ time: 0, x: h.x, y: h.y }];
		if (h.scaleX !== 1 || h.scaleY !== 1) k.scale = [{ time: 0, x: h.scaleX, y: h.scaleY }];
		out[name] = k;
	}
	const clip: Clip3d = { name: 'pose', duration: HOLD, bones: out };
	const held = (m: Record<string, number>) =>
		Object.fromEntries(Object.entries(m).map(([n, mix]) => [n, [{ time: 0, mix }]]));
	if (mixes.ik) clip.ik = held(mixes.ik);
	if (mixes.constraints) clip.constraints = held(mixes.constraints);
	return clip;
}

/** The rig the stage poses: its constraints dropped (the page solves them) but its spaces, which a 3D IK reads. */
const stageRig = (rig: Rig3d): Rig3d => ({
	...rig,
	constraints: (rig.constraints ?? []).filter((c) => c.space !== undefined),
});

/**
 * The clip seen by a camera turned `deg` about the vertical: each root's turn composed with the
 * view's, about its own origin, so the rig turns in place (positive: its right side toward the viewer).
 */
export function turnedView(rig: Rig3d, clip: Clip3d, deg: number): Clip3d {
	if (!deg) return clip;
	const bones = { ...clip.bones };
	const view = matOf(orientOf(0, -deg, 0));
	for (const b of rig.bones) {
		if (b.parent !== undefined || b.follow !== undefined) continue;
		const own = bones[b.name] ?? {};
		const turn = own.orient?.length
			? matOf(own.orient[0].value)
			: matOf(orientOf(own.rotate?.[0]?.value ?? 0, 0, 0));
		const setup = b.rotate ?? 0;
		const value = quatOf(mul3(mul3(mul3(rotZ(-setup), view), rotZ(setup)), turn));
		const keys: BoneKeys3d = { ...own, orient: [{ time: 0, value }] };
		delete keys.rotate;
		bones[b.name] = keys;
	}
	return { ...clip, bones };
}

/** A bone's 2D local as engine-rig holds it (absolute, not offsets): what the stage draws. */
export interface Local2d {
	rotation: number;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	shearY: number;
}

export interface ViewPose {
	/** Every bone the bake keyed or passed through, at its pose. */
	bones: Record<string, Local2d>;
	/** The slots' draw order from depth, when depth moved any slot from the setup order; else null. */
	order: string[] | null;
	/** Per slot with drawings by angle, the drawing that faces the viewer best. */
	attachments: Record<string, string>;
	/** The bones the bake keyed. */
	baked: string[];
}

/**
 * The rig at pose `bones` (each bone's channels, `heldOf`; a bone left out is at its setup) seen by
 * a camera turned `deg` about the vertical, as the bake keys it. Constraints are not baked against
 * (the page's own update solves them after), but 3D IKs are solved, at `mixes`, reading their controls
 * through their spaces. Null, with the reasons, when the bake refuses the rig.
 */
export function viewPose(
	rig: Rig3d,
	bones: Record<string, Held3d>,
	deg: number,
	mixes: HeldMixes = {},
): { pose: ViewPose } | { problems: string[] } {
	const free = stageRig(rig);
	const clip = turnedView(free, heldClip(bones, mixes), deg);
	const problems = rig2p5dProblems(free, clip);
	if (problems.length) return { problems };
	const bake = bake2p5d(free, clip);
	const at = <K extends { time?: number }>(ks: K[] | undefined): K | undefined => ks?.[0];
	const out: Record<string, Local2d> = {};
	for (const name of new Set([...bake.baked, ...Object.keys(bake.animation.bones)])) {
		const s = bake.setup[name];
		const t = bake.animation.bones[name] ?? {};
		out[name] = {
			rotation: s.rotation + (at(t.rotate)?.value ?? 0),
			x: s.x + (at(t.translate)?.x ?? 0),
			y: s.y + (at(t.translate)?.y ?? 0),
			scaleX: s.scaleX * (at(t.scale)?.x ?? 1),
			scaleY: s.scaleY * (at(t.scale)?.y ?? 1),
			shearY: at(t.sheary)?.value ?? 0,
		};
	}
	const attachments: Record<string, string> = {};
	for (const [slot, keys] of Object.entries(bake.drawings))
		if (keys.length) attachments[slot] = keys[0].attachment;
	return {
		pose: {
			bones: out,
			order: bake.animation.drawOrder?.length ? bake.orderAt(0) : null,
			attachments,
			baked: bake.baked,
		},
	};
}

// ── The gizmo in 3D ─────────────────────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;
/** An arrow drawn shorter than this share of its length points too far toward the viewer to drag. */
export const AXIS_LEAST = 0.15;
/** A ring seen edge-on is drawn (and grabbed) as an ellipse at least this round. */
export const RING_LEAST = 0.25;

/** Every bone's 3D frame as the stage draws it: the held pose `bones`, seen by a camera turned `deg`. */
export function heldFrames(
	rig: Rig3d,
	bones: Record<string, Held3d>,
	deg: number,
	mixes: HeldMixes = {},
): Map<string, Frame3d> {
	const free = stageRig(rig);
	return pose3d(free, turnedView(free, heldClip(bones, mixes), deg), 0);
}

/** The view's turn: what the drawn world is the rig's world turned by (a root's drawn parent). */
export const viewFrame = (deg: number): M3 => matOf(orientOf(0, -deg, 0));

const unit3 = (v: readonly number[]): V3 | null => {
	const n = Math.hypot(v[0], v[1], v[2]);
	return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null;
};
const col = (m: readonly number[], k: number): V3 => [m[k], m[3 + k], m[6 + k]];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];

/**
 * The gizmo's three directions on bone frame `m` (drawn): in `local` space its own, x along its length
 * (`along` degrees from its x axis, as its tilt and twist are read: `orientAlong`), y across it and z
 * its card's normal; in `view` space the stage's, turned by the view (`deg`).
 */
export function gizmoAxes3d(
	m: readonly number[],
	space: 'local' | 'view',
	deg: number,
	along = 0,
): { x: V3; y: V3; z: V3 } {
	const r = space === 'local' ? mul3(rotationOf(m), rotZ(along)) : viewFrame(deg);
	return { x: col(r, 0), y: col(r, 1), z: col(r, 2) };
}

/** A turn of `deg` about unit `axis`, as a rotation matrix (Rodrigues). */
export function axisTurn(axis: readonly number[], deg: number): M3 {
	const [x, y, z] = unit3(axis) ?? [0, 0, 1];
	const c = Math.cos(deg * RAD);
	const s = Math.sin(deg * RAD);
	const k = 1 - c;
	return [
		c + x * x * k,
		x * y * k - z * s,
		x * z * k + y * s,
		y * x * k + z * s,
		c + y * y * k,
		y * z * k - x * s,
		z * x * k - y * s,
		z * y * k + x * s,
		c + z * z * k,
	];
}

/** The inverse of a 3×3 frame, or null when it has none (a scale of 0). */
function inverse3(m: readonly number[]): M3 | null {
	const [a, b, c, d, e, f, g, h, i] = m;
	const A = e * i - f * h;
	const B = f * g - d * i;
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	if (Math.abs(det) < 1e-12) return null;
	return [
		A,
		c * h - b * i,
		b * f - c * e,
		B,
		a * i - c * g,
		c * d - a * f,
		C,
		b * g - a * h,
		a * e - b * d,
	].map((x) => x / det);
}

/**
 * A bone's turn from its setup (`q`, its `orient`) after turning it `deg` about drawn-world `axis`
 * (one of its own drawn axes, or the stage's): the turn that draws it turned so, its parent drawn
 * as `parent` (with its scale; a root's is the view's, `viewFrame`) and `setup` its setup rotation.
 * Under a parent scaled unevenly a bone's drawn frame is not a rotation; its rotation part (x axis
 * first) turns exactly: the new local turn is the rotation part of parent⁻¹ · turn · drawn frame
 * (a frame's rotation part ignores what scales and shears it after its x axis, so this is exact).
 */
export function turnBone(
	q: Quat,
	setup: number,
	parent: readonly number[],
	axis: readonly number[],
	deg: number,
): Quat {
	const inv = inverse3(parent);
	if (!inv) return q;
	const drawn = mul3([...parent], mul3(rotZ(setup), matOf(q)));
	const local = rotationOf(mul3(inv, mul3(axisTurn(axis, deg), drawn)));
	return quatOf(mul3(rotZ(-setup), local));
}

/**
 * A move of `t` along drawn-world direction `dir`, as offsets in the parent's frame (x, y, depth):
 * the parent drawn as `parent` (with its scale; a root's is the view's).
 */
export function moveBone(parent: readonly number[], dir: readonly number[], t: number): V3 {
	const inv = inverse3(parent);
	if (!inv) return [0, 0, 0];
	return [0, 1, 2].map(
		(r) => (inv[r * 3] * dir[0] + inv[r * 3 + 1] * dir[1] + inv[r * 3 + 2] * dir[2]) * t,
	) as V3;
}

/**
 * How far a drag `drag` (drawn-world units) moves a point along an arrow pointing `dir` (drawn
 * world): the part of the drag along the arrow as drawn, over the arrow's drawn length, so the point
 * follows the cursor. Null for an arrow pointing nearly at the viewer (`AXIS_LEAST`).
 */
export function alongAxis(dir: readonly number[], drag: readonly number[]): number | null {
	const l2 = dir[0] * dir[0] + dir[1] * dir[1];
	if (l2 < AXIS_LEAST * AXIS_LEAST) return null;
	return (drag[0] * dir[0] + drag[1] * dir[1]) / l2;
}

/**
 * A ring of radius `r` about drawn-world `axis`, as drawn: the 2×2 `[m0 m1; m2 m3]` putting its
 * point at angle `u` (radians, +u turning about `axis` by the right hand) at `m · (cos u, sin u)`
 * from the centre. Seen edge-on a ring is a line, so its thinner side is held at `RING_LEAST` of
 * its wider (the side it bulges to keeps the ring's own sense where it has one).
 */
export function ringOnScreen(axis: readonly number[], r: number, least = RING_LEAST): number[] {
	const a = unit3(axis) ?? [0, 0, 1];
	const u = unit3(Math.abs(a[2]) < 0.9 ? cross(a, [0, 0, 1]) : cross(a, [1, 0, 0])) ?? [1, 0, 0];
	const w = cross(a, u);
	const m = [u[0] * r, w[0] * r, u[1] * r, w[1] * r];
	// m = R(φ) · diag(s1, s2) · R(θ), with s2 signed by the determinant.
	const E = (m[0] + m[3]) / 2;
	const F = (m[0] - m[3]) / 2;
	const G = (m[2] + m[1]) / 2;
	const H = (m[2] - m[1]) / 2;
	const Q = Math.hypot(E, H);
	const R = Math.hypot(F, G);
	const s1 = Q + R;
	let s2 = Q - R;
	if (Math.abs(s2) >= least * s1) return m;
	const a1 = Math.atan2(G, F);
	const a2 = Math.atan2(H, E);
	const th = (a2 - a1) / 2;
	const ph = (a2 + a1) / 2;
	s2 = (s2 < 0 ? -1 : 1) * least * s1;
	const [cp, sp, ct, st] = [Math.cos(ph), Math.sin(ph), Math.cos(th), Math.sin(th)];
	// R(φ) · diag(s1, s2) · R(θ)
	return [
		cp * s1 * ct - sp * s2 * st,
		-cp * s1 * st - sp * s2 * ct,
		sp * s1 * ct + cp * s2 * st,
		-sp * s1 * st + cp * s2 * ct,
	];
}

/** The angle `u` (radians) of the drawn ring point nearest `at` (from the centre), and how far it is. */
export function ringNearest(
	m: readonly number[],
	at: readonly number[],
): { u: number; dist: number } {
	const distAt = (u: number) =>
		Math.hypot(
			at[0] - (m[0] * Math.cos(u) + m[1] * Math.sin(u)),
			at[1] - (m[2] * Math.cos(u) + m[3] * Math.sin(u)),
		);
	const N = 96;
	const step = (2 * Math.PI) / N;
	let u = 0;
	for (let k = 1; k < N; k++) if (distAt(k * step) < distAt(u)) u = k * step;
	// Then closer, between its two neighbours (a ring's drawn distance is smooth there).
	let lo = u - step;
	let hi = u + step;
	for (let k = 0; k < 40; k++) {
		const a = lo + (hi - lo) / 3;
		const b = hi - (hi - lo) / 3;
		if (distAt(a) < distAt(b)) hi = b;
		else lo = a;
	}
	u = (lo + hi) / 2;
	return { u, dist: distAt(u) };
}

/**
 * Where a ring grabbed at `u` (radians) is dragged to: the angle of the drawn ring point nearest `at`
 * (from the centre), found from `u` outward (a few Newton steps along the ring), so the grabbed point
 * follows the cursor and never jumps across the ring. The turn is how far that angle went.
 */
export function ringFollow(m: readonly number[], u: number, at: readonly number[]): number {
	let v = u;
	for (let k = 0; k < 6; k++) {
		const tx = -m[0] * Math.sin(v) + m[1] * Math.cos(v);
		const ty = -m[2] * Math.sin(v) + m[3] * Math.cos(v);
		const l2 = tx * tx + ty * ty;
		if (l2 < 1e-12) break;
		const px = m[0] * Math.cos(v) + m[1] * Math.sin(v);
		const py = m[2] * Math.cos(v) + m[3] * Math.sin(v);
		const step = ((at[0] - px) * tx + (at[1] - py) * ty) / l2;
		v += Math.max(-0.5, Math.min(0.5, step));
	}
	return v;
}
