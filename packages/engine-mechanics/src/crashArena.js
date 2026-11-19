/**
 * THE CRASH ARENA, SEEDED (`docs/design/3d-games.md` Phase 3 step 6, gameplay evaluation §5): a
 * port of BattleOTtheYear's `MapGenerator.GenerateCrashArena` (`Assets/_Project/Scripts/
 * LevelDesign/MapGenerator.cs`) as data. The original rolls `UnityEngine.Random` unseeded and lays
 * prefabs; this one rolls an integer PRNG from the room's seed and returns an `arcade.world3d`
 * level, so the server and every device make the same arena from the same seed, to the byte.
 *
 * The shape is BOTY's, on a grid of `CRASH_CELL` columns and `CRASH_STEP` tiers:
 *
 * 1. a ring of floor round the pit (columns −4..4 at tier 0, the 3 × 3 hole in the middle open);
 * 2. trampolines on the ring's four inner corners;
 * 3. 6–8 branches from random ring tiles, 10–19 moves each: 40 % a ramp up or down a tier onto a
 *    landing that always carries a trampoline, otherwise a flat move (a diagonal one fills the
 *    corner to keep the path walkable) onto a platform (no walls; 30 % a trampoline) or, 10 %, a
 *    3 × 3 room (walled); the direction wiggles 40 % of moves; every branch ends in a room;
 * 4. walls on a room tile's open sides, props in rooms, the death plane under the lowest floor.
 *
 * Where it differs from BOTY, on purpose:
 *
 * - **Team spawns are balanced.** BOTY puts blue round the pit and red far out; here both teams
 *   start far out on opposite sides of the arena, with equal mean path cost to the pit.
 * - **Ramps face the four axes.** A branch moving diagonally ramps along one of its axes.
 * - **The ring's corner trampolines stand on the ring.** BOTY raises a tile a tier above each and
 *   puts the trampoline on it, which no one can reach on foot.
 * - **Every floor is reachable.** A tile that cannot be walked to from the pit and back (a corner
 *   only touching diagonally, a branch that ran into a ramp) is removed, with its ramps; a
 *   trampoline is left out where the flight would hit a floor overhead.
 * - **Chests and piece spawners.** BOTY's CrashArena places neither (its pieces come from props);
 *   here every branch-end room holds a chest and a piece spawner, and a few rooms a pickup spawner.
 *
 * Everything is integer arithmetic on the grid, then exact multiples of 0.5 m: no `Math.random`,
 * nothing implementation-defined, so a seed makes the same bytes on V8 and JavaScriptCore
 * (`check:arena-3d` pins it). Plain, dependency-free ESM.
 */

import { navCosts3d, navGrid3d, nodeAt3d, nodesAround3d, validateLevel3d } from './levelNav3d.js';

/** A column's side, m: BOTY's 10-unit cell halved, a second's walk for a 1.8 m hero at 5 m/s. */
export const CRASH_CELL = 5;
/** Between tiers, m: above a double jump (3 m) plus a step-up (0.35 m), so tiers take a ramp or a
 *  trampoline, as BOTY's 6-unit floors do; 3 m of headroom under a floor a tier up. */
export const CRASH_STEP = 3.5;
/** A floor's thickness, m. */
export const CRASH_SLAB = 0.5;
/** A room wall, m: over a double jump; lower where a floor overhead closes it. */
export const CRASH_WALL = 4;
const WALL_THICK = 0.5;
/** A trampoline's launch height, m: BOTY's 15 m/s bounce scaled to these tiers, ~2 of them. */
export const CRASH_TRAMPOLINE_HEIGHT = 7.5;
/** Half a trampoline pad's side, m (a 2 m pad in the middle of its tile). */
const PAD_HALF = 1;
/** The death plane, m under the lowest floor (BOTY: 20 units under, at 6 units a tier). */
const DEATH_DROP = 10;
/** Tier bounds (BOTY's −10..30 units at 6 a tier). */
const TIER_MIN = -1;
const TIER_MAX = 5;
const RING = 4;
const HOLE = 1;
/** Per team, so 16 seats. */
export const CRASH_TEAM_SPAWNS = 8;
const PROPS = 10;
const PICKUP_SPAWNERS = 4;
/** Prop health and drops (BOTY's `DestructibleProp`: 100 hp, 1 piece). */
const PROP_HP = 100;
const PROP_DROPS = 1;
const ATTEMPTS = 16;

