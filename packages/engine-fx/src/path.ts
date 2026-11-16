/**
 * Invisible FX — PATHS: particles that live on a curve (`docs/design/fx-paths.md`), as ONE custom
 * `@barvynkoa/particle-emitter` behavior (`fxPath`).
 *
 * A layer's path is a polyline, a Catmull-Rom spline or a cubic Bézier in emitter-local px. It is
 * used three ways, all from this one behavior:
 *  - **along**  — particles are born on the curve (even, random, or sweeping over a travel time);
 *  - **travel** — the emitter's origin moves along the curve, carrying whatever spawn shape it has;
 *  - **follow** — each particle moves along the curve as its direction of travel.
 *
 * Order 1: the library runs order-0 (Spawn) behaviors, then places the particle at the emitter,
 * then every other order. Running at 1 puts the path AFTER placement (so it composes with any spawn
 * shape whatever the config's order) and BEFORE the Normal-order Direction and movement inits (so a
 * launch direction can be made relative to the path).
 *
 * Sweep and travel need the emitter's own clock, which the library does not give a behavior.
 * {@link installFxEmitterTick} (run by `registerFxBehaviors`) wraps `Emitter.prototype.update` to
 * call `tickEmitter(emitter, dt)` on any behavior that has one before the original update. The
 * clock lives ON THE EMITTER, so an exposed parameter that rebuilds this behavior keeps the pass
 * where it was; it advances by the `dt` the renderer passes (already scaled by the particle clock,
 * so Turbo speeds it up) and restarts when emission switches back on.
 *
 * Like the other `engine-fx` behaviors this imports nothing at run time, so it is headless-testable.
 * A layer without a path carries no `fxPath` entry — every other effect stays byte-identical.
 */

export const FX_PATH_BEHAVIOR_TYPE = 'fxPath';

export type FxPathCurveKind = 'polyline' | 'catmullRom' | 'bezier';
export type FxPathEmit = 'shape' | 'along' | 'travel';
export type FxPathDistribution = 'even' | 'random' | 'sweep';
export type FxPathDirection = 'free' | 'tangent' | 'normal';
export type FxPathRepeat = 'loop' | 'pingpong' | 'once';
export type FxPathEase = 'linear' | 'in' | 'out' | 'inOut';
export type FxPathFollowBy = 'life' | 'speed';
export type FxPathFollowEnd = 'stop' | 'loop' | 'die';

export const FX_PATH_CURVE_KINDS: FxPathCurveKind[] = ['polyline', 'catmullRom', 'bezier'];
export const FX_PATH_EMITS: FxPathEmit[] = ['shape', 'along', 'travel'];
export const FX_PATH_DISTRIBUTIONS: FxPathDistribution[] = ['even', 'random', 'sweep'];
export const FX_PATH_DIRECTIONS: FxPathDirection[] = ['free', 'tangent', 'normal'];
export const FX_PATH_REPEATS: FxPathRepeat[] = ['loop', 'pingpong', 'once'];
export const FX_PATH_EASES: FxPathEase[] = ['linear', 'in', 'out', 'inOut'];
export const FX_PATH_FOLLOW_BYS: FxPathFollowBy[] = ['life', 'speed'];
export const FX_PATH_FOLLOW_ENDS: FxPathFollowEnd[] = ['stop', 'loop', 'die'];

export interface FxVec2 {
	x: number;
	y: number;
}

/** One anchor. `in` / `out` are Bézier handles RELATIVE to the anchor; other kinds ignore them. */
export interface FxPathPoint extends FxVec2 {
	in?: FxVec2;
	out?: FxVec2;
}

export interface FxPathCurve {
	kind: FxPathCurveKind;
	points: FxPathPoint[];
	/** The last point joins the first. */
	closed: boolean;
	/** Catmull-Rom only, 0..1: 0 = the classic spline, 1 = straight segments. */
	tension: number;
}

