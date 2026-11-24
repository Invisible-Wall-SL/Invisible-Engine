/**
 * SALMONS' ORIGINAL LEVEL GENERATOR (`docs/design/salmons-levels.md`): the map the original game
 * (`GuiltyForever/Salmon-` `server/mapGenerator.js` `generateMap`, `server/shared/riverUtils.js`
 * `buildMeanderTable`, at 41811c2) makes from a seed, ported line for line on the same PRNG
 * (`seedrandom.js`), so a seed makes the original's level: a river meandering from a 3-tile source
 * to a 58-tile delta, waterfalls every 40 columns, up to 3 bridges, rocks and whirlpools upstream,
 * and cellular-automaton sand islands in the delta.
 *
 * {@link generateSalmonsMap} is the original, in its own grid (`gx` down the river from the source
 * at 0 to the sea at `RIVER_LENGTH`, `gy` across it, 0 at the meander's axis). An AUTHORED OVERLAY
 * ({@link applySalmonsOverlay}) adds, removes and re-heights pieces by grid cell on top of it, kept
 * apart from the generated base so a new seed never loses it. {@link salmonsMapRiver} turns the
 * result into the engine's river (`salmons.js` `SalmonsRiver`, one grid cell = {@link CELL} world
 * px), so `salmonsGeometry`, the placeholder drawing and the original art read it unchanged. The
 * server, every device and `/editor` call the same function on the same seed (`onlineGenerators.js`).
 * Pure and dependency-free: no `Math.random`, no I/O.
 */

import { seedRandom } from './seedrandom.js';

/** The original's map constants (`server/shared/constants.js`). */
export const SALMONS_MAP = Object.freeze({
	RIVER_LENGTH: 400,
	RIVER_WIDTH_START: 28,
	RIVER_WIDTH_END: 3,
	RIVER_MEANDER_AMP: 10,
	RIVER_MEANDER_FREQ: 0.025,
	DELTA_START_FRAC: 0.85,
	SEA_LENGTH: 80,
	WATERFALL_HEIGHT_MIN: 1,
	WATERFALL_HEIGHT_MAX: 8,
	WATERFALL_CLEARANCE: 4,
	BRIDGE_HEIGHT: 6,
	BRIDGE_MAX_COUNT: 3,
	BRIDGE_WATERFALL_CLEARANCE: 10,
	BRIDGE_MIN_SPACING: 50,
	CURRENT_STRENGTH: 1.5,
});

/** World px per grid cell: the original's 64 × 32 tile drawn as the engine's 96 × 48 diamond. */
export const CELL = 48;

/** The level `/editor` previews when the config pins none, and the export's authored river. */
export const SALMONS_MAP_SEED = 1;

const C = SALMONS_MAP;

/** The original's `buildMeanderTable`: the river's axis offset per column (a Float32Array). */
export function buildMeanderTable(seed) {
	const rng = seedRandom(`${seed}_meander`);
	const len = C.RIVER_LENGTH + C.SEA_LENGTH + 10;
	const amp = C.RIVER_MEANDER_AMP;
	const freq = C.RIVER_MEANDER_FREQ;
	const phase1 = rng() * Math.PI * 2;
	const phase2 = rng() * Math.PI * 2;
	const phase3 = rng() * Math.PI * 2;
	const table = new Float32Array(len);
	for (let u = 0; u < len; u++) {
		const wave1 = Math.sin(u * freq + phase1) * amp;
		const wave2 = Math.sin(u * freq * 2.3 + phase2) * amp * 0.4;
		const wave3 = Math.sin(u * freq * 0.5 + phase3) * amp * 0.3;
		const taper = Math.min(1.0, (u / C.RIVER_LENGTH) * 4);
		table[u] = (wave1 + wave2 + wave3) * taper;
	}
	return table;
}

/** The original's `getRiverHalfWidth`: half the river's width at column `u`, in cells. */
export function riverHalfWidth(u) {
	const rl = C.RIVER_LENGTH;
	const progress = Math.max(0, Math.min(1, u / rl));
	let width = C.RIVER_WIDTH_END * (1 - progress) + C.RIVER_WIDTH_START * progress;
	if (progress > C.DELTA_START_FRAC) {
		const delta = (progress - C.DELTA_START_FRAC) / (1 - C.DELTA_START_FRAC);
		width += delta * delta * 30;
	}
	if (u >= rl) width = 200;
	return Math.floor(width);
}

/** The original's `getMeanderAt`: the axis at column `u`, interpolated. */
export function meanderAt(table, u) {
	const idx = Math.floor(u);
	if (idx < 0 || idx >= table.length) return 0;
	const frac = u - idx;
	const next = Math.min(idx + 1, table.length - 1);
	return table[idx] * (1 - frac) + table[next] * frac;
}