export const CRASH_ARENA_KINDS = Object.freeze({
	pit: 'pit',
	trampoline: 'trampoline',
	chest: 'chest',
	prop: 'prop',
	pieceSpawner: 'pieceSpawner',
	pickupSpawner: 'pickupSpawner',
});

/** A seed (a number, or a string) as a uint32. */
function seedBits(seed) {
	if (typeof seed === 'number') {
		const n = Math.trunc(seed);
		return (n ^ Math.trunc(n / 0x100000000)) >>> 0;
	}
	let h = 0x811c9dc5;
	const s = String(seed);
	for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193);
	return h >>> 0;
}

/** mulberry32: integer only, the same stream on every engine. */
function stream(bits) {
	let s = bits | 0;
	const next = () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return (t ^ (t >>> 14)) >>> 0;
	};
	return {
		/** An integer in [lo, hi), as `UnityEngine.Random.Range(int, int)`. */
		range: (lo, hi) => lo + (next() % (hi - lo)),
		/** True `percent` times in a hundred, as `Random.value < p`. */
		chance: (percent) => next() % 100 < percent,
	};
}

const key = (x, y, z) => `${x},${y},${z}`;

/** BOTY's `new Vector3Int(Random.Range(-1, 2), 0, Random.Range(-1, 2))`, zero → forward (+z). */
function direction(rng) {
	const dx = rng.range(-1, 2);
	const dz = rng.range(-1, 2);
	return dx || dz ? { dx, dz } : { dx: 0, dz: 1 };
}

/** The tiles, ramps and trampolines of one attempt: BOTY's walk, on our grid. */
function layout(rng) {
	/** `x,y,z` → `{ floor, x, y, z, room, pad }` for a floor; `{ ramp }` for the two tiers a ramp
	 *  holds; `{}` for the pit's column, kept open at every tier. */
	const grid = new Map();
	const ramps = [];
	const ring = [];
	const ends = [];
	const free = (x, y, z) => !grid.has(key(x, y, z));
	const floor = (x, y, z, room = false) => {
		if (!free(x, y, z)) return grid.get(key(x, y, z));
		const tile = { floor: true, x, y, z, room, pad: false };
		grid.set(key(x, y, z), tile);
		return tile;
	};
	const room = (cx, y, cz) => {
		for (let dx = -1; dx <= 1; dx++)
			for (let dz = -1; dz <= 1; dz++) {
				const tile = floor(cx + dx, y, cz + dz, true);
				if (tile.floor) tile.room = true;
			}
	};

	for (let x = -HOLE; x <= HOLE; x++)
		for (let z = -HOLE; z <= HOLE; z++)
			for (let y = TIER_MIN; y <= TIER_MAX + 1; y++) grid.set(key(x, y, z), {});
	for (let x = -RING; x <= RING; x++)
		for (let z = -RING; z <= RING; z++) {
			if (Math.abs(x) <= HOLE && Math.abs(z) <= HOLE) continue;
			ring.push(floor(x, 0, z));
		}
	for (const [x, z] of [
		[3, 3],
		[-3, 3],
		[3, -3],
		[-3, -3],
	])
		grid.get(key(x, 0, z)).pad = true;

	const branches = rng.range(6, 9);
	for (let b = 0; b < branches; b++) {
		const start = ring[rng.range(0, ring.length)];
		let { dx, dz } = direction(rng);
		let cur = { x: start.x, y: start.y, z: start.z };
		const length = rng.range(10, 20);
		for (let s = 0; s < length; s++) {
			if (rng.chance(40)) {
				let dy = rng.chance(50) ? 1 : -1;
				if (cur.y + dy < TIER_MIN || cur.y + dy > TIER_MAX) dy = -dy;
				const alongX = dx && dz ? rng.chance(50) : dx !== 0;
				const rx = alongX ? dx : 0;
				const rz = alongX ? 0 : dz;
				const lo = Math.min(cur.y, cur.y + dy);
				const rampX = cur.x + rx;
				const rampZ = cur.z + rz;
				const land = { x: cur.x + 2 * rx, y: cur.y + dy, z: cur.z + 2 * rz };
				if (free(rampX, lo, rampZ) && free(rampX, lo + 1, rampZ) && free(land.x, land.y, land.z)) {
					const up = dy > 0;
					// The ramp rises toward the higher of its two ends.
					const fx = up ? rx : -rx;
					const fz = up ? rz : -rz;
					const facing = fx > 0 ? '+x' : fx < 0 ? '-x' : fz > 0 ? '+z' : '-z';
					const ramp = {
						x: rampX,
						z: rampZ,
						lo,
						facing,
						low: up ? key(cur.x, cur.y, cur.z) : key(land.x, land.y, land.z),
						high: up ? key(land.x, land.y, land.z) : key(cur.x, cur.y, cur.z),
					};
					ramps.push(ramp);
					grid.set(key(rampX, lo, rampZ), { ramp });
					grid.set(key(rampX, lo + 1, rampZ), { ramp });
					floor(land.x, land.y, land.z).pad = true;
					cur = land;
					continue;
				}
			}
			const prev = cur;
			cur = { x: cur.x + dx, y: cur.y, z: cur.z + dz };
			if (dx && dz && free(prev.x + dx, prev.y, prev.z)) floor(prev.x + dx, prev.y, prev.z);
			if (free(cur.x, cur.y, cur.z)) {
				const tile = floor(cur.x, cur.y, cur.z);
				if (rng.chance(10)) room(cur.x, cur.y, cur.z);
				else if (rng.chance(30)) tile.pad = true;
			}
			if (rng.chance(40)) ({ dx, dz } = direction(rng));
		}
		ends.push(key(cur.x, cur.y, cur.z));
		room(cur.x, cur.y, cur.z);
	}
	return { grid, ramps, ends };
}

