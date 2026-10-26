/**
 * Arcade motion (`docs/design/game-families.md` §4.2, P10.8): kinematic bodies on a flat play field.
 *
 * Plain, dependency-free ESM for the reason `board.js` is: the shared runtime steps it, and the
 * online game server (tier A4, `realtime-multiplayer.md` §6) and a device's own-player prediction
 * will step the very same file. No physics engine: a body has a position and a velocity, is held by
 * the field's edges, and reports what it touches. Tier A2 (P10.11) adds steering ({@link steer}), the
 * solid response ({@link stepSolid}) and sampled paths; P10.8's functions are unchanged by them.
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
	return holdToField(body, field);
}

function holdToField(body, field) {
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

const DEG = Math.PI / 180;

const rateOf = (value) => (Number.isFinite(value) && value >= 0 ? value : undefined);

/**
 * Turn a body's velocity towards `desired` (px/s) under its movement settings, for `dt` seconds.
 * `turnRate` (deg/s) first limits the heading change while both the velocity and the desired one are
 * non-zero; the velocity then moves towards that target, as a vector, by at most `accel` · dt when
 * the target is faster than the body and `decel` · dt otherwise (a reversal or a turn at the same
 * speed brakes); `decel` absent ⇒ `accel`, both absent ⇒ at once. `maxSpeed` caps |v| last.
 * Mutates and returns the body.
 */
export function steer(body, desired, movement, dt) {
	const vx = body.vx || 0;
	const vy = body.vy || 0;
	let tx = desired.vx || 0;
	let ty = desired.vy || 0;
	const speed = Math.hypot(vx, vy);
	const want = Math.hypot(tx, ty);
	const turnRate = rateOf(movement?.turnRate);
	if (turnRate !== undefined && speed > 0 && want > 0) {
		const from = Math.atan2(vy, vx);
		let turn = Math.atan2(ty, tx) - from;
		if (turn > Math.PI) turn -= 2 * Math.PI;
		else if (turn <= -Math.PI) turn += 2 * Math.PI;
		const limit = turnRate * DEG * dt;
		if (Math.abs(turn) > limit) {
			const heading = from + Math.sign(turn) * limit;
			tx = Math.cos(heading) * want;
			ty = Math.sin(heading) * want;
		}
	}
	const accel = rateOf(movement?.accel);
	const decel = rateOf(movement?.decel) ?? accel;
	const rate = want > speed ? accel : decel;
	if (rate === undefined) {
		body.vx = tx;
		body.vy = ty;
	} else {
		const dx = tx - vx;
		const dy = ty - vy;
		const gap = Math.hypot(dx, dy);
		const most = rate * dt;
		if (gap <= most) {
			body.vx = tx;
			body.vy = ty;
		} else {
			body.vx = vx + (dx / gap) * most;
			body.vy = vy + (dy / gap) * most;
		}
	}
	const maxSpeed = rateOf(movement?.maxSpeed);
	if (maxSpeed !== undefined) {
		const now = Math.hypot(body.vx, body.vy);
		if (now > maxSpeed) {
			body.vx = (body.vx / now) * maxSpeed;
			body.vy = (body.vy / now) * maxSpeed;
		}
	}
	return body;
}

/** Overlap deeper than this (px) is a penetration; a body resting against a solid is not in it. */
const SOLID_EPSILON = 1e-6;

const penetrates = (a, b) =>
	a.x0 + SOLID_EPSILON < b.x1 &&
	b.x0 + SOLID_EPSILON < a.x1 &&
	a.y0 + SOLID_EPSILON < b.y1 &&
	b.y0 + SOLID_EPSILON < a.y1;

/** The solids a body already penetrates. */
const inside = (body, blockers) =>
	new Set(blockers.filter((solid) => penetrates(aabbOf(body), aabbOf(solid))));

/**
 * Push a body that moved along one axis back out of every solid it entered, against its motion.
 * `already` are the solids it penetrated before that move: it did not enter those, so they are
 * left to the shallow-axis settle (pushing it against its motion would throw it across them).
 */
function pushBack(body, blockers, axis, dir, already) {
	const half = axis === 'x' ? halfSize(body).hw : halfSize(body).hh;
	const lo = axis === 'x' ? 'x0' : 'y0';
	const hi = axis === 'x' ? 'x1' : 'y1';
	let hit = false;
	for (let pass = 0; pass <= blockers.length; pass++) {
		let pushed = false;
		for (const solid of blockers) {
			if (already.has(solid)) continue;
			const box = aabbOf(solid);
			if (!penetrates(aabbOf(body), box)) continue;
			body[axis] = dir > 0 ? box[lo] - half : box[hi] + half;
			pushed = true;
		}
		if (!pushed) break;
		hit = true;
	}
	return hit;
}

/**
 * Move one body by its velocity for `dt` seconds, stopping at solids: x first (pushed back out of
 * every solid it entered, `vx` zeroed), then y the same way, so a body driven diagonally into a
 * wall keeps sliding along it. An overlap it did not move into (a moving solid, a spawn inside one)
 * is never pushed against its motion: it is settled afterwards along the shallower axis. Then the
 * field's edges, as {@link stepBody}. Only bodies with `solid: true` block, never the body itself;
 * every shape is resolved by its box (a circle is pushed as its bounding square). A step shorter
 * than the body never passes through a solid.
 */
