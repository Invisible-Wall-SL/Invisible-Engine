/**
 * Bot navigation on a 3D level (`docs/design/3d/gameplay-evaluation.md` §3 "Bots"): a grid nav graph
 * derived from a `motion3d` level at load, A* over it with seeded tie-breaks, a follower that turns
 * a path into the velocity a bot's input is made from, and the segment test line of sight uses.
 *
 * Plain, dependency-free ESM. SERVER-ONLY: bots exist only in the room, and a device never steps a
 * bot (it interpolates it), so nothing here is in the predicted path and it may use any arithmetic.
 * Seeded: every tie A* breaks draws from the caller's rng, so a room's bots replay exactly from the
 * room's seed.
 *
 * The graph samples the level on a square grid of `cell` m columns. A column's NODES are the tops a
 * body of `spec` can stand on there: a box's lid or a ramp's surface under the column's centre, with
 * the body's height clear above it and its footprint clear of walls. EDGES, to the eight neighbour
 * columns, come from tracing the surface from one centre to the other the way `motion3d` moves a
 * body (climbing at most `stepUp` at a time, sticking to `snapDown`):
 *
 * - `walk` — the surface is continuous (flat, a ramp, a step);
 * - `drop` — the trace walks off a ledge and lands lower (one-way: the trace back is a wall);
 * - `jump` — a ledge higher than `stepUp` but within a jump (`jumpReach`, default 80 % of
 *   `spec.jumpHeight`), which the follower presses jump for;
 * - `bounce` — BOTY's `ConnectTrampolines`: from a node on a trampoline zone to a higher node the
 *   launch carries a body to, by the zone's `height`, the body's speed and gravity.
 */

import { collidersNear, topUnder } from './motion3d.js';

/** The kinds of edge, in the order a node lists them. */
export const NAV_EDGES = ['walk', 'drop', 'jump', 'bounce'];

export const NAV3D_DEFAULTS = Object.freeze({
	cell: 1,
	maxDrop: 8,
	probe: 0.1,
	jumpReachRatio: 0.8,
	bounceReachRatio: 0.7,
	trampolineCost: 4,
	jumpCost: 1,
	dropCost: 0.5,
});

const EPS = 1e-6;
/** Two tops closer than this, m, are one. */
const SAME_TOP = 0.05;
/** A trace's end within this of a node, m, is that node. */
const AT_NODE = 0.15;

const NEIGHBOURS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1],
];

/** A cost in whole millimetres, so equally long ways tie exactly and the seed picks between them. */
const mm = (m) => Math.round(m * 1000);

const SQRT2 = Math.sqrt(2);

const inside = (c, x, z) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ;

/** The colliders containing a plane point, with their top there. */
function columnAt(level, x, z) {
	const out = [];
	for (const c of collidersNear(level, x, z, x, z))
		if (inside(c, x, z)) out.push({ c, top: topUnder(c, x, z, x, z) });
	return out;
}

/**
 * The nav graph of a `motion3d` level (`createLevel3d`) for bodies of `spec` (`MOTION3D_DEFAULTS`
 * shape). `opts` overrides {@link NAV3D_DEFAULTS}; `jumpReach` defaults to `jumpReachRatio` of
 * `spec.jumpHeight`. Returns `{ cell, nodes, columns, edges, spec }`: a node is `{ id, ix, iz, x, y,
 * z, ramp, trampoline }` (`trampoline` its zone id or −1), `edges[id]` its outgoing `{ to, kind,
 * cost }` in a fixed order, `columns` a `Map` of `"ix,iz"` to node ids bottom to top.
 */
