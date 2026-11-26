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

import {
	biomeAt,
	biomeStretchAt,
	biomeStretches,
	resolveBiomes,
	seedBiomes,
} from './salmonsBiomes.js';
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

/**
 * EVERY NUMBER THAT SHAPES A LEVEL, FROM THE CONFIG (`arcade.online.levels.generator`; owner,
 * 2026-11-26: "I would like to have more control over the level generation, so I can control all
 * of its parameters"; `docs/design/salmons-levels.md` §6). These are the original's and the port's
 * own values, so a config with no `generator` block plays exactly the level it played before.
 *
 * - The river: its length in columns, its half width at the source and at the mouth (cells), where
 *   the delta flares and by how much, and the original meander's amplitude and frequency.
 * - The sand: where the delta's sand starts (a share of the length) and how far above the sea it
 *   stops, the share of cells seeded, the cellular automaton's passes, birth and survival counts,
 *   and the cells kept clear of the banks.
 * - Rocks and whirlpools: the first column, a column's chance of a piece, the whirlpools' share,
 *   the cells kept clear of the banks, a rock's size (cells) and a whirlpool's radius (px).
 * - Waterfalls (with `levels.waterfalls`' count and heights): the original's columns, every
 *   `waterfallEvery` from `waterfallFrom`, the columns kept clear of pieces each side, and how far
 *   under its place's cap the original's height may fall.
 * - Bridges: how many at most, their height, the first column, how far from a waterfall, from each
 *   other and above the sand.
 * - A winding course (`levels.river`): the straight run at the source and each side of a waterfall,
 *   where the bends end, a reach's length (clamped, and in river widths at the source and at the
 *   end), how far the axis wanders, a bending and a quiet reach's share of the angle, the reaches
 *   below the source that always bend, and how fast the sharpness falls towards the sea.
 * - The world: rows above the source and below the sea, cells of bank past the widest water.
 * - Spawns: the salmon's line above the sea and its spread, and the catchers' places (how many,
 *   tries per place, columns kept clear at each end, how far past the water, how far apart).
 *
 * Plain values, not read off {@link SALMONS_MAP} (whose same-named numbers they are, as
 * `check:salmons-levels` holds): a bundle that never makes a level drops a literal it never reads.
 *
 * Left out, as not the level's: the current (`CURRENT_STRENGTH`, a speed the movement step pushes
 * at), a waterfall's thickness and the bank limit (the rules' bounds, `salmons.js`), the sea's
 * length (it moves no cell of the map), and the course's sampling step (arithmetic, not a look).
 */
export const SALMONS_GENERATOR = Object.freeze({
	riverLength: 400,
	sourceHalfWidth: 3,
	mouthHalfWidth: 28,
	deltaStart: 0.85,
	deltaFlare: 30,
	meanderAmp: 10,
	meanderFreq: 0.025,
	sandStart: 0.7,
	sandEndGap: 10,
	sandSeed: 0.28,
	sandPasses: 4,
	sandBirth: 4,
	sandSurvive: 3,
	sandMargin: 2,
	obstacleFrom: 20,
	obstacleChance: 0.3,
	whirlpoolShare: 0.2,
	obstacleMargin: 2,
	rockSize: 1.5,
	whirlpoolRadius: 90,
	waterfallFrom: 21,
	waterfallEvery: 40,
	waterfallClearance: 4,
	waterfallDrop: 4,
	bridgeCount: 3,
	bridgeHeight: 6,
	bridgeFrom: 25,
	bridgeFallClearance: 10,
	bridgeSpacing: 50,
	bridgeSandGap: 5,
	sourceRun: 4,
	fallRunMin: 3,
	fallRunMax: 6,
	windingEnd: 0.75,
	reachMin: 14,
	reachMax: 60,
	reachSourceMin: 3,
	reachSourceMax: 5,
	reachEndMin: 1.2,
	reachEndMax: 2.4,
	wander: 34,
	bendMin: 0.9,
	bendMax: 1,
	quietMin: 0.08,
	quietMax: 0.25,
	firstBends: 2,
	falloff: 1.5,
	sourceRows: 5,
	seaRows: 6,
	bankCells: 14,
	salmonSpawnAbove: 10,
	salmonSpread: 0.4,
	catcherPlaces: 32,
	catcherTries: 30,
	catcherEnds: 30,
	catcherPast: 3,
	catcherSpread: 5,
	catcherApart: 15,
});

