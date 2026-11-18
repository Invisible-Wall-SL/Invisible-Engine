/**
 * THE NAV GRAPH OF A GRID LEVEL (`docs/design/3d/gameplay-evaluation.md` §5: "derived at load,
 * never stored"): where a body can stand on a `motion3d` level and how it gets from one place to
 * another, read from the level's colliders and zones alone, so any grid level has one — a
 * generated arena (`crashArena.js`) and, later, a Blender import alike. The arena generator prunes
 * and places spawns with it, `validateLevel3d` holds a level to it, and bots path on it.
 *
 * The level is read as square columns of `cellSize`, centred on multiples of it (column `(i, j)`
 * spans `x ∈ [i·cell − cell/2, i·cell + cell/2]`). A NODE is a surface a body can stand on at a
 * column's centre (a box's lid, or a ramp's height there) with the body's height clear above it.
 * Edges join nodes of neighbouring columns (the four sides):
 *
 * - `walk` both ways when the two surfaces meet at the shared side within `stepUp` and nothing
 *   stands in the side's opening (a wall strip does);
 * - `drop` one way off a higher surface onto a lower one when the fall is clear;
 * - `trampoline` one way from a node standing in a trampoline zone to a node up to one column away
 *   (the eight around it), no higher than the launch's apex less a metre, with the flight clear.
 *
 * Costs are small integers (walk and drop 1, trampoline 3), so a path's cost is exact everywhere.
 * Plain, dependency-free ESM; the same operations `motion3d.js` allows, nothing implementation-
 * defined, so the graph is the same bits on the server and on every device.
 */

import { MOTION3D_DEFAULTS, collidersNear, createLevel3d, topUnder } from './motion3d.js';

export const NAV_WALK = 1;
export const NAV_DROP = 1;
export const NAV_TRAMPOLINE = 3;

/** A trampoline reaches no target closer than this under its apex. */
const APEX_MARGIN = 1;

/** +x, −x, +z, −z: the side of a column, and the step to the neighbour across it. */
const SIDES = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];
const OPPOSITE = [1, 0, 3, 2];

const inside = (c, x, z) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ;

/** Whether a box of air meets a collider: a ramp by its surface under the box, a box by itself. */
function blocked(level, x0, y0, z0, x1, y1, z1) {
	if (!(y1 > y0)) return false;
	for (const c of collidersNear(level, x0, z0, x1, z1)) {
		if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
		if (y0 < topUnder(c, x0, z0, x1, z1) && y1 > c.minY) return true;
	}
	return false;
}

/**
 * The nav graph of a level spec (`createLevel3d`'s input). `cellSize` defaults to the level's;
 * `spec` is the body that walks it (`MOTION3D_DEFAULTS`). Returns `{ cellSize, nodes, edges, out,
 * into }`: nodes `{ id, i, j, x, y, z, collider, pad }` in column order (`i`, then `j`, then `y`);
 * `pad` is the trampoline zone's id, or −1; edges `{ from, to, kind, cost }`; `out[n]` / `into[n]`
 * the ids of the edges leaving / reaching node n.
 */