/**
 * THE RIVER'S SHAPE, FROM THE CONFIG (`arcade.online.levels.river` and `.waterfalls`; owner,
 * 2026-11-24: "more turns, that can have the player go right to left sometimes", "more 140 degree
 * turns around the source", waterfalls "not as tall as I expect"). A level with neither block is
 * the original's, to the byte. `docs/design/salmons-levels.md` §5.
 */

/** What a `levels.river` block's missing fields are: `winding` is the share of reaches that bend
 *  (the rest run nearly straight), `sharpestTurn` the most a bend turns the river, degrees, and
 *  `sourceBias` how much of that is kept for the source (0: bends as sharp all the way down). */
export const RIVER_SHAPE = Object.freeze({ winding: 0.75, sharpestTurn: 140, sourceBias: 0.6 });

/** The values a shape may take (`game-config` holds a config to the same). */
export const RIVER_SHAPE_LIMITS = Object.freeze({
	winding: Object.freeze([0, 1]),
	sharpestTurn: Object.freeze([0, 150]),
	sourceBias: Object.freeze([0, 1]),
	waterfallCount: Object.freeze([0, 12]),
	waterfallHeight: Object.freeze([1, 16]),
});

/** How a winding course is laid out, cells: the straight run at the source, the straight run each
 *  side of a waterfall (its face stands square across the water), where the bends end (the delta
 *  below runs straight, as the original's sand and spawns expect), a reach's length as a multiple
 *  of the river's width there (more of them where it is narrow: a bend reads as sharp only between
 *  reaches a few widths long), how far the axis may wander, and a bending and a quiet reach's share
 *  of the angle (two quiet reaches never follow each other). */
const COURSE = Object.freeze({
	sourceRun: 4,
	fallRun: Object.freeze({ min: 3, max: 6 }),
	endFrac: 0.75,
	reach: Object.freeze({
		min: 14,
		max: 60,
		atSource: Object.freeze([3, 5]),
		atEnd: Object.freeze([1.2, 2.4]),
	}),
	wander: 34,
	bend: Object.freeze([0.9, 1]),
	quiet: Object.freeze([0.08, 0.25]),
	/** The first reaches below the source always bend: every river has its sharp turn there. */
	firstBends: 2,
	sample: 0.25,
	/** How the sharpness falls from the source to the bends' end: above 1 keeps it near the source. */
	falloff: 1.5,
});

const clampTo = ([lo, hi], v, fallback) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** A config's `levels` as the generator reads it: `undefined` for the original's level. */
export function levelShape(levels) {
	const river = levels?.river;
	const falls = levels?.waterfalls;
	if (!river && !falls) return undefined;
	const L = RIVER_SHAPE_LIMITS;
	const shape = {};
	if (river)
		shape.river = {
			winding: clampTo(L.winding, river.winding, RIVER_SHAPE.winding),
			sharpestTurn: clampTo(L.sharpestTurn, river.sharpestTurn, RIVER_SHAPE.sharpestTurn),
			sourceBias: clampTo(L.sourceBias, river.sourceBias, RIVER_SHAPE.sourceBias),
		};
	if (falls) {
		const count = clampTo(L.waterfallCount, falls.count, undefined);
		const min = clampTo(L.waterfallHeight, falls.heightMin, undefined);
		const max = clampTo(L.waterfallHeight, falls.heightMax, undefined);
		shape.waterfalls = {
			...(count === undefined ? {} : { count: Math.round(count) }),
			...(min === undefined && max === undefined
				? {}
				: {
						heightMin: Math.round(Math.min(min ?? C.WATERFALL_HEIGHT_MIN, max ?? 16)),
						heightMax: Math.round(
							Math.max(max ?? C.WATERFALL_HEIGHT_MAX, min ?? C.WATERFALL_HEIGHT_MIN),
						),
					}),
		};
	}
	return shape;
}

/** The columns a level's waterfalls stand on, from the source down: the original's (every 40th
 *  above the sand), or `count` of them spread the same way (6 are the original's). */
function waterfallColumnsOf(sandStart, count) {
	const columns = [];
	if (count === undefined) {
		for (let gx = 21; gx < sandStart; gx++) if (gx % 40 === 0) columns.push(gx);
		return columns;
	}
	for (let k = 1; k <= count; k++) columns.push(Math.round((k * sandStart) / (count + 1)));
	return columns;
}

/**
 * A river's COURSE: where its water is, column by column. `lo(gx)` and `hi(gx)` are a column's
 * first and last water cells, `axis(u)` the middle of the water at any `u` along it, `edge(u,
 * side)` the water's edge on a side (−1 or 1) and `past(u, side, by, more)` a place `by + more`
 * cells past it; a winding one also has `bends`, each turn of its axis (`{ gx, deg }`). With no `shape.river` it is the original's (its
 * meander table and width, the same arithmetic). With one it WINDS: straight reaches from the
 * source down, each turned to the other side of the last by up to half `sharpestTurn` (a bend
 * between two reaches turns the river by up to all of it), as long as a few of the river's
 * widths, sharper towards the source by `sourceBias`; it runs straight at the source, each side
 * of a waterfall and through the delta. The water is every cell whose centre is within the
 * original's half width of that line, so a reach is as wide ACROSS ITS FLOW as the original's
 * river there however it is turned, and a column's water stays one run of cells: the river never
 * turns back up its own columns, which is what lets a waterfall stand on one line across the
 * world and raise everything upstream of it (`salmonsElevation.ts`).
 */