export interface FxPathAlong {
	distribution: FxPathDistribution;
	/** px — a random offset along the normal, either side. */
	jitter: number;
	/** `tangent` / `normal` make the layer's Direction relative to the path at the birth point. */
	direction: FxPathDirection;
}

export interface FxPathTravel {
	/** Seconds for one pass. */
	duration: number;
	repeat: FxPathRepeat;
	ease: FxPathEase;
}

export interface FxPathFollow {
	enabled: boolean;
	/** `life` reaches the end at death (a closed path: one lap); `speed` moves at `speed` px/s. */
	by: FxPathFollowBy;
	speed: number;
	/** Per-particle speed multiplier floor, 0..1 (Scale's `minMult` contract). */
	speedMin: number;
	/** Past the last point (`speed` only): hold, wrap to the start, or die. */
	end: FxPathFollowEnd;
	/** Turn the particle to the tangent every frame. */
	orient: boolean;
}

/** `fxPath`'s config, as stored. Read it through {@link readFxPath}. */
export interface FxPathConfig {
	curve?: Partial<FxPathCurve>;
	emit?: FxPathEmit;
	along?: Partial<FxPathAlong>;
	travel?: Partial<FxPathTravel>;
	follow?: Partial<FxPathFollow>;
}

/** The clamped, defaulted form every reader goes through. */
export interface FxPath {
	curve: FxPathCurve;
	emit: FxPathEmit;
	along: FxPathAlong;
	travel: FxPathTravel;
	follow: FxPathFollow;
}

export const FX_PATH_DEFAULT_POINTS: FxPathPoint[] = [
	{ x: -150, y: 0, out: { x: 60, y: -90 } },
	{ x: 0, y: 0, in: { x: -60, y: 0 }, out: { x: 60, y: 0 } },
	{ x: 150, y: 0, in: { x: -60, y: -90 } },
];

/**
 * The most anchors a path keeps; the rest are dropped. `init` (re-run each time an event layer
 * re-fires) rebuilds the arc-length table, so an absurd doc would stall the game on every fire. A
 * hand-drawn path has a handful of points; 256 anchors of a spline are ~6k samples, built in well
 * under a millisecond.
 */
export const FX_PATH_MAX_POINTS = 256;

