/**
 * Invisible Flipbook — PLAYBACK ORDER (design doc `invisible-flipbook.md`).
 *
 * A clip authors its frames ONCE, in one order. How that order is walked at play time is a
 * separate question, and one the same clip legitimately answers differently in two places: a
 * coin spins forward on the reel and ping-pongs on the paytable; a wave flows left in one
 * screen and right in its mirror.
 *
 * Expressing that as a WALK over the authored list — rather than as a second authored clip, or
 * as a custom playhead in the renderer — is what keeps every surface honest. `<Flipbook>` hands
 * PIXI's `AnimatedSprite` a texture array and nothing else, the `/flipbook` preview advances an
 * index, and the editor canvas samples a wall clock. Give all three the SAME index walk and they
 * cannot disagree about what frame is showing; give the renderer a bespoke direction-aware clock
 * and they will, silently.
 *
 * Dependency-free like the rest of this package, so the walk is fixtured offline
 * ([[feedback_validate_data_contracts_offline]]).
 */

/**
 * How a clip's authored frames are walked.
 *
 * - `forward` — 0…n-1 (the default; every clip authored before this existed).
 * - `reverse` — n-1…0. The same art played backwards, without duplicating the clip.
 * - `pingpong` — 0…n-1 then back down to 1, so a loop returns to frame 0 exactly once per
 *   cycle. The turnaround frames are NOT repeated: holding them would stutter the two moments
 *   an eye is most likely to notice.
 */
export type FlipbookDirection = 'forward' | 'reverse' | 'pingpong';

/** Every direction, for a UI that offers them. Order is the order they should be listed in. */
export const FLIPBOOK_DIRECTIONS: readonly FlipbookDirection[] = ['forward', 'reverse', 'pingpong'];

/** Playback default when a clip omits `direction`. `forward` is what every clip authored before
 * directions existed did, so it is also the value the normalizer DROPS — an untouched clip stays
 * byte-identical. */
export const DEFAULT_FLIPBOOK_DIRECTION: FlipbookDirection = 'forward';

export const isFlipbookDirection = (v: unknown): v is FlipbookDirection =>
	v === 'forward' || v === 'reverse' || v === 'pingpong';

/**
 * The authored-frame INDICES in playback order — the one definition of a direction, which every
 * consumer walks.
 *
 * Indices rather than frame names on purpose: the caller has already resolved names to textures
 * (or to region records, in the two editors), and a missing frame must not shift the walk. Index
 * `i` always means "the i-th authored frame", whatever happened to it downstream.
 *
 * A ping-pong of fewer than 3 frames is just its forward walk: with no INTERIOR frame there is
 * nothing to come back through, and `[0,1,0]` would hold frame 0 for two ticks every cycle.
 */
export function playbackIndices(count: number, direction?: FlipbookDirection): number[] {
	const n = Math.max(0, Math.floor(count));
	if (n === 0) return [];
	if (direction === 'reverse') return Array.from({ length: n }, (_, i) => n - 1 - i);
	if (direction === 'pingpong' && n >= 3) {
		const out = Array.from({ length: n }, (_, i) => i);
		for (let i = n - 2; i >= 1; i--) out.push(i);
		return out;
	}
	return Array.from({ length: n }, (_, i) => i);
}

/**
 * How many frames ONE cycle plays — `playbackIndices(...).length` without building the array.
 *
 * This is the number every DURATION must be computed from, and getting it from `frames.length`
 * instead is the specific bug this exists to prevent: a ping-pong symbol state whose revert is
 * timed off the authored count reverts halfway through the animation, which reads as "the win
 * animation doesn't play" rather than as a timing fault (the same shape as the `oncomplete`-on-
 * mount bug `SymbolFlipbook` already documents).
 */
export function playbackFrameCount(count: number, direction?: FlipbookDirection): number {
	const n = Math.max(0, Math.floor(count));
	return direction === 'pingpong' && n >= 3 ? 2 * n - 2 : n;
}