export function createNavGrid3d(level, spec, opts = {}) {
	const o = { ...NAV3D_DEFAULTS, ...opts };
	const cell = o.cell;
	if (!(cell > 0)) throw new Error(`nav3d: cell must be > 0 (${cell})`);
	const jumpReach = o.jumpReach ?? spec.jumpHeight * o.jumpReachRatio;
	const r = spec.radius;
	const h = spec.height;
	let minX = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxZ = -Infinity;
	for (const c of level.colliders) {
		minX = Math.min(minX, c.minX);
		minZ = Math.min(minZ, c.minZ);
		maxX = Math.max(maxX, c.maxX);
		maxZ = Math.max(maxZ, c.maxZ);
	}
	const nodes = [];
	const columns = new Map();
	if (!level.colliders.length) return { cell, nodes, columns, edges: [], spec, jumpReach };

	const ix0 = Math.floor(minX / cell);
	const ix1 = Math.ceil(maxX / cell) - 1;
	const iz0 = Math.floor(minZ / cell);
	const iz1 = Math.ceil(maxZ / cell) - 1;

	const standable = (x, z, top, here) => {
		if (top < level.killY) return false;
		for (const { c, top: t } of here)
			if (t > top + SAME_TOP && c.minY < top + h - EPS) return false;
		for (const c of collidersNear(level, x - r, z - r, x + r, z + r)) {
			if (!(x - r < c.maxX && x + r > c.minX && z - r < c.maxZ && z + r > c.minZ)) continue;
			const t = topUnder(c, x - r, z - r, x + r, z + r);
			if (t > top + spec.stepUp && c.minY < top + h - EPS) return false;
		}
		return true;
	};

	for (let ix = ix0; ix <= ix1; ix++)
		for (let iz = iz0; iz <= iz1; iz++) {
			const x = (ix + 0.5) * cell;
			const z = (iz + 0.5) * cell;
			const here = columnAt(level, x, z);
			const tops = [];
			for (const { c, top } of here) {
				if (tops.some((t) => Math.abs(t.top - top) < SAME_TOP)) continue;
				if (standable(x, z, top, here)) tops.push({ top, ramp: c.rise >= 0 });
			}
			if (!tops.length) continue;
			tops.sort((a, b) => a.top - b.top);
			const ids = [];
			for (const t of tops) {
				const id = nodes.length;
				nodes.push({ id, ix, iz, x, y: t.top, z, ramp: t.ramp, trampoline: -1 });
				ids.push(id);
			}
			columns.set(`${ix},${iz}`, ids);
		}

	for (const zone of level.zones) {
		if (zone.kind !== 'trampoline') continue;
		for (const n of nodes)
			if (
				n.trampoline < 0 &&
				n.x >= zone.minX &&
				n.x <= zone.maxX &&
				n.z >= zone.minZ &&
				n.z <= zone.maxZ &&
				n.y >= zone.minY &&
				n.y <= zone.maxY
			)
				n.trampoline = zone.id;
	}

	const nodeNear = (ix, iz, y, tolerance) => {
		const ids = columns.get(`${ix},${iz}`);
		if (!ids) return -1;
		let best = -1;
		let gap = tolerance;
		for (const id of ids) {
			const d = Math.abs(nodes[id].y - y);
			if (d <= gap) {
				gap = d;
				best = id;
			}
		}
		return best;
	};

	/** Trace the surface from `a` toward column (bx, bz): `{ y, dropped, jumped }` or null. */
	const trace = (a, bx, bz) => {
		const dx = bx - a.x;
		const dz = bz - a.z;
		const length = Math.sqrt(dx * dx + dz * dz);
		const n = Math.max(1, Math.ceil(length / o.probe));
		let y = a.y;
		let dropped = false;
		let jumped = false;
		for (let i = 1; i <= n; i++) {
			const px = a.x + (dx * i) / n;
			const pz = a.z + (dz * i) / n;
			const here = columnAt(level, px, pz);
			let support = -Infinity;
			let wall = -Infinity;
			for (const { c, top } of here) {
				if (top <= y + spec.stepUp + EPS) {
					if (top > support) support = top;
				} else if (c.minY < y + h - EPS && top > wall) wall = top;
			}
			if (wall > -Infinity) {
				if (jumped || wall - y > jumpReach) return null;
				for (const { c } of here) if (c.minY >= wall && c.minY < wall + h) return null;
				jumped = true;
				y = wall;
				continue;
			}
			if (support >= y - spec.snapDown - EPS) {
				y = support;
				continue;
			}
			if (support === -Infinity || y - support > o.maxDrop) return null;
			dropped = true;
			y = support;
		}
		return { y, dropped, jumped };
	};

	const edges = nodes.map(() => []);
	for (const a of nodes) {
		const out = edges[a.id];
		for (const [sx, sz] of NEIGHBOURS) {
			const bix = a.ix + sx;
			const biz = a.iz + sz;
			if (!columns.has(`${bix},${biz}`)) continue;
			if (sx !== 0 && sz !== 0) {
				const tolerance = spec.stepUp + cell * 0.5;
				if (nodeNear(a.ix + sx, a.iz, a.y, tolerance) < 0) continue;
				if (nodeNear(a.ix, a.iz + sz, a.y, tolerance) < 0) continue;
			}
			const end = trace(a, (bix + 0.5) * cell, (biz + 0.5) * cell);
			if (!end) continue;
			const to = nodeNear(bix, biz, end.y, AT_NODE);
			if (to < 0) continue;
			const b = nodes[to];
			if (end.jumped && end.dropped) continue;
			const kind = end.jumped ? 'jump' : end.dropped ? 'drop' : 'walk';
			const flat = cell * Math.sqrt(sx * sx + sz * sz);
			const extra =
				(kind === 'jump' ? o.jumpCost : kind === 'drop' ? o.dropCost : 0) +
				(b.trampoline >= 0 ? o.trampolineCost : 0);
			out.push({ to, kind, cost: mm(flat + extra) });
		}
	}

	const g = -spec.gravity;
	for (const a of nodes) {
		if (a.trampoline < 0) continue;
		const zone = level.zones[a.trampoline];
		const apex = a.y + zone.height;
		if (segmentHit3d(level, a.x, a.y + 0.05, a.z, a.x, apex + h, a.z) >= 0) continue;
		for (const b of nodes) {
			if (b.trampoline >= 0 || b.y < a.y + spec.stepUp || b.y > apex - 0.2) continue;
			const window = 2 * Math.sqrt((2 * (apex - b.y)) / g);
			const reach = spec.speed * window * o.bounceReachRatio;
			const dx = b.x - a.x;
			const dz = b.z - a.z;
			const d = Math.sqrt(dx * dx + dz * dz);
			if (d > reach || d < cell) continue;
			const top = Math.max(b.y + h, apex);
			if (segmentHit3d(level, a.x, top, a.z, b.x, top, b.z) >= 0) continue;
			if (segmentHit3d(level, b.x, top, b.z, b.x, b.y + 0.05, b.z) >= 0) continue;
			edges[a.id].push({ to: b.id, kind: 'bounce', cost: mm(d + window * spec.speed * 0.5) });
		}
	}
	return { cell, nodes, columns, edges, spec, jumpReach };
}

