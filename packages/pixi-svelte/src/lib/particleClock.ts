/**
 * The PARTICLE CLOCK (`invisible-fx.md`, "Decided (owner, 2026-10-15)": turbo speeds up the particles
 * too). One time scale, default 1, that:
 *
 *  - every `<ParticleEmitter>` multiplies its step by ({@link particleStepSeconds}) — authored FX,
 *    rig-bound FX, Tier-C rig particles (their clips advance by the emitter's step) and the coded
 *    emitters (win coins, flight trails) all go through it;
 *  - every wall-clock EMISSION timer divides by when it starts ({@link particleWallMs}) — a trigger's
 *    `duration`, a forced layer's `emitFor`, a rig binding's `delay` — so an effect keeps its shape
 *    (the same particles, faster) instead of emitting more of them. A timer reads the scale once, at
 *    its start; a turbo toggle mid-burst does not re-time it.
 *
 * The game points it at its turbo scalar at boot (`setParticleTimeScale(stateBetDerived.timeScale)`).
 * The tools never set it, so `/fx`, the Scene Editor and the Rigger / Symbols previews play at 1.
 *
 * No components, with its own subpath export (`pixi-svelte/particleClock`): a game boot path or a
 * plain `.ts` module can install or read it without the package barrel, which drags `webfontloader`
 * into SSR route analysis (the trap `rigBoundContent` hit, `docs/status/fx.md` 2026-09-04).
 */

import { untrack } from 'svelte';
import { emitterDeltaSeconds } from 'engine-fx';

let read: (() => number) | undefined;

/**
 * Point the clock at a live scale (read every tick, so a turbo toggle takes effect on the next
 * frame), or `undefined` to put it back to 1.
 */
export function setParticleTimeScale(next: (() => number) | undefined): void {
	read = next;
}

/**
 * The current scale. A read that is not a finite number above 0, or that throws, is 1: a broken read
 * must not freeze or reverse every particle in the game (0 would be a pause, and pausing is not this
 * clock's job — the emitters stop on their own `emit` flag).
 *
 * Always read UNTRACKED: the game's read is turbo `$state`, and a timer that starts inside an effect
 * (or inside a listener another component's effect fires) must not make that effect re-run — and
 * restart its burst — when turbo is toggled.
 */
export function particleTimeScale(): number {
	const current = read;
	if (!current) return 1;
	let v: unknown;
	try {
		v = untrack(current);
	} catch {
		return 1;
	}
	return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * The seconds a `<ParticleEmitter>` advances its emitter this frame: the emit-speed step
 * (`emitterDeltaSeconds`), times an effect-level `effect.timeScale`, times the particle clock. At the
 * clock's 1 (and no `effect.timeScale`) this is `emitterDeltaSeconds(deltaMS, emitSpeed)` exactly —
 * both factors multiply in as 1.
 */
export function particleStepSeconds(deltaMS: number, emitSpeed?: number, effectScale = 1): number {
	return emitterDeltaSeconds(deltaMS, emitSpeed) * effectScale * particleTimeScale();
}

/** A wall-clock emission timer's length, read at the moment it starts: `ms ÷` the clock (×1 ⇒ `ms`). */
export function particleWallMs(ms: number): number {
	return ms / particleTimeScale();
}