export function stepSolid(body, dt, solids, field) {
	const blockers = solids.filter((solid) => solid !== body && solid.solid === true);
	const dx = (body.vx || 0) * dt;
	const dy = (body.vy || 0) * dt;
	let hitX = false;
	let hitY = false;
	const beforeX = dx !== 0 ? inside(body, blockers) : undefined;
	body.x += dx;
	if (beforeX && pushBack(body, blockers, 'x', dx, beforeX)) {
		hitX = true;
		body.vx = 0;
	}
	const beforeY = dy !== 0 ? inside(body, blockers) : undefined;
	body.y += dy;
	if (beforeY && pushBack(body, blockers, 'y', dy, beforeY)) {
		hitY = true;
		body.vy = 0;
	}
	for (const solid of blockers) {
		const a = aabbOf(body);
		const b = aabbOf(solid);
		if (!penetrates(a, b)) continue;
		const left = a.x1 - b.x0;
		const right = b.x1 - a.x0;
		const up = a.y1 - b.y0;
		const down = b.y1 - a.y0;
		if (Math.min(left, right) <= Math.min(up, down)) {
			const dir = left <= right ? -1 : 1;
			body.x += dir < 0 ? -left : right;
			if ((body.vx || 0) * dir < 0) body.vx = 0;
			hitX = true;
		} else {
			const dir = up <= down ? -1 : 1;
			body.y += dir < 0 ? -up : down;
			if ((body.vy || 0) * dir < 0) body.vy = 0;
			hitY = true;
		}
	}
	holdToField(body, field);
	return { hitX, hitY };
}

/** Samples per authored segment of a smoothed path. */
export const PATH_SUBDIVISIONS = 12;

const catmullRom = (p0, p1, p2, p3, t) => {
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 *
		(2 * p1 +
			(p2 - p0) * t +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
			(3 * p1 - p0 - 3 * p2 + p3) * t3)
	);
};

/**
 * A path ready to walk: `{ points, closed, length, cum }`, `cum[i]` the arc distance at
 * `points[i]` and `length` the whole way round (the closing segment included when closed).
 * `smoothing` 0..1 blends each segment from the straight line (0, the polyline as drawn) to a
 * uniform Catmull-Rom curve through the points (1), sampled {@link PATH_SUBDIVISIONS} times a segment.
 */
export function samplePath({ points, closed = false, smoothing = 0 }) {
	if (!points.length) throw new Error('motion: a path needs at least one point');
	const src = points.map((p) => ({ x: p.x, y: p.y }));
	const n = src.length;
	const amount = Number.isFinite(smoothing) ? Math.min(Math.max(smoothing, 0), 1) : 0;
	let out = src;
	if (amount > 0 && n > 1) {
		out = [];
		const at = (i) => (closed ? src[(i + n) % n] : src[Math.min(Math.max(i, 0), n - 1)]);
		const segments = closed ? n : n - 1;
		for (let i = 0; i < segments; i++) {
			const p0 = at(i - 1);
			const p1 = at(i);
			const p2 = at(i + 1);
			const p3 = at(i + 2);
			for (let k = 0; k < PATH_SUBDIVISIONS; k++) {
				const t = k / PATH_SUBDIVISIONS;
				const lx = p1.x + (p2.x - p1.x) * t;
				const ly = p1.y + (p2.y - p1.y) * t;
				out.push({
					x: lx + (catmullRom(p0.x, p1.x, p2.x, p3.x, t) - lx) * amount,
					y: ly + (catmullRom(p0.y, p1.y, p2.y, p3.y, t) - ly) * amount,
				});
			}
		}
		if (!closed) out.push({ ...src[n - 1] });
	}
	const cum = [0];
	for (let i = 1; i < out.length; i++)
		cum.push(cum[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
	const last = out[out.length - 1];
	const length =
		closed && out.length > 1
			? cum[out.length - 1] + Math.hypot(out[0].x - last.x, out[0].y - last.y)
			: cum[out.length - 1];
	return { points: out, closed: Boolean(closed), length, cum };
}

/** The point `distance` px along a sampled path: wrapped round a closed path, clamped to an open one. */
export function pointAt(path, distance) {
	const { points, cum, length } = path;
	const n = points.length;
	if (n === 1 || !(length > 0)) return { x: points[0].x, y: points[0].y };
	let d = Number.isFinite(distance) ? distance : 0;
	if (path.closed) d = ((d % length) + length) % length;
	else d = Math.min(Math.max(d, 0), length);
	let lo = 0;
	let hi = n - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (cum[mid] <= d) lo = mid;
		else hi = mid - 1;
	}
	if (lo === n - 1 && !path.closed) return { x: points[lo].x, y: points[lo].y };
	const a = points[lo];
	const b = points[(lo + 1) % n];
	const end = lo === n - 1 ? length : cum[lo + 1];
	const span = end - cum[lo];
	const t = span > 0 ? (d - cum[lo]) / span : 0;
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The arc distance of a sampled path's point nearest (x, y); the first such on a tie. */
export function nearestDistance(path, x, y) {
	const { points, cum, length } = path;
	const n = points.length;
	const segments = path.closed ? n : n - 1;
	let best = 0;
	let bestSq = (points[0].x - x) ** 2 + (points[0].y - y) ** 2;
	for (let i = 0; i < segments; i++) {
		const a = points[i];
		const b = points[(i + 1) % n];
		const ex = b.x - a.x;
		const ey = b.y - a.y;
		const lenSq = ex * ex + ey * ey;
		const t = lenSq > 0 ? Math.min(Math.max(((x - a.x) * ex + (y - a.y) * ey) / lenSq, 0), 1) : 0;
		const px = a.x + ex * t;
		const py = a.y + ey * t;
		const distSq = (px - x) ** 2 + (py - y) ** 2;
		if (distSq < bestSq) {
			bestSq = distSq;
			const end = i === n - 1 ? length : cum[i + 1];
			best = cum[i] + (end - cum[i]) * t;
		}
	}
	return path.closed && best >= length ? 0 : best;
}