const WALL_SIDES = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

/** The tiles as a `motion3d` level: floors, ramps, room walls, trampolines, the pit. */
function levelOf(grid, ramps) {
	const half = CRASH_CELL / 2;
	const colliders = [];
	const zones = [
		{
			kind: CRASH_ARENA_KINDS.pit,
			minX: -(HOLE * CRASH_CELL + half),
			minY: -CRASH_STEP,
			minZ: -(HOLE * CRASH_CELL + half),
			maxX: HOLE * CRASH_CELL + half,
			maxY: 0,
			maxZ: HOLE * CRASH_CELL + half,
		},
	];
	const occupied = (x, y, z) => grid.has(key(x, y, z));
	let lowest = 0;
	const tiles = [...grid.values()].filter((t) => t.floor);
	for (const t of tiles) {
		const cx = t.x * CRASH_CELL;
		const cz = t.z * CRASH_CELL;
		const top = t.y * CRASH_STEP;
		lowest = Math.min(lowest, top);
		colliders.push({
			kind: 'box',
			minX: cx - half,
			minY: top - CRASH_SLAB,
			minZ: cz - half,
			maxX: cx + half,
			maxY: top,
			maxZ: cz + half,
		});
		if (t.pad && !occupied(t.x, t.y + 1, t.z) && !occupied(t.x, t.y + 2, t.z))
			zones.push({
				kind: CRASH_ARENA_KINDS.trampoline,
				height: CRASH_TRAMPOLINE_HEIGHT,
				minX: cx - PAD_HALF,
				minY: top - 0.05,
				minZ: cz - PAD_HALF,
				maxX: cx + PAD_HALF,
				maxY: top + 0.25,
				maxZ: cz + PAD_HALF,
			});
		if (!t.room) continue;
		const open = WALL_SIDES.map(
			([dx, dz]) =>
				!occupied(t.x + dx, t.y, t.z + dz) &&
				!occupied(t.x + dx, t.y + 1, t.z + dz) &&
				!occupied(t.x + dx, t.y - 1, t.z + dz),
		);
		const above = grid.get(key(t.x, t.y + 1, t.z));
		const wallTop = above
			? above.floor
				? top + CRASH_STEP - CRASH_SLAB
				: top + CRASH_STEP
			: top + CRASH_WALL;
		const height = Math.min(top + CRASH_WALL, wallTop);
		open.forEach((isOpen, side) => {
			if (!isOpen) return;
			const [dx, dz] = WALL_SIDES[side];
			if (dx)
				colliders.push({
					kind: 'box',
					minX: dx > 0 ? cx + half - WALL_THICK : cx - half,
					minY: top,
					minZ: cz - half,
					maxX: dx > 0 ? cx + half : cx - half + WALL_THICK,
					maxY: height,
					maxZ: cz + half,
				});
			else
				colliders.push({
					kind: 'box',
					minX: cx - half + (open[1] ? WALL_THICK : 0),
					minY: top,
					minZ: dz > 0 ? cz + half - WALL_THICK : cz - half,
					maxX: cx + half - (open[0] ? WALL_THICK : 0),
					maxY: height,
					maxZ: dz > 0 ? cz + half : cz - half + WALL_THICK,
				});
		});
	}
	for (const r of ramps) {
		const cx = r.x * CRASH_CELL;
		const cz = r.z * CRASH_CELL;
		colliders.push({
			kind: 'ramp',
			facing: r.facing,
			minX: cx - half,
			minY: r.lo * CRASH_STEP,
			minZ: cz - half,
			maxX: cx + half,
			maxY: (r.lo + 1) * CRASH_STEP,
			maxZ: cz + half,
		});
	}
	return { colliders, zones, cellSize: CRASH_CELL, killY: lowest - DEATH_DROP };
}

