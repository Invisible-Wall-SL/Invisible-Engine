// The generated Crash arena's scenarios (`docs/design/3d-games.md` Phase 3 step 6), shared by
// `check:arena-3d` (Node) and the browser page `arena-3d-page.mjs` inlines (Chrome, WebKit):
//
// - `arenaLevelHash(seed)`: FNV-1a over the arena's JSON, the bytes a room and a device must agree on;
// - `walkArenaRoutes(seed)`: every team spawn walks its nav path to the pit's rim through `motion3d`
//   (`stepBody3d`), steering by int8 axes like a device; checkpoints hash the body's exact bits.
//
// Plain ESM; only `+ − × ÷`, `Math.sqrt`, `Math.round` and comparisons, like the step itself.

import { crashArena } from '../packages/engine-mechanics/src/crashArena.js';
import {
	navGrid3d,
	navPath3d,
	nodeAt3d,
	nodesAround3d,
} from '../packages/engine-mechanics/src/levelNav3d.js';
import {
	createBody3d,
	createLevel3d,
	hashBodies3d,
	HASH3D_SEED,
	stepBody3d,
} from '../packages/engine-mechanics/src/motion3d.js';

export const ARENA_SEEDS = 32;
export const ROUTE_STEP_LIMIT = 6000;
const CHECKPOINT = 250;
/** How far off a pad's middle a path passes, m: outside the 2 m pad, inside a room's 0.5 m wall. */
const AROUND_PAD = 1.5;

export function textHash(text) {
	let h = 0x811c9dc5;
	for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

export const arenaLevelHash = (seed) => textHash(JSON.stringify(crashArena(seed)));

/** One code over the level hashes of seeds 0..n−1, and the hashes. */
export function arenaSeedsCode(n = ARENA_SEEDS) {
	const hashes = [];
	for (let s = 0; s < n; s++) hashes.push(arenaLevelHash(s));
	return { code: textHash(hashes.join('')), hashes };
}

const steer = (body, x, z) => {
	const dx = x - body.x;
	const dz = z - body.z;
	const len = Math.sqrt(dx * dx + dz * dz);
	if (len < 1e-9) return { mx: 0, mz: 0, yaw: 0, buttons: 0 };
	return { mx: Math.round((dx / len) * 127), mz: Math.round((dz / len) * 127), yaw: 0, buttons: 0 };
};
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * Where a walk into node `b` (from `a`, on to `c`) aims: its middle, or, on a pad the path does not
 * launch from, a point beside the pad toward the way out.
 */
function aimInto(a, b, c, launches) {
	if (b.pad < 0 || launches) return { x: b.x, z: b.z, tolerance: 0.6 };
	const ux = sign(a.x - b.x);
	const uz = sign(a.z - b.z);
	const vx = c ? sign(c.x - b.x) : -ux;
	const vz = c ? sign(c.z - b.z) : -uz;
	const straight = (ux + vx === 0 && uz + vz === 0) || (ux === vx && uz === vz);
	return straight
		? { x: b.x - AROUND_PAD * uz, z: b.z + AROUND_PAD * ux, tolerance: 0.3 }
		: { x: b.x + AROUND_PAD * (ux + vx), z: b.z + AROUND_PAD * (uz + vz), tolerance: 0.3 };
}

/** A landing in `b`'s column at its height (a ramp's anywhere on its rise). */
function landedOn(body, b, graph, level) {
	const half = graph.cellSize / 2;
	if (Math.abs(body.x - b.x) > half || Math.abs(body.z - b.z) > half) return false;
	const c = level.colliders[b.collider];
	return c.kind === 'ramp'
		? body.y >= c.minY - 0.05 && body.y <= c.maxY + 0.05
		: Math.abs(body.y - b.y) < 0.6;
}

/**
 * Every team spawn of seed's arena walks to the pit's rim. Returns `{ code, routes, steps, ramp,
 * drops, trampolines, bounces, failures }`; `code` folds each route's checkpoint hashes.
 */
export function walkArenaRoutes(seed) {
	const arena = crashArena(seed);
	const level = createLevel3d(arena.level);
	const graph = navGrid3d(arena.level);
	const rim = nodesAround3d(graph, arena.level.zones[0]);
	const tally = { routes: 0, steps: 0, ramp: 0, drops: 0, trampolines: 0, bounces: 0 };
	const failures = [];
	let h = HASH3D_SEED;
	arena.spawns.forEach((spawn, k) => {
		const path = navPath3d(graph, nodeAt3d(graph, spawn.x, spawn.y, spawn.z), rim);
		if (!path) {
			failures.push(`spawn ${k}: no path`);
			return;
		}
		const body = createBody3d(spawn);
		let edge = 0;
		let flying = false;
		let steps = 0;
		for (; edge < path.length && steps < ROUTE_STEP_LIMIT; steps++) {
			const e = graph.edges[path[edge]];
			const a = graph.nodes[e.from];
			const b = graph.nodes[e.to];
			const next = graph.edges[path[edge + 1]];
			const aim = aimInto(a, b, next && graph.nodes[next.to], next?.kind === 'trampoline');
			const input =
				e.kind === 'trampoline'
					? flying
						? steer(body, b.x, b.z)
						: steer(body, a.x, a.z)
					: steer(body, aim.x, aim.z);
			const r = stepBody3d(body, input, level);
			if (r.onRamp) tally.ramp += 1;
			if (r.bounced) tally.bounces += 1;
			if ((steps + 1) % CHECKPOINT === 0) h = hashBodies3d([body], h);
			if (r.fell) {
				failures.push(`spawn ${k}: fell at edge ${edge} (${e.kind})`);
				return;
			}
			if (e.kind === 'trampoline') {
				if (flying && r.landed && landedOn(body, b, graph, level)) {
					tally.trampolines += 1;
					flying = false;
					edge += 1;
				} else if (r.bounced) flying = true;
				continue;
			}
			const near =
				Math.abs(body.x - aim.x) < aim.tolerance && Math.abs(body.z - aim.z) < aim.tolerance;
			if ((r.grounded || r.landed) && near && landedOn(body, b, graph, level)) {
				if (e.kind === 'drop') tally.drops += 1;
				edge += 1;
			}
		}
		h = hashBodies3d([body], h);
		tally.steps += steps;
		if (edge < path.length) failures.push(`spawn ${k}: stuck at edge ${edge} of ${path.length}`);
		else tally.routes += 1;
	});
	return { code: (h >>> 0).toString(16).padStart(8, '0'), ...tally, failures };
}

/** Every trampoline edge of seed's arena flown: a body on the pad, steered at the target once up. */
export function flyArenaTrampolines(seed) {
	const arena = crashArena(seed);
	const level = createLevel3d(arena.level);
	const graph = navGrid3d(arena.level);
	let flown = 0;
	const misses = [];
	for (const e of graph.edges) {
		if (e.kind !== 'trampoline') continue;
		const a = graph.nodes[e.from];
		const b = graph.nodes[e.to];
		const body = createBody3d({ x: a.x, y: a.y, z: a.z });
		let up = false;
		let ok = false;
		for (let s = 0; s < 600 && !ok; s++) {
			const r = stepBody3d(body, up ? steer(body, b.x, b.z) : steer(body, a.x, a.z), level);
			if (up && r.landed) {
				ok = landedOn(body, b, graph, level);
				if (!ok) break;
			}
			if (r.bounced) up = true;
		}
		if (ok) flown += 1;
		else misses.push(`(${a.x}, ${a.y}, ${a.z}) → (${b.x}, ${b.y}, ${b.z})`);
	}
	return { flown, misses };
}
