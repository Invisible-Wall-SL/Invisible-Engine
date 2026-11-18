/**
 * Arcade 3D motion (`docs/design/3d-games.md`, `docs/design/3d/gameplay-evaluation.md` §2): a
 * kinematic body on a level of axis-aligned boxes and ramp wedges, y up, in metres.
 *
 * Plain, dependency-free ESM for the reason `motion.js` is: the room on `services/game-server` and
 * a device's own-player prediction step this very file, and the room's step must equal the
 * device's bit for bit. Nothing here touches the 2D modules; a 3D game reaches it only on its own
 * path, so the committed 2D replays cannot move.
 *
 * Determinism across engines (V8 in Node and Chrome, JavaScriptCore on iOS): the step uses only
 * operations IEEE 754 rounds exactly — `+ − × ÷`, `Math.sqrt`, comparisons, `Math.floor` /
 * `Math.ceil` / `Math.min` / `Math.max` / `Math.abs` — never `Math.sin/cos/atan2/hypot/pow/exp`,
 * whose results are implementation-defined. The device turns its camera into a world-space move
 * direction and quantises it to int8 before the step; yaw travels as a uint16 that is only copied.
 * Pinned by `scripts/check-arcade-3d.mjs`, which also greps this file for those functions.
 *
 * The body is its upright bounding box against the level: `radius` out from the centre on x and z,
 * `height` up from the feet. `x` / `z` is the centre on the plane and `y` the feet. A sub-step
 * moves x, then z, then y. A horizontal move walks up a ramp no steeper than `maxSlope` (rise over
 * run) along its slope, jumping or not; it steps up a ledge — a box, or a walkable ramp's lip above
 * its slope — out of a budget of `stepUp` a STEP, however many sub-steps the step takes; and a
 * steeper ramp is a wall. A grounded body that walks off a surface sticks to one up to `snapDown`
 * below it.
 */

/** Steps per second the 3D sim is pinned at. */
export const MOTION3D_HZ = 60;

/** Sub-steps one step may take: a fall at `maxFall` crosses no slab thinner than `subMove`. */
export const MAX_SUB_STEPS_3D = 64;

/** An int8 move axis spans −127..127 (−128 reads as −127). */
export const MOVE_SCALE = 127;

/** A uint16 yaw: 65536 units to the turn. */
export const YAW_UNITS = 65536;

/** Input button bits. */
export const BUTTON_JUMP = 1;
export const BUTTON_SPRINT = 2;

/** The smallest column a level is bucketed into, m: a finer grid only makes every query wider. */
export const MIN_CELL_SIZE_3D = 0.25;

/** Collider-in-column entries a level may hold; a larger one is refused before it is built. */
export const MAX_LEVEL_CELLS_3D = 1 << 18;

/** Colliders a level may have. */
export const MAX_COLLIDERS_3D = 20000;

/** Zones a level may have: every body scans them all on every step. */
export const MAX_ZONES_3D = 256;

/** Colliders one column may hold: a step looks at every collider of the columns it sweeps. */
export const MAX_CELL_COLLIDERS_3D = 64;

/**
 * How far from the origin, m, any place of a level may be, and past which on the plane a body has
 * fallen: the wire carries float32, whose step stays under a device's 1 mm match out to 2^14 m.
 */
export const MAX_COORD_3D = 16384;

/** The longest step a room takes, s: its slowest tick rate is 10 Hz. */
export const MAX_STEP_DT_3D = 0.1;

/** Columns one step's swept footprint (`2 * radius` plus a step at full sprint) may be wide. */
export const MAX_SWEEP_CELLS_3D = 2;

/** The margin, m, a step's one query adds around its swept footprint for rounding. */
const SWEEP_PAD = 1e-3;

/**
 * `[min, max]` of every motion value a config may set: past them a step does unbounded work or a
 * body never comes back to the level. `maxFall` is above 0, so a body off the level always falls.
 */