export function navGrid3d(spec, { cellSize, motion = MOTION3D_DEFAULTS } = {}) {
	const level = createLevel3d(spec);
	const cell = cellSize ?? level.cellSize;
	const half = cell / 2;
	const r = motion.radius;
	const h = motion.height;
	const up = motion.stepUp;
	if (!level.colliders.length) return { cellSize: cell, nodes: [], edges: [], out: [], into: [] };

	let i0 = Infinity;
	let i1 = -Infinity;
	let j0 = Infinity;
	let j1 = -Infinity;
	for (const c of level.colliders) {
		i0 = Math.min(i0, Math.floor((c.minX + half) / cell));
		i1 = Math.max(i1, Math.floor((c.maxX + half) / cell));
		j0 = Math.min(j0, Math.floor((c.minZ + half) / cell));
		j1 = Math.max(j1, Math.floor((c.maxZ + half) / cell));
	}

	const nodes = [];
	/** `i,j` → the column's node ids, lowest first. */
	const columns = new Map();
	for (let i = i0; i <= i1; i++)
		for (let j = j0; j <= j1; j++) {
			const x = i * cell;
			const z = j * cell;
			const here = collidersNear(level, x, z, x, z).filter((c) => inside(c, x, z));
			const tops = [];
			for (const c of here) {
				const y = topUnder(c, x, z, x, z);
				const roofed = here.some((o) => o !== c && o.minY < y + h && topUnder(o, x, z, x, z) > y);
				if (!roofed && !blocked(level, x - r, y + up, z - r, x + r, y + h, z + r))
					tops.push({ y, collider: c.id });
			}
			tops.sort((a, b) => a.y - b.y || a.collider - b.collider);
			const ids = [];
			for (const t of tops) {
				if (ids.length && nodes[ids[ids.length - 1]].y === t.y) continue;
				const pad = level.zones.find(
					(zone) =>
						zone.kind === 'trampoline' &&
						x >= zone.minX &&
						x <= zone.maxX &&
						z >= zone.minZ &&
						z <= zone.maxZ &&
						t.y >= zone.minY &&
						t.y <= zone.maxY,
				);
				ids.push(nodes.length);
				nodes.push({
					id: nodes.length,
					i,
					j,
					x,
					y: t.y,
					z,
					collider: t.collider,
					pad: pad ? pad.id : -1,
				});
			}
			if (ids.length) columns.set(`${i},${j}`, ids);
		}

	/** A node's surface height at the middle of a side, or `undefined` off its collider. */
	const sideTop = (n, side) => {
		const c = level.colliders[n.collider];
		const x = n.x + SIDES[side][0] * half;
		const z = n.z + SIDES[side][1] * half;
		return inside(c, x, z) ? topUnder(c, x, z, x, z) : undefined;
	};

	const edges = [];
	const out = nodes.map(() => []);
	const into = nodes.map(() => []);
	const link = (from, to, kind, cost) => {
		out[from].push(edges.length);
		into[to].push(edges.length);
		edges.push({ from, to, kind, cost });
	};

	for (const a of nodes) {
		for (let side = 0; side < 4; side++) {
			const [dx, dz] = SIDES[side];
			const across = columns.get(`${a.i + dx},${a.j + dz}`);
			if (!across) continue;
			const ea = sideTop(a, side);
			if (ea === undefined) continue;
			// The side's opening, `r` either way of the side, and the strip just past it.
			const ex = a.x + dx * half;
			const ez = a.z + dz * half;
			const sx0 = dx ? ex - r : a.x - r;
			const sx1 = dx ? ex + r : a.x + r;
			const sz0 = dz ? ez - r : a.z - r;
			const sz1 = dz ? ez + r : a.z + r;
			const px0 = dx > 0 ? ex : dx < 0 ? ex - 2 * r : a.x - r;
			const px1 = dx > 0 ? ex + 2 * r : dx < 0 ? ex : a.x + r;
			const pz0 = dz > 0 ? ez : dz < 0 ? ez - 2 * r : a.z - r;
			const pz1 = dz > 0 ? ez + 2 * r : dz < 0 ? ez : a.z + r;
			for (const bId of across) {
				const b = nodes[bId];
				const eb = sideTop(b, OPPOSITE[side]);
				if (eb === undefined) continue;
				if (Math.abs(ea - eb) <= up) {
					// Each pair once: from the lower id, both ways.
					if (a.id < b.id) {
						const top = Math.max(ea, eb);
						if (!blocked(level, sx0, top + up, sz0, sx1, top + h, sz1)) {
							link(a.id, b.id, 'walk', NAV_WALK);
							link(b.id, a.id, 'walk', NAV_WALK);
						}
					}
				} else if (ea > eb) {
					if (
						!blocked(level, sx0, ea + up, sz0, sx1, ea + h, sz1) &&
						!blocked(level, px0, eb + up, pz0, px1, ea + h, pz1)
					)
						link(a.id, b.id, 'drop', NAV_DROP);
				}
			}
		}
	}

	for (const a of nodes) {
		if (a.pad < 0) continue;
		const apex = a.y + level.zones[a.pad].height;
		if (blocked(level, a.x - r, a.y + up, a.z - r, a.x + r, apex + h, a.z + r)) continue;
		for (let di = -1; di <= 1; di++)
			for (let dj = -1; dj <= 1; dj++) {
				if (!di && !dj) continue;
				for (const bId of columns.get(`${a.i + di},${a.j + dj}`) ?? []) {
					const b = nodes[bId];
					if (b.y < a.y || b.y > apex - APEX_MARGIN) continue;
					const mx = (a.x + b.x) / 2;
					const mz = (a.z + b.z) / 2;
					if (blocked(level, b.x - r, b.y + up, b.z - r, b.x + r, apex + h, b.z + r)) continue;
					if (blocked(level, mx - r, apex - 2, mz - r, mx + r, apex + h, mz + r)) continue;
					link(a.id, b.id, 'trampoline', NAV_TRAMPOLINE);
				}
			}
	}

	return { cellSize: cell, nodes, edges, out, into };
}

