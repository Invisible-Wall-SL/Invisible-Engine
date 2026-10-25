/**
 * Arcade motion (`docs/design/game-families.md` §4.2, P10.8): kinematic bodies on a flat play field.
 *
 * Plain, dependency-free ESM for the reason `board.js` is: the shared runtime steps it, and the
 * online game server (tier A4, `realtime-multiplayer.md` §6) and a device's own-player prediction
 * will step the very same file. No physics engine: a body has a position and a velocity, is held by
 * the field's edges, and reports what it touches. Nothing here pushes a body out of another (solid
 * response is tier A2).
 *
 * Units: positions in field pixels with (0, 0) the field's top-left, velocities in px/s, `dt` in
 * seconds. A body's `x` / `y` is its CENTRE; a static shape (a zone) is a top-left rectangle.
 *
 * Determinism: every function here is pure arithmetic in a fixed order over plain objects, and
 * {@link createFixedStep} steps at a fixed `dt` whatever the frame rate, so the same inputs at the same
 * steps replay to the same numbers. Pinned by `scripts/check-arcade-motion.mjs`.
 */

/** Simulation steps per second when a game names none. */
export const DEFAULT_FIXED_HZ = 60;

/** Above this many bodies, {@link overlaps} finds candidate pairs through a uniform grid. */
export const BROAD_PHASE_ABOVE = 64;

/** Steps one frame may run before the rest of its time is dropped (a hitch never spirals). */
export const MAX_STEPS_PER_FRAME = 5;

/** How a body meets the field's edges. */
export const BODY_EDGES = ['clamp', 'wrap', 'pass'];

/**
 * A fixed-timestep accumulator. `advance(frameMs, onStep)` adds a frame's time and runs `onStep`
 * once per whole step it holds, at most `maxSteps` a frame; a backlog past that is dropped.
 */
export function createFixedStep({ hz = DEFAULT_FIXED_HZ, maxSteps = MAX_STEPS_PER_FRAME } = {}) {
	if (!(Number.isFinite(hz) && hz > 0)) throw new Error(`motion: a fixed rate must be > 0 (${hz})`);
	const stepMs = 1000 / hz;
	let carried = 0;
	let total = 0;
	return {
		stepMs,
		dt: 1 / hz,
		get steps() {
			return total;
		},
		/** How far the next step is, 0..1: the share of a step already carried. */
		get alpha() {
			return carried / stepMs;
		},
		advance(frameMs, onStep) {
			if (Number.isFinite(frameMs) && frameMs > 0) carried += frameMs;
			let ran = 0;
			while (carried >= stepMs && ran < maxSteps) {
				carried -= stepMs;
				ran += 1;
				total += 1;
				onStep(total);
			}
			if (carried >= stepMs) carried %= stepMs;
			return ran;
		},
		reset() {
			carried = 0;
			total = 0;
		},
	};
}

const halfSize = (body) => {
	if (body.shape === 'circle') return { hw: body.r, hh: body.r };
	if (body.shape === 'box') return { hw: body.w / 2, hh: body.h / 2 };
	return { hw: 0, hh: 0 };
};

/** A body's bounding box: `{ x0, y0, x1, y1 }`. */
export function aabbOf(body) {
	const { hw, hh } = halfSize(body);
	return { x0: body.x - hw, y0: body.y - hh, x1: body.x + hw, y1: body.y + hh };
}

const clampAxis = (centre, half, size) =>
	half * 2 >= size ? size / 2 : Math.min(Math.max(centre, half), size - half);

const wrapAxis = (centre, size) => {
	if (centre < 0) return centre + size * Math.ceil(-centre / size);
	if (centre >= size) return centre - size * Math.floor(centre / size);
	return centre;
};

/**
 * Move one body by its velocity for `dt` seconds and hold it to the field: `clamp` (the default)
 * keeps it wholly inside, `wrap` carries its centre round to the far edge, `pass` lets it leave.
 * Mutates and returns the body. The single-body step a predicting client re-runs (§4.5).
 */
