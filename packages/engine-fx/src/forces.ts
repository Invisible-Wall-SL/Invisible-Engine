/**
 * Invisible FX — FORCES: gravity, wind, vortex, attractor, turbulence and drag, as ONE custom
 * `@barvynkoa/particle-emitter` behavior (`fxForces`) that integrates a velocity.
 *
 * The stock library has a single constant acceleration (`moveAcceleration`) and nothing that
 * depends on WHERE a particle is, so a swirl, a pull toward a point or a turbulent drift cannot be
 * authored with it. `fxForces` carries a stack of force entries in its config; each frame it sums
 * their accelerations at the particle's position and integrates them.
 *
 * How it combines with the movement behavior already on the layer (no movement is ever replaced):
 *  - **`moveAcceleration` / `moveSpeedStatic`** own a velocity (`particle.config.velocity`) and
 *    integrate it themselves. The forces add INTO that velocity, so the movement's `maxSpeed` clamp
 *    and its rotate-to-travel apply to the forced motion too, and drag slows the launch.
 *  - **anything else** (`moveSpeed` / `fxSpeed` — a speed curve the behavior rewrites each frame —
 *    or no movement at all): the forces keep their OWN velocity, starting at rest, and move the
 *    particle by it on top of the movement. Drag then damps that forced velocity — a terminal
 *    velocity for gravity — while the speed curve keeps owning the launch.
 *
 * Space: positions are the emitter PARENT's local space (where the library puts particles). A
 * force CENTRE is an offset from the emitter's live origin (`ownerPos + spawnPos`), so a vortex
 * follows a moving or bone-pinned emitter. Angles use the library's own convention, the one the
 * Direction knob writes: 0° = right, 90° = down (screen y grows downward), 180° = left, 270° = up.
 *
 * Frame-rate independence: accelerations are integrated per `deltaSec`, and with drag the step is
 * the exact solution of `v' = a − k·v` (decay `e^(−k·dt)`, terminal speed `a/k`); and turbulence/gusts are functions of the particle's AGE, not
 * of the frame count.
 *
 * {@link readFxForces} is the ONE clamp: the behavior's constructor and the `/fx` inspector both
 * read through it, so a hand-edited or out-of-range doc renders the same everywhere. Like the other
 * `engine-fx` behaviors this module imports nothing (no PixiJS), so the math is headless-testable;
 * `registerFxBehaviors(Emitter)` registers it alongside them.
 */

export const FX_FORCES_BEHAVIOR_TYPE = 'fxForces';

export type FxForceKind = 'gravity' | 'wind' | 'vortex' | 'attractor' | 'turbulence' | 'drag';

/** The kinds in the order the inspector offers them. */
export const FX_FORCE_KINDS: FxForceKind[] = [
	'gravity',
	'wind',
	'vortex',
	'attractor',
	'turbulence',
	'drag',
];

/** A constant pull along an angle — the gravity every movement mode can use. */
export interface FxGravityForce {
	kind: 'gravity';
	enabled: boolean;
	/** px/s². */
	strength: number;
	/** Degrees, the library convention (90 = down). */
	angle: number;
}

/** A push along an angle that GUSTS: each particle's share swings by `gust` at `gustFrequency`. */
export interface FxWindForce {
	kind: 'wind';
	enabled: boolean;
	/** px/s² at the gust's mean. */
	strength: number;
	angle: number;
	/** 0..1 — how far a gust swings the strength either side of its mean (0 = steady). */
	gust: number;
	/** Gust swings per second, per particle. */
	gustFrequency: number;
}

