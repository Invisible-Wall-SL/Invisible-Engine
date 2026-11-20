// A synthetic performer for the 3D motion gates (docs/design/rig-2p5d.md §8): MediaPipe-shaped
// frames — Pose Landmarker's points and world points, Hand Landmarker's hands, Face Landmarker's
// transformation matrix — built from a pose given as directions in the rig's frame (x right, y up,
// z toward the viewer, metres from the hips' middle), so a gate knows the true 3D pose it tracked.
// A library for the spikes, not a check.

export const W = 1000;
export const H = 1000;
const RAD = Math.PI / 180;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => mul(a, 1 / Math.hypot(...a));
/** Row-major 3 × 3 rotations. */
export const rx = (d) => {
	const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
	return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const ry = (d) => {
	const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
	return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rz = (d) => {
	const [c, s] = [Math.cos(d * RAD), Math.sin(d * RAD)];
	return [c, -s, 0, s, c, 0, 0, 0, 1];
};
export const mm = (p, c) => {
	const m = [];
	for (let r = 0; r < 3; r++)
		for (let k = 0; k < 3; k++)
			m.push(p[r * 3] * c[k] + p[r * 3 + 1] * c[3 + k] + p[r * 3 + 2] * c[6 + k]);
	return m;
};
export const ap = (m, v) => [
	m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
	m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
	m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** A direction from a turn in the picture (0 = down, + counter-clockwise) and a tilt toward the viewer. */
export const dir = (picture, toward = 0) => {
	const p = picture * RAD;
	const t = toward * RAD;
	return [Math.sin(p) * Math.cos(t), -Math.cos(p) * Math.cos(t), Math.sin(t)];
};

/** MediaPipe's world frame: x right, y down, z away from the camera. */
const mp = (v) => [v[0], -v[1], -v[2]];
/** The picture: 1 m = 500 px, the hips' middle at (500, 450). */
const pic = (v, vis = 1) => [0.5 + v[0] * 0.5, 0.45 - v[1] * 0.5, vis];

const SIDE = {
	l: {
		shoulder: 12,
		elbow: 14,
		wrist: 16,
		pinky: 18,
		index: 20,
		thumb: 22,
		hip: 24,
		knee: 26,
		ankle: 28,
		heel: 30,
		toe: 32,
		k: -1,
	},
	r: {
		shoulder: 11,
		elbow: 13,
		wrist: 15,
		pinky: 17,
		index: 19,
		thumb: 21,
		hip: 23,
		knee: 25,
		ankle: 27,
		heel: 29,
		toe: 31,
		k: 1,
	},
};

/**
 * The 3D points of a pose, rig frame. `pose`:
 *  - `body`: { yaw (toward the picture's right, +), lean (in the picture, + counter-clockwise) }
 *  - `arms.l|r`: { upper, lower } directions; `palm`: { along, across } (across toward the index)
 *  - `legs.l|r`: { upper, lower }
 */
export function points(pose = {}) {
	const B = mm(ry(pose.body?.yaw ?? 0), rz(pose.body?.lean ?? 0));
	const at = (v) => ap(B, v);
	const p = new Array(33).fill(null);
	p[23] = at([0.1, 0, 0]);
	p[24] = at([-0.1, 0, 0]);
	p[11] = at([0.18, 0.5, 0]);
	p[12] = at([-0.18, 0.5, 0]);
	p[7] = at([0.07, 0.68, -0.02]);
	p[8] = at([-0.07, 0.68, -0.02]);
	p[0] = at([0, 0.66, 0.08]);
	p[2] = at([-0.03, 0.69, 0.06]);
	p[5] = at([0.03, 0.69, 0.06]);
	for (const s of ['l', 'r']) {
		const S = SIDE[s];
		const arm = pose.arms?.[s] ?? {};
		const upper = norm(arm.upper ?? at(dir(0)));
		const lower = norm(arm.lower ?? upper);
		p[S.elbow] = add(p[S.shoulder], mul(upper, 0.28));
		p[S.wrist] = add(p[S.elbow], mul(lower, 0.25));
		const palm = arm.palm ?? { along: lower, across: at([-S.k, 0, 0]) };
		const along = norm(palm.along);
		const across = norm(sub(palm.across, mul(along, dot(palm.across, along))));
		p[S.index] = add(p[S.wrist], add(mul(along, 0.08), mul(across, 0.02)));
		p[S.pinky] = add(p[S.wrist], add(mul(along, 0.08), mul(across, -0.02)));
		p[S.thumb] = add(p[S.wrist], add(mul(along, 0.03), mul(across, 0.04)));
		const leg = pose.legs?.[s] ?? {};
		const thigh = norm(leg.upper ?? at(dir(0)));
		const shin = norm(leg.lower ?? thigh);
		p[S.knee] = add(p[S.hip], mul(thigh, 0.42));
		p[S.ankle] = add(p[S.knee], mul(shin, 0.4));
		p[S.heel] = add(p[S.ankle], at([0, -0.05, -0.05]));
		p[S.toe] = add(p[S.ankle], at([0, -0.06, 0.15]));
	}
	for (let i = 0; i < 33; i++) p[i] ??= at([0, 0.6, 0]);
	return p;
}

/** Hand Landmarker's 21 points for a palm frame, rig frame, about the wrist. */
function handPoints(along, across) {
	const a = norm(along);
	const c = norm(sub(across, mul(a, dot(across, a))));
	const pt = (u, v) => add(mul(a, u), mul(c, v));
	const out = [pt(0, 0)];
	out.push(pt(0.02, 0.03), pt(0.04, 0.045), pt(0.06, 0.055), pt(0.075, 0.06));
	for (const [v, len] of [
		[0.025, 0.09],
		[0, 0.095],
		[-0.018, 0.09],
		[-0.034, 0.085],
	])
		out.push(pt(len, v), pt(len + 0.035, v), pt(len + 0.06, v), pt(len + 0.08, v));
	return out;
}

/**
 * One tracked frame of a pose. `opts.face`: a rotation (rig frame) for the head, given as the face's
 * transformation matrix; `opts.hands`: Hand Landmarker hands at each wrist; `opts.vis`: visibility per
 * point index; `opts.skew`: degrees the tracker's 3D points turn in the picture plane away from its
 * picture points (MediaPipe's two do not agree on real footage).
 */
export function frame(t, pose = {}, opts = {}) {
	const p = points(pose);
	const vis = opts.vis ?? {};
	const skew = rz(opts.skew ?? 0);
	const f = {
		t,
		pose: {
			landmarks: p.map((v, i) => pic(v, vis[i] ?? 1)),
			world: p.map((v) => mp(ap(skew, v))),
		},
	};
	if (opts.face) {
		const R = opts.face;
		// Column-major 4 × 4, the canonical face to the camera (cm).
		f.face = {
			landmarks: Array.from({ length: 478 }, () => [0.5, 0.2]),
			blend: {},
			matrix: [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, -60, 1],
		};
	}
	if (opts.hands) {
		f.hands = ['l', 'r'].map((s) => {
			const S = SIDE[s];
			const arm = pose.arms?.[s] ?? {};
			const lower = norm(arm.lower ?? arm.upper ?? dir(0));
			const palm = arm.palm ?? { along: lower, across: [-S.k, 0, 0] };
			const pts = handPoints(palm.along, palm.across);
			return {
				landmarks: pts.map((v) => pic(add(p[S.wrist], v)).slice(0, 2)),
				world: pts.map(mp),
			};
		});
	}
	return f;
}

/** A track of `n` frames at `fps`, frame i posed by `poseAt(i, t)` → { pose, opts }. */
export function track(n, fps, poseAt) {
	const frames = [];
	for (let i = 0; i < n; i++) {
		const t = i / fps;
		const { pose, opts } = poseAt(i, t);
		frames.push(frame(t, pose, opts));
	}
	return { width: W, height: H, frames };
}