export const MOTION3D_LIMITS = Object.freeze({
	radius: [0.01, 5],
	height: [0.01, 20],
	speed: [0.01, 50],
	sprint: [0.01, 4],
	groundAccel: [0, 1000],
	airAccel: [0, 1000],
	gravity: [-100, -0.01],
	maxFall: [1, 100],
	jumpHeight: [0, 50],
	doubleJumpHeight: [0, 50],
	apexWindow: [0, 100],
	coyoteSteps: [0, 600],
	bufferSteps: [0, 600],
	stepUp: [0, 5],
	snapDown: [0, 5],
	subMove: [0.01, 1],
	maxSlope: [0, 20],
});

/** The tallest trampoline, m. */
export const MAX_TRAMPOLINE_M = 100;

/** Whether a body of `spec` sweeps at most {@link MAX_SWEEP_CELLS_3D} columns of `cellSize` in a
 *  step of {@link MAX_STEP_DT_3D}: what bounds one step's work. */
export const sweepFits3d = (spec, cellSize) =>
	2 * spec.radius + spec.speed * spec.sprint * MAX_STEP_DT_3D + 2 * SWEEP_PAD <=
	MAX_SWEEP_CELLS_3D * cellSize;

/** The direction a ramp's surface rises toward. */
export const RAMP_FACINGS = ['+x', '-x', '+z', '-z'];

/**
 * BOTY's numbers (gameplay evaluation §1): gravity −9.81, jump 1.5 m, double jump while |vy| < 5;
 * the steepest ramp walked is 45° (`maxSlope` 1; CrashArena's are 0.7).
 */
export const MOTION3D_DEFAULTS = Object.freeze({
	radius: 0.4,
	height: 1.8,
	speed: 5,
	sprint: 1.6,
	groundAccel: 60,
	airAccel: 15,
	gravity: -9.81,
	maxFall: 30,
	jumpHeight: 1.5,
	doubleJumpHeight: 1.5,
	apexWindow: 5,
	coyoteSteps: 6,
	bufferSteps: 6,
	stepUp: 0.35,
	snapDown: 0.35,
	subMove: 0.1,
	maxSlope: 1,
});

/**
 * A level from its colliders and zones. A collider is `{ kind: 'box' | 'ramp', minX, minY, minZ,
 * maxX, maxY, maxZ, facing? }`; a ramp's surface rises from `minY` on its low edge to `maxY` on the
 * edge `facing` names. A zone is `{ kind, minX, minY, minZ, maxX, maxY, maxZ, height? }`; a
 * `trampoline` launches a body standing in it to `height` m (one without a height above 0 does
 * not launch). Colliders are bucketed into square `cellSize` columns on the plane; `killY` is the
 * death plane. A level past {@link MAX_COLLIDERS_3D}, {@link MAX_ZONES_3D} or
 * {@link MAX_LEVEL_CELLS_3D} column entries, with a `cellSize` under {@link MIN_CELL_SIZE_3D} or a
 * place past {@link MAX_COORD_3D}, is refused before anything is bucketed; one with more than
 * {@link MAX_CELL_COLLIDERS_3D} colliders in a column, once bucketed.
 */