/** A swirl around a centre, with a radial push (+ out, centrifugal) or pull (− in, centripetal). */
export interface FxVortexForce {
	kind: 'vortex';
	enabled: boolean;
	/** Centre, as an offset from the emitter origin (px). */
	x: number;
	y: number;
	/** Tangential acceleration (px/s², ≥ 0); the sense is `direction`. */
	swirl: number;
	/** `cw` / `ccw` as seen on screen. */
	direction: 'cw' | 'ccw';
	/** Radial acceleration (px/s²): positive pushes OUT (centrifugal), negative pulls IN. */
	radial: number;
	/** Influence radius (px). 0 = unlimited (no falloff). */
	radius: number;
	/** Falloff exponent inside the radius: 0 = flat, 1 = linear, 2 = quadratic toward the edge. */
	falloff: number;
}

/** A point that pulls (+) or pushes (−), optionally swallowing what reaches it. */
export interface FxAttractorForce {
	kind: 'attractor';
	enabled: boolean;
	x: number;
	y: number;
	/** px/s²: positive attracts, negative repels. */
	strength: number;
	radius: number;
	falloff: number;
	/** Particles closer than this (px) are removed — a sink. 0 = never. */
	absorb: number;
}

/** A smooth, swirling (divergence-free) flow field the particles drift through. */
export interface FxTurbulenceForce {
	kind: 'turbulence';
	enabled: boolean;
	/** Peak acceleration (px/s²). */
	strength: number;
	/** Size of one swirl cell (px) — small = jittery, large = lazy. */
	scale: number;
	/** How fast the field changes as the particle ages (cycles/s). */
	speed: number;
}

/** Linear damping of the velocity the forces own — air resistance. */
export interface FxDragForce {
	kind: 'drag';
	enabled: boolean;
	/** Per second: speed falls to e^(−amount) of itself each second (0 = none). */
	amount: number;
}

export type FxForce =
	FxGravityForce | FxWindForce | FxVortexForce | FxAttractorForce | FxTurbulenceForce | FxDragForce;

/** `fxForces`' config — the stack, in authoring order (forces sum, so order never changes motion). */
export interface FxForcesConfig {
	forces: FxForce[];
}

/** Every numeric field's range and default — the inspector reads its slider bounds from here too. */
export const FX_FORCE_LIMITS = {
	strength: { min: 0, max: 10000, def: 600 },
	angle: { min: 0, max: 360, def: 90 },
	gust: { min: 0, max: 1, def: 0.5 },
	gustFrequency: { min: 0, max: 20, def: 1 },
	offset: { min: -5000, max: 5000, def: 0 },
	swirl: { min: 0, max: 20000, def: 1500 },
	radial: { min: -20000, max: 20000, def: 400 },
	radius: { min: 0, max: 5000, def: 0 },
	falloff: { min: 0, max: 4, def: 1 },
	pull: { min: -20000, max: 20000, def: 1200 },
	absorb: { min: 0, max: 1000, def: 0 },
	turbulenceScale: { min: 1, max: 2000, def: 120 },
	turbulenceSpeed: { min: 0, max: 10, def: 0.5 },
	drag: { min: 0, max: 20, def: 1.5 },
} as const;

type Limit = { min: number; max: number; def: number };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number pinned into its range; anything else is the field's default. */
function clampNum(v: unknown, l: Limit): number {
	const n = typeof v === 'number' ? v : Number.NaN;
	if (!Number.isFinite(n)) return l.def;
	return Math.min(l.max, Math.max(l.min, n));
}

/** An angle wrapped into [0, 360). Non-finite ⇒ the default. */
function wrapAngle(v: unknown, def: number): number {
	const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
	const w = n % 360;
	return w < 0 ? w + 360 : w;
}

/** A force with every field at its default — what the inspector's "Add" appends. */
export function defaultFxForce(kind: FxForceKind): FxForce {
	return readFxForce({ kind }) as FxForce;
}