/** The values each of {@link SALMONS_GENERATOR}'s may take, `[least, most]` (`game-config` holds
 *  a config to the same: it imports them). */
export const SALMONS_GENERATOR_LIMITS = Object.freeze({
	riverLength: Object.freeze([120, 800]),
	sourceHalfWidth: Object.freeze([1, 20]),
	mouthHalfWidth: Object.freeze([1, 60]),
	deltaStart: Object.freeze([0.5, 0.99]),
	deltaFlare: Object.freeze([0, 80]),
	meanderAmp: Object.freeze([0, 40]),
	meanderFreq: Object.freeze([0, 0.2]),
	sandStart: Object.freeze([0.3, 0.95]),
	sandEndGap: Object.freeze([0, 60]),
	sandSeed: Object.freeze([0, 1]),
	sandPasses: Object.freeze([0, 12]),
	sandBirth: Object.freeze([0, 9]),
	sandSurvive: Object.freeze([0, 9]),
	sandMargin: Object.freeze([0, 10]),
	obstacleFrom: Object.freeze([0, 800]),
	obstacleChance: Object.freeze([0, 1]),
	whirlpoolShare: Object.freeze([0, 1]),
	obstacleMargin: Object.freeze([0, 10]),
	rockSize: Object.freeze([0.5, 4]),
	whirlpoolRadius: Object.freeze([24, 240]),
	waterfallFrom: Object.freeze([0, 800]),
	waterfallEvery: Object.freeze([5, 400]),
	waterfallClearance: Object.freeze([0, 40]),
	waterfallDrop: Object.freeze([0, 16]),
	bridgeCount: Object.freeze([0, 10]),
	bridgeHeight: Object.freeze([1, 16]),
	bridgeFrom: Object.freeze([0, 800]),
	bridgeFallClearance: Object.freeze([0, 100]),
	bridgeSpacing: Object.freeze([1, 400]),
	bridgeSandGap: Object.freeze([0, 100]),
	sourceRun: Object.freeze([0, 40]),
	fallRunMin: Object.freeze([0, 20]),
	fallRunMax: Object.freeze([0, 20]),
	windingEnd: Object.freeze([0.3, 0.95]),
	reachMin: Object.freeze([2, 200]),
	reachMax: Object.freeze([2, 200]),
	reachSourceMin: Object.freeze([0.5, 10]),
	reachSourceMax: Object.freeze([0.5, 10]),
	reachEndMin: Object.freeze([0.5, 10]),
	reachEndMax: Object.freeze([0.5, 10]),
	wander: Object.freeze([0, 80]),
	bendMin: Object.freeze([0, 1]),
	bendMax: Object.freeze([0, 1]),
	quietMin: Object.freeze([0, 1]),
	quietMax: Object.freeze([0, 1]),
	firstBends: Object.freeze([0, 10]),
	falloff: Object.freeze([0.25, 4]),
	sourceRows: Object.freeze([1, 20]),
	seaRows: Object.freeze([1, 20]),
	bankCells: Object.freeze([13, 40]),
	salmonSpawnAbove: Object.freeze([1, 60]),
	salmonSpread: Object.freeze([0, 1]),
	catcherPlaces: Object.freeze([1, 100]),
	catcherTries: Object.freeze([1, 200]),
	catcherEnds: Object.freeze([0, 60]),
	catcherPast: Object.freeze([0, 20]),
	catcherSpread: Object.freeze([0, 20]),
	catcherApart: Object.freeze([0, 100]),
});

/** The parameters that are whole numbers (counts, columns, cells, passes). */
export const SALMONS_GENERATOR_WHOLE = Object.freeze([
	'riverLength',
	'sourceHalfWidth',
	'mouthHalfWidth',
	'sandEndGap',
	'sandPasses',
	'sandBirth',
	'sandSurvive',
	'sandMargin',
	'obstacleFrom',
	'obstacleMargin',
	'waterfallFrom',
	'waterfallEvery',
	'waterfallClearance',
	'waterfallDrop',
	'bridgeCount',
	'bridgeHeight',
	'bridgeFrom',
	'bridgeFallClearance',
	'bridgeSpacing',
	'bridgeSandGap',
	'sourceRun',
	'fallRunMin',
	'fallRunMax',
	'firstBends',
	'sourceRows',
	'seaRows',
	'bankCells',
	'salmonSpawnAbove',
	'catcherPlaces',
	'catcherTries',
	'catcherEnds',
	'catcherPast',
	'catcherApart',
]);

