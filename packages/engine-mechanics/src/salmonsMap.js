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
 * The original's `generateMap(seed)`: `obstacles` (`{ x: gx, y: gy, z: 0, type, height? }`, type
 * `waterfall` | `rock` | `whirlpool` | `sandbank`) and `bridges` (`{ gx, gyStart, gyEnd, height }`),
 * in the original's order. A number seed is used as its decimal string.
 */
export function generateSalmonsMap(seed) {
	const key = String(seed);
	const rng = seedRandom(key);
	const obstacles = [];
	const bridges = [];
	const riverLength = C.RIVER_LENGTH;
	const meander = buildMeanderTable(key);
	const sandStart = Math.floor(riverLength * 0.7);
	const centreAt = (gx) => Math.round(meanderAt(meander, gx));

	const wfRng = seedRandom(`${key}_waterfallH`);
	const Hmin = C.WATERFALL_HEIGHT_MIN;
	const Hmax = C.WATERFALL_HEIGHT_MAX;
	const waterfallColumns = [];
	for (let gx = 21; gx < sandStart; gx++) if (gx % 40 === 0) waterfallColumns.push(gx);
	const minWfGx = waterfallColumns[0] ?? 0;
	const maxWfGx = waterfallColumns[waterfallColumns.length - 1] ?? 0;
	const wfGxRange = Math.max(1, maxWfGx - minWfGx);
	for (const gx of waterfallColumns) {
		const t = (gx - minWfGx) / wfGxRange;
		const capH = Math.max(Hmin, Math.round(Hmax - (Hmax - Hmin) * t));
		const minH = Math.max(Hmin, capH - 4);
		const H = minH + Math.floor(wfRng() * (capH - minH + 1));
		const halfW = riverHalfWidth(gx);
		const gyCenter = centreAt(gx);
		for (let i = 0; i <= 2 * halfW; i++)
			obstacles.push({ x: gx, y: gyCenter + halfW - i, z: 0, type: 'waterfall', height: H });
	}

	const brRng = seedRandom(`${key}_bridges`);
	const bridgeCandidates = [];
	for (let gx = 25; gx < sandStart - 5; gx++) {
		if (waterfallColumns.some((w) => Math.abs(gx - w) < C.BRIDGE_WATERFALL_CLEARANCE)) continue;
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
		const halfW = riverHalfWidth(gx);
		const gyCenter = centreAt(gx);
		bridges.push({
			gx,
			gyStart: gyCenter - halfW,
			gyEnd: gyCenter + halfW,
			height: C.BRIDGE_HEIGHT,
		});
	}

	const nearWaterfall = (gx) =>
		waterfallColumns.some((w) => Math.abs(gx - w) <= C.WATERFALL_CLEARANCE);
	const nearBridge = (gx) => bridgeCols.some((b) => Math.abs(gx - b) <= 1);
	for (let gx = 20; gx < sandStart; gx++) {
		if (nearWaterfall(gx) || nearBridge(gx)) continue;
		if (rng() < 0.3) {
			const halfW = riverHalfWidth(gx);
			const offset = Math.floor((rng() * 2 - 1) * (halfW - 2));
			const type = rng() < 0.2 ? 'whirlpool' : 'rock';
			obstacles.push({ x: gx, y: centreAt(gx) + offset, z: 0, type });
		}
	}

	const sandEnd = riverLength - 10;
	const sbRng = seedRandom(`${key}_sandCA`);
	const validPos = new Set();
	for (let gx = sandStart; gx <= sandEnd; gx++) {
		const halfW = riverHalfWidth(gx);
		const gyCenter = centreAt(gx);
		for (let gy = gyCenter - halfW + 2; gy <= gyCenter + halfW - 2; gy++)
			validPos.add(`${gx},${gy}`);
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

/**
 * `map` with an authored overlay on top: `remove` first (every piece on each named cell), then `set`
 * (a waterfall cell's `height`), then `add` (a piece on a cell of the water). A cell the base no
 * longer has (nothing there to remove or re-height, or an addition outside this seed's water) is
 * not applied and comes back in `orphans`, so a reseed never drops an authored piece silently. The
 * overlay itself is never changed.
 */
export function applySalmonsOverlay(map, overlay, seed) {
	const orphans = [];
	if (!overlay) return { map, orphans };
	const meander = buildMeanderTable(String(seed));
	const at = (o) => `${o.x},${o.y}`;
	const removed = new Set((overlay.remove ?? []).map(([gx, gy]) => `${gx},${gy}`));
	const present = new Set(map.obstacles.map(at));
	for (const [gx, gy] of overlay.remove ?? [])
		if (!present.has(`${gx},${gy}`)) orphans.push({ op: 'remove', cell: [gx, gy] });
	let obstacles = map.obstacles.filter((o) => !removed.has(at(o)));
	for (const s of overlay.set ?? []) {
		const [gx, gy] = s.cell;
		const hit = obstacles.some((o) => o.x === gx && o.y === gy && o.type === 'waterfall');
		if (!hit) {
			orphans.push({ op: 'set', cell: [gx, gy] });
			continue;
		}
		obstacles = obstacles.map((o) =>
			o.x === gx && o.y === gy && o.type === 'waterfall' ? { ...o, height: s.height } : o,
		);
	}
	for (const a of overlay.add ?? []) {
		const [gx, gy] = a.cell;
		if (!OVERLAY_KINDS.includes(a.kind) || !inRiver(meander, gx, gy)) {
			orphans.push({ op: 'add', cell: [gx, gy], kind: a.kind });
			continue;
		}
		const piece = { x: gx, y: gy, z: 0, type: a.kind };
		if (a.kind === 'waterfall') piece.height = a.height ?? C.WATERFALL_HEIGHT_MIN;
		obstacles = obstacles.filter((o) => !(o.x === gx && o.y === gy)).concat(piece);
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
/** How many places on the banks the bots and land characters start from. */
const BANK_SPAWNS = 16;

/**
 * The river a seed's level makes, in the engine's shape (`salmons.js` `SalmonsRiver`): the
 * original's map with the overlay on top, one grid cell = {@link CELL} px, the source at the top
 * and the sea at the bottom. Each run of columns of one width is a band (a waterfall column always
 * starts one, so its face sits on a band's top as the drawing expects); rocks are 1.5 cells, sand
 * islands one rect per run of cells across a column. Also `generator`, `grid` (the cell ↔ world
 * transform, for `/editor`), `bridges` and `orphans`.
 */
export function salmonsMapRiver(seed = SALMONS_MAP_SEED, overlay) {
	const key = String(seed);
	const meander = buildMeanderTable(key);
	const { map, orphans } = applySalmonsOverlay(generateSalmonsMap(key), overlay, key);
	const columns = [];
	for (let gx = 0; gx < C.RIVER_LENGTH; gx++) {
		const centre = Math.round(meanderAt(meander, gx));
		const halfW = riverHalfWidth(gx);
		columns.push({ gx, lo: centre - halfW, hi: centre + halfW });
	}
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
	const botSpawns = [];
	for (let i = 0; i < BANK_SPAWNS; i++) {
		const gx = Math.round(30 + ((C.RIVER_LENGTH - 60) * (i + 0.5)) / BANK_SPAWNS);
		const col = columns[gx];
		botSpawns.push({
			x: i % 2 ? xOf(col.hi + 6) : xOf(col.lo - 6),
			y: yOf(gx) + CELL / 2,
		});
	}
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
