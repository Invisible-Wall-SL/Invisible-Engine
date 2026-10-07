/**
 * Thin typed access to the Invisible rig runtime's WebGL renderer (`engine-rig/webgl`) — the same
 * runtime the Invisible Spine Viewer and Rigger load as `static/spine/vendor/invisible-rig.js`, and
 * the same skeleton code the game runs. Loaded lazily, so pages without a rig preview never fetch it.
 *
 * We type only the handful of members the editor overlay touches.
 */

import type * as RIG from 'engine-rig/webgl';

/** `Skeleton.getBounds` writes its result by CALLING `offset.set()/size.set()`, so callers pass a
 * real `Vector2`, never a plain `{x,y}`. */
export type SpineVector2 = RIG.Vector2;
export type SpineCamera = RIG.OrthoCamera;
/** A posed bone — its world transform AFTER `skeleton.updateWorldTransform`. The Symbols-SM live
 * FX overlay projects `worldX`/`worldY` to screen; the Scene Editor's bone-ridden preview reads
 * `getWorldRotationX()` (degrees, CCW, y-up) and `getWorldScaleX/Y()` exactly as the runtime
 * `<SpineBoneAttach>` does. */
export type SpineBone = RIG.Bone;
export type SpineSkeleton = RIG.Skeleton;
/** The live track's playhead: `trackTime` grows unbounded for a looping entry, so the wrapped time
 * is `trackTime % animation.duration`. */
export type SpineTrackEntry = RIG.TrackEntry;
export type SpineAnimationState = RIG.AnimationState;
/** The AUTHORED skeleton box (`x`/`y`/`width`/`height`) is the pose-independent sizing rect the
 * game's `spineSizeScale` fits against. `x`/`y` is its bottom-left corner in y-up skeleton coords; a
 * Spine-editor rig centres it on the origin, a Rigger rig need not (read it through
 * `authoredSpineBox`). `width`/`height` are `0` when the export omits them, which is why
 * {@link measureSpineBounds} falls back to a live `getBounds`. The loader's `scale` scales none of
 * these — only the geometry. */
export type SpineSkeletonData = RIG.SkeletonData;
export type SpineTextureAtlas = RIG.TextureAtlas;
export type SpineSceneRenderer = RIG.SceneRenderer;
export type SpineRuntime = typeof RIG;

/** Per-`assetKey` metadata the editor publishes for each loaded spine bundle — the
 * animation / skin / slot / bone name lists the Properties panel turns into dropdowns. */
export interface SpineMeta {
	animations: string[];
	skins: string[];
	slots: string[];
	bones: string[];
}

let runtimePromise: Promise<SpineRuntime> | null = null;
let runtime: SpineRuntime | null = null;

/** Load the runtime once per page; every caller shares the same promise and the same object. */
export function loadSpineRuntime(): Promise<SpineRuntime> {
	if (runtimePromise) return runtimePromise;
	runtimePromise = import('engine-rig/webgl').then(
		(mod) => {
			runtime = mod;
			return mod;
		},
		(error: unknown) => {
			// Let the next caller retry instead of pinning every later load to this failure.
			runtimePromise = null;
			throw error;
		},
	);
	return runtimePromise;
}

/** The loaded runtime object, or `null` before `loadSpineRuntime` resolves. */
export function getActiveRuntime(): SpineRuntime | null {
	return runtime;
}

/** Build the shared `SceneRenderer` once a runtime is loaded. */
export function createSceneRenderer(
	canvas: HTMLCanvasElement,
	gl: WebGLRenderingContext,
): SpineSceneRenderer | null {
	const spine = getActiveRuntime();
	if (!spine) return null;
	return new spine.SceneRenderer(canvas, gl);
}

/** The runtime's `Physics.update` token. Only a skeleton the loaded runtime built is ever posed. */
export function getSpinePhysics(): RIG.Physics {
	const spine = getActiveRuntime();
	if (!spine) throw new Error('rig runtime not loaded');
	return spine.Physics.update;
}