const LIMITS = {
	coord: 100000,
	tension: [0, 1],
	jitter: [0, 10000],
	duration: [0.01, 600],
	speed: [0, 100000],
	speedMin: [0, 1],
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function clampNum(v: unknown, lo: number, hi: number, def: number): number {
	const n = typeof v === 'number' ? v : Number.NaN;
	if (!Number.isFinite(n)) return def;
	return Math.min(hi, Math.max(lo, n));
}

function pick<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
	return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

function readVec(v: unknown): FxVec2 | undefined {
	if (!isRecord(v)) return undefined;
	return {
		x: clampNum(v.x, -LIMITS.coord, LIMITS.coord, 0),
		y: clampNum(v.y, -LIMITS.coord, LIMITS.coord, 0),
	};
}

function readPoints(v: unknown): FxPathPoint[] {
	const out: FxPathPoint[] = [];
	if (Array.isArray(v)) {
		for (const raw of v) {
			if (out.length >= FX_PATH_MAX_POINTS) break;
			if (!isRecord(raw)) continue;
			const p: FxPathPoint = {
				x: clampNum(raw.x, -LIMITS.coord, LIMITS.coord, 0),
				y: clampNum(raw.y, -LIMITS.coord, LIMITS.coord, 0),
			};
			const hin = readVec(raw.in);
			const hout = readVec(raw.out);
			if (hin) p.in = hin;
			if (hout) p.out = hout;
			out.push(p);
		}
	}
	if (out.length >= 2) return out;
	return FX_PATH_DEFAULT_POINTS.map((p) => structuredCopy(p));
}

function structuredCopy(p: FxPathPoint): FxPathPoint {
	const c: FxPathPoint = { x: p.x, y: p.y };
	if (p.in) c.in = { ...p.in };
	if (p.out) c.out = { ...p.out };
	return c;
}

/**
 * The ONE clamp: the behavior and the `/fx` inspector both read through it. Keeps at most
 * {@link FX_PATH_MAX_POINTS} anchors.
 */
export function readFxPath(config: unknown): FxPath {
	const c = isRecord(config) ? config : {};
	const curve = isRecord(c.curve) ? c.curve : {};
	const along = isRecord(c.along) ? c.along : {};
	const travel = isRecord(c.travel) ? c.travel : {};
	const follow = isRecord(c.follow) ? c.follow : {};
	return {
		curve: {
			kind: pick(curve.kind, FX_PATH_CURVE_KINDS, 'catmullRom'),
			points: readPoints(curve.points),
			closed: curve.closed === true,
			tension: clampNum(curve.tension, LIMITS.tension[0], LIMITS.tension[1], 0),
		},
		emit: pick(c.emit, FX_PATH_EMITS, 'shape'),
		along: {
			distribution: pick(along.distribution, FX_PATH_DISTRIBUTIONS, 'random'),
			jitter: clampNum(along.jitter, LIMITS.jitter[0], LIMITS.jitter[1], 0),
			direction: pick(along.direction, FX_PATH_DIRECTIONS, 'free'),
		},
		travel: {
			duration: clampNum(travel.duration, LIMITS.duration[0], LIMITS.duration[1], 2),
			repeat: pick(travel.repeat, FX_PATH_REPEATS, 'loop'),
			ease: pick(travel.ease, FX_PATH_EASES, 'linear'),
		},
		follow: {
			enabled: follow.enabled === true,
			by: pick(follow.by, FX_PATH_FOLLOW_BYS, 'life'),
			speed: clampNum(follow.speed, LIMITS.speed[0], LIMITS.speed[1], 200),
			speedMin: clampNum(follow.speedMin, LIMITS.speedMin[0], LIMITS.speedMin[1], 1),
			end: pick(follow.end, FX_PATH_FOLLOW_ENDS, 'stop'),
			orient: follow.orient === true,
		},
	};
}

/** Whether the path does anything: an `fxPath` that neither places nor moves particles is dead. */
export function fxPathInUse(path: FxPath): boolean {
	return path.emit !== 'shape' || path.follow.enabled;
}

// ---------------------------------------------------------------------------
// Curve math — every kind flattens to cubic segments, sampled into an arc-length table.
// ---------------------------------------------------------------------------

interface Cubic {
	p0: FxVec2;
	c1: FxVec2;
	c2: FxVec2;
	p1: FxVec2;
	straight: boolean;
}

const SAMPLES_PER_CURVE = 24;

function cubicsOf(curve: FxPathCurve): Cubic[] {
	const pts = curve.points;
	const n = pts.length;
	const segs = curve.closed ? n : n - 1;
	const out: Cubic[] = [];
	const at = (i: number): FxPathPoint => pts[((i % n) + n) % n];
	for (let i = 0; i < segs; i++) {
		const a = at(i);
		const b = at(i + 1);
		if (curve.kind === 'polyline') {
			out.push({ p0: a, c1: a, c2: b, p1: b, straight: true });
		} else if (curve.kind === 'bezier') {
			const ho = a.out ?? { x: 0, y: 0 };
			const hi = b.in ?? { x: 0, y: 0 };
			out.push({
				p0: a,
				c1: { x: a.x + ho.x, y: a.y + ho.y },
				c2: { x: b.x + hi.x, y: b.y + hi.y },
				p1: b,
				straight: ho.x === 0 && ho.y === 0 && hi.x === 0 && hi.y === 0,
			});
		} else {
			// Cardinal spline: tangent m_i = (1 − tension)·(p_{i+1} − p_{i−1}) / 2; an open end
			// repeats its own point, so the spline starts and ends on the first and last points.
			const k = (1 - curve.tension) / 2;
			const prev = curve.closed || i > 0 ? at(i - 1) : a;
			const next = curve.closed || i + 2 < n ? at(i + 2) : b;
			const ma = { x: (b.x - prev.x) * k, y: (b.y - prev.y) * k };
			const mb = { x: (next.x - a.x) * k, y: (next.y - a.y) * k };
			out.push({
				p0: a,
				c1: { x: a.x + ma.x / 3, y: a.y + ma.y / 3 },
				c2: { x: b.x - mb.x / 3, y: b.y - mb.y / 3 },
				p1: b,
				straight: curve.tension >= 1,
			});
		}
	}
	return out;
}

function cubicAt(c: Cubic, t: number, out: FxVec2): void {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const d = 3 * u * t * t;
	const e = t * t * t;
	out.x = a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p1.x;
	out.y = a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p1.y;
}

/**
 * A curve flattened into samples with their cumulative arc length. `pointAt(s)` / `angleAt(s)` map a
 * DISTANCE along the curve (0..length) to a point and a tangent angle (radians, the library's
 * convention: 0 = right, +π/2 = down), so even spacing and follow-by-speed are true px.
 */
export class FxPathTable {
	readonly length: number;
	readonly closed: boolean;
	/** The distance at which each curve segment starts (segment i runs from anchor i to i + 1). */
	readonly segmentStarts: number[];
	private xs: Float64Array;
	private ys: Float64Array;
	private cum: Float64Array;

	constructor(curve: FxPathCurve) {
		this.closed = curve.closed;
		const xs: number[] = [];
		const ys: number[] = [];
		const cubics = cubicsOf(curve);
		const tmp = { x: 0, y: 0 };
		xs.push(curve.points[0].x);
		ys.push(curve.points[0].y);
		const starts: number[] = [];
		for (const c of cubics) {
			starts.push(xs.length - 1);
			const steps = c.straight ? 1 : SAMPLES_PER_CURVE;
			for (let k = 1; k <= steps; k++) {
				cubicAt(c, k / steps, tmp);
				xs.push(tmp.x);
				ys.push(tmp.y);
			}
		}
		const cum = new Float64Array(xs.length);
		for (let i = 1; i < xs.length; i++) {
			cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
		}
		this.xs = Float64Array.from(xs);
		this.ys = Float64Array.from(ys);
		this.cum = cum;
		this.length = cum[cum.length - 1];
		this.segmentStarts = starts.map((i) => cum[i]);
	}

	/** The curve segment (anchor `i` → `i + 1`) that holds distance `s`. */
	segmentAt(s: number): number {
		const starts = this.segmentStarts;
		let i = 0;
		while (i + 1 < starts.length && starts[i + 1] <= s) i++;
		return i;
	}

	/** The distance along the curve of the sample nearest a point (for picking on a stage). */
	nearest(x: number, y: number): { s: number; distance: number } {
		const { xs, ys, cum } = this;
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i + 1 < xs.length; i++) {
			const ax = xs[i];
			const ay = ys[i];
			const dx = xs[i + 1] - ax;
			const dy = ys[i + 1] - ay;
			const len2 = dx * dx + dy * dy;
			const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
			const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
			if (d < bestD) {
				bestD = d;
				best = cum[i] + (cum[i + 1] - cum[i]) * t;
			}
		}
		return { s: best, distance: bestD };
	}

	/** The sample segment holding distance `s` (clamped to the curve). */
	private seg(s: number): number {
		const cum = this.cum;
		let lo = 0;
		let hi = cum.length - 1;
		if (hi === 0) return 0;
		if (s <= 0) return 0;
		if (s >= this.length) return hi - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (cum[mid] <= s) lo = mid;
			else hi = mid;
		}
		return lo;
	}

	pointAt(s: number, out: FxVec2): FxVec2 {
		const i = this.seg(s);
		const xs = this.xs;
		const ys = this.ys;
		if (xs.length < 2) {
			out.x = xs[0];
			out.y = ys[0];
			return out;
		}
		const span = this.cum[i + 1] - this.cum[i];
		const t = span > 0 ? Math.min(1, Math.max(0, (s - this.cum[i]) / span)) : 0;
		out.x = xs[i] + (xs[i + 1] - xs[i]) * t;
		out.y = ys[i] + (ys[i + 1] - ys[i]) * t;
		return out;
	}

	angleAt(s: number): number {
		const xs = this.xs;
		const ys = this.ys;
		if (xs.length < 2) return 0;
		let i = this.seg(s);
		// A zero-length sample (coincident points) has no direction: look for the nearest one that has.
		let dx = xs[i + 1] - xs[i];
		let dy = ys[i + 1] - ys[i];
		for (let j = i + 1; dx === 0 && dy === 0 && j + 1 < xs.length; j++) {
			dx = xs[j + 1] - xs[j];
			dy = ys[j + 1] - ys[j];
		}
		for (i = i - 1; dx === 0 && dy === 0 && i >= 0; i--) {
			dx = xs[i + 1] - xs[i];
			dy = ys[i + 1] - ys[i];
		}
		return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
	}
}