/** The node a place stands on: its column's node whose surface is within `tolerance` of `y`. */
export function nodeAt3d(graph, x, y, z, tolerance = 1e-6) {
	const i = Math.floor((x + graph.cellSize / 2) / graph.cellSize);
	const j = Math.floor((z + graph.cellSize / 2) / graph.cellSize);
	for (const n of graph.nodes)
		if (n.i === i && n.j === j && Math.abs(n.y - y) <= tolerance) return n.id;
	return -1;
}

/**
 * Path cost from every node to the nearest of `targets` along the edges (`backward: false`), or
 * from the nearest of `targets` to every node (`backward: true`); −1 where there is no way.
 */
export function navCosts3d(graph, targets, { backward = false } = {}) {
	const cost = new Int32Array(graph.nodes.length).fill(-1);
	// Costs are small integers: a bucket queue is exact and needs no comparisons of floats.
	const buckets = [[]];
	for (const t of targets) {
		cost[t] = 0;
		buckets[0].push(t);
	}
	const edgesOf = backward ? graph.out : graph.into;
	for (let c = 0; c < buckets.length; c++) {
		const bucket = buckets[c];
		if (!bucket) continue;
		for (let k = 0; k < bucket.length; k++) {
			const n = bucket[k];
			if (cost[n] !== c) continue;
			for (const e of edgesOf[n]) {
				const edge = graph.edges[e];
				const next = backward ? edge.to : edge.from;
				const total = c + edge.cost;
				if (cost[next] !== -1 && cost[next] <= total) continue;
				cost[next] = total;
				(buckets[total] ??= []).push(next);
			}
		}
	}
	return cost;
}

/** The cheapest path from node `from` to the nearest of `targets`, as edge ids; `null` if none. */
export function navPath3d(graph, from, targets) {
	const cost = navCosts3d(graph, targets);
	if (cost[from] < 0) return null;
	const path = [];
	let n = from;
	while (cost[n] > 0) {
		let best = -1;
		for (const e of graph.out[n]) {
			const edge = graph.edges[e];
			if (cost[edge.to] >= 0 && cost[edge.to] + edge.cost === cost[n]) {
				best = e;
				break;
			}
		}
		path.push(best);
		n = graph.edges[best].to;
	}
	return path;
}