export function createLevel3d({ colliders = [], zones = [], cellSize = 4, killY = -50 } = {}) {
	if (!(cellSize >= MIN_CELL_SIZE_3D && cellSize < Infinity))
		throw new Error(`motion3d: cellSize must be at least ${MIN_CELL_SIZE_3D} (${cellSize})`);
	if (colliders.length > MAX_COLLIDERS_3D)
		throw new Error(`motion3d: more than ${MAX_COLLIDERS_3D} colliders (${colliders.length})`);
	if (zones.length > MAX_ZONES_3D)
		throw new Error(`motion3d: more than ${MAX_ZONES_3D} zones (${zones.length})`);
	if (!within(killY)) throw new Error(`motion3d: killY past ${MAX_COORD_3D} m (${killY})`);
	colliders.forEach((c, id) => {
		if (!boxWithin(c)) throw new Error(`motion3d: collider ${id} lies past ${MAX_COORD_3D} m`);
	});
	zones.forEach((z, id) => {
		if (!boxWithin(z)) throw new Error(`motion3d: zone ${id} lies past ${MAX_COORD_3D} m`);
	});
	const list = colliders.map((c, id) => {
		if (!(c.maxX > c.minX && c.maxY > c.minY && c.maxZ > c.minZ))
			throw new Error(`motion3d: collider ${id} has no volume`);
		const rise = c.kind === 'ramp' ? RAMP_FACINGS.indexOf(c.facing) : -1;
		if (c.kind === 'ramp' && rise < 0)
			throw new Error(`motion3d: ramp ${id} needs a facing (${RAMP_FACINGS.join(' ')})`);
		if (c.kind !== 'ramp' && c.kind !== 'box')
			throw new Error(`motion3d: collider ${id} is neither box nor ramp`);
		const run = rise < 2 ? c.maxX - c.minX : c.maxZ - c.minZ;
		return {
			id,
			kind: c.kind,
			minX: c.minX,
			minY: c.minY,
			minZ: c.minZ,
			maxX: c.maxX,
			maxY: c.maxY,
			maxZ: c.maxZ,
			rise,
			slope: rise < 0 ? 0 : (c.maxY - c.minY) / run,
		};
	});
	const spans = list.map((c) => [
		Math.floor(c.minX / cellSize),
		Math.floor(c.maxX / cellSize),
		Math.floor(c.minZ / cellSize),
		Math.floor(c.maxZ / cellSize),
	]);
	let entries = 0;
	spans.forEach(([x0, x1, z0, z1], id) => {
		entries += (x1 - x0 + 1) * (z1 - z0 + 1);
		if (!(entries <= MAX_LEVEL_CELLS_3D))
			throw new Error(
				`motion3d: collider ${id} takes the level past ${MAX_LEVEL_CELLS_3D} cells of ${cellSize} m`,
			);
	});
	const cells = new Map();
	for (const c of list) {
		const [x0, x1, z0, z1] = spans[c.id];
		for (let cx = x0; cx <= x1; cx++)
			for (let cz = z0; cz <= z1; cz++) {
				const key = `${cx},${cz}`;
				const bucket = cells.get(key);
				if (!bucket) cells.set(key, [c.id]);
				else if (bucket.push(c.id) > MAX_CELL_COLLIDERS_3D)
					throw new Error(
						`motion3d: collider ${c.id} puts more than ${MAX_CELL_COLLIDERS_3D} colliders in one ` +
							`cell of ${cellSize} m`,
					);
			}
	}
	const zoneList = zones.map((z, id) => ({
		id,
		kind: z.kind,
		minX: z.minX,
		minY: z.minY,
		minZ: z.minZ,
		maxX: z.maxX,
		maxY: z.maxY,
		maxZ: z.maxZ,
		height: z.height > 0 && z.height <= MAX_TRAMPOLINE_M ? z.height : 0,
	}));
	return {
		colliders: list,
		zones: zoneList,
		cells,
		cellSize,
		killY,
		seen: new Int32Array(list.length),
		query: 0,
	};
}

const within = (v) => Math.abs(v) <= MAX_COORD_3D;

const boxWithin = (b) =>
	within(b.minX) &&
	within(b.minY) &&
	within(b.minZ) &&
	within(b.maxX) &&
	within(b.maxY) &&
	within(b.maxZ);

/** The colliders whose columns a plane box touches, in id order. */
export function collidersNear(level, x0, z0, x1, z1) {
	const size = level.cellSize;
	const cx0 = Math.floor(x0 / size);
	const cx1 = Math.floor(x1 / size);
	const cz0 = Math.floor(z0 / size);
	const cz1 = Math.floor(z1 / size);
	// `seen` is an Int32Array, and one level may serve every room of a game for days.
	if (level.query >= 0x7fffffff) {
		level.seen.fill(0);
		level.query = 0;
	}
	level.query += 1;
	const stamp = level.query;
	const ids = [];
	for (let cx = cx0; cx <= cx1; cx++)
		for (let cz = cz0; cz <= cz1; cz++) {
			const bucket = level.cells.get(`${cx},${cz}`);
			if (!bucket) continue;
			for (const id of bucket) {
				if (level.seen[id] === stamp) continue;
				level.seen[id] = stamp;
				ids.push(id);
			}
		}
	ids.sort((a, b) => a - b);
	return ids.map((id) => level.colliders[id]);
}