/** The pairs whose least must not pass their most: two given the wrong way round are swapped. */
export const SALMONS_GENERATOR_PAIRS = Object.freeze([
	Object.freeze(['fallRunMin', 'fallRunMax']),
	Object.freeze(['reachMin', 'reachMax']),
	Object.freeze(['reachSourceMin', 'reachSourceMax']),
	Object.freeze(['reachEndMin', 'reachEndMax']),
	Object.freeze(['bendMin', 'bendMax']),
	Object.freeze(['quietMin', 'quietMax']),
]);

/** A config's `levels.generator` whole: every parameter held to its limits (whole ones rounded,
 *  pairs in order), a missing or unusable one its default. */
export function generatorParams(raw) {
	const params = {};
	for (const [key, fallback] of Object.entries(SALMONS_GENERATOR)) {
		const v = clampTo(SALMONS_GENERATOR_LIMITS[key], raw?.[key], fallback);
		params[key] = SALMONS_GENERATOR_WHOLE.includes(key) ? Math.round(v) : v;
	}
	for (const [lo, hi] of SALMONS_GENERATOR_PAIRS)
		if (params[lo] > params[hi]) [params[lo], params[hi]] = [params[hi], params[lo]];
	return params;
}

const G = SALMONS_GENERATOR;

/** The original's `buildMeanderTable`: the river's axis offset per column (a Float32Array). */
export function buildMeanderTable(seed, P = G) {
	const rng = seedRandom(`${seed}_meander`);
	const len = P.riverLength + C.SEA_LENGTH + 10;
	const amp = P.meanderAmp;
	const freq = P.meanderFreq;
	const phase1 = rng() * Math.PI * 2;
	const phase2 = rng() * Math.PI * 2;
	const phase3 = rng() * Math.PI * 2;
	const table = new Float32Array(len);
	for (let u = 0; u < len; u++) {
		const wave1 = Math.sin(u * freq + phase1) * amp;
		const wave2 = Math.sin(u * freq * 2.3 + phase2) * amp * 0.4;
		const wave3 = Math.sin(u * freq * 0.5 + phase3) * amp * 0.3;
		const taper = Math.min(1.0, (u / P.riverLength) * 4);
		table[u] = (wave1 + wave2 + wave3) * taper;
	}
	return table;
}

