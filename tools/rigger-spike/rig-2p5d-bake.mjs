// The 2.5D rig bake (docs/design/rig-2p5d.md), as the library the gate `rig-2p5d.mjs` runs: a rig
// whose bones carry a 3D orientation and a depth, and a clip keyed in 3D, baked into ordinary irig v1
// (4.2-format) timelines — rotate, translate, scale, shearY, drawOrder and attachment keys. Nothing
// here imports the runtime: the gate plays the result through the real engine-rig, so this file's
// model of how the runtime composes a bone (Inherit.Normal) is itself under test.
//
// A bone's 3D local transform is a translation (x, y, depth) and an orientation: `rotate` about the
// view axis (the 2D rotation), then `tilt` about its own y (its tip toward the viewer, +), then
// `twist` about its own length. A clip keys those three per bone; between keys the orientation is a
// quaternion slerp. The art of a bone lies in its local x-y plane (a card).
//
// The bake, per bone, parents first:
//   1. the bone's WORLD 3D frame, projected orthographically: its 2D world affine is the top-left
//      2×2 of the world linear part and the x, y of the world origin;
//   2. a FLOOR: the projected 2×2's smaller singular value is held at ≥ f × the larger, with the sign
//      of its determinant (f = floorPx / the card's extent, so the card's own image moves ≤ floorPx);
//      a card turning through edge-on flips that sign, which is a STEP (two keys at one time);
//   3. its 2D local = inverse(the parent's PLAYED 2D world) × its own target, decomposed into rotate,
//      scaleX, scaleY, shearY (shearX stays 0: the rotation absorbs it) and x, y, so whatever the
//      parent's keys left, the child's keys put it back — children never drift;
//   4. keyed densely (denseHz), with a step at every flip or drawing swap of its own or its parent's,
//      then reduced: Douglas–Peucker on the WORLD error of its card's corners against what the runtime
//      will play, then refined wherever even the dense keys miss the tolerance. The error is measured
//      on a check set that holds the grid (checkHz), the parent's checks, key times and key-run
//      middles (where the parent's own error peaks), and is subdivided wherever this card or its
//      parent as played thins out: a child's locals grow like 1 / its parent's thinness. A run whose
//      played card thins below half its floor or shows its other side is refused (its children
//      could not follow).
// Draw order comes from the cards' depth with a hysteresis. A slot with drawings by angle shows the
// one that faces the viewer best (past a margin, held a minimum time), on an image bone that hangs
// from a steady bone, follows the turning one in 3D and is turned back by the drawing's angle.

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
/** A determinant above −EDGE counts as facing the viewer, so a card held exactly edge-on keeps one side. */
const EDGE = 1e-12;
/** How far either side of a step its two limits are read, in seconds. */
const LIMIT = 1e-6;

// ── 3D ──────────────────────────────────────────────────────────────────────────────────────────