/** Read + clamp ONE force entry; an unknown kind or a non-object reads as `undefined` (dropped). */
export function readFxForce(raw: unknown): FxForce | undefined {
	if (!isRecord(raw)) return undefined;
	const L = FX_FORCE_LIMITS;
	const enabled = raw.enabled !== false;
	switch (raw.kind) {
		case 'gravity':
			return {
				kind: 'gravity',
				enabled,
				strength: clampNum(raw.strength, L.strength),
				angle: wrapAngle(raw.angle, L.angle.def),
			};
		case 'wind':
			return {
				kind: 'wind',
				enabled,
				strength: clampNum(raw.strength, { ...L.strength, def: 300 }),
				angle: wrapAngle(raw.angle, 0),
				gust: clampNum(raw.gust, L.gust),
				gustFrequency: clampNum(raw.gustFrequency, L.gustFrequency),
			};
		case 'vortex':
			return {
				kind: 'vortex',
				enabled,
				x: clampNum(raw.x, L.offset),
				y: clampNum(raw.y, L.offset),
				swirl: clampNum(raw.swirl, L.swirl),
				direction: raw.direction === 'ccw' ? 'ccw' : 'cw',
				radial: clampNum(raw.radial, L.radial),
				radius: clampNum(raw.radius, L.radius),
				falloff: clampNum(raw.falloff, L.falloff),
			};
		case 'attractor':
			return {
				kind: 'attractor',
				enabled,
				x: clampNum(raw.x, L.offset),
				y: clampNum(raw.y, L.offset),
				strength: clampNum(raw.strength, L.pull),
				radius: clampNum(raw.radius, L.radius),
				falloff: clampNum(raw.falloff, L.falloff),
				absorb: clampNum(raw.absorb, L.absorb),
			};
		case 'turbulence':
			return {
				kind: 'turbulence',
				enabled,
				strength: clampNum(raw.strength, { ...L.strength, def: 400 }),
				scale: clampNum(raw.scale, L.turbulenceScale),
				speed: clampNum(raw.speed, L.turbulenceSpeed),
			};
		case 'drag':
			return { kind: 'drag', enabled, amount: clampNum(raw.amount, L.drag) };
		default:
			return undefined;
	}
}

/** The single clamp: an `fxForces` behavior config (or anything) → its clean force stack. */
export function readFxForces(config: unknown): FxForce[] {
	const list = isRecord(config) && Array.isArray(config.forces) ? config.forces : [];
	return list.map(readFxForce).filter((f): f is FxForce => f !== undefined);
}

/** A mutable 2D vector — the forces' scratch + per-particle velocity. */
export interface FxVec {
	x: number;
	y: number;
}

