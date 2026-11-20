import type { BoneKeys3d, Quat, QuatKey } from './rig2p5d';
import {
	IDENTITY3,
	across,
	aimFrame,
	apply3,
	cross,
	localTurn,
	matOf,
	mul3,
	quatOf,
	qdot,
	rotZ,
	slerp,
	transpose3,
	turnBetween,
	unit,
	type M3,
	type V3,
} from './rig3dMath';
import {
	ROTATE_TOLERANCE,
	neutralFrames,
	oneEuro,
	type LandmarkRef,
	type MotionFilter,
	type MotionTrack,
} from './rigMotion';

/**
 * Motion from video into a 2.5D rig's 3D keys (docs/design/rig-2p5d.md §8): each mapped bone's 3D
 * orientation, solved from the tracked points and Face Landmarker's transformation matrix and written
 * as `orient` quaternion keys (a turn from the setup). The bake (`rig2p5d.ts`) then turns them into
 * the 2D keys games play, so foreshortening, a hand passing behind the body, the head's parallax and
 * the body's turn are one projection, not four tricks. Pure: no DOM, no MediaPipe.
 *
 * A point is read in the picture and in depth: its x and y are the picture's (where the tracker put
 * it on the frame, so a bone points where the video's limb does), its depth the tracker's 3D estimate
 * (its world points, at the frame's pixels per metre). MediaPipe's world points alone do not project
 * onto its picture points: read that way, the arms on real footage pointed 2–5° off the video's.
 */

/** Points that turn a bone: its direction `from → to`, and a line across it for its turn. */
export interface Bone3dPoints {
	from: LandmarkRef;
	to: LandmarkRef;
	/** A line lying across the bone's card (it is `acrossRest` in the setup). */
	across?: [LandmarkRef, LandmarkRef];
}

/**
 * One bone of a 2.5D template turned from the track: by Pose Landmarker's points (`pose`), by the
 * face's 3D pose (`face`), or to face the viewer (`viewer`).
 */
export interface Bone3dMotion {
	kind: 'bone3d';
	bone: string;
	/** Pose Landmarker's points. */
	pose?: Bone3dPoints;
	/** The head's turn: Face Landmarker's transformation matrix, against the performer's neutral. */
	face?: 'matrix';
	/**
	 * Square to the viewer, keeping its parent's turn in the picture: an image of something round (a
	 * head's outline) that a turning card would narrow.
	 */
	viewer?: 'square';
	/**
	 * With points and no line across: the card rolls about the bone to face the viewer as squarely as
	 * its direction allows — a limb, which looks the same from any side. Without it, it keeps its
	 * parent's card.
	 */
	roll?: 'viewer';
	/** The bone's direction in the setup; none = toward its first child. */
	rest?: [number, number];
	/** The direction `across` lies in, in the setup (needed with `across`). */
	acrossRest?: [number, number];
	/**
	 * The furthest the bone turns from its setup direction, in degrees: a reading past it (the
	 * tracker finding a body upside down across a camera cut, a spine bent double) is a gap, held
	 * from the frame before and reported. None = any turn.
	 */
	reach?: number;
}

/** A template's 3D motion map: what turns each bone of its 2.5D rig. */
export interface RigMotion3d extends MotionFilter {
	/** A pose point below this visibility is a gap. */
	minVisibility: number;
	/** Parents first. */
	entries: Bone3dMotion[];
	/**
	 * The channels a 3D import leaves alone: their bones are turned in 3D, or what they fake (a limb's
	 * shortening, the draw order, the torso's ¾ image, the face's slide) is the bake's projection.
	 */
	replaces: string[];
	/** What a 3D import cannot take, said after it (in place of the map's 2D `cannot`). */
	cannot: string[];
}

/** What the 3D solve needs of a template. */
export interface Motion3dTemplate {
	bones: { name: string; parent?: string; x: number; y: number; rotation?: number }[];
}

export interface Solve3d {
	/** Per bone, its `orient` keys from time 0. */
	bones: Record<string, BoneKeys3d>;
	/** Bones never read (their points were never seen). */
	unseen: string[];
	/** Per bone with a `reach`, the share of frames read past it (held instead). */
	beyond: Record<string, number>;
	/** Per bone, its turn from the setup on every frame, before key reduction (for the gates). */
	turns?: Record<string, Quat[]>;
	/** Per bone, its world rotation on every frame as solved (for the gates). */
	worlds?: Record<string, M3[]>;
}