export function riverCourse(seed, shape) {
	const key = String(seed);
	const meander = buildMeanderTable(key);
	if (!shape?.river) {
		const mid = (gx) => Math.round(meanderAt(meander, gx));
		return {
			winding: false,
			lo: (gx) => mid(gx) - riverHalfWidth(gx),
			hi: (gx) => mid(gx) + riverHalfWidth(gx),
			axis: (u) => meanderAt(meander, u),
			edge: (u, side) => meanderAt(meander, u) + side * riverHalfWidth(u),
			past: (u, side, by, more) => meanderAt(meander, u) + side * (riverHalfWidth(u) + by + more),
		};
	}
	const { winding, sharpestTurn, sourceBias } = shape.river;
	const rng = seedRandom(`${key}_course`);
	const K = COURSE;
	const end = Math.floor(C.RIVER_LENGTH * K.endFrac);
	const falls = waterfallColumnsOf(Math.floor(C.RIVER_LENGTH * 0.7), shape.waterfalls?.count);
	const points = [
		{ g: 0, y: 0 },
		{ g: K.sourceRun, y: 0 },
	];
	let g = K.sourceRun;
	let y = 0;
	let side = rng() < 0.5 ? 1 : -1;
	let quiet = true;
	let reaches = 0;
	// A wider river runs straight further each side of a waterfall, so the reaches' corners stay
	// clear of its face.
	const fallRun = (w) =>
		Math.min(K.fallRun.max, Math.max(K.fallRun.min, Math.round(riverHalfWidth(w) / 2) + 1));
	const between = ([a, b]) => a + (b - a) * rng();
	while (g < end) {
		const fall = falls.find((w) => w + fallRun(w) > g);
		const stop = Math.min(end, fall === undefined ? end : fall - fallRun(fall));
		if (stop - g < 2) {
			g = fall === undefined || stop === end ? end : fall + fallRun(fall);
			points.push({ g, y });
			continue;
		}
		const most = (sharpestTurn / 2) * (1 - sourceBias * Math.min(1, g / end) ** K.falloff);
		const bends = rng() < winding || quiet || reaches < K.firstBends;
		quiet = !bends;
		reaches += 1;
		const angle = (most * between(bends ? K.bend : K.quiet) * Math.PI) / 180;
		const width = 2 * riverHalfWidth(g) + 1;
		const t = g / end;
		const widths = between(K.reach.atSource) * (1 - t) + between(K.reach.atEnd) * t;
		const length = Math.min(K.reach.max, Math.max(K.reach.min, width * widths));
		const rows = Math.min(stop - g, Math.max(2, length * Math.cos(angle)));
		let dy = side * Math.tan(angle) * rows;
		if (Math.abs(y + dy) > K.wander) dy = -Math.sign(y) * Math.abs(dy);
		g += rows;
		y += dy;
		points.push({ g, y });
		side = -Math.sign(dy) || -side;
	}
	points.push({ g: C.RIVER_LENGTH + C.SEA_LENGTH, y });
	const axis = (u) => {
		if (u <= 0) return points[0].y;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			if (u <= b.g) return a.y + ((b.y - a.y) * (u - a.g)) / (b.g - a.g);
		}
		return y;
	};
	const min = new Float64Array(C.RIVER_LENGTH).fill(Infinity);
	const max = new Float64Array(C.RIVER_LENGTH).fill(-Infinity);
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const steps = Math.max(1, Math.ceil(Math.hypot(b.g - a.g, b.y - a.y) / K.sample));
		for (let s = 0; s <= steps; s++) {
			const u = a.g + ((b.g - a.g) * s) / steps;
			const v = a.y + ((b.y - a.y) * s) / steps;
			const r = riverHalfWidth(Math.min(u, C.RIVER_LENGTH - 1)) + 0.5;
			for (let gx = Math.max(0, Math.ceil(u - r)); gx <= u + r && gx < C.RIVER_LENGTH; gx++) {
				const half = Math.sqrt(r * r - (gx - u) * (gx - u));
				if (v - half < min[gx]) min[gx] = v - half;
				if (v + half > max[gx]) max[gx] = v + half;
			}
		}
	}
	const lo = (gx) => Math.ceil(min[gx] - 1e-9);
	const hi = (gx) => Math.floor(max[gx] + 1e-9);
	const column = (u) => Math.min(C.RIVER_LENGTH - 1, Math.max(0, Math.floor(u)));
	// The edge at a place is the outermost of its column's and its neighbours': a place is drawn
	// half a cell down its column, and on a slanted reach the next column's water starts cells away.
	const edge = (u, s) => {
		const at = column(u + 0.5);
		const near = [column(at - 1), at, column(at + 1)];
		return s < 0 ? Math.min(...near.map(lo)) : Math.max(...near.map(hi));
	};
	const heading = (a, b) => (Math.atan2(b.y - a.y, b.g - a.g) * 180) / Math.PI;
	const bends = [];
	for (let i = 1; i < points.length - 1; i++) {
		const deg = Math.abs(heading(points[i - 1], points[i]) - heading(points[i], points[i + 1]));
		if (deg > 0) bends.push({ gx: points[i].g, deg });
	}
	return {
		winding: true,
		bends,
		lo,
		hi,
		axis,
		edge,
		past: (u, s, by, more) => edge(u, s) + s * (by + more),
	};
}