/** The original's `getRiverHalfWidth`: half the river's width at column `u`, in cells. */
export function riverHalfWidth(u, P = G) {
	const rl = P.riverLength;
	const progress = Math.max(0, Math.min(1, u / rl));
	let width = P.sourceHalfWidth * (1 - progress) + P.mouthHalfWidth * progress;
	if (progress > P.deltaStart) {
		const delta = (progress - P.deltaStart) / (1 - P.deltaStart);
		width += delta * delta * P.deltaFlare;
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

/** A winding course's sampling step along its line, cells, and how far past its own column's
 *  water a bank place may lie (`salmons.js` `SALMONS_BOUNDS.bank`, less half a cell). The rest of
 *  its layout is {@link SALMONS_GENERATOR}'s. */
const COURSE = Object.freeze({ sample: 0.25, bankReach: 11.5 });

const clampTo = ([lo, hi], v, fallback) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const isBlock = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A config's `levels` as the level of `seed` reads them: `undefined` for the original's level.
 *  `generator` is every parameter ({@link generatorParams}) and `biomes` the seed's
 *  (`salmonsBiomes.js` `resolveBiomes`), each only when the config has its block. */
export function levelShape(levels, seed) {
	const river = levels?.river;
	const falls = levels?.waterfalls;
	const generator = isBlock(levels?.generator) ? generatorParams(levels.generator) : undefined;
	const biomes = resolveBiomes(levels?.biomes, seed);
	if (!river && !falls && !generator && !biomes) return undefined;
	const L = RIVER_SHAPE_LIMITS;
	const shape = {};
	if (generator) shape.generator = generator;
	if (biomes) shape.biomes = biomes;
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

/** Where a level's sand starts, its first column: no waterfall, rock or bridge from there down. */
const sandStartOf = (P) => Math.floor(P.riverLength * P.sandStart);

/** The columns a level's waterfalls stand on, from the source down: the original's (every
 *  `waterfallEvery`th from `waterfallFrom` above the sand), or `count` of them spread the same way
 *  (6 are the original's); then, with biomes, each stretch keeps its `waterfalls` share of its own,
 *  spread evenly (no random draw: a level whose biomes keep them all is the level without). */
function waterfallColumnsOf(P, shape) {
	const sandStart = sandStartOf(P);
	const count = shape?.waterfalls?.count;
	const columns = [];
	if (count === undefined) {
		for (let gx = P.waterfallFrom; gx < sandStart; gx++)
			if (gx % P.waterfallEvery === 0) columns.push(gx);
	} else for (let k = 1; k <= count; k++) columns.push(Math.round((k * sandStart) / (count + 1)));
	const biomes = shape?.biomes;
	if (!biomes) return columns;
	const seen = new Map();
	return columns.filter((gx) => {
		const { stretch, kind } = biomeStretchAt(biomes, gx);
		const k = seen.get(stretch) ?? 0;
		seen.set(stretch, k + 1);
		return Math.floor((k + 1) * kind.waterfalls) > Math.floor(k * kind.waterfalls);
	});
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
	const P = shape?.generator ?? G;
	const halfWidth = (u) => riverHalfWidth(u, P);
	const meander = buildMeanderTable(key, P);
	if (!shape?.river) {
		const mid = (gx) => Math.round(meanderAt(meander, gx));
		return {
			winding: false,
			rows: P.riverLength,
			lo: (gx) => mid(gx) - halfWidth(gx),
			hi: (gx) => mid(gx) + halfWidth(gx),
			axis: (u) => meanderAt(meander, u),
			edge: (u, side) => meanderAt(meander, u) + side * halfWidth(u),
			past: (u, side, by, more) => meanderAt(meander, u) + side * (halfWidth(u) + by + more),
		};
	}
	const { winding, sharpestTurn, sourceBias } = shape.river;
	const rng = seedRandom(`${key}_course`);
	const K = COURSE;
	const length = P.riverLength;
	const end = Math.floor(length * P.windingEnd);
	const falls = waterfallColumnsOf(P, shape);
	const points = [
		{ g: 0, y: 0 },
		{ g: P.sourceRun, y: 0 },
	];
	let g = P.sourceRun;
	let y = 0;
	let side = rng() < 0.5 ? 1 : -1;
	let quiet = true;
	let reaches = 0;
	// A wider river runs straight further each side of a waterfall, so the reaches' corners stay
	// clear of its face.
	const fallRun = (w) =>
		Math.min(P.fallRunMax, Math.max(P.fallRunMin, Math.round(halfWidth(w) / 2) + 1));
	const between = ([a, b]) => a + (b - a) * rng();
	while (g < end) {
		const fall = falls.find((w) => w + fallRun(w) > g);
		const stop = Math.min(end, fall === undefined ? end : fall - fallRun(fall));
		if (stop - g < 2) {
			g = fall === undefined || stop === end ? end : fall + fallRun(fall);
			points.push({ g, y });
			continue;
		}
		const most = (sharpestTurn / 2) * (1 - sourceBias * Math.min(1, g / end) ** P.falloff);
		const bends = rng() < winding || quiet || reaches < P.firstBends;
		quiet = !bends;
		reaches += 1;
		const share = bends ? [P.bendMin, P.bendMax] : [P.quietMin, P.quietMax];
		const angle = (most * between(share) * Math.PI) / 180;
		const width = 2 * halfWidth(g) + 1;
		const t = g / end;
		const widths =
			between([P.reachSourceMin, P.reachSourceMax]) * (1 - t) +
			between([P.reachEndMin, P.reachEndMax]) * t;
		const reach = Math.min(P.reachMax, Math.max(P.reachMin, width * widths));
		const rows = Math.min(stop - g, Math.max(2, reach * Math.cos(angle)));
		let dy = side * Math.tan(angle) * rows;
		// Past the limit it turns back towards the middle, and no further than the limit there.
		if (Math.abs(y + dy) > P.wander) {
			const back = -(Math.sign(y) || side);
			dy = back * Math.min(Math.abs(dy), P.wander + Math.abs(y));
		}
		g += rows;
		y += dy;
		points.push({ g, y });
		side = -Math.sign(dy) || -side;
	}
	points.push({ g: length + C.SEA_LENGTH, y });
	const axis = (u) => {
		if (u <= 0) return points[0].y;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			if (u <= b.g) return a.y + ((b.y - a.y) * (u - a.g)) / (b.g - a.g);
		}
		return y;
	};
	const min = new Float64Array(length).fill(Infinity);
	const max = new Float64Array(length).fill(-Infinity);
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const steps = Math.max(1, Math.ceil(Math.hypot(b.g - a.g, b.y - a.y) / K.sample));
		for (let s = 0; s <= steps; s++) {
			const u = a.g + ((b.g - a.g) * s) / steps;
			const v = a.y + ((b.y - a.y) * s) / steps;
			const r = halfWidth(Math.min(u, length - 1)) + 0.5;
			for (let gx = Math.max(0, Math.ceil(u - r)); gx <= u + r && gx < length; gx++) {
				const half = Math.sqrt(r * r - (gx - u) * (gx - u));
				if (v - half < min[gx]) min[gx] = v - half;
				if (v + half > max[gx]) max[gx] = v + half;
			}
		}
	}
	const lo = (gx) => Math.ceil(min[gx] - 1e-9);
	const hi = (gx) => Math.floor(max[gx] + 1e-9);
	const column = (u) => Math.min(length - 1, Math.max(0, Math.floor(u)));
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
		rows: length,
		bends,
		lo,
		hi,
		axis,
		edge,
		// No further than the bank limit from its own column's water (`salmons.js`
		// `SALMONS_BOUNDS.bank`, less half a cell), however far a neighbour's edge lies.
		past: (u, s, by, more) => {
			const own = s < 0 ? lo(column(u + 0.5)) : hi(column(u + 0.5));
			const at = edge(u, s) + s * (by + more);
			return s < 0 ? Math.max(at, own - K.bankReach) : Math.min(at, own + K.bankReach);
		},
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
	const P = shape?.generator ?? G;
	const biomes = shape?.biomes;
	const riverLength = P.riverLength;
	const course = riverCourse(key, shape);
	const sandStart = sandStartOf(P);
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
	const waterfallColumns = waterfallColumnsOf(P, shape);
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
			const minH = Math.max(Hmin, capH - P.waterfallDrop);
			H = minH + Math.floor(wfRng() * (capH - minH + 1));
		} else H = Hmin + Math.floor(wfRng() * (Hmax - Hmin + 1));
		const { hi, span } = across(gx);
		for (let i = 0; i <= span; i++)
			obstacles.push({ x: gx, y: hi - i, z: 0, type: 'waterfall', height: H });
	}

	const brRng = seedRandom(`${key}_bridges`);
	const bridgeCandidates = [];
	for (let gx = P.bridgeFrom; gx < sandStart - P.bridgeSandGap; gx++) {
		if (waterfallColumns.some((w) => Math.abs(gx - w) < P.bridgeFallClearance)) continue;
		if (biomes && !biomeAt(biomes, gx).bridges) continue;
		bridgeCandidates.push(gx);
	}
	if (course.winding) {
		// A bridge crosses where the river runs near straight, not along a reach; where it runs
		// straight nowhere, anywhere.
		const straight = bridgeCandidates.filter(
			(gx) => across(gx).span <= 1.5 * (2 * riverHalfWidth(gx, P) + 1),
		);
		if (straight.length) bridgeCandidates.splice(0, bridgeCandidates.length, ...straight);
	}
	for (let i = bridgeCandidates.length - 1; i > 0; i--) {
		const j = Math.floor(brRng() * (i + 1));
		[bridgeCandidates[i], bridgeCandidates[j]] = [bridgeCandidates[j], bridgeCandidates[i]];
	}
	const bridgeCols = [];
	for (const gx of bridgeCandidates) {
		if (bridgeCols.length >= P.bridgeCount) break;
		if (bridgeCols.some((b) => Math.abs(b - gx) < P.bridgeSpacing)) continue;
		bridgeCols.push(gx);
	}
	bridgeCols.sort((a, b) => a - b);
	for (const gx of bridgeCols) {
		const { lo, hi } = across(gx);
		bridges.push({ gx, gyStart: lo, gyEnd: hi, height: P.bridgeHeight });
	}

	const nearWaterfall = (gx) =>
		waterfallColumns.some((w) => Math.abs(gx - w) <= P.waterfallClearance);
	const nearBridge = (gx) => bridgeCols.some((b) => Math.abs(gx - b) <= 1);
	for (let gx = P.obstacleFrom; gx < sandStart; gx++) {
		if (nearWaterfall(gx) || nearBridge(gx)) continue;
		const { chance, whirlpools } = pieceChances(P, biomes && biomeAt(biomes, gx));
		if (rng() < chance) {
			const { span, mid } = across(gx);
			const offset = Math.floor((rng() * 2 - 1) * (span / 2 - P.obstacleMargin));
			const type = rng() < whirlpools ? 'whirlpool' : 'rock';
			obstacles.push({ x: gx, y: mid + offset, z: 0, type });
		}
	}

	const sandEnd = riverLength - P.sandEndGap;
	const sbRng = seedRandom(`${key}_sandCA`);
	const validPos = new Set();
	for (let gx = sandStart; gx <= sandEnd; gx++) {
		const { lo, hi } = across(gx);
		for (let gy = lo + P.sandMargin; gy <= hi - P.sandMargin; gy++) validPos.add(`${gx},${gy}`);
	}
	let sandSet = new Set();
	for (const pos of validPos) {
		const gx = Number(pos.split(',')[0]);
		const seeded = biomes ? P.sandSeed * biomeAt(biomes, gx).sand : P.sandSeed;
		if (sbRng() < seeded) sandSet.add(pos);
	}
	for (let iter = 0; iter < P.sandPasses; iter++) {
		const next = new Set();
		for (const pos of validPos) {
			const [gx, gy] = pos.split(',').map(Number);
			let cnt = 0;
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++) {
					if ((dx || dy) && sandSet.has(`${gx + dx},${gy + dy}`)) cnt++;
				}
			if (sandSet.has(pos) ? cnt >= P.sandSurvive : cnt >= P.sandBirth) next.add(pos);
		}
		sandSet = next;
	}
	for (const pos of sandSet) {
		const [gx, gy] = pos.split(',').map(Number);
		obstacles.push({ x: gx, y: gy, z: 0, type: 'sandbank' });
	}
	return { obstacles, bridges };
}