const qmul = (a, b) => [
	a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
	a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
	a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
	a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qaxis = (x, y, z, deg) => {
	const h = (deg * RAD) / 2;
	const s = Math.sin(h);
	return [Math.cos(h), x * s, y * s, z * s];
};
/** `rotate` about the view axis, then `tilt` about the bone's y (tip toward the viewer +), then `twist` about its x. */
const orient = (rotate, tilt, twist) =>
	qmul(qmul(qaxis(0, 0, 1, rotate), qaxis(0, 1, 0, -tilt)), qaxis(1, 0, 0, twist));
function slerp(a, b, u) {
	let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	if (d < 0) {
		b = b.map((v) => -v);
		d = -d;
	}
	if (d > 0.99999) {
		const r = a.map((v, i) => v + (b[i] - v) * u);
		const n = Math.hypot(...r);
		return r.map((v) => v / n);
	}
	const th = Math.acos(d);
	const s = Math.sin(th);
	const wa = Math.sin((1 - u) * th) / s;
	const wb = Math.sin(u * th) / s;
	return a.map((v, i) => v * wa + b[i] * wb);
}
const qmat = ([w, x, y, z]) => [
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
const mul3 = (p, c) => {
	const m = new Array(9);
	for (let r = 0; r < 3; r++)
		for (let k = 0; k < 3; k++)
			m[r * 3 + k] =
				p.m[r * 3] * c.m[k] + p.m[r * 3 + 1] * c.m[3 + k] + p.m[r * 3 + 2] * c.m[6 + k];
	const o = [0, 1, 2].map(
		(r) => p.m[r * 3] * c.o[0] + p.m[r * 3 + 1] * c.o[1] + p.m[r * 3 + 2] * c.o[2] + p.o[r],
	);
	return { m, o };
};

/** A bone's local orientation at `t` from the clip's keys (absolute, in degrees), or its setup. */
function localQuat(bone, keys, t) {
	if (!keys?.length) return orient(bone.rotate ?? 0, 0, 0);
	const q = (k) => orient(k.rotate ?? bone.rotate ?? 0, k.tilt ?? 0, k.twist ?? 0);
	if (t <= keys[0].time) return q(keys[0]);
	for (let i = 1; i < keys.length; i++)
		if (t < keys[i].time) {
			const u = (t - keys[i - 1].time) / (keys[i].time - keys[i - 1].time);
			return slerp(q(keys[i - 1]), q(keys[i]), u);
		}
	return q(keys[keys.length - 1]);
}

/**
 * Every bone's 3D world transform at `t` ({ m: 3×3 row-major, o }). A bone that `follow`s another
 * is placed on it in 3D whatever its 2D parent (an image bone hangs from a steady bone but draws the
 * one it follows); `turns` gives an image bone's extra tilt (its drawing, turned back by its angle).
 */
function world3d(rig, clip, t, turns = () => 0) {
	const out = new Map();
	for (const b of rig.bones) {
		const turn = turns(b.name, t);
		const spin = { m: qmat(orient(0, -turn, 0)), o: [0, 0, 0] };
		if (b.follow) {
			out.set(b.name, turn ? mul3(out.get(b.follow), spin) : out.get(b.follow));
			continue;
		}
		const q = localQuat(b, clip.bones[b.name], t);
		const local = {
			m: qmat(turn ? qmul(q, orient(0, -turn, 0)) : q),
			o: [b.x ?? 0, b.y ?? 0, b.depth ?? 0],
		};
		out.set(b.name, b.parent ? mul3(out.get(b.parent), local) : local);
	}
	return out;
}

/** The orthographic picture of a 3D frame: its 2D world affine, as engine-rig stores a bone's. */
const project = (w) => ({
	a: w.m[0],
	b: w.m[1],
	c: w.m[3],
	d: w.m[4],
	x: w.o[0],
	y: w.o[1],
});

// ── 2D ──────────────────────────────────────────────────────────────────────────────────────────

/** The 2×2's singular values (σ1 ≥ |σ2|, σ2 carrying the determinant's sign) and directions. */
function svd2(A) {
	const { a, b, c, d } = A;
	const p = a * a + c * c;
	const q = a * b + c * d;
	const r = b * b + d * d;
	const s1 = Math.sqrt((p + r) / 2 + Math.hypot((p - r) / 2, q));
	let vx = q;
	let vy = s1 * s1 - p;
	if (Math.hypot(vx, vy) < 1e-12 * (p + r)) [vx, vy] = p >= r ? [1, 0] : [0, 1];
	const n = Math.hypot(vx, vy);
	vx /= n;
	vy /= n;
	return {
		s1,
		s2: (a * d - b * c) / s1,
		v: [vx, vy],
		u: [(a * vx + b * vy) / s1, (c * vx + d * vy) / s1],
	};
}

/** How thin a 2D affine is: σ2 / σ1 (1 = a card facing the viewer, 0 = edge-on). */
function thinness(A) {
	const s = svd2(A);
	return s.s1 > 0 ? Math.abs(s.s2) / s.s1 : 0;
}

/**
 * The affine with its smaller singular value held at ≥ f × the larger, keeping the determinant's
 * sign (≥ −EDGE counts as +). The change is along the thin direction only: a point p of the card
 * moves by at most (f·σ1 − |σ2|)·|p|.
 */
function floored(A, f) {
	const { s1, s2, u, v } = svd2(A);
	if (!(s1 > 0)) return A;
	const det = A.a * A.d - A.b * A.c;
	const want = (det >= -EDGE ? 1 : -1) * Math.max(Math.abs(s2), f * s1);
	const k = want - s2;
	if (k === 0) return A;
	// σ2's directions are the larger ones turned 90°: u2 = (−u_y, u_x), v2 = (−v_y, v_x).
	return {
		...A,
		a: A.a + k * u[1] * v[1],
		b: A.b - k * u[1] * v[0],
		c: A.c - k * u[0] * v[1],
		d: A.d + k * u[0] * v[0],
	};
}
const facing = (A) => A.a * A.d - A.b * A.c >= -EDGE;

const nearest = (v, ref) => v + 360 * Math.round((ref - v) / 360);

/** engine-rig's Inherit.Normal, shearX = 0: the world a local pose gives under `p` (null = root). */
function compose(p, l) {
	const rx = l.rotation * RAD;
	const ry = (l.rotation + 90 + l.shearY) * RAD;
	const la = Math.cos(rx) * l.scaleX;
	const lc = Math.sin(rx) * l.scaleX;
	const lb = Math.cos(ry) * l.scaleY;
	const ld = Math.sin(ry) * l.scaleY;
	if (!p) return { a: la, b: lb, c: lc, d: ld, x: l.x, y: l.y };
	return {
		a: p.a * la + p.b * lc,
		b: p.a * lb + p.b * ld,
		c: p.c * la + p.d * lc,
		d: p.c * lb + p.d * ld,
		x: p.a * l.x + p.b * l.y + p.x,
		y: p.c * l.x + p.d * l.y + p.y,
	};
}

/** The local pose that puts a bone at world `w` under parent world `p`, its angles near `ref`'s. */
function localOf(p, w, ref, shear) {
	let M = w;
	if (p) {
		const det = p.a * p.d - p.b * p.c;
		const ia = p.d / det;
		const ib = -p.b / det;
		const ic = -p.c / det;
		const id = p.a / det;
		const dx = w.x - p.x;
		const dy = w.y - p.y;
		M = {
			a: ia * w.a + ib * w.c,
			b: ia * w.b + ib * w.d,
			c: ic * w.a + id * w.c,
			d: ic * w.b + id * w.d,
			x: ia * dx + ib * dy,
			y: ic * dx + id * dy,
		};
	}
	const rotation = nearest(Math.atan2(M.c, M.a) * DEG, ref?.rotation ?? 0);
	const shearY = shear ? nearest(Math.atan2(M.d, M.b) * DEG - rotation - 90, ref?.shearY ?? 0) : 0;
	return {
		x: M.x,
		y: M.y,
		rotation,
		scaleX: Math.hypot(M.a, M.c),
		scaleY: Math.hypot(M.b, M.d),
		shearY,
	};
}

const CHANNELS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearY'];
/** What the file stores (7 significant digits) as the runtime holds it (a float32). */
const store = (v) => Number(v.toPrecision(7));
const held = (v) => Math.fround(store(v));
/** A key's pose as the runtime will play it: setup + stored offset; scale × setup (1 here). */
function asPlayed(setup, l) {
	return {
		x: setup.x + held(l.x - setup.x),
		y: setup.y + held(l.y - setup.y),
		rotation: setup.rotation + held(l.rotation - setup.rotation),
		scaleX: held(l.scaleX),
		scaleY: held(l.scaleY),
		shearY: held(l.shearY),
	};
}
const lerpPose = (k0, k1, t) => {
	const u = (t - k0.time) / (k1.time - k0.time);
	const out = {};
	for (const c of CHANNELS) out[c] = k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
	return out;
};
/** The runtime's lookup: the last key at or before `t`, linear to the next. */
function poseAt(keys, t) {
	let lo = 0;
	let hi = keys.length - 1;
	if (t >= keys[hi].time) return keys[hi].pose;
	if (t < keys[0].time) return keys[0].pose;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (keys[mid].time <= t) lo = mid;
		else hi = mid;
	}
	return lerpPose(keys[lo], keys[hi], t);
}

/** The largest distance, in rig units, between where two affines put the card's corners. */
export function cornerError(w, ref, card) {
	let e = 0;
	for (const px of [card.x0, card.x1])
		for (const py of [-card.h, card.h]) {
			const dx = w.a * px + w.b * py + w.x - (ref.a * px + ref.b * py + ref.x);
			const dy = w.c * px + w.d * py + w.y - (ref.c * px + ref.d * py + ref.y);
			const d = Math.hypot(dx, dy);
			e = Number.isNaN(d) ? Infinity : Math.max(e, d);
		}
	return e;
}
const cardExtent = (card) => Math.hypot(Math.max(Math.abs(card.x0), Math.abs(card.x1)), card.h);

// ── The bake ────────────────────────────────────────────────────────────────────────────────────

const BAKE_DEFAULTS = {
	/** World error the reduced keys may leave, at any card corner, in rig units. */
	tol: 0.45,
	/** How far the floor may move a card's own corner, in rig units. */
	floorPx: 0.35,
	denseHz: 120,
	checkHz: 480,
	/** Depth (rig units) one card must pass another by before the draw order swaps. */
	hysteresis: 6,
	/** How much better (in the cosine of its turn) another drawing must face the viewer to swap… */
	swapMargin: 0.03,
	/** …and how long a drawing is held at least, in seconds. */
	swapHold: 0.1,
	// Each switch below exists so the gate can show the step is needed (mutation checks).
	shear: true,
	floor: true,
	steps: true,
	dense: true,
	reduce: true,
	/** 'world' = project each bone's world frame; 'local' = project its local transform alone. */
	project: 'world',
};

/** The largest change in a card's floored thinness (σ2 / σ1) between two check points. */
const THIN_STEP = 1.1;

export function bake(rig, clip, options = {}) {
	const o = { ...BAKE_DEFAULTS, ...options };
	const D = clip.duration;
	const bones = new Map(rig.bones.map((b) => [b.name, b]));
	for (const b of rig.bones) {
		if (b.parent && !bones.has(b.parent)) throw new Error(`${b.name}: parent ${b.parent} missing`);
		if (b.parent && rig.bones.indexOf(bones.get(b.parent)) > rig.bones.indexOf(b))
			throw new Error(`${b.name}: listed before its parent`);
		if ((b.tilt ?? 0) !== 0 || (b.twist ?? 0) !== 0)
			throw new Error(`${b.name}: the setup pose must be flat (tilt and twist 0)`);
	}
	const moves3d = (n) =>
		clip.bones[n]?.some((k) => k.tilt || k.twist) ||
		rig.slots.some((s) => s.bone === n && s.variants);
	const animated = (name) => {
		for (let n = name; n; n = bones.get(n).follow ?? bones.get(n).parent)
			if (moves3d(n)) return true;
		return false;
	};
	// Every bone at or under (or following) a bone that moves in 3D is baked; the rest keep their keys.
	const baked = rig.bones.filter((b) => animated(b.name)).map((b) => b.name);

	const N = Math.round(D * o.checkHz);
	const every = Math.round(o.checkHz / o.denseHz);
	const grid = Array.from({ length: N + 1 }, (_, i) => Math.min(D, i / o.checkHz));
	const dense = grid.filter((_, i) => i % every === 0);

	// Drawings by angle: each slot shows the drawing that faces the viewer best, chosen on the dense
	// grid, swapped only past the margin and after the hold.
	const swaps = new Map();
	for (const slot of rig.slots.filter((s) => s.variants)) {
		const image = bones.get(slot.bone);
		const from = image.follow ?? image.parent;
		const sched = [];
		let cur = slot.variants[0];
		for (const t of dense) {
			const w = world3d(rig, clip, t).get(from);
			// The depth of the card normal a drawing turned back by `turn` shows: parent × tilt(−turn).
			const nz = (v) => {
				const m = qmat(orient(0, -v.turn, 0));
				return w.m[6] * m[2] + w.m[7] * m[5] + w.m[8] * m[8];
			};
			const best = slot.variants.reduce((x, y) => (nz(y) > nz(x) ? y : x));
			const last = sched[sched.length - 1];
			if (!last) sched.push({ time: held(t), variant: cur });
			else if (best !== cur && nz(best) > nz(cur) + o.swapMargin && t - last.time >= o.swapHold) {
				cur = best;
				sched.push({ time: held(t), variant: cur });
			}
		}
		swaps.set(slot.bone, { slot: slot.name, sched });
	}
	const turns = (name, t) => {
		const s = swaps.get(name);
		if (!s) return 0;
		let v = s.sched[0].variant;
		for (const e of s.sched) if (e.time <= t) v = e.variant;
		return v.turn;
	};
	const worlds = (t) => world3d(rig, clip, t, turns);
	const floorOf = (name) => (o.floor ? o.floorPx / cardExtent(bones.get(name).card) : 0);

	// Flips: where a card's projection changes side (its determinant's sign), found to 1e-9 s.
	const gridWorlds = grid.map((t) => worlds(t));
	const flips = {};
	for (const name of baked) {
		flips[name] = [];
		for (let i = 1; i <= N; i++) {
			const s0 = facing(project(gridWorlds[i - 1].get(name)));
			if (s0 === facing(project(gridWorlds[i].get(name)))) continue;
			let lo = grid[i - 1];
			let hi = grid[i];
			while (hi - lo > 1e-9) {
				const mid = (lo + hi) / 2;
				if (facing(project(worlds(mid).get(name))) === s0) lo = mid;
				else hi = mid;
			}
			flips[name].push(hi);
		}
	}
	const swapTimes = (name) =>
		swaps
			.get(name)
			?.sched.slice(1)
			.map((e) => e.time) ?? [];
	const targetOf = (name, w) => floored(project(w.get(name)), floorOf(name));

	// The 2D setup pose: as authored, except a follower's, which is where its 3D setup projects.
	const setup2d = new Map();
	const setupWorld = world3d(rig, { bones: {} }, 0);
	for (const b of rig.bones) {
		const own = {
			x: b.x ?? 0,
			y: b.y ?? 0,
			rotation: b.rotate ?? 0,
			scaleX: 1,
			scaleY: 1,
			shearY: 0,
		};
		if (!b.follow)
			setup2d.set(b.name, {
				...own,
				world: compose(b.parent ? setup2d.get(b.parent).world : null, own),
			});
		else {
			const l = localOf(setup2d.get(b.parent).world, project(setupWorld.get(b.name)), own, true);
			setup2d.set(b.name, {
				...l,
				scaleX: 1,
				scaleY: 1,
				shearY: 0,
				world: project(setupWorld.get(b.name)),
			});
		}
	}
	const setupOf = (b) => {
		const { x, y, rotation } = setup2d.get(b.name);
		return { x, y, rotation, scaleX: 1, scaleY: 1, shearY: 0 };
	};
	const result = new Map();
	/** A bone's 2D world as the runtime plays it: its keys if baked, else its setup, composed. */
	const playedAt = (name, t) => {
		const b = bones.get(name);
		const r = result.get(name);
		return compose(b.parent ? playedAt(b.parent, t) : null, r ? poseAt(r.keys, t) : setupOf(b));
	};
	const report = { bones: {}, flips, timelineKeys: {} };

	for (const name of baked) {
		const b = bones.get(name);
		const setup = setupOf(b);
		const floor = floorOf(name);
		const parentAt = (t) => (b.parent ? playedAt(b.parent, t) : null);

		// Where the error is measured: the check grid, the parent's checks, key times and the middle of
		// each of its key runs (where its interpolation error peaks, which this bone's keys must put
		// back), subdivided down to 1 µs wherever this card's target or its parent AS PLAYED thins out
		// (σ2 / σ1) by more than THIN_STEP between neighbours: this bone's locals grow like 1 / that.
		const ct = [];
		const cp = [];
		const cg = [];
		const point = (t, w = worlds(t)) => {
			const p = parentAt(t);
			const g = targetOf(name, w);
			return { t, p, g, r: [p ? thinness(p) : 1, thinness(g)] };
		};
		const wide = (a, z) =>
			a.r.some((x, k) => {
				const lo = Math.max(Math.min(x, z.r[k]), 1e-9);
				return Math.max(x, z.r[k]) / lo > THIN_STEP;
			});
		const subdivide = (a, z) => {
			if (z.t - a.t <= 1e-6 || Math.min(...a.r, ...z.r) >= 0.5) return;
			const m = point((a.t + z.t) / 2);
			if (!wide(a, m) && !wide(m, z)) return;
			subdivide(a, m);
			ct.push(m.t);
			cp.push(m.p);
			cg.push(m.g);
			subdivide(m, z);
		};
		const base = new Set(grid);
		const pr = b.parent ? result.get(b.parent) : null;
		if (pr) {
			for (const t of pr.checks) base.add(t);
			pr.keys.forEach((k, i) => {
				base.add(k.time);
				if (i > 0) base.add((k.time + pr.keys[i - 1].time) / 2);
			});
		}
		const onGrid = new Map(grid.map((t, i) => [t, gridWorlds[i]]));
		let last = null;
		for (const t of [...base].filter((x) => x >= 0 && x <= D).sort((x, y) => x - y)) {
			const at = point(t, onGrid.get(t));
			if (last) subdivide(last, at);
			ct.push(at.t);
			cp.push(at.p);
			cg.push(at.g);
			last = at;
		}
		const checkAfter = (t) => {
			let lo = 0;
			let hi = ct.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (ct[mid] <= t) lo = mid + 1;
				else hi = mid;
			}
			return lo;
		};

		// One key: the local that puts the bone on its target under its parent AS PLAYED, so whatever
		// the parent's keys left, this bone's keys put it back. Angles near the previous key's.
		let ref = setup;
		const keyAt = (time, at, seg) => {
			const w = worlds(at);
			const l =
				o.project === 'local'
					? localOf(
							null,
							project(b.parent ? relative(w.get(b.parent), w.get(name)) : w.get(name)),
							ref,
							o.shear,
						)
					: localOf(parentAt(at), targetOf(name, w), ref, o.shear);
			ref = l;
			return { time: held(time), seg, pose: asPlayed(setup, l) };
		};

		// Steps: where this card or its parent jumps — its own flips and drawing swaps, and every step
		// of its parent's (the parent's played world jumps there).
		const own = [...flips[name], ...swapTimes(name)];
		const inherited = b.parent ? (result.get(b.parent)?.steps ?? []) : [];
		const steps = o.steps ? [...new Set([...own, ...inherited])].sort((x, y) => x - y) : [];
		const bounds = [0, ...steps, D];
		const authored = new Set();
		for (let n = name; n; n = bones.get(n).parent)
			for (const k of clip.bones[n] ?? []) authored.add(k.time);
		const keys = [];
		for (let s = 0; s + 1 < bounds.length; s++) {
			const t0 = held(bounds[s]);
			const t1 = held(bounds[s + 1]);
			keys.push(keyAt(t0, s === 0 ? 0 : Math.max(bounds[s], t0) + LIMIT, s));
			const inner = (o.dense ? dense : [...authored]).filter((t) => t > t0 && t < t1);
			for (const t of inner.sort((x, y) => x - y)) keys.push(keyAt(t, t, s));
			keys.push(keyAt(t1, s + 2 === bounds.length ? D : Math.min(bounds[s + 1], t1) - LIMIT, s));
		}

		// A run k0 → k1 is as bad as its worst corner error at the checks between — and unusable if
		// this card, as played, thins below half its floor or shows its other side, because its
		// children would then need locals past any bound.
		const runError = (k0, k1, t, p, g) => {
			const u = (t - k0.time) / (k1.time - k0.time);
			const l = {};
			for (const c of CHANNELS) l[c] = k0.pose[c] + (k1.pose[c] - k0.pose[c]) * u;
			const w = compose(p, l);
			const e = cornerError(w, g, b.card);
			if (floor > 0 && (facing(w) !== facing(g) || thinness(w) < floor / 2)) return Infinity;
			return Number.isNaN(e) ? Infinity : e;
		};
		const worstBetween = (k0, k1, quarters = false) => {
			let worst = -1;
			let at = 0;
			for (let i = checkAfter(k0.time); i < ct.length && ct[i] < k1.time; i++) {
				const e = runError(k0, k1, ct[i], cp[i], cg[i]);
				if (e > worst) [worst, at] = [e, ct[i]];
			}
			if (quarters)
				for (const u of [0.25, 0.5, 0.75]) {
					const t = k0.time + (k1.time - k0.time) * u;
					const e = runError(k0, k1, t, parentAt(t), targetOf(name, worlds(t)));
					if (e > worst) [worst, at] = [e, t];
				}
			return { worst, at };
		};

		// Douglas–Peucker inside each segment between steps, on that error.
		const keep = new Array(keys.length).fill(true);
		if (o.dense && o.reduce) {
			const rdp = (i, j) => {
				if (j - i < 2) return;
				const { worst, at } = worstBetween(keys[i], keys[j]);
				if (worst <= o.tol) {
					for (let k = i + 1; k < j; k++) keep[k] = false;
					return;
				}
				let split = i + 1;
				for (let k = i + 1; k < j; k++)
					if (Math.abs(keys[k].time - at) < Math.abs(keys[split].time - at)) split = k;
				rdp(i, split);
				rdp(split, j);
			};
			let start = 0;
			for (let k = 1; k <= keys.length; k++)
				if (k === keys.length || keys[k].seg !== keys[start].seg) {
					rdp(start, k - 1);
					start = k;
				}
		}
		let kept = keys.filter((_, k) => keep[k]);
		let unmet = 0;
		if (o.dense) {
			// Where the kept keys (even every dense one) leave more than tol, key the worst point — at
			// most as many new keys as the dense bake had; past that the run is reported, not keyed.
			const refined = [kept[0]];
			let budget = keys.length;
			const refine = (k0, k1, depth) => {
				const { worst, at } = worstBetween(k0, k1, true);
				if (worst > o.tol && (depth >= 24 || k1.time - k0.time <= 1e-6 || budget <= 0)) unmet++;
				else if (worst > o.tol) {
					budget--;
					ref = k0.pose;
					const mid = keyAt(at, at, k0.seg);
					if (mid.time > k0.time && mid.time < k1.time) {
						refine(k0, mid, depth + 1);
						refine(mid, k1, depth + 1);
						return;
					}
				}
				refined.push(k1);
			};
			for (let k = 1; k < kept.length; k++) {
				if (kept[k].time === kept[k - 1].time) refined.push(kept[k]);
				else refine(kept[k - 1], kept[k], 0);
			}
			kept = refined;
		}
		result.set(name, { keys: kept, steps, checks: ct });
		report.bones[name] = { keys: kept.length, dense: keys.length, steps: steps.length, unmet };
	}

	// Draw order: each card's centre depth on the dense grid; two cards swap only past the hysteresis.
	const slotNames = rig.slots.map((s) => s.name);
	const depthOf = (w, slot) => {
		const c = bones.get(slot.bone).card;
		const bw = w.get(slot.bone);
		return bw.m[6] * ((c.x0 + c.x1) / 2) + bw.o[2];
	};
	const orderKeys = [];
	const orderSched = [];
	let order = slotNames.map((_, i) => i);
	for (let i = 0; i <= N; i += every) {
		// A card's depth is its bone's as the clip moves it, before any drawing is turned to face.
		const w = world3d(rig, clip, grid[i]);
		const z = rig.slots.map((s) => depthOf(w, s));
		const next = [...order];
		for (let moved = true; moved;) {
			moved = false;
			for (let k = 0; k + 1 < next.length; k++)
				if (z[next[k]] > z[next[k + 1]] + o.hysteresis) {
					[next[k], next[k + 1]] = [next[k + 1], next[k]];
					moved = true;
				}
		}
		if (i === 0 || next.join() !== order.join()) {
			order = next;
			orderSched.push({ time: held(grid[i]), order: [...order] });
			if (i > 0 || order.some((s, k) => s !== k))
				orderKeys.push({
					time: store(grid[i]),
					offsets: order
						.map((slot, at) => ({ slot, at }))
						.sort((x, y) => x.slot - y.slot)
						.filter((e) => e.at !== e.slot)
						.map((e) => ({ slot: slotNames[e.slot], offset: e.at - e.slot })),
				});
		}
	}

	// The file: the rig's 2D setup (flat by contract) and the baked clip.
	const timelines = {};
	for (const [n, { keys }] of result) {
		const setup = setupOf(bones.get(n));
		const rest = (c) => (c.startsWith('scale') ? 1 : setup[c]);
		const differs = (c) => keys.some((k) => Math.abs(k.pose[c] - rest(c)) > 1e-9);
		const value = (k, c) => store(k.pose[c] - (c.startsWith('scale') ? 0 : setup[c]));
		const t = {};
		if (differs('rotation'))
			t.rotate = keys.map((k) => ({ time: store(k.time), value: value(k, 'rotation') }));
		if (differs('x') || differs('y'))
			t.translate = keys.map((k) => ({ time: store(k.time), x: value(k, 'x'), y: value(k, 'y') }));
		if (differs('scaleX') || differs('scaleY'))
			t.scale = keys.map((k) => ({
				time: store(k.time),
				x: value(k, 'scaleX'),
				y: value(k, 'scaleY'),
			}));
		if (differs('shearY'))
			t.sheary = keys.map((k) => ({ time: store(k.time), value: value(k, 'shearY') }));
		timelines[n] = t;
		report.timelineKeys[n] = Object.values(t).reduce((sum, ks) => sum + ks.length, 0);
	}
	const animation = { bones: timelines };
	if (orderKeys.length) animation.drawOrder = orderKeys;
	const slotsAnim = {};
	for (const { slot, sched } of swaps.values())
		slotsAnim[slot] = {
			attachment: sched.map((e) => ({ time: store(e.time), name: e.variant.name })),
		};
	if (Object.keys(slotsAnim).length) animation.slots = slotsAnim;

	const doc = {
		irig: 1,
		skeleton: { hash: 'rig-2p5d', importedFrom: '4.2', x: -400, y: -400, width: 800, height: 800 },
		bones: rig.bones.map((b) => ({
			name: b.name,
			...(b.parent ? { parent: b.parent } : {}),
			length: b.length ?? 0,
			x: store(setupOf(b).x),
			y: store(setupOf(b).y),
			rotation: store(setupOf(b).rotation),
		})),
		slots: rig.slots.map((s) => ({ name: s.name, bone: s.bone, attachment: s.attachment })),
		skins: [
			{
				name: 'default',
				attachments: Object.fromEntries(
					rig.slots.map((s) => {
						const c = bones.get(s.bone).card;
						const region = { x: (c.x0 + c.x1) / 2, y: 0, width: c.x1 - c.x0, height: c.h * 2 };
						const names = s.variants ? s.variants.map((v) => v.name) : [s.attachment];
						return [s.name, Object.fromEntries(names.map((n) => [n, region]))];
					}),
				),
			},
		],
		animations: { [clip.name]: animation },
	};
	return {
		doc,
		report,
		swaps: new Map([...swaps].map(([bone, s]) => [bone, s.sched])),
		orderAt: (t) => {
			let cur = orderSched[0].order;
			for (const e of orderSched) if (e.time <= t) cur = e.order;
			return cur.map((i) => slotNames[i]);
		},
	};
}

/** inverse(p) × c for 3D affines whose linear part is a rotation (inverse = transpose). */
function relative(p, c) {
	const t = [p.m[0], p.m[3], p.m[6], p.m[1], p.m[4], p.m[7], p.m[2], p.m[5], p.m[8]];
	const d = [c.o[0] - p.o[0], c.o[1] - p.o[1], c.o[2] - p.o[2]];
	return mul3({ m: t, o: [0, 0, 0] }, { m: c.m, o: d });
}