/** The top of a collider under a footprint: a box's lid, or a ramp's highest point under it. */
export function topUnder(c, x0, z0, x1, z1) {
	switch (c.rise) {
		case 0:
			return c.minY + (Math.max(c.minX, Math.min(x1, c.maxX)) - c.minX) * c.slope;
		case 1:
			return c.minY + (c.maxX - Math.min(c.maxX, Math.max(x0, c.minX))) * c.slope;
		case 2:
			return c.minY + (Math.max(c.minZ, Math.min(z1, c.maxZ)) - c.minZ) * c.slope;
		case 3:
			return c.minY + (c.maxZ - Math.min(c.maxZ, Math.max(z0, c.minZ))) * c.slope;
		default:
			return c.maxY;
	}
}

/** A body at rest at a place. Position in metres (feet), yaw as uint16. */
export function createBody3d({ x = 0, y = 0, z = 0, yaw = 0 } = {}) {
	return {
		x,
		y,
		z,
		vx: 0,
		vy: 0,
		vz: 0,
		yaw: yaw & 0xffff,
		grounded: false,
		held: false,
		coyote: 0,
		buffer: 0,
		doubleUsed: false,
	};
}

const int8 = (v) => {
	const n = v | 0;
	return n < -MOVE_SCALE ? -MOVE_SCALE : n > MOVE_SCALE ? MOVE_SCALE : n;
};

const toward = (v, target, maxDelta) => {
	const d = target - v;
	return d > maxDelta ? v + maxDelta : d < -maxDelta ? v - maxDelta : target;
};

/**
 * One fixed step of one body. `input` is `{ mx, mz, yaw, buttons }` — int8 world-space move axes,
 * a uint16 yaw, {@link BUTTON_JUMP} / {@link BUTTON_SPRINT} bits. Mutates `body`; returns what
 * happened this step: `{ grounded, landed, jumped, doubleJumped, bounced, onWall, onRamp, steppedUp,
 * hitCeiling, fell }`. `fell` is the death plane; the rules respawn, the step does not.
 */