// ---------------------------------------------------------------------------
// Travel timing
// ---------------------------------------------------------------------------

export function fxPathEase(ease: FxPathEase, t: number): number {
	switch (ease) {
		case 'in':
			return t * t;
		case 'out':
			return 1 - (1 - t) * (1 - t);
		case 'inOut':
			return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
		default:
			return t;
	}
}

/** Where one travel is after `seconds`: 0..1 along the curve, eased. */
export function fxPathTravelProgress(travel: FxPathTravel, seconds: number): number {
	const p = Math.max(0, seconds) / travel.duration;
	let u: number;
	switch (travel.repeat) {
		case 'once':
			u = Math.min(1, p);
			break;
		case 'pingpong': {
			const m = p % 2;
			u = m <= 1 ? m : 2 - m;
			break;
		}
		default:
			u = p % 1;
	}
	return fxPathEase(travel.ease, u);
}

// ---------------------------------------------------------------------------
// The behavior
// ---------------------------------------------------------------------------

/** The emitter slice the path reads and writes (the library's `Emitter` satisfies it). */
export interface FxPathEmitter {
	rotation: number;
	emit: boolean;
	spawnPos: FxVec2;
	updateSpawnPos(x: number, y: number): void;
	/** Forget the last position, so the next spawns are not spread along a jump. */
	resetPositionTracking?(): void;
	/** Replaced by every `init` (which also resets `spawnPos` and `rotation`). */
	initBehaviors?: unknown[];
	/** ≤ 0 inside a frame's spawn loop: how long before the frame's end this wave was due. */
	_spawnTimer?: number;
	particlesPerWave?: number;
	/** The path's clock — see the module header. */
	fxPathClock?: FxPathClock;
}

