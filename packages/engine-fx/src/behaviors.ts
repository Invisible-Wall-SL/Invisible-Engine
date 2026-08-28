/**
 * Invisible FX — the two CUSTOM particle behaviors that give the author per-particle randomness
 * `@barvynkoa/particle-emitter` has no stock behavior for.
 *
 * The library models per-particle variation as a `minMult` on the Movement (`moveSpeed`) and
 * Scale behaviors — a random multiplier in `[minMult, 1]` picked once per particle and applied
 * to that behavior's whole curve. `alpha` has NO such knob, and NOTHING randomises tint at all.
 * So "min/max for everything that can have it" needs exactly two additions:
 *
 *  - `fxAlpha`        — the stock `alpha` curve PLUS a `minMult`, i.e. Scale's contract for alpha.
 *  - `fxColorOverlay` — a colour laid over the particle at a per-particle random INTENSITY.
 *
 * Both are plain classes matching the library's `IEmitterBehavior` duck type (`order` +
 * `initParticles`, optional `updateParticle`) — the same pluggable seam Tier C's `spineParticle`
 * behavior stands on. They import NOTHING: no PixiJS, no particle-emitter, so this module stays
 * pure and headlessly unit-coverable like the rest of `engine-fx`. Registration therefore takes
 * the `Emitter` class as an ARGUMENT ({@link registerFxBehaviors}) rather than importing it.
 *
 * ⚠ A config only carries these types when the author actually enables the feature, so every
 * effect that doesn't use them stays 100% stock. A doc that DOES use them needs
 * `registerFxBehaviors(Emitter)` to have run in the renderer first — the library logs
 * `Unknown behavior: fxAlpha` and drops it otherwise (visible degradation, never a crash).
 * Call sites: the runtime `<ParticleEmitter>` and the launcher's shared `effectEmitter.client.ts`
 * (which every launcher-side stage — `/fx`, the Scene Editor, the Rigger/Symbols overlay — imports).
 */

/** One point of a V3 `ValueList` curve (`{ time: 0..1, value }`). */
export interface FxCurvePoint {
	time: number;
	value: number;
}

/** The `ValueList<number>` shape the stock list-property behaviors take. */
export interface FxCurve {
	list: FxCurvePoint[];
	isStepped?: boolean;
}

/**
 * The slice of the library's `Particle` these behaviors touch. Restated structurally (the
 * library's `Particle` type would drag PixiJS in) — `config` is its per-particle scratch bag,
 * the same one `ScaleBehavior` stores its `scaleMult` in.
 */
export interface FxParticleLike {
	alpha: number;
	tint: number;
	agePercent: number;
	config: Record<string, unknown>;
	next: FxParticleLike | null;
}

/** The library's `BehaviorOrder.Normal` — the slot the stock `alpha` behavior occupies. */
const ORDER_NORMAL = 2;
/** The library's `BehaviorOrder.Late` — runs after `color`, so an overlay sees the final tint. */
const ORDER_LATE = 5;

/** Piecewise-linear (or stepped) read of a V3 curve at `t` ∈ 0..1. Empty ⇒ `fallback`. */
function curveAt(curve: FxCurve | undefined, t: number, fallback: number): number {
	const list = curve?.list;
	if (!Array.isArray(list) || list.length === 0) return fallback;
	if (list.length === 1) return list[0].value;
	for (let i = 0; i < list.length - 1; i++) {
		const a = list[i];
		const b = list[i + 1];
		if (t > b.time) continue;
		if (curve?.isStepped) return a.value;
		const span = b.time - a.time;
		const k = span > 0 ? Math.min(1, Math.max(0, (t - a.time) / span)) : 0;
		return a.value + (b.value - a.value) * k;
	}
	return list[list.length - 1].value;
}

/** A random multiplier in `[minMult, 1]` — the library's own `ScaleBehavior` formula. */
function randMult(minMult: number): number {
	return Math.random() * (1 - minMult) + minMult;
}

export const FX_ALPHA_BEHAVIOR_TYPE = 'fxAlpha';

/** `fxAlpha`'s config — the stock `alpha` block plus Scale's `minMult` randomiser. */
export interface FxAlphaConfig {
	alpha: FxCurve;
	/** Each particle multiplies the whole alpha curve by a random value in `[minMult, 1]`. */
	minMult?: number;
}

/**
 * Alpha over life WITH per-particle variation — `ScaleBehavior`'s contract applied to opacity.
 *
 * Self-contained on purpose: it owns the curve rather than multiplying whatever a stock `alpha`
 * behavior last wrote. A "multiply the current alpha" add-on would compound its own output every
 * frame whenever the `alpha` behavior is absent (opacity decaying to zero), so the two never
 * coexist — the authoring model swaps `alpha` ⇄ `fxAlpha` as variation is toggled.
 */
export class FxAlphaBehavior {
	static type = FX_ALPHA_BEHAVIOR_TYPE;
	order = ORDER_NORMAL;
	private curve: FxCurve;
	private minMult: number;