/** The nodes whose column touches a zone's footprint from outside it, standing at its rim. */
export function nodesAround3d(graph, zone, motion = MOTION3D_DEFAULTS) {
	const half = graph.cellSize / 2;
	const ids = [];
	for (const n of graph.nodes) {
		const inX = n.x + half > zone.minX && n.x - half < zone.maxX;
		const inZ = n.z + half > zone.minZ && n.z - half < zone.maxZ;
		const nearX = n.x + half >= zone.minX - half && n.x - half <= zone.maxX + half;
		const nearZ = n.z + half >= zone.minZ - half && n.z - half <= zone.maxZ + half;
		const touches = (inX && nearZ && !inZ) || (inZ && nearX && !inX);
		if (touches && Math.abs(n.y - zone.maxY) <= motion.stepUp) ids.push(n.id);
	}
	return ids;
}

/** Two colliders share volume (a ramp counted as its whole box). */
const overlaps = (a, b) =>
	a.minX < b.maxX &&
	a.maxX > b.minX &&
	a.minY < b.maxY &&
	a.maxY > b.minY &&
	a.minZ < b.maxZ &&
	a.maxZ > b.minZ;

/**
 * Hold a level to the rules a Crash arena must keep (`docs/design/3d-games.md` Phase 3 step 6):
 *
 * - no two colliders share volume;
 * - the pit (the first zone of kind `pit`) has a rim to stand on, and every spawn and marker
 *   stands on a node that can reach the rim and be reached from it;
 * - spawns with a `team` come in equal numbers per team, and the teams' mean path cost to the rim
 *   differs by at most `balance` of the larger (and at least one step is always allowed).
 *
 * `world` is `{ level, spawns, markers? }`; returns `{ ok, problems, graph, costs }` — `problems`
 * names each broken rule, `costs` maps each spawn to its cost to the rim.
 */
export function validateLevel3d(world, { motion = MOTION3D_DEFAULTS, balance = 0.1 } = {}) {
	const problems = [];
	const level = createLevel3d(world.level);
	for (const c of level.colliders)
		for (const o of collidersNear(level, c.minX, c.minZ, c.maxX, c.maxZ))
			if (o.id > c.id && overlaps(c, o)) problems.push(`colliders ${c.id} and ${o.id} overlap`);

	const graph = navGrid3d(world.level, { motion });
	const pit = level.zones.find((z) => z.kind === 'pit');
	const rim = pit ? nodesAround3d(graph, pit, motion) : [];
	if (!pit) problems.push('no pit zone');
	else if (!rim.length) problems.push('the pit has no rim to stand on');
	const toRim = navCosts3d(graph, rim);
	const fromRim = navCosts3d(graph, rim, { backward: true });

	const place = (what, p) => {
		const n = nodeAt3d(graph, p.x, p.y, p.z);
		if (n < 0) {
			problems.push(`${what} stands on no walkable top`);
			return -1;
		}
		if (toRim[n] < 0) problems.push(`${what} cannot reach the pit`);
		if (fromRim[n] < 0) problems.push(`${what} cannot be reached from the pit`);
		return toRim[n];
	};
	const costs = world.spawns.map((s, k) => place(`spawn ${k}`, s));
	(world.markers ?? []).forEach((m, k) => place(`marker ${k} (${m.kind})`, m));

	const teams = new Map();
	world.spawns.forEach((s, k) => {
		if (s.team === undefined) return;
		const list = teams.get(s.team) ?? [];
		list.push(costs[k]);
		teams.set(s.team, list);
	});
	if (teams.size) {
		const counts = [...teams.values()].map((l) => l.length);
		if (Math.min(...counts) !== Math.max(...counts))
			problems.push(`teams have unequal spawns (${counts.join(' / ')})`);
		const means = [...teams.values()].map((l) => l.reduce((a, b) => a + b, 0) / l.length);
		const most = Math.max(...means);
		if (most - Math.min(...means) > Math.max(1, balance * most))
			problems.push(`teams are unbalanced to the pit (mean ${means.join(' / ')})`);
	}
	return { ok: problems.length === 0, problems, graph, costs };
}