export function stepBody3d(body, input, level, spec = MOTION3D_DEFAULTS, dt = 1 / MOTION3D_HZ) {
	const out = {
		grounded: false,
		landed: false,
		jumped: false,
		doubleJumped: false,
		bounced: false,
		onWall: false,
		onRamp: false,
		steppedUp: false,
		hitCeiling: false,
		fell: false,
	};
	body.yaw = input.yaw & 0xffff;
	const buttons = input.buttons | 0;
	const wasGrounded = body.grounded;

	const mx = int8(input.mx);
	const mz = int8(input.mz);
	const unit = (spec.speed * (buttons & BUTTON_SPRINT ? spec.sprint : 1)) / MOVE_SCALE;
	let tx = mx * unit;
	let tz = mz * unit;
	const len2 = mx * mx + mz * mz;
	if (len2 > MOVE_SCALE * MOVE_SCALE) {
		const k = MOVE_SCALE / Math.sqrt(len2);
		tx *= k;
		tz *= k;
	}
	const dv = (wasGrounded ? spec.groundAccel : spec.airAccel) * dt;
	body.vx = toward(body.vx, tx, dv);
	body.vz = toward(body.vz, tz, dv);

	const pressed = (buttons & BUTTON_JUMP) !== 0;
	const edge = pressed && !body.held;
	body.held = pressed;
	if (edge) body.buffer = spec.bufferSteps;
	else if (body.buffer > 0) body.buffer -= 1;
	if (wasGrounded) {
		body.coyote = spec.coyoteSteps;
		body.doubleUsed = false;
	} else if (body.coyote > 0) body.coyote -= 1;
	const g = -spec.gravity;
	if (body.buffer > 0 && (wasGrounded || body.coyote > 0)) {
		body.vy = Math.sqrt(2 * g * spec.jumpHeight);
		body.buffer = 0;
		body.coyote = 0;
		out.jumped = true;
	} else if (edge && !wasGrounded && !body.doubleUsed && Math.abs(body.vy) < spec.apexWindow) {
		body.vy = Math.sqrt(2 * g * spec.doubleJumpHeight);
		body.doubleUsed = true;
		body.buffer = 0;
		out.doubleJumped = true;
	}
	body.vy += spec.gravity * dt;
	if (body.vy < -spec.maxFall) body.vy = -spec.maxFall;
	body.grounded = false;

	const dx = body.vx * dt;
	const dy = body.vy * dt;
	const dz = body.vz * dt;
	const reach = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
	const n = reach > 0 ? Math.min(MAX_SUB_STEPS_3D, Math.ceil(reach / spec.subMove)) : 1;
	let sx = dx / n;
	let sy = dy / n;
	let sz = dz / n;
	const r = spec.radius + SWEEP_PAD;
	const near = collidersNear(
		level,
		Math.min(body.x, body.x + dx) - r,
		Math.min(body.z, body.z + dz) - r,
		Math.max(body.x, body.x + dx) + r,
		Math.max(body.z, body.z + dz) + r,
	);
	climbLeft = spec.stepUp;
	for (let i = 0; i < n; i++) {
		if (sx !== 0 && !moveFlat(body, 0, sx, near, spec, out)) sx = 0;
		if (sz !== 0 && !moveFlat(body, 1, sz, near, spec, out)) sz = 0;
		if (sy !== 0 && !moveUp(body, sy, near, spec, out)) sy = 0;
	}

	if (!body.grounded && wasGrounded && !out.jumped && body.vy <= 0) snapDown(body, near, spec, out);
	if (body.grounded) {
		out.landed = !wasGrounded;
		const zone = trampolineAt(body, level);
		if (zone) {
			body.vy = Math.sqrt(2 * g * zone.height);
			body.grounded = false;
			body.doubleUsed = false;
			out.bounced = true;
		}
	}
	out.grounded = body.grounded;
	out.fell = body.y < level.killY || !within(body.x) || !within(body.z);
	return out;
}

/** The step-up a step has left, m: {@link stepBody3d} sets it to `stepUp`, a step-up spends it. */
let climbLeft = 0;

/** What a sub-move along a walkable ramp may rise past its slope times the run, m: rounding. */
const SLOPE_SLACK = 1e-9;

/**
 * Move on x (`axis` 0) or z (1) by `d`; false when it was stopped. Rising along a ramp no steeper
 * than `maxSlope`, in its facing's axis, is walking — at a jump too; any rise past that (a box's
 * ledge, a ramp's lip) is a step-up, taken out of the step's `climbLeft` by a body not rising; a
 * steeper ramp is a wall. A ledge the step has no budget left for holds the body, its velocity
 * kept, until the next step; a wall stops it.
 */