/**
 * A column's chance of a rock or a whirlpool and, of those, the whirlpools' share: the generator's
 * own (`obstacleChance`, `whirlpoolShare`) where its biome keeps both densities at 1 (or there is
 * no biome), else each density times its own part of the generator's, at most 1 in all. The same
 * draws either way, so a biome moves only the columns it changes.
 */
function pieceChances(P, kind) {
	if (!kind || (kind.rocks === 1 && kind.whirlpools === 1))
		return { chance: P.obstacleChance, whirlpools: P.whirlpoolShare, wanted: P.obstacleChance };
	const rocks = P.obstacleChance * (1 - P.whirlpoolShare) * kind.rocks;
	const pools = P.obstacleChance * P.whirlpoolShare * kind.whirlpools;
	const both = rocks + pools;
	return { chance: Math.min(1, both), whirlpools: both > 0 ? pools / both : 0, wanted: both };
}

/**
 * What a level's biomes ask of it and it has no place for, told as overlay orphans are (`op:
 * 'biome'`): a stretch that asks for more rocks, whirlpools or sand than the generator's (a
 * density above 1) where the level places none of them (rocks and whirlpools only from
 * `obstacleFrom` to the sand, sand only in the delta), or for more than every column or cell (its
 * chance held at 1). Nothing is dropped: the stretch plays the density it can.
 */