export interface FxPathClock {
	/** Seconds since emission (re)started, at the END of the frame being updated. */
	t: number;
	/** `emit` as last seen, to restart on a rising edge. */
	emitting: boolean;
	/** The travel offset this path last added to `spawnPos`, and the rotation it was added at. */
	appliedX: number;
	appliedY: number;
	appliedRotation: number;
	/** A running count for an even stream of single-particle waves. */
	evenIndex: number;
	/** The completed passes of a looping travel, to spot the wrap back to the start. */
	pass: number;
	/** The `initBehaviors` the clock was started for: a new array means the emitter re-initialised. */
	behaviors: unknown[] | undefined;
}

/** The particle slice the path touches (structural — no PixiJS import). */
export interface FxPathParticle {
	x: number;
	y: number;
	rotation: number;
	agePercent: number;
	config: Record<string, unknown>;
	next: FxPathParticle | null;
	emitter?: FxPathEmitter | null;
}

/** Golden-ratio step: a single-particle stream spread evenly over the curve, in any time window. */
const GOLDEN = 0.6180339887498949;

function clockOf(em: FxPathEmitter): FxPathClock {
	let c = em.fxPathClock;
	if (!c) {
		c = {
			t: 0,
			emitting: false,
			appliedX: 0,
			appliedY: 0,
			appliedRotation: 0,
			evenIndex: 0,
			pass: 0,
			behaviors: em.initBehaviors,
		};
		em.fxPathClock = c;
	}
	if (c.behaviors !== em.initBehaviors) {
		// `init` put `spawnPos` back to the config's `pos` at rotation 0: nothing of ours is in it, and
		// the effect starts over (a re-fired event layer is re-initialised).
		c.behaviors = em.initBehaviors;
		c.t = 0;
		c.evenIndex = 0;
		c.pass = 0;
		c.appliedX = 0;
		c.appliedY = 0;
		c.appliedRotation = Number(em.rotation) || 0;
		c.emitting = false;
	}
	return c;
}

