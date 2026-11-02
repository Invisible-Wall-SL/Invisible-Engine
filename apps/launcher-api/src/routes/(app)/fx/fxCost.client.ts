/**
 * Invisible FX — the live PERFORMANCE COST readout: what an effect costs the GPU while it is
 * authored. Two halves:
 *  - measured, by the stage every frame: the live particles of each layer, and its COVERAGE — the
 *    sum of every particle's on-screen bounds (clipped to the viewport) over the viewport's area,
 *    so roughly how many full screens of pixels the GPU blends for it;
 *  - read off the layer's config: the settings that drive that cost (Max particles, spawn rate,
 *    lifetime, blend mode, art frame size), and plain-English hints for the usual causes.
 *
 * Read-only: nothing here writes a config or touches how an emitter plays. Pure (no rune, no DOM, no
 * Pixi object constructed), so `tools/fx-spike/fxCost.ts` covers it in Node.
 */

import type { Emitter, EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { behaviorsOf, type EmitterLayer } from 'engine-fx';
import { blendMode, curveRange, type Affine, type BlendKind } from './fxModel.client';

/**
 * The budgets the readout warns against. Live particles cost CPU (each is updated every frame);
 * coverage costs GPU fill (each covered pixel is blended once per particle over it).
 */
export const FX_COST_BUDGET = {
	layer: { live: 300, coverage: 1.5 },
	total: { live: 800, coverage: 4 },
} as const;

export interface FxCostBudget {
	live: number;
	coverage: number;
}

/** One frame's (or a peak's) measure of a layer or of the whole effect. */
export interface FxCostSample {
	live: number;
	/** Covered pixels ÷ the viewport's pixels. */
	coverage: number;
}

export interface FxLayerCostReading {
	now: FxCostSample;
	/** The most each has been since the effect last changed or the view moved. */
	peak: FxCostSample;
}

/** What the stage reports, a few times a second. */
export interface FxStageCost {
	/** The area coverage is measured against: the preview viewport, in CSS pixels. */
	viewport: { w: number; h: number; zoom: number };
	layers: Record<string, FxLayerCostReading>;
	total: { now: FxCostSample; peak: FxCostSample };
}

/** A sprite's local bounds (Pixi's `Sprite.bounds`: the anchor-offset frame rectangle). */
export interface LocalBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * The on-screen area of a rectangle in local space under `m` (local → screen), taken as the
 * axis-aligned box around its four transformed corners, clipped to a `w` × `h` viewport at 0,0.
 */
export function clippedScreenArea(m: Affine, b: LocalBounds, w: number, h: number): number {
	const ax = m.a * b.minX + m.c * b.minY + m.tx;
	const ay = m.b * b.minX + m.d * b.minY + m.ty;
	const bx = m.a * b.maxX + m.c * b.minY + m.tx;
	const by = m.b * b.maxX + m.d * b.minY + m.ty;
	const cx = m.a * b.maxX + m.c * b.maxY + m.tx;
	const cy = m.b * b.maxX + m.d * b.maxY + m.ty;
	const dx = m.a * b.minX + m.c * b.maxY + m.tx;
	const dy = m.b * b.minX + m.d * b.maxY + m.ty;
	const x0 = Math.max(0, Math.min(ax, bx, cx, dx));
	const x1 = Math.min(w, Math.max(ax, bx, cx, dx));
	const y0 = Math.max(0, Math.min(ay, by, cy, dy));
	const y1 = Math.min(h, Math.max(ay, by, cy, dy));
	return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
}

/** `p` then `q`: the affine that maps through `q` first, then `p` (`p · q`). */
export function multiplyAffine(p: Affine, q: Affine): Affine {
	return {
		a: p.a * q.a + p.c * q.b,
		b: p.b * q.a + p.d * q.b,
		c: p.a * q.c + p.c * q.d,
		d: p.b * q.c + p.d * q.d,
		tx: p.a * q.tx + p.c * q.ty + p.tx,
		ty: p.b * q.tx + p.d * q.ty + p.ty,
	};
}

/** The parts of a live particle the measure reads (a library `Particle` is a Pixi `Sprite`). */
interface MeasuredParticle {
	visible: boolean;
	alpha: number;
	bounds: LocalBounds;
	localTransform: Affine;
	updateLocalTransform(): void;
	next: MeasuredParticle | null;
}

const firstParticle = (emitter: Emitter): MeasuredParticle | null =>
	(emitter as unknown as { _activeParticlesFirst: MeasuredParticle | null })._activeParticlesFirst;

/**
 * Walk an emitter's live particles: how many, and the screen pixels their bounds cover, clipped to
 * the viewport. `toScreen` maps the particles' parent into screen pixels. A hidden or fully
 * transparent particle is counted live (it is still updated) but covers nothing.
 */
export function measureEmitter(
	emitter: Emitter,
	toScreen: Affine,
	w: number,
	h: number,
): { live: number; area: number } {
	let live = 0;
	let area = 0;
	for (let p = firstParticle(emitter); p; p = p.next) {
		live++;
		if (!p.visible || p.alpha <= 0) continue;
		p.updateLocalTransform();
		area += clippedScreenArea(multiplyAffine(toScreen, p.localTransform), p.bounds, w, h);
	}
	return { live, area };
}

/** Over `budget` on either axis. */
export const overBudget = (s: FxCostSample, budget: FxCostBudget): boolean =>
	s.live > budget.live || s.coverage > budget.coverage;

/** The settings of a layer that drive its cost, as authored. */
export interface FxLayerCostSettings {
	maxParticles: number;
	/** Particles asked for per second (`particlesPerWave × spawnChance ÷ frequency`); 0 when off. */
	spawnRate: number;
	lifetime: { min: number; max: number };
	blend: BlendKind;
	/** The largest art frame in pixels (0 × 0 when no art is bound or its regions are not read). */
	frame: { w: number; h: number };
	/** The largest scale the scale behaviour gives a particle (1 without one). */
	scale: number;
	/** How many the rate would keep alive with no cap: `spawnRate × the average lifetime`. */
	demand: number;
}

const num = (v: unknown, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function largestScale(config: EmitterConfigV3): number {
	const curve = curveRange(config, 'scale');
	if (curve) return Math.max(Math.abs(curve.startMax), Math.abs(curve.endMax));
	const fixed = behaviorsOf(config).find((b) => b.type === 'scaleStatic');
	if (fixed)
		return Math.max(Math.abs(num(fixed.config.min, 1)), Math.abs(num(fixed.config.max, 1)));
	return 1;
}

export function layerCostSettings(
	layer: EmitterLayer,
	frame: { w: number; h: number },
): FxLayerCostSettings {
	const c = layer.config;
	const frequency = num(c.frequency, 0);
	const perWave = Math.max(1, num(c.particlesPerWave, 1));
	const chance = Math.min(1, Math.max(0, num(c.spawnChance, 1)));
	const spawnRate = frequency > 0 ? (perWave * chance) / frequency : 0;
	const min = Math.max(0, num(c.lifetime?.min, 0));
	const max = Math.max(min, num(c.lifetime?.max, min));
	return {
		maxParticles: Math.max(0, num(c.maxParticles, 1000)),
		spawnRate,
		lifetime: { min, max },
		blend: blendMode(c),
		frame,
		scale: largestScale(c),
		demand: (spawnRate * (min + max)) / 2,
	};
}

/** The rate asks for this many times Max particles: the emitter sits at its cap. */
export const AT_CAP_RATIO = 2;
/** A particle whose art × scale is this many pixels on its long side is "very large". */
export const LARGE_PARTICLE_PX = 400;
/** Each particle covering this share of the viewport on average is "very large" on screen. */
export const LARGE_PARTICLE_SCREEN = 0.05;

export interface FxCostHint {
	/** Which cause: the readout keys on it. */
	kind: 'cap' | 'large' | 'additive' | 'count' | 'coverage';
	text: string;
}

const round = (n: number): string =>
	n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(1) : n.toFixed(2);

/**
 * Plain-English hints for a layer: why it costs what it does. `reading` is what the stage measured
 * (its peak), absent before the layer has drawn.
 */
export function layerCostHints(
	settings: FxLayerCostSettings,
	reading: FxCostSample | undefined,
	budget: FxCostBudget = FX_COST_BUDGET.layer,
): FxCostHint[] {
	const hints: FxCostHint[] = [];
	const { maxParticles, spawnRate, demand, lifetime, frame, scale, blend } = settings;
	if (maxParticles > 0 && demand >= AT_CAP_RATIO * maxParticles) {
		const life = (lifetime.min + lifetime.max) / 2;
		const fits = life > 0 ? maxParticles / life : 0;
		hints.push({
			kind: 'cap',
			text:
				`Asks for ${round(spawnRate)}/s but Max particles is ${maxParticles}: it sits at its cap all the ` +
				`time and every slot costs every frame.` +
				(fits > 0 ? ` About ${round(fits)}/s fills it; slow the rate or lower Max particles.` : ''),
		});
	}
	const side = Math.max(frame.w, frame.h) * scale;
	const perParticle = reading && reading.live > 0 ? reading.coverage / reading.live : 0;
	if (side >= LARGE_PARTICLE_PX || perParticle >= LARGE_PARTICLE_SCREEN) {
		const art = frame.w && frame.h ? `art ${frame.w}×${frame.h}` : 'art';
		hints.push({
			kind: 'large',
			text:
				`Very large particles: ${art} at scale ${round(scale)}` +
				(perParticle > 0 ? `, each ~${Math.round(perParticle * 100)}% of the screen` : '') +
				`. Use a smaller sprite or a smaller scale.`,
		});
	}
	if ((blend === 'add' || blend === 'screen') && reading && reading.coverage > 1) {
		hints.push({
			kind: 'additive',
			text:
				`${blend === 'add' ? 'Additive' : 'Screen'} blending stacks: ${round(reading.coverage)} ` +
				`screens blended per frame. Transparent pixels still cost; fewer, smaller or ` +
				`shorter-lived particles cost less.`,
		});
	}
	if (reading && reading.live > budget.live && !hints.some((h) => h.kind === 'cap'))
		hints.push({
			kind: 'count',
			text: `${reading.live} particles live (budget ${budget.live}). Lower Max particles or the rate.`,
		});
	if (
		reading &&
		reading.coverage > budget.coverage &&
		!hints.some((h) => h.kind === 'large' || h.kind === 'additive')
	)
		hints.push({
			kind: 'coverage',
			text: `Covers ${round(reading.coverage)} screens (budget ${budget.coverage}). Fewer or smaller particles cost less.`,
		});
	return hints;
}

/** `1.23×`, the readout's coverage format. */
export const formatScreens = (coverage: number): string => `${round(coverage)}×`;

/** A spawn rate for the readout: `1000/s`, `2.5/s`, or `—` when the layer does not spawn. */
export const formatRate = (rate: number): string => (rate > 0 ? `${round(rate)}/s` : '—');