export function stepBody(body, dt, field) {
	body.x += (body.vx || 0) * dt;
	body.y += (body.vy || 0) * dt;
	if (!field) return body;
	const edges = body.edges ?? 'clamp';
	if (edges === 'clamp') {
		const { hw, hh } = halfSize(body);
		body.x = clampAxis(body.x, hw, field.w);
		body.y = clampAxis(body.y, hh, field.h);
	} else if (edges === 'wrap') {
		body.x = wrapAxis(body.x, field.w);
		body.y = wrapAxis(body.y, field.h);
	}
	return body;
}

/** {@link stepBody} every body, in order. */
export function step(bodies, dt, field) {
	for (const body of bodies) stepBody(body, dt, field);
	return bodies;
}

/** The edge a body has wholly crossed (`left`, `right`, `top`, `bottom`), or `undefined` while any
 *  part of it is on the field. Left and right are tested before top and bottom. */
export function outsideEdge(body, field) {
	const box = aabbOf(body);
	if (box.x1 < 0) return 'left';
	if (box.x0 > field.w) return 'right';
	if (box.y1 < 0) return 'top';
	if (box.y0 > field.h) return 'bottom';
	return undefined;
}

const boxesTouch = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

const circleTouchesBox = (cx, cy, r, box) => {
	const nx = Math.min(Math.max(cx, box.x0), box.x1);
	const ny = Math.min(Math.max(cy, box.y0), box.y1);
	const dx = cx - nx;
	const dy = cy - ny;
	return dx * dx + dy * dy <= r * r;
};

/** Whether two bodies touch (edges meeting count). A body with no shape is a point. */
export function touching(a, b) {
	if (a.shape === 'circle' && b.shape === 'circle') {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		const r = a.r + b.r;
		return dx * dx + dy * dy <= r * r;
	}
	if (a.shape === 'circle') return circleTouchesBox(a.x, a.y, a.r, aabbOf(b));
	if (b.shape === 'circle') return circleTouchesBox(b.x, b.y, b.r, aabbOf(a));
	return boxesTouch(aabbOf(a), aabbOf(b));
}

const hasTag = (body, tag) => Array.isArray(body.tags) && body.tags.includes(tag);