export function biomeOrphans(shape) {
	const biomes = shape?.biomes;
	if (!biomes) return [];
	const P = shape.generator ?? G;
	const sandStart = sandStartOf(P);
	const sandEnd = P.riverLength - P.sandEndGap;
	const orphans = [];
	for (const { from, to, kind } of biomeStretches(biomes, 0, P.riverLength)) {
		const tell = (piece, reason) =>
			orphans.push({ op: 'biome', biome: kind.id, kind: piece, rows: [from, to - 1], reason });
		const pieces = from < sandStart && to > P.obstacleFrom;
		const sand = from <= sandEnd && to > sandStart;
		if (kind.rocks > 1 && !pieces) tell('rock', 'no-room');
		if (kind.whirlpools > 1 && !pieces) tell('whirlpool', 'no-room');
		if (pieceChances(P, kind).wanted > 1 && pieces)
			tell(kind.rocks >= kind.whirlpools ? 'rock' : 'whirlpool', 'capped');
		if (kind.sand > 1 && !sand) tell('sandbank', 'no-room');
		if (P.sandSeed * kind.sand > 1 && sand) tell('sandbank', 'capped');
	}
	return orphans;
}

/** The kinds an overlay can add: the original's obstacle types. */
export const OVERLAY_KINDS = Object.freeze(['rock', 'whirlpool', 'sandbank', 'waterfall']);