/**
 * The original's `generateMap(seed)`: `obstacles` (`{ x: gx, y: gy, z: 0, type, height? }`, type
 * `waterfall` | `rock` | `whirlpool` | `sandbank`) and `bridges` (`{ gx, gyStart, gyEnd, height }`),
 * in the original's order. A number seed is used as its decimal string, so `7` is the original's
 * `'7'` (the original's own rooms used base-36 strings, which a uint32 room seed cannot name).
 */
export function generateSalmonsMap(seed, shape) {
	const key = String(seed);
	const rng = seedRandom(key);
	const obstacles = [];
	const bridges = [];
	const riverLength = C.RIVER_LENGTH;
	const course = riverCourse(key, shape);
	const sandStart = Math.floor(riverLength * 0.7);
	/** A column's water: its first cell, how many cells wide less one, and its middle cell. */
	const across = (gx) => {
		const lo = course.lo(gx);
		const hi = course.hi(gx);
		return { lo, hi, span: hi - lo, mid: Math.round((lo + hi) / 2) };
	};

	const wfRng = seedRandom(`${key}_waterfallH`);
	const told = shape?.waterfalls;
	const Hmin = told?.heightMin ?? C.WATERFALL_HEIGHT_MIN;
	const Hmax = told?.heightMax ?? C.WATERFALL_HEIGHT_MAX;
	const waterfallColumns = waterfallColumnsOf(sandStart, told?.count);
	const minWfGx = waterfallColumns[0] ?? 0;
	const maxWfGx = waterfallColumns[waterfallColumns.length - 1] ?? 0;
	const wfGxRange = Math.max(1, maxWfGx - minWfGx);
	for (const gx of waterfallColumns) {
		let H;
		if (told?.heightMin === undefined) {
			// The original's: the cap falls from the highest at the source to the lowest at the sea,
			// and a waterfall is up to 4 cells under its cap.
			const t = (gx - minWfGx) / wfGxRange;
			const capH = Math.max(Hmin, Math.round(Hmax - (Hmax - Hmin) * t));
			const minH = Math.max(Hmin, capH - 4);
			H = minH + Math.floor(wfRng() * (capH - minH + 1));
		} else H = Hmin + Math.floor(wfRng() * (Hmax - Hmin + 1));
		const { hi, span } = across(gx);
		for (let i = 0; i <= span; i++)
			obstacles.push({ x: gx, y: hi - i, z: 0, type: 'waterfall', height: H });
	}

	const brRng = seedRandom(`${key}_bridges`);
	const bridgeCandidates = [];
	for (let gx = 25; gx < sandStart - 5; gx++) {
		if (waterfallColumns.some((w) => Math.abs(gx - w) < C.BRIDGE_WATERFALL_CLEARANCE)) continue;
		// On a winding course a bridge crosses where the river runs near straight, not along a reach.
		if (course.winding && across(gx).span > 1.5 * (2 * riverHalfWidth(gx) + 1)) continue;
		bridgeCandidates.push(gx);
	}
	for (let i = bridgeCandidates.length - 1; i > 0; i--) {
		const j = Math.floor(brRng() * (i + 1));
		[bridgeCandidates[i], bridgeCandidates[j]] = [bridgeCandidates[j], bridgeCandidates[i]];
	}
	const bridgeCols = [];
	for (const gx of bridgeCandidates) {
		if (bridgeCols.length >= C.BRIDGE_MAX_COUNT) break;
		if (bridgeCols.some((b) => Math.abs(b - gx) < C.BRIDGE_MIN_SPACING)) continue;
		bridgeCols.push(gx);
	}
	bridgeCols.sort((a, b) => a - b);
	for (const gx of bridgeCols) {
		const { lo, hi } = across(gx);
		bridges.push({ gx, gyStart: lo, gyEnd: hi, height: C.BRIDGE_HEIGHT });
	}

	const nearWaterfall = (gx) =>
		waterfallColumns.some((w) => Math.abs(gx - w) <= C.WATERFALL_CLEARANCE);
	const nearBridge = (gx) => bridgeCols.some((b) => Math.abs(gx - b) <= 1);
	for (let gx = 20; gx < sandStart; gx++) {
		if (nearWaterfall(gx) || nearBridge(gx)) continue;
		if (rng() < 0.3) {
			const { span, mid } = across(gx);
			const offset = Math.floor((rng() * 2 - 1) * (span / 2 - 2));
			const type = rng() < 0.2 ? 'whirlpool' : 'rock';
			obstacles.push({ x: gx, y: mid + offset, z: 0, type });
		}
	}

	const sandEnd = riverLength - 10;
	const sbRng = seedRandom(`${key}_sandCA`);
	const validPos = new Set();
	for (let gx = sandStart; gx <= sandEnd; gx++) {
		const { lo, hi } = across(gx);
		for (let gy = lo + 2; gy <= hi - 2; gy++) validPos.add(`${gx},${gy}`);
	}
	let sandSet = new Set();
	for (const pos of validPos) if (sbRng() < 0.28) sandSet.add(pos);
	for (let iter = 0; iter < 4; iter++) {
		const next = new Set();
		for (const pos of validPos) {
			const [gx, gy] = pos.split(',').map(Number);
			let cnt = 0;
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++) {
					if ((dx || dy) && sandSet.has(`${gx + dx},${gy + dy}`)) cnt++;
				}
			if (sandSet.has(pos) ? cnt >= 3 : cnt >= 4) next.add(pos);
		}
		sandSet = next;
	}
	for (const pos of sandSet) {
		const [gx, gy] = pos.split(',').map(Number);
		obstacles.push({ x: gx, y: gy, z: 0, type: 'sandbank' });
	}
	return { obstacles, bridges };
}