/** Candidate pairs `[i, j]` (i < j), ascending: every pair, or those sharing a grid cell. */
function candidatePairs(bodies, useGrid, cellSize) {
	const pairs = [];
	if (!useGrid) {
		for (let i = 0; i < bodies.length; i++)
			for (let j = i + 1; j < bodies.length; j++) pairs.push([i, j]);
		return pairs;
	}
	const cells = new Map();
	const seen = new Set();
	const n = bodies.length;
	for (let i = 0; i < n; i++) {
		const box = aabbOf(bodies[i]);
		const cx0 = Math.floor(box.x0 / cellSize);
		const cx1 = Math.floor(box.x1 / cellSize);
		const cy0 = Math.floor(box.y0 / cellSize);
		const cy1 = Math.floor(box.y1 / cellSize);
		for (let cx = cx0; cx <= cx1; cx++) {
			for (let cy = cy0; cy <= cy1; cy++) {
				const key = `${cx},${cy}`;
				const members = cells.get(key);
				if (!members) {
					cells.set(key, [i]);
					continue;
				}
				for (const j of members) {
					const id = j * n + i;
					if (seen.has(id)) continue;
					seen.add(id);
					pairs.push([j, i]);
				}
				members.push(i);
			}
		}
	}
	return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

const gridCellFor = (bodies) => {
	let largest = 0;
	for (const body of bodies) {
		const { hw, hh } = halfSize(body);
		largest = Math.max(largest, hw * 2, hh * 2);
	}
	return Math.max(32, largest * 2);
};

/**
 * Every touching pair the tag pairs ask about, as `{ a, b, tagA, tagB }` with `a` the body carrying
 * `tagA`. `pairs` is `[tagA, tagB][]`; a pair of one tag (`['enemy', 'enemy']`) reports each touching
 * couple once. Ordered by the tag pair, then by the bodies' order. Above
 * `options.broadPhaseAbove` bodies (default {@link BROAD_PHASE_ABOVE}) the candidates come from a
 * uniform grid of `options.cellSize` px (default twice the largest body); the result is the same.
 */
export function overlaps(bodies, pairs, options = {}) {
	const above = options.broadPhaseAbove ?? BROAD_PHASE_ABOVE;
	const useGrid = bodies.length > above;
	const candidates = candidatePairs(bodies, useGrid, options.cellSize ?? gridCellFor(bodies));
	const hits = [];
	for (const [tagA, tagB] of pairs) {
		for (const [i, j] of candidates) {
			const p = bodies[i];
			const q = bodies[j];
			let a;
			let b;
			if (hasTag(p, tagA) && hasTag(q, tagB)) {
				a = p;
				b = q;
			} else if (hasTag(q, tagA) && hasTag(p, tagB)) {
				a = q;
				b = p;
			} else continue;
			if (touching(a, b)) hits.push({ a, b, tagA, tagB });
		}
	}
	return hits;
}

const rectOf = (shape) => ({
	x0: shape.x,
	y0: shape.y,
	x1: shape.x + shape.w,
	y1: shape.y + shape.h,
});

/** Whether a body touches a static rectangle `{ x, y, w, h }` (top-left). */
export function inZone(body, zone) {
	const rect = rectOf(zone);
	if (body.shape === 'circle') return circleTouchesBox(body.x, body.y, body.r, rect);
	return boxesTouch(aabbOf(body), rect);
}

/**
 * Index a level's static shapes (`{ id, x, y, w, h }`, top-left) once, in a uniform grid of
 * `cellSize` px, so a body tests only the shapes in the cells it covers rather than every shape on
 * the level.
 */
export function createStaticIndex(shapes, cellSize = 128) {
	if (!(cellSize > 0)) throw new Error(`motion: a grid cell must be > 0 (${cellSize})`);
	const cells = new Map();
	shapes.forEach((shape, order) => {
		const rect = rectOf(shape);
		for (let cx = Math.floor(rect.x0 / cellSize); cx <= Math.floor(rect.x1 / cellSize); cx++) {
			for (let cy = Math.floor(rect.y0 / cellSize); cy <= Math.floor(rect.y1 / cellSize); cy++) {
				const key = `${cx},${cy}`;
				const members = cells.get(key);
				if (members) members.push(order);
				else cells.set(key, [order]);
			}
		}
	});
	return { shapes: [...shapes], cellSize, cells };
}

/** The indexed shapes a box `{ x0, y0, x1, y1 }` touches, in their index order. */
export function queryStatic(index, box) {
	const found = new Set();
	const { cellSize } = index;
	for (let cx = Math.floor(box.x0 / cellSize); cx <= Math.floor(box.x1 / cellSize); cx++) {
		for (let cy = Math.floor(box.y0 / cellSize); cy <= Math.floor(box.y1 / cellSize); cy++) {
			for (const order of index.cells.get(`${cx},${cy}`) ?? []) found.add(order);
		}
	}
	return [...found]
		.sort((a, b) => a - b)
		.map((order) => index.shapes[order])
		.filter((shape) => boxesTouch(rectOf(shape), box));
}

/** {@link queryStatic} without the index: every shape, tested in turn. */
export function scanStatic(shapes, box) {
	return shapes.filter((shape) => boxesTouch(rectOf(shape), box));
}

/** The ids of the indexed zones a body is in, in index order. */
export function zonesOf(body, index) {
	return queryStatic(index, aabbOf(body))
		.filter((zone) => inZone(body, zone))
		.map((zone) => zone.id);
}