/** Where the force field is centred and how old the particle is — the inputs beside position. */
export interface FxForceSample {
	/** Particle position (emitter-parent space). */
	x: number;
	y: number;
	/** The emitter origin the force centres are offset from. */
	originX: number;
	originY: number;
	/** Particle age (s). */
	age: number;
	/** Per-particle phase in [0, 1) so gusts and turbulence don't move every particle in lockstep. */
	seed: number;
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** Below this distance (px) a centre's direction is undefined — radial/swirl push is skipped. */
const CENTRE_EPS = 1e-3;

/** 1 inside an unlimited radius; else `(1 − d/r)^falloff` inside, 0 outside. */
function falloffWeight(d: number, radius: number, falloff: number): number {
	if (radius <= 0) return 1;
	if (d >= radius) return 0;
	return falloff <= 0 ? 1 : (1 - d / radius) ** falloff;
}

/**
 * The summed acceleration of every enabled positional/constant force at one sample, into `out`.
 * Drag is NOT an acceleration (it is a decay, applied by {@link stepFxForces}) and is skipped here.
 * Returns `true` when an attractor's `absorb` radius has caught the particle.
 */
export function fxForceAcceleration(forces: FxForce[], s: FxForceSample, out: FxVec): boolean {
	out.x = 0;
	out.y = 0;
	let absorbed = false;
	for (const f of forces) {
		if (!f.enabled) continue;
		switch (f.kind) {
			case 'gravity': {
				out.x += Math.cos(f.angle * DEG) * f.strength;
				out.y += Math.sin(f.angle * DEG) * f.strength;
				break;
			}
			case 'wind': {
				const swing = f.gust * Math.sin(TAU * (f.gustFrequency * s.age + s.seed));
				const a = f.strength * (1 + swing);
				out.x += Math.cos(f.angle * DEG) * a;
				out.y += Math.sin(f.angle * DEG) * a;
				break;
			}
			case 'vortex': {
				const rx = s.x - (s.originX + f.x);
				const ry = s.y - (s.originY + f.y);
				const d = Math.hypot(rx, ry);
				if (d < CENTRE_EPS) break;
				const w = falloffWeight(d, f.radius, f.falloff);
				if (w === 0) break;
				const ux = rx / d;
				const uy = ry / d;
				// Screen y grows DOWN, so the clockwise tangent of (ux, uy) is (−uy, ux).
				const sense = f.direction === 'cw' ? 1 : -1;
				out.x += (-uy * f.swirl * sense + ux * f.radial) * w;
				out.y += (ux * f.swirl * sense + uy * f.radial) * w;
				break;
			}
			case 'attractor': {
				const rx = s.originX + f.x - s.x;
				const ry = s.originY + f.y - s.y;
				const d = Math.hypot(rx, ry);
				if (f.absorb > 0 && d <= f.absorb) absorbed = true;
				if (d < CENTRE_EPS) break;
				const w = falloffWeight(d, f.radius, f.falloff);
				out.x += (rx / d) * f.strength * w;
				out.y += (ry / d) * f.strength * w;
				break;
			}
			case 'turbulence': {
				// Two octaves of the curl of ψ = sin(kx + p)·sin(ky + q). Each octave's (∂ψ/∂y, −∂ψ/∂x)
				// is divergence-free, so particles swirl through the field instead of bunching into
				// sinks; the second, finer octave drifts the other way and breaks up the grid.
				const k = TAU / f.scale;
				const t = TAU * (f.speed * s.age + s.seed);
				const ax = k * s.x + t;
				const ay = k * s.y + t * 0.73;
				const bx = k * 1.7 * s.x - t * 1.31;
				const by = k * 1.7 * s.y + t * 0.89;
				const vx = Math.sin(ax) * Math.cos(ay) + 0.5 * Math.sin(bx) * Math.cos(by);
				const vy = -Math.cos(ax) * Math.sin(ay) - 0.5 * Math.cos(bx) * Math.sin(by);
				out.x += vx * f.strength * (2 / 3);
				out.y += vy * f.strength * (2 / 3);
				break;
			}
			case 'drag':
				break;
		}
	}
	return absorbed;
}

/** Whether an enabled attractor's `absorb` radius holds the sample's position. */
export function fxAbsorbs(forces: FxForce[], s: FxForceSample): boolean {
	for (const f of forces) {
		if (!f.enabled || f.kind !== 'attractor' || f.absorb <= 0) continue;
		if (Math.hypot(s.originX + f.x - s.x, s.originY + f.y - s.y) <= f.absorb) return true;
	}
	return false;
}

/** The summed drag coefficient of the enabled drag entries (0 = none). */
export function fxDragAmount(forces: FxForce[]): number {
	let k = 0;
	for (const f of forces) if (f.enabled && f.kind === 'drag') k += f.amount;
	return k;
}

/**
 * Advance one velocity by `dt` under the stack: the summed acceleration, decayed by drag.
 * Returns `true` when the particle was absorbed. Pure apart from writing `vel` and `scratch`.
 */
export function stepFxForces(
	forces: FxForce[],
	s: FxForceSample,
	vel: FxVec,
	dt: number,
	drag: number,
	scratch: FxVec,
): boolean {
	const absorbed = fxForceAcceleration(forces, s, scratch);
	if (drag > 0) {
		// The exact solution of v' = a − k·v over dt (a held for the step), so neither the decay nor
		// the terminal speed a/k depends on the frame rate.
		const decay = Math.exp(-drag * dt);
		const gain = (1 - decay) / drag;
		vel.x = vel.x * decay + scratch.x * gain;
		vel.y = vel.y * decay + scratch.y * gain;
	} else {
		vel.x += scratch.x * dt;
		vel.y += scratch.y * dt;
	}
	return absorbed;
}

/** The slice of the library's `Particle` the forces read/write (no PixiJS type). */
export interface FxForceParticle {
	x: number;
	y: number;
	age: number;
	config: Record<string, unknown>;
	next: FxForceParticle | null;
	emitter?: {
		ownerPos: FxVec;
		spawnPos: FxVec;
		getBehavior?(type: string): unknown;
	} | null;
}

/** Movement behaviors that own `particle.config.velocity` and integrate it themselves. */
const VELOCITY_OWNERS = ['moveAcceleration', 'moveSpeedStatic'];

/** The library's `BehaviorOrder.Late` — beside the movement behaviors. */
const ORDER_LATE = 5;

/** See the module header. */
export class FxForcesBehavior {
	static type = FX_FORCES_BEHAVIOR_TYPE;
	order = ORDER_LATE;
	readonly forces: FxForce[];
	private drag: number;
	private active: boolean;
	/** Whether this emitter's movement owns a velocity the forces add into ({@link resolveShared}). */
	private shared: boolean | undefined;
	private scratch: FxVec = { x: 0, y: 0 };
	private sample: FxForceSample = { x: 0, y: 0, originX: 0, originY: 0, age: 0, seed: 0 };