/** The kinds an overlay can add: the original's obstacle types. */
export const OVERLAY_KINDS = Object.freeze(['rock', 'whirlpool', 'sandbank', 'waterfall']);

/** Whether grid cell (gx, gy) is in the river's water (the original's `isInWater`). */
export function inRiver(meander, gx, gy) {
	if (gx < 0 || gx >= C.RIVER_LENGTH) return false;
	return Math.abs(gy - Math.round(meanderAt(meander, Math.max(0, gx)))) <= riverHalfWidth(gx);
}

/** Whether grid cell (gx, gy) is in a course's water ({@link riverCourse}). */
export function inCourse(course, gx, gy) {
	if (!Number.isInteger(gx) || gx < 0 || gx >= C.RIVER_LENGTH) return false;
	return gy >= course.lo(gx) && gy <= course.hi(gx);
}

/**
 * `map` with an authored overlay on top: `remove` first, then `set`, then `add`. A waterfall is a
 * whole column, as the original generates it and the engine draws and plays it, so a waterfall
 * entry acts on the column of its cell: `remove` on a waterfall cell takes the column's waterfall
 * away, `set` re-heights the column's, and `add` of a waterfall lays one across the river at that
 * column. Any other entry acts on its one cell. An entry the level has no place for (nothing to
 * remove or re-height, an addition outside this seed's water) is not applied and comes back in
 * `orphans`, so a reseed never drops an authored piece silently. The overlay is never changed.
 */
export function applySalmonsOverlay(map, overlay, seed, shape) {
	const orphans = [];
	if (!overlay) return { map, orphans };
	const course = riverCourse(seed, shape);
	const isFallAt = (gx, gy) => (o) => o.type === 'waterfall' && o.x === gx && o.y === gy;
	let obstacles = map.obstacles;
	for (const [gx, gy] of overlay.remove ?? []) {
		const fall = obstacles.some(isFallAt(gx, gy));
		const next = obstacles.filter((o) =>
			fall && o.type === 'waterfall' ? o.x !== gx : !(o.x === gx && o.y === gy),
		);
		if (next.length === obstacles.length) orphans.push({ op: 'remove', cell: [gx, gy] });
		obstacles = next;
	}
	for (const { cell, height } of overlay.set ?? []) {
		const [gx, gy] = cell;
		if (!obstacles.some(isFallAt(gx, gy))) {
			orphans.push({ op: 'set', cell: [gx, gy] });
			continue;
		}
		obstacles = obstacles.map((o) => (o.type === 'waterfall' && o.x === gx ? { ...o, height } : o));
	}
	for (const a of overlay.add ?? []) {
		const [gx, gy] = a.cell;
		if (!OVERLAY_KINDS.includes(a.kind) || !inCourse(course, gx, gy)) {
			orphans.push({ op: 'add', cell: [gx, gy], kind: a.kind });
			continue;
		}
		if (a.kind === 'waterfall') {
			const hi = course.hi(gx);
			const span = hi - course.lo(gx);
			const height = a.height ?? C.WATERFALL_HEIGHT_MIN;
			obstacles = obstacles.filter((o) => !(o.x === gx && (o.type === 'waterfall' || o.y === gy)));
			const fall = [];
			for (let i = 0; i <= span; i++)
				fall.push({ x: gx, y: hi - i, z: 0, type: 'waterfall', height });
			obstacles = obstacles.concat(fall);
			continue;
		}
		obstacles = obstacles
			.filter((o) => !(o.x === gx && o.y === gy))
			.concat({ x: gx, y: gy, z: 0, type: a.kind });
	}
	return { map: { obstacles, bridges: map.bridges }, orphans };
}