function moveFlat(body, axis, d, near, spec, out) {
	const r = spec.radius;
	const h = spec.height;
	const prev = axis === 0 ? body.x : body.z;
	if (axis === 0) body.x = prev + d;
	else body.z = prev + d;
	const x0 = body.x - r;
	const x1 = body.x + r;
	const z0 = body.z - r;
	const z1 = body.z + r;
	const run = d < 0 ? -d : d;
	const canStep = body.vy <= 0;
	let floor = body.y;
	let spend = 0;
	let ramp = false;
	let blocked = false;
	let held = false;
	for (const c of near) {
		if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
		const top = topUnder(c, x0, z0, x1, z1);
		if (!(body.y < top && body.y + h > c.minY)) continue;
		const steep = c.rise >= 0 && c.slope > spec.maxSlope;
		const along = c.rise >= 0 && !steep && (c.rise < 2 ? 0 : 1) === axis;
		const ledge = top - body.y - (along ? c.slope * run + SLOPE_SLACK : 0);
		if (ledge <= 0 || (canStep && !steep && ledge <= climbLeft)) {
			if (top > floor) floor = top;
			if (ledge > spend) spend = ledge;
			if (c.rise >= 0) ramp = true;
		} else if (canStep && !steep && ledge <= spec.stepUp) {
			held = true;
		} else {
			blocked = true;
			break;
		}
	}
	if (held && !blocked) {
		if (axis === 0) body.x = prev;
		else body.z = prev;
		return false;
	}
	if (!blocked && floor > body.y) {
		for (const c of near) {
			if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
			const top = topUnder(c, x0, z0, x1, z1);
			if (floor < top && floor + h > c.minY) {
				blocked = true;
				break;
			}
		}
		if (!blocked) {
			body.y = floor;
			climbLeft -= spend;
			if (body.vy <= 0) {
				body.vy = 0;
				body.grounded = true;
				if (ramp) out.onRamp = true;
				else out.steppedUp = true;
			}
		}
	}
	if (blocked) {
		if (axis === 0) {
			body.x = prev;
			body.vx = 0;
		} else {
			body.z = prev;
			body.vz = 0;
		}
		out.onWall = true;
		return false;
	}
	return true;
}

/** Move on y by `d`: land on the highest top crossed, or stop under a ceiling; false when stopped. */
function moveUp(body, d, near, spec, out) {
	const r = spec.radius;
	const h = spec.height;
	const prev = body.y;
	const next = prev + d;
	const x0 = body.x - r;
	const x1 = body.x + r;
	const z0 = body.z - r;
	const z1 = body.z + r;
	if (d < 0) {
		let best = -Infinity;
		let ramp = false;
		for (const c of near) {
			if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
			const top = topUnder(c, x0, z0, x1, z1);
			if (top <= prev && top >= next && top > best) {
				best = top;
				ramp = c.rise >= 0;
			}
		}
		if (best !== -Infinity) {
			body.y = best;
			body.vy = 0;
			body.grounded = true;
			if (ramp) out.onRamp = true;
			return false;
		}
	} else {
		let low = Infinity;
		for (const c of near) {
			if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
			if (c.minY >= prev + h && c.minY < next + h && c.minY < low) low = c.minY;
		}
		if (low !== Infinity) {
			body.y = low - h;
			body.vy = 0;
			out.hitCeiling = true;
			return false;
		}
	}
	body.y = next;
	return true;
}

/** Stick a body that walked off a surface onto one within `snapDown` below its feet. */
function snapDown(body, near, spec, out) {
	const r = spec.radius;
	const x0 = body.x - r;
	const x1 = body.x + r;
	const z0 = body.z - r;
	const z1 = body.z + r;
	let best = -Infinity;
	let ramp = false;
	for (const c of near) {
		if (!(x0 < c.maxX && x1 > c.minX && z0 < c.maxZ && z1 > c.minZ)) continue;
		const top = topUnder(c, x0, z0, x1, z1);
		if (top <= body.y && top >= body.y - spec.snapDown && top > best) {
			best = top;
			ramp = c.rise >= 0;
		}
	}
	if (best === -Infinity) return;
	body.y = best;
	body.vy = 0;
	body.grounded = true;
	if (ramp) out.onRamp = true;
}

/** The trampoline zone a standing body's centre is in, if any. */
function trampolineAt(body, level) {
	for (const z of level.zones) {
		if (z.kind !== 'trampoline' || !(z.height > 0)) continue;
		if (
			body.x >= z.minX &&
			body.x <= z.maxX &&
			body.z >= z.minZ &&
			body.z <= z.maxZ &&
			body.y >= z.minY &&
			body.y <= z.maxY
		)
			return z;
	}
	return null;
}