/** Take back a travel offset a previous instance (an edit that switched travel off) left behind. */
function dropTravel(em: FxPathEmitter, c: FxPathClock): void {
	if (c.appliedX === 0 && c.appliedY === 0) return;
	const turn = (Number(em.rotation) || 0) - c.appliedRotation;
	const cs = Math.cos(turn);
	const sn = Math.sin(turn);
	const ax = c.appliedX * cs - c.appliedY * sn;
	const ay = c.appliedX * sn + c.appliedY * cs;
	em.updateSpawnPos(em.spawnPos.x - ax, em.spawnPos.y - ay);
	c.appliedX = 0;
	c.appliedY = 0;
}

/**
 * The emitter has a clock but no `fxPath` any more, and `init` did not run (it would have reset
 * `spawnPos` and the behavior arrays): the behavior was taken out in place, so take its travel
 * offset out too, then forget the clock.
 */
function releaseFxPath(em: FxPathEmitter): void {
	const c = em.fxPathClock;
	if (!c) return;
	if (c.behaviors === em.initBehaviors) dropTravel(em, c);
	em.fxPathClock = undefined;
}

/** Start the path's pass again (a Replay that restarts the emitter without re-initialising it). */
export function rewindFxPath(em: FxPathEmitter): void {
	const c = em.fxPathClock;
	if (!c) return;
	c.t = 0;
	c.evenIndex = 0;
	c.pass = 0;
	em.resetPositionTracking?.();
}

/** See the module header. */
export class FxPathBehavior {
	static type = FX_PATH_BEHAVIOR_TYPE;
	order = 1;
	readonly path: FxPath;
	readonly table: FxPathTable;
	private readonly usesClock: boolean;
	private tmp: FxVec2 = { x: 0, y: 0 };
	private tmp2: FxVec2 = { x: 0, y: 0 };

	constructor(config: FxPathConfig) {
		this.path = readFxPath(config);
		this.table = new FxPathTable(this.path.curve);
		this.usesClock =
			this.path.emit === 'travel' ||
			(this.path.emit === 'along' && this.path.along.distribution === 'sweep');
	}