/** Whether grid cell (gx, gy) is in the river's water (the original's `isInWater`). */
export function inRiver(meander, gx, gy, P = G) {
	if (gx < 0 || gx >= P.riverLength) return false;
	return Math.abs(gy - Math.round(meanderAt(meander, Math.max(0, gx)))) <= riverHalfWidth(gx, P);
}

/** Whether grid cell (gx, gy) is in a course's water ({@link riverCourse}). */
export function inCourse(course, gx, gy) {
	if (!Number.isInteger(gx) || gx < 0 || gx >= course.rows) return false;
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

/** An overlay's entries in one form (a cell, then what is laid on it), its empty lists left out;
 *  `undefined` for one that lays nothing. */
function overlayRead(overlay) {
	const cell = ([gx, gy]) => [gx, gy];
	const add = (overlay?.add ?? []).map((a) => ({
		cell: cell(a.cell),
		kind: a.kind,
		...(a.height === undefined ? {} : { height: a.height }),
	}));
	const remove = (overlay?.remove ?? []).map(cell);
	const set = (overlay?.set ?? []).map((s) => ({ cell: cell(s.cell), height: s.height }));
	if (!add.length && !remove.length && !set.length) return undefined;
	return {
		...(add.length ? { add } : {}),
		...(remove.length ? { remove } : {}),
		...(set.length ? { set } : {}),
	};
}

/**
 * A config's `levels` as the level of `seed` reads them, in ONE form that is itself a config's
 * `levels`: the shape ({@link levelShape}) and, under `'*'`, the one overlay laid on that level
 * ({@link levelOverlay}); no pinned seeds, and no part that says nothing. Read again it is itself
 * and makes the same level, and two configs whose forms are equal as JSON make the same level of
 * `seed`. It is what a room tells its devices and a device plays in place of its own config's
 * (`onlineGenerators.js` `roomLevelGame`): `river`, `waterfalls`, `overlays`, each present only
 * when the config says something of it.
 */
export function seedLevels(levels, seed) {
	const shape = levelShape(levels, seed);
	const falls = shape?.waterfalls;
	const overlay = overlayRead(levelOverlay(levels, seed));
	return {
		...(shape?.river ? { river: shape.river } : {}),
		...(falls && Object.keys(falls).length ? { waterfalls: falls } : {}),
		...(overlay ? { overlays: { '*': overlay } } : {}),
		...(shape?.generator ? { generator: shape.generator } : {}),
		...(shape?.biomes ? { biomes: seedBiomes(shape.biomes) } : {}),
	};
}

/** A waterfall's thickness, px, straddling the top of its column (as `salmons.js`). */
const FALL_H = 40;
/** The original's catcher fallback when no try finds a place (`server/index.js`): column 200 (or
 *  the last, on a shorter river), `halfW + 5` off the axis. */
const CATCHER_FALLBACK = Object.freeze({ gx: 200, past: 5 });

/**
 * The original's catcher spawns (`server/index.js` `findCatcherSpawn`), drawn from the seed: each
 * place is its first of `catcherTries` tries at least `catcherApart` cells from the places before
 * it, `catcherEnds` columns clear of each end and `catcherPast` + up to `catcherSpread` cells past
 * the water's edge, else the list ends (the original's fallback when there is none). Grid cells.
 */
function catcherPlaces(key, course, P) {
	const rng = seedRandom(`${key}_catchers`);
	const places = [];
	while (places.length < P.catcherPlaces) {
		let found;
		for (let t = 0; t < P.catcherTries && !found; t++) {
			const gx = P.catcherEnds + rng() * (P.riverLength - 2 * P.catcherEnds);
			const side = rng() < 0.5 ? -1 : 1;
			const gy = course.past(gx, side, P.catcherPast, rng() * P.catcherSpread);
			if (places.every((p) => (p.gx - gx) ** 2 + (p.gy - gy) ** 2 >= P.catcherApart ** 2))
				found = { gx, gy };
		}
		if (!found) break;
		places.push(found);
	}
	if (!places.length) {
		const gx = Math.min(CATCHER_FALLBACK.gx, P.riverLength - 1);
		places.push({ gx, gy: course.edge(gx, 1) + CATCHER_FALLBACK.past });
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
	const P = shape?.generator ?? G;
	const course = riverCourse(key, shape);
	const applied = applySalmonsOverlay(generateSalmonsMap(key, shape), overlay, key, shape);
	const { map } = applied;
	const orphans = [...applied.orphans, ...biomeOrphans(shape)];
	const columns = [];
	for (let gx = 0; gx < P.riverLength; gx++)
		columns.push({ gx, lo: course.lo(gx), hi: course.hi(gx) });
	const gyMin = Math.min(...columns.map((c) => c.lo)) - P.bankCells;
	const gyMax = Math.max(...columns.map((c) => c.hi)) + P.bankCells;
	const xOf = (gy) => (gy - gyMin) * CELL;
	const yOf = (gx) => (gx + P.sourceRows) * CELL;
	const spawnGx = P.riverLength - P.salmonSpawnAbove;
	const world = {
		w: (gyMax - gyMin + 1) * CELL,
		h: (P.sourceRows + P.riverLength + P.seaRows) * CELL,
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
		r: P.whirlpoolRadius,
		spin: (o.x + o.y) % 2 ? 1 : -1,
	}));
	const rocks = byType('rock').map((o) => {
		const c = centreOf(o);
		const size = CELL * P.rockSize;
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
	const spawnCol = columns[spawnGx];
	const at = ({ gx, gy }) => ({
		x: Math.round(xOf(gy) + CELL / 2),
		y: Math.round(yOf(gx) + CELL / 2),
	});
	const botSpawns = catcherPlaces(key, course, P).map(at);
	const spread = Math.floor(P.salmonSpread * riverHalfWidth(spawnGx, P));
	const salmonSpawns = [];
	for (let k = -spread; k <= spread; k++)
		salmonSpawns.push(at({ gx: spawnGx, gy: course.axis(spawnGx) + k }));
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
		source: { x: top.left, y: 0, w: top.right - top.left, h: P.sourceRows * CELL },
		sea: { x: 0, y: yOf(P.riverLength), w: world.w, h: P.seaRows * CELL },
		spawn: { x: xOf(Math.round((spawnCol.lo + spawnCol.hi) / 2)) + CELL / 2, y: yOf(spawnGx) },
		salmonSpawns,
		botSpawns,
		bridges: map.bridges.map((b) => ({
			x: xOf(b.gyStart),
			y: yOf(b.gx),
			w: (b.gyEnd - b.gyStart + 1) * CELL,
			h: CELL,
			height: b.height,
		})),
		grid: { cell: CELL, gyMin, sourceRows: P.sourceRows },
		orphans,
		...(shape?.biomes ? { biomes: shape.biomes } : {}),
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
export function courseFacts(river, P = G) {
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
		narrowest = Math.min(narrowest, widthAt(i) / (2 * riverHalfWidth(i, P) + 1));
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
