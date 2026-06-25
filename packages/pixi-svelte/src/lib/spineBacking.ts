/**
 * Invisible FX — Tier C: the pooled spine "backing" abstraction + its real pixi-v8 `Spine`
 * factory. A {@link SpineBacking} owns ONE skeleton instance and the display object the emitter
 * tracks; {@link SpineParticleBehavior} pools these. The interface is renderer-agnostic so the
 * pool bookkeeping is unit-coverable headlessly (the harness injects a spine-core backing), while
 * the runtime injects the real pixi-v8 `Spine`-backed one built here.
 */

import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

/**
 * The minimal display-object surface the behavior writes per frame. A pixi-v8 `Spine` (which
 * `extends ViewContainer` ⇒ a `Container`) satisfies it, as does a bare `Container` in tests —
 * so the behavior never imports a renderer.
 */
export interface ContainerLike {
	visible: boolean;
	alpha: number;
	rotation: number;
	position: { set(x: number, y: number): void };
	scale: { set(x: number, y?: number): void };
	removeFromParent(): void;
	destroy(): void;
}

/**
 * The minimal surface of the layer container the behavior parents spine views into (the emitter's
 * own parent `Container`). A real PIXI `Container` satisfies it (its `addChild` is variadic), as
 * does a bare `Container` in tests — hence the permissive variadic signature.
 */
export interface LayerHostLike {
	addChild(...children: ContainerLike[]): unknown;
}

/** A pooled spine instance: a display `view` + the lifecycle the behavior drives. */
export interface SpineBacking {
	/** The display object the emitter tracks (the pixi-v8 `Spine`, or a stand-in in tests). */
	readonly view: ContainerLike;
	/** Spawn: bind the clip + reset the pose/clock + reveal. */
	activate(animation: string, loop: boolean): void;
	/** Per-frame: advance the genuine animation state machine. */
	advance(deltaSec: number): void;
	/** Death: reset so a recycled instance carries no stale pose, hide it. */
	reset(): void;
	/** Permanent teardown (layer unmount): free the underlying skeleton/view. */
	destroy(): void;
}

/** Builds one pooled backing. Injected into the behavior so the pool stays renderer-agnostic. */
export type SpineBackingFactory = () => SpineBacking;

/**
 * The REAL runtime backing: a pixi-v8 `Spine` built from a loaded `SkeletonData` (a `LoadedSpine`
 * in `loadedAssets`, the SAME data `SpineProvider`/`BaseSpineProvider` build a `Spine` from). We
 * drive its `AnimationState` ourselves (`autoUpdate = false`) so the emitter's ticker owns the
 * clock — one `update(dt)` per frame, exactly the spike's shape.
 */
class PixiSpineBacking implements SpineBacking {
	readonly spine: SPINE_PIXI.Spine;

	constructor(spineData: SPINE_PIXI.SkeletonData) {
		this.spine = new SPINE_PIXI.Spine(spineData);
		// The emitter's ticker drives the clock; never let the shared ticker double-advance it.
		this.spine.autoUpdate = false;
		this.spine.visible = false;
	}

	get view(): ContainerLike {
		return this.spine as unknown as ContainerLike;
	}

	activate(animation: string, loop: boolean): void {
		const { state, skeleton } = this.spine;
		state.clearTracks();
		skeleton.setToSetupPose();
		// A missing clip name would throw and abort the whole spawn wave — guard it so an
		// authored-then-renamed clip degrades to a static pose rather than killing the effect.
		if (skeleton.data.findAnimation(animation)) {
			state.setAnimation(0, animation, loop);
		}
		this.spine.visible = true;
	}

	advance(deltaSec: number): void {
		// `autoUpdate = false` ⇒ this advances the AnimationState + applies it to the skeleton.
		this.spine.update(deltaSec);
	}

	reset(): void {
		this.spine.state.clearTracks();
		this.spine.skeleton.setToSetupPose();
		this.spine.visible = false;
	}

	destroy(): void {
		this.spine.destroy();
	}
}

/**
 * Build a {@link SpineBackingFactory} bound to a loaded skeleton. Resolve `skeletonData` from the
 * game's `loadedAssets[skeletonKey]` (a `LoadedSpine`) at the call site (the same lookup
 * `SpineProvider` does), then hand the factory to the behavior — every pooled particle shares the
 * one skeleton data, allocating only its own `Spine` instance.
 */
export function createPixiSpineBackingFactory(
	spineData: SPINE_PIXI.SkeletonData,
): SpineBackingFactory {
	return () => new PixiSpineBacking(spineData);
}
