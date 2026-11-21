/**
 * The one two-bone limb solver of the 2.5D rig (docs/design/rig-controls.md §6.2, K4): the bake's 3D
 * IK (`solveIk3d` in `rig2p5d.ts`) and the motion import's 📍 Follow positions (`rigMotion3d.ts`)
 * both reach a target with it. Pure, in the conventions of `rig3dMath.ts` (x right, y up, z toward
 * the viewer).
 */
import { across, apply3, cross, unit, type M3, type V3 } from './rig3dMath';

const sub = (a: readonly number[], b: readonly number[]): V3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];
const dot = (a: readonly number[], b: readonly number[]): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);

export interface Limb3dOptions {
	/**
	 * Rig units before full reach over which the end eases toward the target instead of snapping
	 * straight (4.2's IK softness, the same curve): the knee or elbow never locks with a pop.
	 */
	softness?: number;
	/** Past full reach both bones grow, by one factor, until the end lands on the target. */
	stretch?: boolean;
}

export interface Limb3d {
	/** The middle joint (elbow, knee). */
	mid: V3;
	/** Where the chain's end lands: the target, unless it is out of reach. */
	end: V3;
	/** How much both bones grew (1: not at all). */
	stretch: number;
	/** The end is on the target (within reach, or stretched to it). */
	reached: boolean;
}

/**
 * Two bones of lengths `l1` and `l2` from `root` toward `target`, the middle joint bent toward
 * `bend` (a direction from the root; only its part across the root → target line counts). Out of
 * reach the chain points straight at the target, or grows to it with `stretch`; closer than the
 * bones fold, it folds. Null when the target sits on the root or `bend` lies along the line.
 */
export function solveLimb3d(
	root: readonly number[],
	target: readonly number[],
	l1: number,
	l2: number,
	bend: readonly number[],
	options: Limb3dOptions = {},
): Limb3d | null {
	const d = sub(target, root);
	const dist = len(d);
	if (!(dist > 1e-9) || !(l1 > 0) || !(l2 > 0)) return null;
	const u: V3 = [d[0] / dist, d[1] / dist, d[2] / dist];
	const n = across(bend, u);
	if (!n) return null;
	const full = l1 + l2;
	let reach = dist;
	const soft = Math.max(0, options.softness ?? 0);
	if (soft > 0) {
		const over = dist - full + soft;
		if (over > 0) {
			const p = Math.min(1, over / (soft * 2)) - 1;
			reach = dist - (over - soft * (1 - p * p));
		}
	}
	const k = options.stretch && reach > full ? reach / full : 1;
	const a = l1 * k;
	const b = l2 * k;
	const D = Math.max(Math.abs(a - b), Math.min(reach, a + b));
	const c = Math.max(-1, Math.min(1, (a * a + D * D - b * b) / (2 * a * D)));
	const s = Math.sqrt(1 - c * c);
	const mid: V3 = [
		root[0] + a * (c * u[0] + s * n[0]),
		root[1] + a * (c * u[1] + s * n[1]),
		root[2] + a * (c * u[2] + s * n[2]),
	];
	const reached = D === dist;
	const end: V3 = reached
		? [target[0], target[1], target[2]]
		: [root[0] + D * u[0], root[1] + D * u[1], root[2] + D * u[2]];
	return { mid, end, stretch: k, reached };
}

/** A pole gives the bend its side when it lies at least this far (a share of its length) off the line. */
const POLE_SIDE = 0.1;

/**
 * The first of `poles` (directions from the root) that gives a chain along unit `u` a side to bend
 * to: one lying at least {@link POLE_SIDE} of its length off the line. Null when none does.
 */
export function poleSide(
	u: readonly number[],
	poles: readonly (readonly number[] | null | undefined)[],
): readonly number[] | null {
	for (const p of poles) {
		if (!p) continue;
		const off = sub(p, [u[0] * dot(p, u), u[1] * dot(p, u), u[2] * dot(p, u)]);
		if (len(off) > POLE_SIDE * len(p)) return p;
	}
	return null;
}

/** How far short of straight the motion import holds a chain pulled to its full reach. */
const IK_SLACK = 0.999;

/**
 * The motion import's reach (📍 Follow positions): two bones from `root` reaching `end`, bent toward
 * the first of `poles` that gives the bend a side. A target past the chain's reach in the picture
 * (x, y) has no answer; one past it only through its depth (z) is brought nearer in depth until it
 * is reached. Null when it cannot be reached, is closer than the bones fold, or no pole gives the
 * bend a side. The triangle is {@link solveLimb3d}'s.
 */
export function twoBoneIk(
	root: readonly number[],
	end: readonly number[],
	l1: number,
	l2: number,
	poles: readonly (readonly number[] | null)[],
): { mid: V3; end: V3 } | null {
	const reach = (l1 + l2) * IK_SLACK;
	const d = sub(end, root);
	const flat = Math.hypot(d[0], d[1]);
	if (!(flat <= reach)) return null;
	let to: V3 = [end[0], end[1], end[2]];
	if (len(d) > reach)
		to = [
			end[0],
			end[1],
			root[2] + Math.sign(d[2]) * Math.sqrt(Math.max(0, reach ** 2 - flat ** 2)),
		];
	const span = len(sub(to, root));
	if (span < Math.abs(l1 - l2) + 1e-6 || span < 1e-9) return null;
	const u = unit(sub(to, root));
	const pole = u && poleSide(u, poles);
	const got = pole && solveLimb3d(root, to, l1, l2, pole);
	return got ? { mid: got.mid, end: got.end } : null;
}

/**
 * The smallest turn carrying direction `from` onto direction `to` (about their cross product). Two
 * opposite directions turn half way round about any axis square to them.
 */
export function swing(from: readonly number[], to: readonly number[]): M3 {
	const a = unit(from);
	const b = unit(to);
	if (!a || !b) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
	const c = Math.max(-1, Math.min(1, dot(a, b)));
	let axis = unit(cross(a, b));
	if (!axis) {
		if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
		axis = across([0, 0, 1], a) ?? across([0, 1, 0], a) ?? [1, 0, 0];
	}
	const s = Math.sqrt(Math.max(0, 1 - c * c));
	const [x, y, z] = axis;
	const t = 1 - c;
	return [
		t * x * x + c,
		t * x * y - s * z,
		t * x * z + s * y,
		t * x * y + s * z,
		t * y * y + c,
		t * y * z - s * x,
		t * x * z - s * y,
		t * y * z + s * x,
		t * z * z + c,
	];
}

/** The point `p` turned by `m` about `about`. */
export const turnAbout = (m: M3, about: readonly number[], p: readonly number[]): V3 => {
	const r = apply3(m, sub(p, about));
	return [about[0] + r[0], about[1] + r[1], about[2] + r[2]];
};