const DEG = 180 / Math.PI;
const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
const median = (xs: number[]) => {
	if (!xs.length) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The rotation of a Face Landmarker transformation matrix (column-major 4 × 4), its scale taken off. */
function faceRotation(m: readonly number[]): M3 | null {
	const x = unit([m[0], m[1], m[2]]);
	const z = unit([m[8], m[9], m[10]]);
	if (!x || !z) return null;
	const y = unit(cross(z, x));
	if (!y) return null;
	const xx = cross(y, z);
	return [xx[0], y[0], z[0], xx[1], y[1], z[1], xx[2], y[2], z[2]];
}

/** The mean of orientations near one another (sign-aligned, normalised). */
function meanTurn(qs: Quat[]): Quat | null {
	if (!qs.length) return null;
	const s: Quat = [0, 0, 0, 0];
	for (const q of qs) {
		const k = qdot(q, qs[0]) < 0 ? -1 : 1;
		for (let i = 0; i < 4; i++) s[i] += k * q[i];
	}
	const n = Math.hypot(...s);
	return n > 0 ? (s.map((v) => v / n) as Quat) : null;
}

/**
 * The samples a run of slerped `orient` keys needs to stay within `tol` degrees of every sample
 * (Ramer–Douglas–Peucker on the angle between the run and the sample); indices, first and last kept.
 */
export function reduceTurns(times: number[], turns: Quat[], tol: number): number[] {
	const n = turns.length;
	if (n <= 2) return Array.from({ length: n }, (_, i) => i);
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		let worst = -1;
		let at = -1;
		for (let i = a + 1; i < b; i++) {
			const u = (times[i] - times[a]) / (times[b] - times[a] || 1);
			const err = turnBetween(slerp(turns[a], turns[b], u), turns[i]);
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

/** A series held through its gaps (leading gaps from the first measured value); null if none. */
function held<T>(values: (T | null)[]): T[] | null {
	const first = values.find((v): v is T => v !== null);
	if (first === undefined) return null;
	let last: T = first;
	return values.map((v) => (v === null ? last : (last = v)));
}

/** A point series smoothed by the One-Euro filter, a coordinate at a time (metres). */
function smoothPoints(series: (V3 | null)[], times: number[], filter: MotionFilter): (V3 | null)[] {
	const axes = [0, 1, 2].map((k) =>
		oneEuro(
			series.map((p) => (p ? p[k] : null)),
			times,
			filter,
			1,
		),
	);
	return series.map((p, i) => (p ? [axes[0][i]!, axes[1][i]!, axes[2][i]!] : null));
}

/** A series of turns smoothed by the One-Euro filter on their (sign-aligned) components. */
function smoothTurns(turns: Quat[], times: number[], filter: MotionFilter): Quat[] {
	const aligned: Quat[] = [];
	for (const q of turns) {
		const prev = aligned[aligned.length - 1];
		aligned.push(prev && qdot(q, prev) < 0 ? (q.map((v) => -v) as Quat) : q);
	}
	const comps = [0, 1, 2, 3].map((k) =>
		oneEuro(
			aligned.map((q) => q[k]),
			times,
			filter,
			1,
		),
	);
	return aligned.map((_, i) => {
		const q = comps.map((c) => c[i]!) as Quat;
		const n = Math.hypot(...q);
		return q.map((v) => v / n) as Quat;
	});
}

/** A turn series as `orient` keys: within {@link ROTATE_TOLERANCE} of every frame, as the 2D import's turns. */
function orientKeys(times: number[], turns: Quat[]): QuatKey[] {
	const out: QuatKey[] = [];
	for (const i of reduceTurns(times, turns, ROTATE_TOLERANCE)) {
		const prev = out[out.length - 1]?.value;
		const q = prev && qdot(turns[i], prev) < 0 ? turns[i].map((v) => -v) : turns[i];
		out.push({ time: round(times[i], 4), value: q.map((v) => round(v, 6)) as Quat });
	}
	return out;
}

/** Picture points (0…1, y down) and 3D points (metres, y down, z away), as a tracker answers them. */
type Seen = { pic: (readonly number[] | null)[]; world: (readonly number[] | null)[] };

/**
 * The frame's pixels per metre: the picture length of the lines given over their length across the
 * picture in the tracker's 3D points (a line turned in depth shortens in both alike).
 */
function pixelsPerMetre(s: Seen, lines: [number, number][], w: number, h: number, minVis = 0) {
	const k: number[] = [];
	for (const [a, b] of lines) {
		const [pa, pb, wa, wb] = [s.pic[a], s.pic[b], s.world[a], s.world[b]];
		if (!pa || !pb || !wa || !wb) continue;
		if (minVis > 0 && !((pa[2] ?? 1) >= minVis && (pb[2] ?? 1) >= minVis)) continue;
		const m = Math.hypot(wb[0] - wa[0], wb[1] - wa[1]);
		if (m > 0.03) k.push(Math.hypot((pb[0] - pa[0]) * w, (pb[1] - pa[1]) * h) / m);
	}
	return k.length ? median(k) : null;
}
/** Lines the body's scale is read on: the shoulders, the hips and the torso's sides. */
const BODY_LINES: [number, number][] = [
	[11, 12],
	[23, 24],
	[11, 23],
	[12, 24],
];

/**
 * The 3D keys of a track (rig-2p5d §8). Entries are solved parents first, each against its parent's
 * world rotation as solved on the same frame: a limb along its two points, rolled to face the viewer;
 * a bone with a line across it (the shoulders, the hips, a palm's knuckles) turned to both; the head
 * to the face's 3D pose against the performer's neutral; an image turned square to the viewer. Points
 * are smoothed by the One-Euro filter first; a frame a bone's points are missing on holds its turn
 * from the frame before.
 */
export function solveBones3d(
	tpl: Motion3dTemplate,
	map: RigMotion3d,
	track: MotionTrack,
	times: number[],
	{ neutral, trace = false }: { neutral?: number; trace?: boolean } = {},
): Solve3d {
	const { frames, width: W, height: H } = track;
	const n = frames.length;
	const byName = new Map(tpl.bones.map((b) => [b.name, b]));
	const entryOf = new Map(map.entries.map((e) => [e.bone, e]));
	const restOf = (bone: string, given?: [number, number]): V3 | null => {
		if (given) return unit([given[0], given[1], 0]);
		const child = tpl.bones.find((b) => b.parent === bone && (b.x !== 0 || b.y !== 0));
		return child ? unit([child.x, child.y, 0]) : null;
	};

	// Every point an entry reads, in the rig's frame (x right, y up, z toward the viewer; metres): the
	// picture's x and y at the frame's pixels per metre, the tracker's depth. Smoothed.
	const bodies: (Seen | null)[] = frames.map((f) =>
		f.pose?.landmarks && f.pose.world ? { pic: f.pose.landmarks, world: f.pose.world } : null,
	);
	const perFrame = bodies.map((s) =>
		s ? pixelsPerMetre(s, BODY_LINES, W, H, map.minVisibility) : null,
	);
	const typical = median(perFrame.filter((x): x is number => x !== null));
	const ppm = perFrame.map((x) => x ?? (Number.isFinite(typical) ? typical : null));
	const pointAt = (i: number, k: number): V3 | null => {
		const p = bodies[i]?.pic[k];
		const w = bodies[i]?.world[k];
		const scale = ppm[i];
		if (!p || !w || !scale || ![p[0], p[1], w[2]].every(Number.isFinite)) return null;
		if (!((p[2] ?? 1) >= map.minVisibility)) return null;
		return [(p[0] * W) / scale, (-p[1] * H) / scale, -w[2]];
	};
	const series = new Map<number, (V3 | null)[]>();
	const pointsOf = (k: number) => {
		let s = series.get(k);
		if (!s) {
			s = smoothPoints(
				frames.map((_, i) => pointAt(i, k)),
				times,
				map,
			);
			series.set(k, s);
		}
		return s;
	};
	const ref = (r: LandmarkRef): (V3 | null)[] => {
		if (typeof r === 'number') return pointsOf(r);
		const [a, b] = [pointsOf(r[0]), pointsOf(r[1])];
		return a.map((p, i) => {
			const q = b[i];
			return p && q ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2] : null;
		});
	};
	/** An entry's direction and line across it on frame i (either may be missing). */
	const readPoints = (pts: Bone3dPoints, i: number) => {
		const line = (a: LandmarkRef, b: LandmarkRef) => {
			const p = ref(a)[i];
			const q = ref(b)[i];
			return p && q ? ([q[0] - p[0], q[1] - p[1], q[2] - p[2]] as V3) : null;
		};
		const along = line(pts.from, pts.to);
		const side = pts.across ? line(pts.across[0], pts.across[1]) : null;
		return along || side ? { along, side } : null;
	};

	// The head: the face's rotation against its neutral (the first second it is seen, or the moment
	// the author picked), as a turn of the world.
	const faceRot = frames.map((f) => (f.face?.matrix ? faceRotation(f.face.matrix) : null));
	const neutralAt = neutralFrames(
		times,
		faceRot.map((m) => m !== null),
		neutral,
	);
	const rest0 = meanTurn(neutralAt.map((i) => quatOf(faceRot[i]!)));
	const faceTurn = faceRot.map((m) =>
		m && rest0 ? quatOf(mul3(m, transpose3(matOf(rest0)))) : null,
	);
	const faceFilled = held(faceTurn);
	const faceSmooth = faceFilled ? smoothTurns(faceFilled, times, map) : null;

	// Solved frame by frame, parents first: each bone's turn from the setup and its world rotation.
	const turns = new Map(map.entries.map((e) => [e.bone, Array<Quat | null>(n).fill(null)]));
	const worlds = new Map(map.entries.map((e) => [e.bone, [] as M3[]]));
	const normals = new Map<string, V3>();
	const facing = new Map<string, number>();
	const beyond = new Map<string, number>();
	const last = new Map<string, Quat>();
	for (let i = 0; i < n; i++) {
		const world = new Map<string, M3>();
		const worldOf = (name: string | undefined): M3 => {
			if (name === undefined) return IDENTITY3;
			const got = world.get(name);
			if (got) return got;
			const b = byName.get(name);
			if (!b) return IDENTITY3;
			const t = entryOf.has(name) ? last.get(name) : undefined;
			const w = mul3(mul3(worldOf(b.parent), rotZ(b.rotation ?? 0)), t ? matOf(t) : IDENTITY3);
			world.set(name, w);
			return w;
		};
		for (const e of map.entries) {
			const b = byName.get(e.bone);
			if (!b) continue;
			const parent = worldOf(b.parent);
			const setup = b.rotation ?? 0;
			const base = mul3(parent, rotZ(setup));
			let turn: Quat | null = null;
			if (e.face) {
				if (faceTurn[i] && faceSmooth) turn = localTurn(parent, setup, matOf(faceSmooth[i]));
			} else if (e.viewer) {
				const up = apply3(base, [0, 1, 0]);
				const prev = facing.get(e.bone);
				const psi = Math.hypot(up[0], up[1]) > 1e-6 ? Math.atan2(up[1], up[0]) - Math.PI / 2 : prev;
				if (psi !== undefined) {
					facing.set(e.bone, psi);
					turn = localTurn(parent, setup, rotZ(psi * DEG));
				}
			} else {
				const rest = restOf(e.bone, e.rest);
				const got = rest && e.pose ? readPoints(e.pose, i) : null;
				if (rest && got) {
					const restSide: V3 = e.acrossRest
						? (unit([e.acrossRest[0], e.acrossRest[1], 0]) ?? cross([0, 0, 1], rest))
						: cross([0, 0, 1], rest);
					const along = got.along ?? apply3(base, rest);
					let side = got.side ?? apply3(base, restSide);
					const a = e.roll === 'viewer' && !got.side ? unit(along) : null;
					if (a) {
						// The view direction made square to the limb is its card's normal; a limb pointing
						// straight at the viewer keeps the roll it had.
						const nz = across([0, 0, 1], a) ?? normals.get(e.bone);
						if (nz) {
							normals.set(e.bone, nz);
							side = cross(nz, a);
						}
					}
					const w = aimFrame({ along: rest, side: restSide }, along, side);
					if (w) turn = localTurn(parent, setup, w);
					if (turn && e.reach !== undefined) {
						const dir = apply3(matOf(turn), rest);
						const off =
							Math.acos(
								Math.max(-1, Math.min(1, dir[0] * rest[0] + dir[1] * rest[1] + dir[2] * rest[2])),
							) * DEG;
						if (off > e.reach) {
							beyond.set(e.bone, (beyond.get(e.bone) ?? 0) + 1);
							turn = null;
						}
					}
				}
			}
			const prev = last.get(e.bone);
			if (turn && prev && qdot(turn, prev) < 0) turn = turn.map((v) => -v) as Quat;
			turns.get(e.bone)![i] = turn;
			if (turn) last.set(e.bone, turn);
			world.delete(e.bone);
			worlds.get(e.bone)!.push(worldOf(e.bone));
		}
	}

	const out: Solve3d = {
		bones: {},
		unseen: [],
		beyond: Object.fromEntries([...beyond].map(([b, k]) => [b, round(k / Math.max(1, n), 3)])),
	};
	if (trace) {
		out.turns = {};
		out.worlds = Object.fromEntries(worlds);
	}
	for (const e of map.entries) {
		const filled = held(turns.get(e.bone)!);
		// An image turned square to the viewer under parents that never turned stays at its setup.
		const still = !filled || (e.viewer && filled.every((q) => turnBetween(q, [1, 0, 0, 0]) < 1e-6));
		if (!filled || still) {
			if (!e.viewer) out.unseen.push(e.bone);
			continue;
		}
		out.bones[e.bone] = { orient: orientKeys(times, filled) };
		if (out.turns) out.turns[e.bone] = filled;
	}
	return out;
}