/**
 * The node a body at (x, y, z) stands on or is nearest: its own column's highest node no more
 * than `above` m over its feet, else the nearest such node in the columns around it (`reach`
 * columns out). −1 when there is none.
 */
export function nearestNode3d(nav, x, y, z, { above = 0.6, reach = 2 } = {}) {
	const ix = Math.floor(x / nav.cell);
	const iz = Math.floor(z / nav.cell);
	const own = nav.columns.get(`${ix},${iz}`);
	if (own) {
		let best = -1;
		for (const id of own) if (nav.nodes[id].y <= y + above) best = id;
		if (best >= 0) return best;
	}
	let best = -1;
	let bestD = Infinity;
	for (let dx = -reach; dx <= reach; dx++)
		for (let dz = -reach; dz <= reach; dz++) {
			const ids = nav.columns.get(`${ix + dx},${iz + dz}`);
			if (!ids) continue;
			for (const id of ids) {
				const n = nav.nodes[id];
				if (n.y > y + above) continue;
				const ex = n.x - x;
				const ey = (n.y - y) * 2;
				const ez = n.z - z;
				const d = ex * ex + ey * ey + ez * ez;
				if (d < bestD) {
					bestD = d;
					best = id;
				}
			}
		}
	return best;
}

/** A binary min-heap of `[f, key, node, h]` rows, by `f` then `key`. */
function createHeap() {
	const rows = [];
	const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
	return {
		get size() {
			return rows.length;
		},
		push(row) {
			rows.push(row);
			let i = rows.length - 1;
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (!less(rows[i], rows[p])) break;
				[rows[i], rows[p]] = [rows[p], rows[i]];
				i = p;
			}
		},
		pop() {
			const top = rows[0];
			const last = rows.pop();
			if (rows.length) {
				rows[0] = last;
				let i = 0;
				for (;;) {
					const l = i * 2 + 1;
					const r = l + 1;
					let m = i;
					if (l < rows.length && less(rows[l], rows[m])) m = l;
					if (r < rows.length && less(rows[r], rows[m])) m = r;
					if (m === i) break;
					[rows[i], rows[m]] = [rows[m], rows[i]];
					i = m;
				}
			}
			return top;
		},
	};
}