	constructor(config: FxAlphaConfig) {
		this.curve = config?.alpha ?? { list: [] };
		const m = Number(config?.minMult);
		this.minMult = Number.isFinite(m) ? Math.min(1, Math.max(0, m)) : 1;
	}

	initParticles(first: FxParticleLike): void {
		for (let p: FxParticleLike | null = first; p; p = p.next) {
			const mult = randMult(this.minMult);
			p.config.fxAlphaMult = mult;
			p.alpha = curveAt(this.curve, 0, 1) * mult;
		}
	}

	updateParticle(particle: FxParticleLike): void {
		const mult = Number(particle.config.fxAlphaMult ?? 1);
		particle.alpha = curveAt(this.curve, particle.agePercent, 1) * mult;
	}
}

export const FX_COLOR_OVERLAY_BEHAVIOR_TYPE = 'fxColorOverlay';

/** `fxColorOverlay`'s config — an overlay colour + the per-particle intensity range. */
export interface FxColorOverlayConfig {
	/** 6-digit hex (`#rrggbb`), the library's own colour notation. */
	color: string;
	/** Intensity range; each particle picks one value in `[min, max]`. 0 = untouched, 1 = full. */
	minIntensity?: number;
	maxIntensity?: number;
}

/** `#rrggbb` → `{ r, g, b }` (0–255). An unparseable value reads as white (a no-op overlay). */
function hexRgb(hex: string): { r: number; g: number; b: number } {
	const clean = String(hex ?? '')
		.replace(/^#/, '')
		.replace(/^0x/i, '');
	const n = Number.parseInt(
		clean.length === 3 ? clean.replace(/./g, '$&$&') : clean.slice(0, 6),
		16,
	);
	if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/**
 * Lay a colour over each particle at a per-particle RANDOM intensity — the tint knob the library
 * has no behavior for (`color` interpolates over life, identically for every particle;
 * `colorStatic` is one fixed colour).
 *
 * It runs LATE so it composes ON TOP of whatever `color`/`colorStatic` produced rather than
 * fighting it. Composition is feedback-safe without knowing whether a colour behavior exists:
 * each particle remembers the tint this behavior last WROTE, so a value that no longer matches
 * can only have come from someone else — that becomes the new base. With no colour behavior
 * present the base never changes and the overlay is idempotent.
 */
export class FxColorOverlayBehavior {
	static type = FX_COLOR_OVERLAY_BEHAVIOR_TYPE;
	order = ORDER_LATE;
	private rgb: { r: number; g: number; b: number };
	private min: number;
	private max: number;

	constructor(config: FxColorOverlayConfig) {
		this.rgb = hexRgb(config?.color ?? '#ffffff');
		const lo = Number(config?.minIntensity);
		const hi = Number(config?.maxIntensity);
		this.min = Number.isFinite(lo) ? Math.min(1, Math.max(0, lo)) : 1;
		this.max = Number.isFinite(hi) ? Math.min(1, Math.max(0, hi)) : this.min;
		if (this.max < this.min) [this.min, this.max] = [this.max, this.min];
	}

	private blend(base: number, t: number): number {
		const br = (base >> 16) & 0xff;
		const bg = (base >> 8) & 0xff;
		const bb = base & 0xff;
		const r = Math.round(br + (this.rgb.r - br) * t);
		const g = Math.round(bg + (this.rgb.g - bg) * t);
		const b = Math.round(bb + (this.rgb.b - bb) * t);
		return (r << 16) | (g << 8) | b;
	}

	initParticles(first: FxParticleLike): void {
		for (let p: FxParticleLike | null = first; p; p = p.next) {
			const t = this.min + Math.random() * (this.max - this.min);
			const base = typeof p.tint === 'number' ? p.tint : 0xffffff;
			p.config.fxOverlayT = t;
			p.config.fxOverlayBase = base;
			const out = this.blend(base, t);
			p.tint = out;
			p.config.fxOverlayOut = out;
		}
	}

	updateParticle(particle: FxParticleLike): void {
		const cfg = particle.config;
		if (particle.tint !== cfg.fxOverlayOut) cfg.fxOverlayBase = particle.tint;
		const base = Number(cfg.fxOverlayBase ?? 0xffffff);
		const out = this.blend(base, Number(cfg.fxOverlayT ?? 1));
		particle.tint = out;
		cfg.fxOverlayOut = out;
	}
}

/** The minimal surface {@link registerFxBehaviors} needs — the library's `Emitter` class satisfies it. */
export interface FxBehaviorRegistrar {
	registerBehavior(constructor: never): void;
}

/** Every custom behavior an authored `EffectDoc` can reference (registration + doc-validation). */
export const FX_BEHAVIOR_TYPES = [FX_ALPHA_BEHAVIOR_TYPE, FX_COLOR_OVERLAY_BEHAVIOR_TYPE];

/**
 * Teach an `Emitter` class the FX behaviors. Idempotent (the library's registry is a plain map
 * keyed by `type`), so every renderer can call it unconditionally at module load.
 */
export function registerFxBehaviors(emitter: FxBehaviorRegistrar): void {
	emitter.registerBehavior(FxAlphaBehavior as never);
	emitter.registerBehavior(FxColorOverlayBehavior as never);
}