	/** Advance the clock and move a travelling origin. Called by the tick hook before `update`. */
	tickEmitter(em: FxPathEmitter, dt: number): void {
		const c = clockOf(em);
		const emitting = !!em.emit;
		let jumped = false;
		if (emitting && !c.emitting) {
			c.t = 0;
			c.evenIndex = 0;
			c.pass = 0;
			jumped = true;
		}
		c.emitting = emitting;
		// One non-finite dt would make the clock Infinity / NaN, and through the base the travel is
		// computed from, leave `spawnPos` NaN for good.
		if (emitting && Number.isFinite(dt) && dt > 0) c.t += dt;
		if (this.path.emit !== 'travel') {
			dropTravel(em, c);
			return;
		}
		const rot = Number(em.rotation) || 0;
		// `Emitter.rotate` turned `spawnPos` — and the offset inside it — by the change since last tick.
		const turn = rot - c.appliedRotation;
		if (turn !== 0) {
			const cs = Math.cos(turn);
			const sn = Math.sin(turn);
			const ax = c.appliedX * cs - c.appliedY * sn;
			c.appliedY = c.appliedX * sn + c.appliedY * cs;
			c.appliedX = ax;
		}
		const travel = this.path.travel;
		if (travel.repeat === 'loop') {
			const pass = Math.floor(c.t / travel.duration);
			if (pass !== c.pass) jumped = !this.table.closed || jumped;
			c.pass = pass;
		}
		const p = this.table.pointAt(fxPathTravelProgress(travel, c.t) * this.table.length, this.tmp);
		const cs = Math.cos(rot);
		const sn = Math.sin(rot);
		const ox = p.x * cs - p.y * sn;
		const oy = p.x * sn + p.y * cs;
		const baseX = em.spawnPos.x - c.appliedX;
		const baseY = em.spawnPos.y - c.appliedY;
		c.appliedX = ox;
		c.appliedY = oy;
		c.appliedRotation = rot;
		const nx = baseX + ox;
		const ny = baseY + oy;
		if (nx !== em.spawnPos.x || ny !== em.spawnPos.y) em.updateSpawnPos(nx, ny);
		// A wrap from the end back to the start (or a restart) is a jump, not a move: without this the
		// library spreads the frame's spawns along the straight line between the two.
		if (jumped) em.resetPositionTracking?.();
	}

	/** Seconds into the pass at which the current wave was due. */
	private emitTime(em: FxPathEmitter): number {
		const c = clockOf(em);
		const due = Number(em._spawnTimer);
		return c.t + (Number.isFinite(due) && due < 0 ? due : 0);
	}

	initParticles(first: FxPathParticle): void {
		const em = first?.emitter;
		if (!em) return;
		const { path, table } = this;
		const L = table.length;
		const rot = Number(em.rotation) || 0;
		const cs = Math.cos(rot);
		const sn = Math.sin(rot);
		const clock = clockOf(em);
		let waveSize = 0;
		for (let p: FxPathParticle | null = first; p; p = p.next) waveSize++;
		const sweepS =
			this.usesClock && path.emit === 'along'
				? fxPathTravelProgress(path.travel, this.emitTime(em)) * L
				: 0;
		const travelS =
			path.emit === 'travel' ? fxPathTravelProgress(path.travel, this.emitTime(em)) * L : 0;
		let i = 0;
		for (let p: FxPathParticle | null = first; p; p = p.next, i++) {
			let s = 0;
			if (path.emit === 'along') {
				switch (path.along.distribution) {
					case 'even': {
						if (waveSize > 1) {
							s = table.closed ? (i / waveSize) * L : (i / (waveSize - 1)) * L;
						} else {
							s = ((clock.evenIndex++ * GOLDEN) % 1) * L;
						}
						break;
					}
					case 'sweep':
						s = sweepS;
						break;
					default:
						s = Math.random() * L;
				}
				const pt = table.pointAt(s, this.tmp);
				let px = pt.x;
				let py = pt.y;
				const angle = table.angleAt(s);
				if (path.along.jitter > 0) {
					const j = (Math.random() * 2 - 1) * path.along.jitter;
					px += -Math.sin(angle) * j;
					py += Math.cos(angle) * j;
				}
				p.x += px * cs - py * sn;
				p.y += px * sn + py * cs;
				if (path.along.direction === 'tangent') p.rotation += angle;
				else if (path.along.direction === 'normal') p.rotation += angle + Math.PI / 2;
			} else if (path.emit === 'travel') {
				s = travelS;
			}
			if (!path.follow.enabled) {
				if (p.config.fxPathS !== undefined) p.config.fxPathS = undefined;
			} else {
				if (path.emit === 'shape') {
					// Born off the curve: start at its first point so it traces the drawn shape.
					const p0 = table.pointAt(0, this.tmp);
					p.x += p0.x * cs - p0.y * sn;
					p.y += p0.x * sn + p0.y * cs;
				}
				const f = path.follow;
				p.config.fxPathS = s;
				p.config.fxPathS0 = s;
				p.config.fxPathCos = cs;
				p.config.fxPathSin = sn;
				p.config.fxPathRot = rot;
				p.config.fxPathMult = f.speedMin >= 1 ? 1 : f.speedMin + Math.random() * (1 - f.speedMin);
				if (f.orient) p.rotation = rot + table.angleAt(s);
			}
		}
	}

