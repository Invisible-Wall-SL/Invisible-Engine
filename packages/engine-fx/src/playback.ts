/**
 * Invisible FX — the runtime PLAYBACK time-scale (design doc `invisible-fx.md` §4.4).
 *
 * A `@barvynkoa/particle-emitter` `Emitter.update(dt)` expects `dt` in SECONDS. The in-game
 * runtime (`ParticleEmitter.svelte`) does NOT feed it real seconds: it advances the emitter by
 * `ticker.deltaMS * emitSpeed`, and the default `emitSpeed` is {@link DEFAULT_EMIT_SPEED}
 * (~2.34× real time — `1000ms * 0.00234 = 2.34s` of emitter time per wall-clock second). So an
 * effect authored to nominally last 1 "second" of `emitterLifetime` actually plays in ~0.43s.
 *
 * This is the SINGLE SOURCE OF TRUTH for that scalar. Both surfaces that drive an emitter — the
 * runtime `ParticleEmitter.svelte` AND the `/fx` editor preview (`FxStage.svelte`) — import it, so
 * the preview plays an effect at the EXACT speed the game will, and any duration read off an effect
 * (the Flow "animation duration" output pin) converts through the same constant. Previously the
 * preview hardcoded `deltaMS / 1000` (real seconds) while the runtime used `0.00234`, so effects
 * ran ~2.34× faster in-game than the editor showed — the drift behind mis-timed authored delays.
 */

/**
 * Default emitter time-scale: seconds of emitter time advanced per millisecond of wall-clock.
 * `deltaMS * DEFAULT_EMIT_SPEED` is the `dt` fed to `Emitter.update`. Kept as the historical
 * runtime value so existing authored/shipped effects play unchanged.
 */
export const DEFAULT_EMIT_SPEED = 0.00234;

/**
 * The `dt` (in emitter seconds) to advance an `Emitter` this frame, given the frame's `deltaMS`
 * and an optional per-mount `emitSpeed` override (falls back to {@link DEFAULT_EMIT_SPEED}). One
 * helper so the runtime and the preview never diverge again.
 */
export const emitterDeltaSeconds = (deltaMS: number, emitSpeed?: number): number =>
	deltaMS * (emitSpeed || DEFAULT_EMIT_SPEED);

/**
 * Convert a duration expressed in EMITTER seconds (e.g. a config's `emitterLifetime`, or a
 * particle `lifetime.max`) into the wall-clock MILLISECONDS it actually occupies in the runtime,
 * accounting for the {@link DEFAULT_EMIT_SPEED} time-scale. This is what makes a "how long does
 * this effect run on screen" number match reality — a raw `emitterLifetime` is emitter-seconds,
 * not wall-clock ms. `emitSpeed` mirrors the per-mount override.
 *
 * Derivation: the runtime advances the emitter by `deltaMS * emitSpeed` seconds each frame, i.e.
 * `emitSpeed` emitter-seconds per wall MILLISECOND. So one emitter-second occupies `1 / emitSpeed`
 * wall-ms already — no further ms↔s scaling. (Default: `1 / 0.00234 ≈ 427ms` per emitter-second.)
 */
export const emitterSecondsToWallMs = (emitterSeconds: number, emitSpeed?: number): number =>
	emitterSeconds / (emitSpeed || DEFAULT_EMIT_SPEED);