	constructor(config: FxForcesConfig) {
		this.forces = readFxForces(config);
		this.drag = fxDragAmount(this.forces);
		this.active = this.forces.some((f) => f.enabled);
	}

	/** Resolved from the emitter the first time a particle is seen, at init OR update: an instance an
	 * exposed parameter rebuilt mid-flight sees live particles before it sees a new one. */
	private resolveShared(em: FxForceParticle['emitter']): boolean {
		if (this.shared === undefined) {
			this.shared = VELOCITY_OWNERS.some((t) => !!em?.getBehavior?.(t));
		}
		return this.shared;
	}

	initParticles(first: FxForceParticle): void {
		this.resolveShared(first?.emitter);
		for (let p: FxForceParticle | null = first; p; p = p.next) {
			p.config.fxForceSeed = Math.random();
			const own = p.config.fxForceVel as FxVec | undefined;
			if (own) {
				own.x = 0;
				own.y = 0;
			} else p.config.fxForceVel = { x: 0, y: 0 };
		}
	}

	updateParticle(particle: FxForceParticle, deltaSec: number): boolean {
		if (!this.active || !(deltaSec > 0)) return false;
		const s = this.sample;
		const em = particle.emitter;
		s.x = particle.x;
		s.y = particle.y;
		s.originX = (em?.ownerPos.x ?? 0) + (em?.spawnPos.x ?? 0);
		s.originY = (em?.ownerPos.y ?? 0) + (em?.spawnPos.y ?? 0);
		s.age = particle.age;
		s.seed = Number(particle.config.fxForceSeed ?? 0);
		const movementVel = this.resolveShared(em)
			? (particle.config.velocity as FxVec | undefined)
			: undefined;
		if (movementVel) {
			return stepFxForces(this.forces, s, movementVel, deltaSec, this.drag, this.scratch);
		}
		const vel = particle.config.fxForceVel as FxVec | undefined;
		if (!vel) return false;
		const oldX = vel.x;
		const oldY = vel.y;
		const absorbed = stepFxForces(this.forces, s, vel, deltaSec, this.drag, this.scratch);
		// Midpoint of old and new velocity — the same integration `moveAcceleration` uses.
		particle.x += ((oldX + vel.x) / 2) * deltaSec;
		particle.y += ((oldY + vel.y) / 2) * deltaSec;
		if (absorbed) return true;
		// Checked again where the step landed, so nothing is left drawn inside a sink for a frame.
		s.x = particle.x;
		s.y = particle.y;
		return fxAbsorbs(this.forces, s);
	}
}