/** Drop what the pit cannot reach and return from, until nothing more goes. */
function prune(grid, ramps) {
	for (let round = 0; round < 16; round++) {
		const level = levelOf(grid, ramps);
		const graph = navGrid3d(level);
		const rim = nodesAround3d(graph, level.zones[0]);
		const to = navCosts3d(graph, rim);
		const from = navCosts3d(graph, rim, { backward: true });
		let removed = 0;
		for (const [k, t] of grid) {
			if (!t.floor) continue;
			const n = nodeAt3d(graph, t.x * CRASH_CELL, t.y * CRASH_STEP, t.z * CRASH_CELL);
			if (n >= 0 && to[n] >= 0 && from[n] >= 0) continue;
			grid.delete(k);
			removed += 1;
		}
		for (let k = ramps.length - 1; k >= 0; k--) {
			const r = ramps[k];
			if (grid.has(r.low) && grid.has(r.high)) continue;
			grid.delete(key(r.x, r.lo, r.z));
			grid.delete(key(r.x, r.lo + 1, r.z));
			ramps.splice(k, 1);
			removed += 1;
		}
		if (!removed) return { level, graph, rim, to };
	}
	return undefined;
}

/** A yaw (uint16, 0 down −z, anticlockwise from above) facing the pit from (x, z), in eighths. */
function yawToCentre(x, z) {
	// The eighth nearest the direction (−x, −z), by comparisons only (no `atan2`).
	const ax = Math.abs(x);
	const az = Math.abs(z);
	const diagonal = 2 * Math.min(ax, az) > Math.max(ax, az);
	// Yaw 0 looks down −z; 16384 looks down −x; 32768 down +z; 49152 down +x.
	if (diagonal) {
		if (z > 0) return x > 0 ? 8192 : 57344;
		return x > 0 ? 24576 : 40960;
	}
	if (az >= ax) return z > 0 ? 0 : 32768;
	return x > 0 ? 16384 : 49152;
}

/**
 * The team spawns: the far tiles split between two anchors on opposite sides, each team taking
 * `CRASH_TEAM_SPAWNS` of its side whose mean cost to the pit is the nearest to the other's.
 */
function teamSpawns(grid, graph, to, taken) {
	const candidates = [];
	for (const t of grid.values()) {
		if (!t.floor || t.pad || taken.has(key(t.x, t.y, t.z))) continue;
		if (Math.abs(t.x) <= RING && Math.abs(t.z) <= RING) continue;
		const n = nodeAt3d(graph, t.x * CRASH_CELL, t.y * CRASH_STEP, t.z * CRASH_CELL);
		if (n >= 0 && to[n] > 0) candidates.push({ t, cost: to[n] });
	}
	if (candidates.length < 2 * CRASH_TEAM_SPAWNS) return undefined;
	const order = (a, b) => b.cost - a.cost || a.t.x - b.t.x || a.t.z - b.t.z || a.t.y - b.t.y;
	candidates.sort(order);
	const far = candidates.filter((c) => 2 * c.cost >= candidates[0].cost);
	const d2 = (a, b) => {
		const dx = a.t.x - b.t.x;
		const dz = a.t.z - b.t.z;
		return dx * dx + dz * dz;
	};
	const red = far[0];
	let blue = far[1];
	for (const c of far) if (d2(c, red) > d2(blue, red)) blue = c;
	const sides = [[], []];
	for (const c of candidates) sides[d2(c, red) <= d2(c, blue) ? 0 : 1].push(c);
	if (sides.some((s) => s.length < CRASH_TEAM_SPAWNS)) return undefined;
	const sum = (list) => list.reduce((a, c) => a + c.cost, 0);
	// The side whose far end is nearer sets the pace; the other slides down its list to match it.
	const [lead, other] = sides[0][0].cost <= sides[1][0].cost ? [0, 1] : [1, 0];
	const pace = sum(sides[lead].slice(0, CRASH_TEAM_SPAWNS));
	let best = 0;
	for (let k = 0; k + CRASH_TEAM_SPAWNS <= sides[other].length; k++) {
		const gap = Math.abs(sum(sides[other].slice(k, k + CRASH_TEAM_SPAWNS)) - pace);
		if (gap < Math.abs(sum(sides[other].slice(best, best + CRASH_TEAM_SPAWNS)) - pace)) best = k;
	}
	const chosen = [];
	chosen[lead] = sides[lead].slice(0, CRASH_TEAM_SPAWNS);
	chosen[other] = sides[other].slice(best, best + CRASH_TEAM_SPAWNS);
	const spawns = [];
	for (let k = 0; k < CRASH_TEAM_SPAWNS; k++)
		for (let team = 0; team < 2; team++) {
			const { t } = chosen[team][k];
			const x = t.x * CRASH_CELL;
			const z = t.z * CRASH_CELL;
			spawns.push({ x, y: t.y * CRASH_STEP, z, yaw: yawToCentre(x, z), team });
		}
	return spawns;
}