/** The overlay a level of `seed` gets from a config's `levels`: every level's, then its own. */
export function levelOverlay(levels, seed) {
	const all = levels?.overlays?.['*'];
	const own = levels?.overlays?.[String(seed)];
	if (!all) return own;
	if (!own) return all;
	return {
		add: [...(all.add ?? []), ...(own.add ?? [])],
		remove: [...(all.remove ?? []), ...(own.remove ?? [])],
		set: [...(all.set ?? []), ...(own.set ?? [])],
	};
}

/** Rows of world above the river's first column (the source) and below its last (the sea). */
const SOURCE_ROWS = 5;
const SEA_ROWS = 6;
/** Cells of bank and forest past the widest water on each side: the bears' and fishermen's room. */
const BANK_CELLS = 14;
/** Where the original spawns salmon: ten columns above the sea. */
const SPAWN_GX = C.RIVER_LENGTH - 10;
/** A waterfall's thickness, px, straddling the top of its column (as `salmons.js`). */
const FALL_H = 40;
/** The whirlpool's drawn radius, px (the art's own size). */
const WHIRLPOOL_R = 90;
/** The original's catcher spawn (`server/index.js` `findCatcherSpawn`), cells: tries per place,
 *  the columns it keeps clear at each end, how far past the water's edge (`halfW + 3 + rand · 5`),
 *  how far from another catcher, and the fallback (column 200, `halfW + 5` off the axis). */
const CATCHER_SPAWN = Object.freeze({
	tries: 30,
	ends: 30,
	past: 3,
	spread: 5,
	apart: 15,
	fallbackGx: 200,
	fallbackPast: 5,
});
/** How many catcher places a level offers at most: the room picks one at random at each spawn. */
const CATCHER_PLACES = 32;
/** How far across the axis the original spawns a salmon: `(rand − 0.5) · halfW · 0.8`. */
const SALMON_SPREAD = 0.4;

/**
 * The original's catcher spawns (`server/index.js` `findCatcherSpawn`), drawn from the seed: each
 * place is its first of {@link CATCHER_SPAWN}`.tries` tries at least `apart` cells from the places
 * before it, else the list ends (the original's fallback when there is none). Grid cells.
 */
function catcherPlaces(key, course) {
	const rng = seedRandom(`${key}_catchers`);
	const S = CATCHER_SPAWN;
	const places = [];
	while (places.length < CATCHER_PLACES) {
		let found;
		for (let t = 0; t < S.tries && !found; t++) {
			const gx = S.ends + rng() * (C.RIVER_LENGTH - 2 * S.ends);
			const side = rng() < 0.5 ? -1 : 1;
			const gy = course.past(gx, side, S.past, rng() * S.spread);
			if (places.every((p) => (p.gx - gx) ** 2 + (p.gy - gy) ** 2 >= S.apart ** 2))
				found = { gx, gy };
		}
		if (!found) break;
		places.push(found);
	}
	if (!places.length) {
		const gx = S.fallbackGx;
		places.push({ gx, gy: course.edge(gx, 1) + S.fallbackPast });
	}
	return places;
}

/**
 * The river a seed's level makes, in the engine's shape (`salmons.js` `SalmonsRiver`): the
 * original's map with the overlay on top, one grid cell = {@link CELL} px, the source at the top
 * and the sea at the bottom. Each run of columns of one width is a band (a waterfall column always
 * starts one, so its face sits on a band's top as the drawing expects); rocks are 1.5 cells, sand
 * islands one rect per run of cells across a column. The salmon start across the original's spawn
 * line (`salmonSpawns`, a cell apart over its spread) and the bears and fishermen at the original's
 * catcher places (`botSpawns`); the room picks one of them at each spawn. Also `generator`, `grid`
 * (the cell ↔ world transform, for `/editor`), `bridges` and `orphans`.
 */
