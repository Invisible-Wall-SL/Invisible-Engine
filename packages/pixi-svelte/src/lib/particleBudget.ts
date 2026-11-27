/**
 * The PARTICLE BUDGET: one quality factor, {@link PARTICLE_BUDGET_FLOOR}..1, that every
 * `<ParticleEmitter>` scales its particle cap and spawn chance by. Measured on `overlay-wishworld`
 * (2026-11-02, a Pixel-sized page with the CPU slowed 4×): its effects held 1,100–4,000 live
 * particles, blended 7–130 screens of pixels a frame, and were over half of every spin frame;
 * capping each emitter at 60 cut that frame by 44%.
 *
 * Inactive until the game turns it on ({@link configureParticleBudget}): the tools never do, so
 * `/fx`, the Scene Editor and the Rigger preview every particle. Once on it starts from the render
 * tier (`renderTier.ts`: only `?render=reduced` caps it, at {@link REDUCED_TIER_QUALITY}) and,
 * when adaptive, follows the frame time: a second of frames slower than 1.5× the target steps it
 * down by {@link STEP}, three seconds faster than 1.1× step it back up, never above the tier's cap.
 * `?particles=<0.25..1>` pins it for testing, and `?particles=off` turns every emitter and baked
 * effect off ({@link particlesOff}: none updates or draws) while everything else plays, for an A/B
 * read of what particles cost.
 *
 * The render-quality ladder's last step (`renderQuality.ts`) lowers the cap further
 * ({@link capParticleBudget}) on a device that cannot hold its frame rate, and lifts it again when
 * the level rises. Without the ladder the cap is the tier's.
 *
 * At 1 an emitter is left exactly as authored (`ParticleEmitter`), so a device that keeps up draws
 * every particle it always did.
 */

import { renderTier, type RenderTier } from './renderTier';

export const PARTICLE_BUDGET_FLOOR = 0.25;
const REDUCED_TIER_QUALITY = 0.5;
const STEP = 0.8;
const WINDOW_MS = 1000;
const RECOVER_WINDOWS = 3;
/** A frame this long is a resumed tab or a load hitch, not the steady cost the budget answers. */
const OUTLIER_MS = 250;
const FALLBACK_FPS = 60;

/** Emitters capped this low keep every particle: one hero sprite thinned by chance would blink. */
export const PARTICLE_BUDGET_MIN_SCALED = 8;

let quality = 1;
let ceiling = 1;
/** The tier's cap: {@link capParticleBudget} never lifts the cap above it. */
let tierCeiling = 1;
/** The render-quality ladder's cap, kept through a later {@link configureParticleBudget}. */
let ladderCap = 1;
let configured = false;
let pinned = false;
let adaptive = false;
let off = false;
let windowMs = 0;
let windowFrames = 0;
let fastWindows = 0;
let lastFrame: number | undefined;

/** `?particles=` read: `off`, a pinned quality (clamped to the floor..1), or none. */
export function parseParticlesParam(raw: string | null): number | 'off' | undefined {
	if (raw === null) return undefined;
	if (raw === 'off') return 'off';
	const v = Number(raw);
	return Number.isFinite(v) ? Math.min(1, Math.max(PARTICLE_BUDGET_FLOOR, v)) : undefined;
}

const pinnedParticles = (): number | 'off' | undefined =>
	typeof window === 'undefined'
		? undefined
		: parseParticlesParam(new URLSearchParams(window.location.search).get('particles'));

/**
 * Turn the budget on for a game. `adaptive: false` keeps it at the tier's cap (a deterministic
 * render must not depend on how fast its machine draws).
 */
export function configureParticleBudget({
	tier = renderTier(),
	adaptive: follow = true,
}: { tier?: RenderTier; adaptive?: boolean } = {}): void {
	tierCeiling = tier === 'reduced' ? REDUCED_TIER_QUALITY : 1;
	ceiling = Math.min(tierCeiling, ladderCap);
	configured = true;
	const pin = pinnedParticles();
	pinned = pin !== undefined;
	off = pin === 'off';
	quality = typeof pin === 'number' ? pin : ceiling;
	adaptive = !pinned && follow;
	windowMs = 0;
	windowFrames = 0;
	fastWindows = 0;
	lastFrame = undefined;
}

/**
 * Cap the budget at `cap` (clamped to the floor..1, never above the tier's cap), or lift the cap
 * back with 1. Lowering it lowers the quality at once; lifting it lets an adaptive budget climb back
 * at its own pace. A pinned `?particles=` and a budget no game configured are left alone: before
 * {@link configureParticleBudget} it does nothing (the cap is not kept for later). A later
 * configure keeps the cap the configured budget last took, so a game that configures again while
 * the ladder is at its last level stays capped until the ladder lifts it.
 */
export function capParticleBudget(cap: number): void {
	if (!configured || pinned) return;
	const clamped = Number.isFinite(cap) ? Math.min(1, Math.max(PARTICLE_BUDGET_FLOOR, cap)) : 1;
	ladderCap = clamped;
	ceiling = Math.min(tierCeiling, clamped);
	quality = adaptive ? Math.min(quality, ceiling) : ceiling;
	fastWindows = 0;
}

/** The factor emitters scale by now: 1 while the budget is off. */
export const particleQuality = (): number => quality;

/** `?particles=off` in a game: no emitter or baked effect updates or draws. A test switch. */
export const particlesOff = (): boolean => off;

/**
 * Feed one rendered frame. Every emitter calls it from its tick with the shared ticker's
 * `lastTime`, so a frame counts once however many emitters are playing; `maxFPS` (0 = uncapped) sets
 * the target a capped game is measured against.
 */
export function sampleParticleFrame(frameTime: number, deltaMS: number, maxFPS: number): void {
	if (!adaptive || frameTime === lastFrame) return;
	lastFrame = frameTime;
	if (!(deltaMS > 0) || deltaMS > OUTLIER_MS) return;
	windowMs += deltaMS;
	windowFrames++;
	if (windowMs < WINDOW_MS) return;
	const mean = windowMs / windowFrames;
	windowMs = 0;
	windowFrames = 0;
	const target = 1000 / (maxFPS > 0 ? maxFPS : FALLBACK_FPS);
	if (mean > target * 1.5) {
		quality = Math.max(PARTICLE_BUDGET_FLOOR, quality * STEP);
		fastWindows = 0;
	} else if (mean < target * 1.1 && quality < ceiling) {
		if (++fastWindows >= RECOVER_WINDOWS) {
			quality = Math.min(ceiling, quality / STEP);
			fastWindows = 0;
		}
	} else fastWindows = 0;
}