/**
 * A* from node `from` to node `to`. Ties on cost and heuristic are broken by `rng()` draws, so two
 * equally short ways are chosen between by the seed. Returns `{ steps, reached, cost }`: `steps` is
 * `[{ node, kind }]` from the first node after `from` (each with the kind of edge that leads to it),
 * `reached` whether it ends at `to`, `cost` its length in m (edge costs are whole mm, so equally
 * long ways tie exactly; the heuristic is the octile grid distance). A target it cannot reach gives the way to the node nearest it
 * on the plane among those it can (`reached: false`), or `null` with `partial: false`. `maxNodes`
 * caps the search.
 */
export function findPath3d(nav, from, to, rng, { partial = true, maxNodes = 20000 } = {}) {
	const { nodes, edges } = nav;
	if (from < 0 || to < 0 || from >= nodes.length || to >= nodes.length) return null;
	const goal = nodes[to];
	const heuristic = (id) => {
		const n = nodes[id];
		const dx = Math.abs(n.ix - goal.ix);
		const dz = Math.abs(n.iz - goal.iz);
		const lo = Math.min(dx, dz);
		return Math.floor((Math.max(dx, dz) - lo + lo * SQRT2) * nav.cell * 1000);
	};
	const g = new Float64Array(nodes.length).fill(Infinity);
	const came = new Int32Array(nodes.length).fill(-1);
	const via = new Int8Array(nodes.length).fill(-1);
	const closed = new Uint8Array(nodes.length);
	const heap = createHeap();
	g[from] = 0;
	heap.push([heuristic(from), rng(), from, heuristic(from)]);
	let best = from;
	let bestH = heuristic(from);
	let expanded = 0;
	while (heap.size) {
		const [, , id, hh] = heap.pop();
		if (closed[id]) continue;
		closed[id] = 1;
		if (hh < bestH) {
			bestH = hh;
			best = id;
		}
		if (id === to) break;
		if (++expanded > maxNodes) break;
		for (const e of edges[id]) {
			if (closed[e.to]) continue;
			const cost = g[id] + e.cost;
			if (cost >= g[e.to]) continue;
			g[e.to] = cost;
			came[e.to] = id;
			via[e.to] = NAV_EDGES.indexOf(e.kind);
			const eh = heuristic(e.to);
			heap.push([cost + eh, rng(), e.to, eh]);
		}
	}
	const end = closed[to] ? to : partial ? best : -1;
	if (end < 0) return null;
	const steps = [];
	for (let id = end; id !== from; id = came[id]) steps.push({ node: id, kind: NAV_EDGES[via[id]] });
	steps.reverse();
	return { steps, reached: end === to, cost: g[end] / 1000 };
}

const STILL = () => ({ vx: 0, vz: 0, jump: false });

/** Closer than this on the plane, m, a walking body is at its waypoint. */
const ARRIVE_M = 0.35;
/** Steps without getting nearer its waypoint before a follower gives the path up. */
const STUCK_STEPS = 90;

/**
 * A follower for one bot: it walks `steps` (a {@link findPath3d} answer) waypoint by waypoint.
 * `goal` (`{ x, z }`, optional) is where to stop on the last node, its centre by default.
 */
export function createPathFollower3d() {
	return { steps: [], i: 0, goal: null, best: Infinity, idle: 0, lost: false };
}

/** Give a follower a new path. */
export function setPath3d(follower, path, goal = null) {
	follower.steps = path ? path.steps : [];
	follower.i = 0;
	follower.goal = goal;
	follower.best = Infinity;
	follower.idle = 0;
	follower.lost = !path;
}

/** Whether a follower has walked its whole path (or has none). */
export const pathDone3d = (follower) => follower.i >= follower.steps.length;

const towards = (dx, dz, speed, dt) => {
	const d = Math.sqrt(dx * dx + dz * dz);
	if (d < 1e-9) return { vx: 0, vz: 0 };
	if (d <= speed * dt) return { vx: dx / dt, vz: dz / dt };
	return { vx: (dx / d) * speed, vz: (dz / d) * speed };
};

/**
 * The velocity (`vx`, `vz`, m/s) and jump a follower wants for `body` this step, the way a
 * `behaviours.js` behaviour wants one: the bot's input is made from it exactly as from a brain's
 * (`online3d.js` `botInput3d`), and `motion3d` steers the body toward it by its acceleration.
 * Sets `follower.lost` when the body left the path (fell off a ledge, missed a bounce) or stopped
 * getting nearer its waypoint: the caller plans again.
 */