export function salmonsMapRiver(seed = SALMONS_MAP_SEED, overlay, shape) {
	const key = String(seed);
	const course = riverCourse(key, shape);
	const { map, orphans } = applySalmonsOverlay(generateSalmonsMap(key, shape), overlay, key, shape);
	const columns = [];
	for (let gx = 0; gx < C.RIVER_LENGTH; gx++)
		columns.push({ gx, lo: course.lo(gx), hi: course.hi(gx) });
	const gyMin = Math.min(...columns.map((c) => c.lo)) - BANK_CELLS;
	const gyMax = Math.max(...columns.map((c) => c.hi)) + BANK_CELLS;
	const xOf = (gy) => (gy - gyMin) * CELL;
	const yOf = (gx) => (gx + SOURCE_ROWS) * CELL;
	const world = {
		w: (gyMax - gyMin + 1) * CELL,
		h: (SOURCE_ROWS + C.RIVER_LENGTH + SEA_ROWS) * CELL,
	};
	const current = Math.round(C.CURRENT_STRENGTH * CELL);

	const byType = (type) => map.obstacles.filter((o) => o.type === type);
	const fallColumns = new Map();
	for (const o of byType('waterfall')) {
		const f = fallColumns.get(o.x) ?? { gx: o.x, height: 0 };
		f.height = Math.max(f.height, o.height ?? 1);
		fallColumns.set(o.x, f);
	}

	const bands = [];
	for (const col of columns) {
		const left = xOf(col.lo);
		const right = xOf(col.hi + 1);
		const last = bands[bands.length - 1];
		if (last && last.left === left && last.right === right && !fallColumns.has(col.gx))
			last.h += CELL;
		else bands.push({ y: yOf(col.gx), h: CELL, left, right, current });
	}

	const centreOf = (o) => ({ x: xOf(o.y) + CELL / 2, y: yOf(o.x) + CELL / 2 });
	const whirlpools = byType('whirlpool').map((o) => ({
		...centreOf(o),
		r: WHIRLPOOL_R,
		spin: (o.x + o.y) % 2 ? 1 : -1,
	}));
	const rocks = byType('rock').map((o) => {
		const c = centreOf(o);
		const size = CELL * 1.5;
		return { x: c.x - size / 2, y: c.y - size / 2, w: size, h: size };
	});
	const sandCells = byType('sandbank')
		.map((o) => [o.x, o.y])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const sandbanks = [];
	for (const [gx, gy] of sandCells) {
		const last = sandbanks[sandbanks.length - 1];
		if (last && last.gx === gx && last.gyEnd === gy - 1) last.gyEnd = gy;
		else sandbanks.push({ gx, gyStart: gy, gyEnd: gy });
	}
	const waterfalls = [...fallColumns.values()]
		.sort((a, b) => a.gx - b.gx)
		.map((f) => ({ x: 0, y: yOf(f.gx) - FALL_H / 2, w: world.w, h: FALL_H, height: f.height }));

	const top = bands[0];
	const spawnCol = columns[SPAWN_GX];
	const at = ({ gx, gy }) => ({
		x: Math.round(xOf(gy) + CELL / 2),
		y: Math.round(yOf(gx) + CELL / 2),
	});
	const botSpawns = catcherPlaces(key, course).map(at);
	const spread = Math.floor(SALMON_SPREAD * riverHalfWidth(SPAWN_GX));
	const salmonSpawns = [];
	for (let k = -spread; k <= spread; k++)
		salmonSpawns.push(at({ gx: SPAWN_GX, gy: course.axis(SPAWN_GX) + k }));
	return {
		seed: typeof seed === 'number' ? seed : key,
		generator: 'salmonsMap',
		world,
		bands,
		whirlpools,
		rocks,
		sandbanks: sandbanks.map((s) => ({
			x: xOf(s.gyStart),
			y: yOf(s.gx),
			w: (s.gyEnd - s.gyStart + 1) * CELL,
			h: CELL,
		})),
		waterfalls,
		source: { x: top.left, y: 0, w: top.right - top.left, h: SOURCE_ROWS * CELL },
		sea: { x: 0, y: yOf(C.RIVER_LENGTH), w: world.w, h: SEA_ROWS * CELL },
		spawn: { x: xOf(Math.round((spawnCol.lo + spawnCol.hi) / 2)) + CELL / 2, y: yOf(SPAWN_GX) },
		salmonSpawns,
		botSpawns,
		bridges: map.bridges.map((b) => ({
			x: xOf(b.gyStart),
			y: yOf(b.gx),
			w: (b.gyEnd - b.gyStart + 1) * CELL,
			h: CELL,
			height: b.height,
		})),
		grid: { cell: CELL, gyMin, sourceRows: SOURCE_ROWS },
		orphans,
	};
}

/** A reach counts as running across the screen's other diagonal once it is turned further than
 *  this from straight up the river, degrees: on the isometric screen straight up the river runs
 *  along one diagonal, and past 45° to one side the swimmer's screen x reverses. */
const ACROSS_DEG = 45;

