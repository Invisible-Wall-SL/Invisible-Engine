/**
 * The `<AnimatedSprite>` frame-list re-assign decision, extracted as a pure function so it can be
 * exercised without a renderer (see `packages/pixi-svelte/fixtures/animatedSpriteFrames.fixture.ts`).
 *
 * WHY IT EXISTS: PIXI's `AnimatedSprite.textures` setter ends in `gotoAndStop(0)` — assigning the
 * frame list STOPS playback and rewinds. `propsSyncEffect` is one `$effect` that re-assigns EVERY
 * prop whenever ANY tracked prop changes, so an unrelated change (alpha, x, a resize, a
 * `loadedAssets` update) re-assigned `textures` and froze the animation on frame 0 — permanently,
 * because the `play` effect only re-runs when `play` itself changes.
 *
 * The symptom is a still frame, which is indistinguishable from a correctly-rendered one-frame
 * clip. That is what made it survive review, and what makes it worth a fixture: nothing about the
 * failure looks like a failure. Confirmed live on `test6`, where a placed background flipbook sat
 * at `playing:false, currentFrame:0` with all 160 of its frames resolved.
 *
 * The decision is deliberately CONTENT-based, not identity-based: the upstream `textures` is a
 * `$derived` array that is rebuilt on every recompute, so identity changes constantly while the
 * frames themselves do not.
 */

/**
 * Does the sprite need its frame list re-assigned? `false` for a rebuilt-but-identical array —
 * the common case — which is what keeps playback alive.
 */
export function framesChanged<T>(previous: readonly T[] | undefined, next: readonly T[]): boolean {
	if (previous === next) return false;
	if (!previous || previous.length !== next.length) return true;
	for (let i = 0; i < previous.length; i++) {
		if (previous[i] !== next[i]) return true;
	}
	return false;
}