/**
 * The zones a body is in, by id: its centre on the plane inside the zone's footprint (edges
 * included) and its upright span `[y, y + height]` touching the zone's. A trampoline counts like
 * any other zone here; only {@link stepBody3d} launches from one.
 */
export function zonesAt3d(body, level, spec = MOTION3D_DEFAULTS) {
	const ids = [];
	for (const z of level.zones) {
		if (
			body.x >= z.minX &&
			body.x <= z.maxX &&
			body.z >= z.minZ &&
			body.z <= z.maxZ &&
			body.y <= z.maxY &&
			body.y + spec.height >= z.minY
		)
			ids.push(z.id);
	}
	return ids;
}

/** What {@link trackStep3d} raises: the arcade family's zone edges plus the step's own. */
export const SIGNALS3D = Object.freeze({
	jumped: 'jumped',
	doubleJumped: 'doubleJumped',
	landed: 'landed',
	bounced: 'bounced',
	leaveZone: 'leaveZone',
	enterZone: 'enterZone',
	fell: 'fell',
});

/** What {@link trackStep3d} remembers of a body between steps: its zones and whether it had fallen. */
export function createTracker3d() {
	return { zones: [], fell: false };
}

/**
 * The signals one step raised, in this order: `jumped`, `doubleJumped`, `landed`, `bounced`, each
 * `leaveZone` then each `enterZone` (`{ zone, kind }`, by zone id), and `fell` — every one an EDGE,
 * as the 2D loop's are: a zone on the step the body enters or leaves it, `fell` on the step it first
 * drops below the death plane (again only after it is back above it, which a respawn does). `result`
 * is that step's {@link stepBody3d} answer; `tracker` ({@link createTracker3d}) is updated.
 */
export function trackStep3d(tracker, body, result, level, spec = MOTION3D_DEFAULTS) {
	const out = [];
	if (result.jumped) out.push({ type: SIGNALS3D.jumped });
	if (result.doubleJumped) out.push({ type: SIGNALS3D.doubleJumped });
	if (result.landed) out.push({ type: SIGNALS3D.landed });
	if (result.bounced) out.push({ type: SIGNALS3D.bounced });
	const was = tracker.zones;
	const is = zonesAt3d(body, level, spec);
	for (const id of was)
		if (!is.includes(id))
			out.push({ type: SIGNALS3D.leaveZone, zone: id, kind: level.zones[id].kind });
	for (const id of is)
		if (!was.includes(id))
			out.push({ type: SIGNALS3D.enterZone, zone: id, kind: level.zones[id].kind });
	tracker.zones = is;
	const fell = body.y < level.killY;
	if (fell && !tracker.fell) out.push({ type: SIGNALS3D.fell });
	tracker.fell = fell;
	return out;
}

const HASH_VIEW = new DataView(new ArrayBuffer(8));

const mix = (h, byte) => Math.imul(h ^ byte, 0x01000193) >>> 0;

const mixFloat = (h, v) => {
	HASH_VIEW.setFloat64(0, v, true);
	for (let i = 0; i < 8; i++) h = mix(h, HASH_VIEW.getUint8(i));
	return h;
};

/** FNV-1a offset basis: the hash of nothing. */
export const HASH3D_SEED = 0x811c9dc5;

/**
 * A uint32 hash (FNV-1a) of the exact bits of every body's state, in order — what a room and a
 * device compare to know they agree. `h` chains it onto an earlier hash.
 */
export function hashBodies3d(bodies, h = HASH3D_SEED) {
	for (const b of bodies) {
		h = mixFloat(h, b.x);
		h = mixFloat(h, b.y);
		h = mixFloat(h, b.z);
		h = mixFloat(h, b.vx);
		h = mixFloat(h, b.vy);
		h = mixFloat(h, b.vz);
		h = mixFloat(h, b.yaw);
		h = mixFloat(h, b.coyote);
		h = mixFloat(h, b.buffer);
		h = mix(h, (b.grounded ? 1 : 0) | (b.held ? 2 : 0) | (b.doubleUsed ? 4 : 0));
	}
	return h;
}