/** One attempt at an arena from a seed's stream; `undefined` when it breaks a rule. */
function attempt(bits) {
	const rng = stream(bits);
	const { grid, ramps, ends } = layout(rng);
	const pruned = prune(grid, ramps);
	if (!pruned) return undefined;
	const { level, graph, to } = pruned;
	const at = (t, kind, extra = {}) => ({
		kind,
		x: t.x * CRASH_CELL,
		y: t.y * CRASH_STEP,
		z: t.z * CRASH_CELL,
		...extra,
	});
	const taken = new Set();
	const markers = [];
	for (const k of ends) {
		const t = grid.get(k);
		if (!t?.floor || taken.has(k)) continue;
		taken.add(k);
		markers.push(at(t, CRASH_ARENA_KINDS.chest));
		// The piece spawner: the end room's first other tile, scanned in a fixed order.
		for (const [dx, dz] of WALL_SIDES) {
			const nk = key(t.x + dx, t.y, t.z + dz);
			const n = grid.get(nk);
			if (n?.floor && n.room && !n.pad && !taken.has(nk)) {
				taken.add(nk);
				markers.push(at(n, CRASH_ARENA_KINDS.pieceSpawner));
				break;
			}
		}
	}
	const rooms = [...grid.entries()].filter(
		([k, t]) => t.floor && t.room && !t.pad && !taken.has(k),
	);
	for (let k = 0; k < rooms.length; k++) {
		const r = rng.range(k, rooms.length);
		[rooms[k], rooms[r]] = [rooms[r], rooms[k]];
	}
	const props = rooms.slice(0, PROPS);
	const pickups = rooms.slice(PROPS, PROPS + PICKUP_SPAWNERS);
	for (const [k] of [...props, ...pickups]) taken.add(k);
	const spawns = teamSpawns(grid, graph, to, taken);
	if (!spawns) return undefined;
	for (const [, t] of props)
		markers.push(
			at(t, CRASH_ARENA_KINDS.prop, { hp: PROP_HP, drops: PROP_DROPS, yaw: rng.range(0, 65536) }),
		);
	for (const [, t] of pickups) markers.push(at(t, CRASH_ARENA_KINDS.pickupSpawner));
	const world = { level, spawns, markers };
	return validateLevel3d(world).ok ? world : undefined;
}

/**
 * The Crash arena a seed makes: `{ generator: 'crashArena', seed, attempt, level, spawns,
 * markers }`. `level` is `createLevel3d`'s input (`arcade.world3d.level`); `spawns` alternate red
 * (`team` 0) and blue (1), eight each, facing the pit; `markers` are the things the Crash rules
 * place: `chest`, `pieceSpawner`, `prop` (`hp`, `drops`, `yaw`) and `pickupSpawner`, each
 * `{ kind, x, y, z }` standing on a floor top. The pit and the trampolines are the level's zones.
 * A seed whose first roll breaks a rule (`validateLevel3d`) rolls again from a derived seed, up to
 * 16 times; `attempt` says which roll it kept. Throws if none holds (no seed in 0..999 does).
 */
export function crashArena(seed) {
	const base = seedBits(seed);
	for (let k = 0; k < ATTEMPTS; k++) {
		const bits = k ? (base ^ Math.imul(k, 0x9e3779b1)) >>> 0 : base;
		const world = attempt(bits);
		if (world) return { generator: 'crashArena', seed, attempt: k, ...world };
	}
	throw new Error(`crashArena: seed ${seed} made no valid arena in ${ATTEMPTS} rolls`);
}
