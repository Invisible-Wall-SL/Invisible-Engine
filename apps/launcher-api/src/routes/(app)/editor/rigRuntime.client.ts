/**
 * Thin typed access to the Invisible rig runtime's WebGL renderer (`engine-rig/webgl`) — the same
 * runtime the Invisible Rig Viewer and Rigger load as `static/rig-viewer/vendor/invisible-rig.js`,
 * and the same skeleton code the game runs. Loaded lazily, so pages without a rig preview never
 * fetch it.
 *
 * We type only the handful of members the editor overlay touches.
 */

import type * as RIG from 'engine-rig/webgl';

/** `Skeleton.getBounds` writes its result by CALLING `offset.set()/size.set()`, so callers pass a
 * real `Vector2`, never a plain `{x,y}`. */
export type RigVector2 = RIG.Vector2;
export type RigCamera = RIG.OrthoCamera;
/** A posed bone — its world transform AFTER `skeleton.updateWorldTransform`. The Symbols-SM live
 * FX overlay projects `worldX`/`worldY` to screen; the Scene Editor's bone-ridden preview reads
 * `getWorldRotationX()` (degrees, CCW, y-up) and `getWorldScaleX/Y()` exactly as the runtime
 * `<RigBoneAttach>` does. */
export type RigBone = RIG.Bone;
export type RigSkeleton = RIG.Skeleton;
/** The live track's playhead: `trackTime` grows unbounded for a looping entry, so the wrapped time
 * is `trackTime % animation.duration`. */
export type RigTrackEntry = RIG.TrackEntry;
export type RigAnimationState = RIG.AnimationState;
/** The AUTHORED skeleton box (`x`/`y`/`width`/`height`) is the pose-independent sizing rect the
 * game's `rigSizeScale` fits against. `x`/`y` is its bottom-left corner in y-up skeleton coords; a
 * rig from an external editor centres it on the origin, a Rigger rig need not (read it through
 * `authoredRigBox`). `width`/`height` are `0` when the export omits them, which is why
 * {@link measureRigBounds} falls back to a live `getBounds`. The loader's `scale` scales none of
 * these — only the geometry. */
export type RigSkeletonData = RIG.SkeletonData;
export type RigTextureAtlas = RIG.TextureAtlas;
export type RigSceneRenderer = RIG.SceneRenderer;
export type RigRuntime = typeof RIG;

/** Per-`assetKey` metadata the editor publishes for each loaded rig bundle — the
 * animation / skin / slot / bone name lists the Properties panel turns into dropdowns. */
export interface RigMeta {
	animations: string[];
	skins: string[];
	slots: string[];
	bones: string[];
}

let runtimePromise: Promise<RigRuntime> | null = null;
let runtime: RigRuntime | null = null;

/** Load the runtime once per page; every caller shares the same promise and the same object. */
export function loadRigRuntime(): Promise<RigRuntime> {
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

/** The loaded runtime object, or `null` before `loadRigRuntime` resolves. */
export function getActiveRuntime(): RigRuntime | null {
	return runtime;
}

/** Build the shared `SceneRenderer` once a runtime is loaded. */
export function createSceneRenderer(
	canvas: HTMLCanvasElement,
	gl: WebGLRenderingContext,
): RigSceneRenderer | null {
	const rig = getActiveRuntime();
	if (!rig) return null;
	return new rig.SceneRenderer(canvas, gl);
}

/** The runtime's `Physics.update` token. Only a skeleton the loaded runtime built is ever posed. */
export function getRigPhysics(): RIG.Physics {
	const rig = getActiveRuntime();
	if (!rig) throw new Error('rig runtime not loaded');
	return rig.Physics.update;
}