export function followPath3d(follower, body, nav, dt) {
	const spec = nav.spec;
	const speed = spec.speed;
	while (follower.i < follower.steps.length) {
		const step = follower.steps[follower.i];
		const wp = nav.nodes[step.node];
		const last = follower.i === follower.steps.length - 1;
		const tx = last && follower.goal ? follower.goal.x : wp.x;
		const tz = last && follower.goal ? follower.goal.z : wp.z;
		const dx = tx - body.x;
		const dz = tz - body.z;
		const d = Math.sqrt(dx * dx + dz * dz);
		const level = Math.abs(body.y - wp.y) < 0.6;
		if (d < ARRIVE_M && level && (body.grounded || step.kind !== 'bounce')) {
			follower.i += 1;
			follower.best = Infinity;
			follower.idle = 0;
			continue;
		}
		if (d < follower.best - 0.05) {
			follower.best = d;
			follower.idle = 0;
		} else if (body.grounded && ++follower.idle > STUCK_STEPS) {
			follower.lost = true;
			return STILL();
		}
		if (step.kind === 'bounce') {
			const prev = follower.i > 0 ? nav.nodes[follower.steps[follower.i - 1].node] : null;
			if (body.grounded && body.y < wp.y - 0.5 && prev && Math.abs(body.y - prev.y) > 0.6) {
				follower.lost = true;
				return STILL();
			}
			if (body.y < wp.y + 0.2) {
				if (!body.grounded && body.vy < 0) {
					follower.lost = body.y < wp.y - 0.5;
					return { ...towards(dx, dz, speed, dt), jump: false };
				}
				if (!prev) return { ...towards(dx, dz, speed, dt), jump: false };
				return { ...towards(prev.x - body.x, prev.z - body.z, speed, dt), jump: false };
			}
			return { ...towards(dx, dz, speed, dt), jump: false };
		}
		if (body.grounded && !level && body.y < wp.y - nav.jumpReach - 0.5) {
			follower.lost = true;
			return STILL();
		}
		const jump = step.kind === 'jump' && body.grounded && d < nav.cell * 1.2 && body.y < wp.y - 0.1;
		return { ...towards(dx, dz, speed, dt), jump };
	}
	return STILL();
}

/**
 * Where a segment from a to b first meets the level, as a fraction 0..1 of the way, or −1 when it
 * is clear. A box is its volume; a ramp is its wedge, exactly (below the sloped surface).
 */
export function segmentHit3d(level, ax, ay, az, bx, by, bz) {
	const dx = bx - ax;
	const dy = by - ay;
	const dz = bz - az;
	let first = Infinity;
	const near = collidersNear(
		level,
		Math.min(ax, bx),
		Math.min(az, bz),
		Math.max(ax, bx),
		Math.max(az, bz),
	);
	for (const c of near) {
		let t0 = 0;
		let t1 = 1;
		let ok = true;
		for (const [o, d, lo, hi] of [
			[ax, dx, c.minX, c.maxX],
			[ay, dy, c.minY, c.maxY],
			[az, dz, c.minZ, c.maxZ],
		]) {
			if (Math.abs(d) < 1e-12) {
				if (o <= lo || o >= hi) {
					ok = false;
					break;
				}
				continue;
			}
			let u0 = (lo - o) / d;
			let u1 = (hi - o) / d;
			if (u0 > u1) [u0, u1] = [u1, u0];
			if (u0 > t0) t0 = u0;
			if (u1 < t1) t1 = u1;
			if (t0 >= t1) {
				ok = false;
				break;
			}
		}
		if (!ok || t0 >= first) continue;
		if (c.rise < 0) {
			first = t0;
			continue;
		}
		const above = (t) => {
			const x = ax + dx * t;
			const y = ay + dy * t;
			const z = az + dz * t;
			const surface =
				c.rise === 0
					? c.minY + (x - c.minX) * c.slope
					: c.rise === 1
						? c.minY + (c.maxX - x) * c.slope
						: c.rise === 2
							? c.minY + (z - c.minZ) * c.slope
							: c.minY + (c.maxZ - z) * c.slope;
			return y - surface;
		};
		const f0 = above(t0);
		const f1 = above(t1);
		let t = -1;
		if (f0 <= 0) t = t0;
		else if (f1 <= 0) t = t0 + ((t1 - t0) * f0) / (f0 - f1);
		if (t >= 0 && t < first) first = t;
	}
	return first === Infinity ? -1 : first;
}

/** Whether a can see b: the segment between them is clear of the level. */
export const lineOfSight3d = (level, ax, ay, az, bx, by, bz) =>
	segmentHit3d(level, ax, ay, az, bx, by, bz) < 0;
