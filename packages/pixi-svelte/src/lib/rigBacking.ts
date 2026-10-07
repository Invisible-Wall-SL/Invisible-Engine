/**
 * Invisible FX — Tier C: the pooled rig "backing" abstraction + its real pixi-v8 `RigView`
 * factory. A {@link RigBacking} owns ONE skeleton instance and the display object the emitter
 * tracks; {@link RigParticleBehavior} pools these. The interface is renderer-agnostic so the
 * pool bookkeeping is unit-coverable headlessly (the harness injects an engine-rig backing), while
 * the runtime injects the real `RigView`-backed one built here.
 */

import * as RIG from 'engine-rig/pixi';

/**
 * The minimal display-object surface the behavior writes per frame. A pixi-v8 `RigView` (which
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
 * The minimal surface of the layer container the behavior parents rig views into (the emitter's
 * own parent `Container`). A real PIXI `Container` satisfies it (its `addChild` is variadic), as
 * does a bare `Container` in tests — hence the permissive variadic signature.
 */
export interface LayerHostLike {
	addChild(...children: ContainerLike[]): unknown;
}

/** A pooled rig instance: a display `view` + the lifecycle the behavior drives. */
export interface RigBacking {
	/** The display object the emitter tracks (the pixi-v8 `RigView`, or a stand-in in tests). */
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
export type RigBackingFactory = () => RigBacking;

/**
 * The REAL runtime backing: a pixi-v8 `RigView` built from a loaded `SkeletonData` (a `LoadedRig`
 * in `loadedAssets`, the SAME data `RigProvider`/`BaseRigProvider` build a `RigView` from). We
 * drive its `AnimationState` ourselves (`autoUpdate = false`) so the emitter's ticker owns the
 * clock — one `update(dt)` per frame, exactly the spike's shape.
 */
class PixiRigBacking implements RigBacking {
	readonly rigView: RIG.RigView;

	constructor(rigData: RIG.SkeletonData) {
		this.rigView = new RIG.RigView(rigData);
		// The emitter's ticker drives the clock; never let the shared ticker double-advance it.
		this.rigView.autoUpdate = false;
		this.rigView.visible = false;
	}

	get view(): ContainerLike {
		return this.rigView as unknown as ContainerLike;
	}

	activate(animation: string, loop: boolean): void {
		const { state, skeleton } = this.rigView;
		state.clearTracks();
		skeleton.setToSetupPose();
		// A missing clip name would throw and abort the whole spawn wave — guard it so an
		// authored-then-renamed clip degrades to a static pose rather than killing the effect.
		if (skeleton.data.findAnimation(animation)) {
			state.setAnimation(0, animation, loop);
		}
		this.rigView.visible = true;
	}

	advance(deltaSec: number): void {
		// `autoUpdate = false` ⇒ this advances the AnimationState + applies it to the skeleton.
		this.rigView.update(deltaSec);
	}

	reset(): void {
		this.rigView.state.clearTracks();
		this.rigView.skeleton.setToSetupPose();
		this.rigView.visible = false;
	}

	destroy(): void {
		this.rigView.destroy();
	}
}

/**
 * Build a {@link RigBackingFactory} bound to a loaded skeleton. Resolve `skeletonData` from the
 * game's `loadedAssets[skeletonKey]` (a `LoadedRig`) at the call site (the same lookup
 * `RigProvider` does), then hand the factory to the behavior — every pooled particle shares the
 * one skeleton data, allocating only its own `RigView` instance.
 */
export function createPixiRigBackingFactory(rigData: RIG.SkeletonData): RigBackingFactory {
	return () => new PixiRigBacking(rigData);
}
