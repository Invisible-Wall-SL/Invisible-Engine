import { Tween } from 'svelte/motion';
import { cubicOut } from 'svelte/easing';

import {
	activeReelIndices,
	activeMaxTier,
	reelCenterX,
	resolveTierFx,
} from './anticipationPresentation';
import { stateGame, stateGameDerived } from './stateGame.svelte';

/**
 * The SINGLE SOURCE OF TRUTH for the reel-anticipation camera transform
 * (`docs/design/reel-anticipation.md`, Phase 3). The zoom used to live entirely inside
 * `AnticipationCamera.svelte`; it moved here so BOTH the reel camera AND any opted-in screen
 * (`Scene.zoomWithAnticipation`, via `registerSceneCameraTransform`) apply the IDENTICAL transform
 * toward the SAME focal point — one coherent camera move, never two copies of the math.
 *
 * The transform is a plain scale + pan in the board's `MainContainer` (main-layout world) space:
 * scaling about the child origin keeps the focal point `target` fixed when `x = target·(1 − scale)`,
 * and at scale 1 the offset is 0 for ANY held target — so a fully-released camera is byte-identical
 * to an un-zoomed board. `targetX` is the mean `reelCenterX` of the actively-anticipating reels,
 * `targetY` the board centre; both are HELD as the zoom releases so the pan eases back to identity
 * rather than snapping when the active set empties.
 *
 * The focal point is ALSO tweened (not just the zoom scale): as reels settle one by one the active
 * set shrinks and the mean `targetX` shifts by whole columns. Tweening it eases that lateral pan
 * between columns instead of snapping the camera sideways in one hard step (the old plain-`$state`
 * target jumped instantly while the zoom held constant, which read as an ugly two-step jerk).
 */

const zoom = new Tween(1, { duration: 450, easing: cubicOut });

// Focal point as tweens so a column-to-column shift (a reel settling out of the active set) pans
// smoothly rather than snapping. Slightly quicker than the zoom so the sideways glide feels crisp.
const targetX = new Tween(0, { duration: 380, easing: cubicOut });
const targetY = new Tween(0, { duration: 380, easing: cubicOut });

/**
 * Re-aim the camera at the current anticipation state — the driver (call from a component `$effect`
 * so it re-runs when the armed reels / tier change). Gated on the SAME `anticipationActive()` +
 * `anticipationZoom` toggles that mount the reel camera, so an opted-in screen and the board are
 * always coherent: when the reel zoom is off (or the mode is off, or the board swaps in place) the
 * camera eases to identity for everyone. The target is only re-read while armed, so it's held
 * through the release.
 */
export const updateAnticipationCameraTarget = (): void => {
	// Read the two toggles FIRST and short-circuit: when the mode is off the effect that calls this
	// tracks only `anticipationMode` (the `&&` never reads the board), so it does NOT re-run on every
	// reel-motion tick of a normal spin — off-path parity/perf. Flipping the mode on re-runs it, which
	// then reads the armed reels; flipping it off re-runs it into the `zoom.set(1)` ease-back.
	//
	// This ONE read is also where the anticipation CAMERA stands down on a swap-in-place board
	// (`anticipationActive`) — including for a screen that opted in with `Scene.zoomWithAnticipation`.
	// Such a screen carries no toggle of its own: it renders whatever `anticipationCameraTransform()`
	// publishes, so with the driver short-circuited the zoom stays parked at 1, which IS the identity
	// transform an un-armed board publishes today. The opt-in tick keeps meaning what it means and
	// simply never fires — the existing at-rest path, rather than a second gate in engine-layout, which
	// is generic and must not learn what a board mode is.
	if (stateGameDerived.anticipationActive() && stateGame.anticipationZoom) {
		const active = activeReelIndices();
		const tier = activeMaxTier();
		if (active.length && tier) {
			void targetX.set(active.reduce((sum, index) => sum + reelCenterX(index), 0) / active.length);
			void targetY.set(stateGameDerived.boardLayout().y);
			void zoom.set(resolveTierFx(tier).zoom);
			return;
		}
	}
	void zoom.set(1);
};

/**
 * The LIVE camera transform in main-layout world space — read per render by the reel camera
 * (`AnticipationCamera.svelte`) and by every opted-in screen through the engine-layout
 * `registerSceneCameraTransform` bridge. Identity (`{ scale: 1, x: 0, y: 0 }`) whenever nothing is
 * armed, so a consumer renders byte-identically while the camera is at rest.
 */
export const anticipationCameraTransform = () => ({
	scale: zoom.current,
	x: targetX.current * (1 - zoom.current),
	y: targetY.current * (1 - zoom.current),
});