	updateParticle(p: FxPathParticle, deltaSec: number): boolean {
		const f = this.path.follow;
		if (!f.enabled) return false;
		const s0 = p.config.fxPathS;
		if (typeof s0 !== 'number') return false;
		const table = this.table;
		const L = table.length;
		let s1: number;
		let die = false;
		if (f.by === 'life') {
			const start = Number(p.config.fxPathS0) || 0;
			const span = table.closed ? L : L - start;
			s1 = start + span * Math.min(1, Math.max(0, p.agePercent));
			if (table.closed && L > 0) s1 %= L;
		} else {
			const dt = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0;
			s1 = s0 + f.speed * Number(p.config.fxPathMult ?? 1) * dt;
			if (s1 > L) {
				if (f.end === 'die') die = true;
				else if (f.end === 'loop' && L > 0) s1 %= L;
				else s1 = L;
			}
		}
		// The difference of two points on the curve: a wrap (a closed lap, or `loop` on an open curve)
		// lands the particle back at the start of its copy of the curve.
		const a = table.pointAt(s0, this.tmp);
		const b = table.pointAt(s1, this.tmp2);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const cs = Number(p.config.fxPathCos ?? 1);
		const sn = Number(p.config.fxPathSin ?? 0);
		p.x += dx * cs - dy * sn;
		p.y += dx * sn + dy * cs;
		p.config.fxPathS = s1;
		if (f.orient) p.rotation = Number(p.config.fxPathRot ?? 0) + table.angleAt(s1);
		return die;
	}
}

// ---------------------------------------------------------------------------
// The tick hook
// ---------------------------------------------------------------------------

const TICK_HOOK = Symbol.for('engine-fx.emitterTick');

interface TickTarget extends FxPathEmitter {
	_autoUpdate?: boolean;
}

/**
 * Wrap `Emitter.prototype.update` so behaviors with a `tickEmitter(emitter, dt)` run before each
 * update (idempotent), with the seconds the original update is about to use. A renderer passes them;
 * an `autoUpdate` emitter is called by the shared Ticker with the Ticker itself, whose `deltaTime`
 * is in FRAMES — the library swaps in `Ticker.shared.elapsedMS * 0.001` inside the original update,
 * so the hook reads the same `elapsedMS` from the Ticker it was handed (`Ticker.shared`).
 */
export function installFxEmitterTick(emitterClass: unknown): void {
	const proto = (emitterClass as { prototype?: Record<PropertyKey, unknown> } | null)?.prototype;
	if (!proto || typeof proto.update !== 'function' || proto[TICK_HOOK]) return;
	const original = proto.update as (this: TickTarget, delta: unknown) => unknown;
	proto.update = function (this: TickTarget, delta: unknown): unknown {
		const behaviors = this.initBehaviors;
		if (behaviors) {
			const dt = tickSeconds(delta, this._autoUpdate === true);
			let pathTicked = false;
			for (const b of behaviors) {
				if (b instanceof FxPathBehavior) pathTicked = true;
				const tick = (b as { tickEmitter?: unknown } | null)?.tickEmitter;
				if (typeof tick === 'function') tick.call(b, this, dt);
			}
			if (!pathTicked && this.fxPathClock) releaseFxPath(this);
		}
		return original.call(this, delta);
	};
	proto[TICK_HOOK] = true;
}

function tickSeconds(delta: unknown, autoUpdate: boolean): number {
	if (typeof delta === 'number') return delta;
	const ticker = delta as { deltaTime?: unknown; elapsedMS?: unknown } | null;
	return autoUpdate ? Number(ticker?.elapsedMS) * 0.001 || 0 : Number(ticker?.deltaTime) || 0;
}