/**
 * What a river's course measures, read off its bands alone (so it measures the original's levels
 * and a winding one alike; `scripts/check-salmons-course.mjs`, `scripts/salmons/river-overview.mjs`):
 * - `sharpest`: the sharpest bend, degrees (the river's heading before it against after it), and
 *   `turns`: each bend of 40° or more, `{ gx, deg }`, from the source down;
 * - `across`: each stretch turned more than 45° from straight up the river, `{ from, to, side,
 *   cells }` (`side` 1 towards +x; `cells` its length along the flow);
 * - `screen`: how many cells of the swim up the river run left to right and right to left, on the
 *   mirrored screen (Salmons') and on the plain one;
 * - `length`: the swim from the sea to the source along the middle of the water, cells;
 * - `narrowest`: the least width across the flow, as a share of the original's width there;
 * - `passage`: the least run of cells two neighbouring columns share, cells (a salmon's centre
 *   needs one cell).
 */
export function courseFacts(river) {
	const rows = [];
	for (const band of river.bands)
		for (let k = 0; k < Math.round(band.h / CELL); k++)
			rows.push({ lo: band.left / CELL, hi: band.right / CELL });
	const n = rows.length;
	const mid = (i) => (rows[i].lo + rows[i].hi) / 2;
	// Over five columns: a slanted bank is a staircase of whole cells, which two columns misread.
	const slope = (i) => {
		const a = Math.max(0, i - 2);
		const b = Math.min(n - 1, i + 2);
		return (mid(a) - mid(b)) / (b - a);
	};
	const deg = rows.map((_, i) => (Math.atan(slope(i)) * 180) / Math.PI);
	const cells = rows.map((_, i) => Math.hypot(1, slope(i)));
	// The widest disc of water centred in a column, as a width in cells (2 · its radius − 1: a
	// straight river of `w` cells measures `w`).
	const REACH = 64;
	const clear = (i, y) => {
		let least = Infinity;
		for (let j = Math.max(0, i - REACH); j <= Math.min(n - 1, i + REACH) && least > 0; j++) {
			const inside = Math.min(y - rows[j].lo + 1, rows[j].hi - y);
			if (Math.abs(j - i) >= least) continue;
			least = Math.min(least, inside <= 0 ? Math.abs(j - i) : Math.hypot(j - i, inside));
		}
		return least;
	};
	const widthAt = (i) => {
		let most = 0;
		for (let y = rows[i].lo; y < rows[i].hi; y++) most = Math.max(most, clear(i, y));
		return 2 * most - 1;
	};
	let narrowest = Infinity;
	let passage = Infinity;
	const screen = {
		mirrored: { leftToRight: 0, rightToLeft: 0 },
		plain: { leftToRight: 0, rightToLeft: 0 },
	};
	const across = [];
	for (let i = 0; i < n; i++) {
		narrowest = Math.min(narrowest, widthAt(i) / (2 * riverHalfWidth(i) + 1));
		if (i)
			passage = Math.min(
				passage,
				Math.min(rows[i].hi, rows[i - 1].hi) - Math.max(rows[i].lo, rows[i - 1].lo),
			);
		const side = deg[i] > ACROSS_DEG ? 1 : deg[i] < -ACROSS_DEG ? -1 : 0;
		screen.mirrored[side < 0 ? 'leftToRight' : 'rightToLeft'] += cells[i];
		screen.plain[side > 0 ? 'rightToLeft' : 'leftToRight'] += cells[i];
		if (!side) continue;
		const last = across[across.length - 1];
		if (last && last.to === i - 1 && last.side === side) {
			last.to = i;
			last.cells += cells[i];
		} else across.push({ from: i, to: i, side, cells: cells[i] });
	}
	const runs = [];
	for (let i = 0; i < n; i++) {
		const side = Math.abs(deg[i]) < 12 ? 0 : Math.sign(deg[i]);
		if (!side) continue;
		const last = runs[runs.length - 1];
		if (last && last.side === side) {
			last.to = i;
			last.peak = Math.max(last.peak, Math.abs(deg[i]));
		} else runs.push({ from: i, to: i, side, peak: Math.abs(deg[i]) });
	}
	// A reach's heading: across its middle (its ends round into the bends), when it is long enough.
	for (const run of runs) {
		const trim = Math.ceil((run.to - run.from) * 0.2);
		const a = run.from + trim;
		const b = run.to - trim;
		if (b - a >= 3) run.peak = Math.abs((Math.atan((mid(a) - mid(b)) / (b - a)) * 180) / Math.PI);
	}
	const turns = [];
	for (let k = 1; k < runs.length; k++) {
		const turn = runs[k - 1].peak + runs[k].peak;
		if (turn >= 40) turns.push({ gx: runs[k].from, deg: Math.round(turn) });
	}
	const whole = (o) => ({
		leftToRight: Math.round(o.leftToRight),
		rightToLeft: Math.round(o.rightToLeft),
	});
	return {
		sharpest: turns.reduce((most, t) => Math.max(most, t.deg), 0),
		turns,
		across: across.map((a) => ({ ...a, cells: Math.round(a.cells) })),
		screen: { mirrored: whole(screen.mirrored), plain: whole(screen.plain) },
		length: Math.round(cells.reduce((sum, c) => sum + c, 0)),
		narrowest: Math.round(narrowest * 100) / 100,
		passage,
	};
}
