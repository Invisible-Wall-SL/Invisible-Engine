/**
 * The frame maths the motion import turns a 2.5D rig's bones with (docs/design/rig-2p5d.md §8). Pure.
 *
 * Conventions are the bake's (`rig2p5d.ts`): x right, y up, z toward the viewer; a 3×3 matrix is
 * row-major; a quaternion is `[w, x, y, z]`. A bone's world rotation is its parent's × Rz(its setup
 * rotation) × its `orient` (the turn from the setup), and its card (its art) lies in its local x-y
 * plane, facing +z at rest.
 */
import type { Quat } from './rig2p5d';

export type V3 = [number, number, number];
/** A row-major 3×3 rotation. */
export type M3 = number[];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const sub = (a: readonly number[], b: readonly number[]): V3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];
const dot = (a: readonly number[], b: readonly number[]): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: readonly number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: readonly number[], b: readonly number[]): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
/** `a` at length 1, or null when it has none. */
export const unit = (a: readonly number[]): V3 | null => {
	const n = Math.hypot(a[0], a[1], a[2]);
	return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : null;
};
/** `a` with its part along unit `n` taken off, at length 1 (null when `a` lies along `n`). */
export const across = (a: readonly number[], n: readonly number[]): V3 | null =>
	unit(sub(a, scale(n, dot(a, n))));

export const IDENTITY3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mul3 = (p: M3, c: M3): M3 => {
	const m = new Array<number>(9);
	for (let r = 0; r < 3; r++)
		for (let k = 0; k < 3; k++)
			m[r * 3 + k] = p[r * 3] * c[k] + p[r * 3 + 1] * c[3 + k] + p[r * 3 + 2] * c[6 + k];
	return m;
};
export const transpose3 = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const apply3 = (m: M3, v: readonly number[]): V3 => [
	m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
	m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
	m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** A turn of `deg` about the view axis (z). */
export const rotZ = (deg: number): M3 => {
	const c = Math.cos(deg * RAD);
	const s = Math.sin(deg * RAD);
	return [c, -s, 0, s, c, 0, 0, 0, 1];
};
/** The rotation whose columns are `a`, `c` and `a × c` (both unit and at right angles). */
const frameOf = (a: V3, c: V3): M3 => {
	const n = cross(a, c);
	return [a[0], c[0], n[0], a[1], c[1], n[1], a[2], c[2], n[2]];
};

/** A rotation matrix as a unit quaternion (Shepperd's method), w ≥ 0. */
export function quatOf(m: M3): Quat {
	const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
	const tr = m00 + m11 + m22;
	let q: Quat;
	if (tr > 0) {
		const s = Math.sqrt(tr + 1) * 2;
		q = [s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s];
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		q = [(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s];
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		q = [(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s];
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4];
	}
	const n = Math.hypot(...q);
	const k = (q[0] < 0 ? -1 : 1) / n;
	return [q[0] * k, q[1] * k, q[2] * k, q[3] * k];
}

/** A unit quaternion's rotation matrix (row-major), as the bake builds it. */
export const matOf = ([w, x, y, z]: Quat): M3 => [
	1 - 2 * (y * y + z * z),
	2 * (x * y - w * z),
	2 * (x * z + w * y),
	2 * (x * y + w * z),
	1 - 2 * (x * x + z * z),
	2 * (y * z - w * x),
	2 * (x * z - w * y),
	2 * (y * z + w * x),
	1 - 2 * (x * x + y * y),
];

export const qdot = (a: Quat, b: Quat): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
/** The angle between two orientations, in degrees. */
export const turnBetween = (a: Quat, b: Quat): number =>
	2 * Math.acos(Math.min(1, Math.abs(qdot(a, b)))) * DEG;
/** Along the shorter arc from `a` (u = 0) to `b` (u = 1), as the bake slerps an `orient` run. */
export function slerp(a: Quat, b: Quat, u: number): Quat {
	let d = qdot(a, b);
	const s = d < 0 ? -1 : 1;
	d *= s;
	if (d > 1 - 1e-9) {
		const q = a.map((v, i) => v + (s * b[i] - v) * u) as Quat;
		const n = Math.hypot(...q);
		return q.map((v) => v / n) as Quat;
	}
	const th = Math.acos(d);
	const k0 = Math.sin((1 - u) * th) / Math.sin(th);
	const k1 = (s * Math.sin(u * th)) / Math.sin(th);
	return a.map((v, i) => k0 * v + k1 * b[i]) as Quat;
}

/**
 * A bone's turn from its setup (its `orient` key), given the world rotation it should have, its
 * parent's world rotation and its own setup rotation: Rz(setup)ᵀ · parentᵀ · world.
 */
export const localTurn = (parent: M3, setup: number, world: M3): Quat =>
	quatOf(mul3(transpose3(mul3(parent, rotZ(setup))), world));

/**
 * The world rotation that carries a bone's rest frame to a measured one. `rest` is the bone's
 * direction and a direction across its card, in its own frame (at right angles, both unit);
 * `along` and `side` the same two measured in the world (`side` is made square to `along`).
 * Null when the measurement has no direction or its side lies along it.
 */
export function aimFrame(
	rest: { along: V3; side: V3 },
	along: readonly number[],
	side: readonly number[],
): M3 | null {
	const a = unit(along);
	if (!a) return null;
	const c = across(side, a);
	if (!c) return null;
	return mul3(frameOf(a, c), transpose3(frameOf(rest.along, rest.side)));
}

/** The rotation part of a frame (its columns made square to each other and unit, x first). */
export function rotationOf(m: readonly number[]): M3 {
	const col = (k: number): V3 => [m[k], m[3 + k], m[6 + k]];
	const x = unit(col(0)) ?? [1, 0, 0];
	const y = across(col(1), x) ?? unit(cross([0, 0, 1], x)) ?? [0, 1, 0];
	const z = cross(x, y);
	return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** A 3×3's inverse, or null when it has none (a zero scale). */
export function inverse3(m: readonly number[]): M3 | null {
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
