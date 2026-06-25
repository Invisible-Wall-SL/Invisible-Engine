/**
 * Invisible FX — Tier C, increment 1: headless harness for the REAL runtime `SpineParticleBehavior`.
 *
 *   pnpm --filter fx-spike run spine-particle-behavior
 *
 * The Phase-0 spike (`spineParticle.ts`) proved the MECHANISM with a throwaway behavior class; this
 * harness pins the PRODUCTION class (`packages/pixi-svelte/src/lib/spineParticleBehavior.ts`) — the
 * pool/lifecycle/no-leak bookkeeping — driving the REAL `@barvynkoa` `Emitter` at a real particle
 * count. The pool is renderer-agnostic by design (a `SpineBackingFactory` injection), so here we
 * inject a spine-core backing (the un-mangled animation machinery the spike used) where the runtime
 * injects a pixi-v8 `Spine`. Rendering pixels + GPU perf at count remain owner-verify-live.
 *
 * The behavior module imports `./spineBacking` ONLY as types (erased at runtime), so importing it
 * here never drags in `@esotericsoftware/spine-pixi-v8` (which needs a renderer).
 */

import { Container } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	AnimationState,
	AnimationStateData,
	Physics,
	Skeleton,
	SkeletonData,
	SkeletonJson,
	type AttachmentLoader,
} from '@esotericsoftware/spine-core';

import {
	SpineParticleBehavior,
	SPINE_PARTICLE_BEHAVIOR_TYPE,
	registerSpineParticleBehavior,
} from '../../packages/pixi-svelte/src/lib/spineParticleBehavior';
import type { SpineBacking, ContainerLike } from '../../packages/pixi-svelte/src/lib/spineBacking';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

// ---------------------------------------------------------------------------
// A real (synthetic) Spine skeleton + clip via the UN-MANGLED spine-core (genuine state machine).
// The `spin` clip rotates a bone 0→360° over a real 1s timeline.
// ---------------------------------------------------------------------------
const nullAttachmentLoader = {
	newRegionAttachment: () => null,
	newMeshAttachment: () => null,
	newBoundingBoxAttachment: () => null,
	newPathAttachment: () => null,
	newPointAttachment: () => null,
	newClippingAttachment: () => null,
} as unknown as AttachmentLoader;

const SKELETON_JSON = {
	skeleton: { spine: '4.2', images: '', audio: '' },
	bones: [{ name: 'root' }, { name: 'spin', parent: 'root' }],
	slots: [],
	animations: {
		spin: {
			bones: {
				spin: {
					rotate: [
						{ time: 0, value: 0 },
						{ time: 1, value: 360 },
					],
				},
			},
		},
	},
};

const skeletonData: SkeletonData = new SkeletonJson(nullAttachmentLoader).readSkeletonData(
	SKELETON_JSON,
);

// ---------------------------------------------------------------------------
// The injected spine-core backing — implements the production `SpineBacking` interface (the SAME
// interface the runtime pixi-v8 backing implements). ALLOCATION IS COUNTED.
// ---------------------------------------------------------------------------
let skeletonsAllocated = 0;
let destroyed = 0;

class CoreSpineBacking implements SpineBacking {
	readonly container = new Container();
	readonly skeleton: Skeleton;
	readonly state: AnimationState;

	constructor() {
		skeletonsAllocated++;
		this.skeleton = new Skeleton(skeletonData);
		this.state = new AnimationState(new AnimationStateData(skeletonData));
	}

	get view(): ContainerLike {
		return this.container as unknown as ContainerLike;
	}

	activate(animation: string, loop: boolean): void {
		this.state.clearTracks();
		this.skeleton.setToSetupPose();
		this.state.setAnimation(0, animation, loop);
		this.container.visible = true;
	}

	advance(deltaSec: number): void {
		this.state.update(deltaSec);
		this.state.apply(this.skeleton);
		this.skeleton.updateWorldTransform(Physics.update);
	}

	reset(): void {
		this.state.clearTracks();
		this.skeleton.setToSetupPose();
		this.container.visible = false;
	}

	destroy(): void {
		destroyed++;
		this.container.destroy();
	}

	boneRotation(): number {
		return this.skeleton.findBone('spin')?.rotation ?? 0;
	}
}

// ---------------------------------------------------------------------------
// Registration is idempotent.
// ---------------------------------------------------------------------------
console.log('fx SpineParticleBehavior — registration');
registerSpineParticleBehavior();
registerSpineParticleBehavior(); // second call must be a no-op (no throw / re-thrash)
assert(
	SpineParticleBehavior.type === SPINE_PARTICLE_BEHAVIOR_TYPE,
	'static type is `spineParticle`',
);

// ---------------------------------------------------------------------------
// Drive a REAL emitter with the production behavior at a real particle count.
// ---------------------------------------------------------------------------
const MAX_PARTICLES = 30;
const layerHost = new Container();

const config: EmitterConfigV3 = {
	lifetime: { min: 0.4, max: 0.7 },
	frequency: 0.01,
	emitterLifetime: -1,
	maxParticles: MAX_PARTICLES,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [
		{
			type: 'alpha',
			config: {
				alpha: {
					list: [
						{ time: 0, value: 1 },
						{ time: 1, value: 0 },
					],
				},
			},
		},
		{
			type: SPINE_PARTICLE_BEHAVIOR_TYPE,
			config: {
				animation: 'spin',
				loop: true,
				prewarm: MAX_PARTICLES,
				layerHost,
				createBacking: () => new CoreSpineBacking(),
			},
		},
	],
};

const parent = new Container();
const emitter = new Emitter(parent, config);
const behavior = emitter.getBehavior(
	SPINE_PARTICLE_BEHAVIOR_TYPE,
) as unknown as SpineParticleBehavior;

console.log('fx SpineParticleBehavior — construction + prewarm');
assert(behavior instanceof SpineParticleBehavior, 'the production behavior is live on the emitter');
assert(
	skeletonsAllocated === MAX_PARTICLES,
	`pool pre-allocates ${MAX_PARTICLES} backings up-front`,
);
assert(
	behavior.allocatedCount() === MAX_PARTICLES,
	'the behavior reports the same bounded allocation count',
);
assert(
	behavior.poolSize() === MAX_PARTICLES && behavior.live.size === 0,
	'all prewarmed, none live',
);

// Stress: many spawn/death cycles.
emitter.emit = true;
let peakLive = 0;
const STEPS = 1500;
for (let i = 0; i < STEPS; i++) {
	emitter.update(0.016);
	peakLive = Math.max(peakLive, behavior.live.size);
}

console.log('fx SpineParticleBehavior — pooling + lifecycle under load');
assert(
	skeletonsAllocated === MAX_PARTICLES,
	`allocation BOUNDED: still ${skeletonsAllocated} backings after ${STEPS} frames (none per-frame)`,
);
assert(behavior.allocatedCount() === MAX_PARTICLES, 'behavior never allocated beyond the pool');
assert(peakLive > 0, `particles went live (peak ${peakLive} backings)`);
const sampleLive = [...behavior.live][0] as unknown as CoreSpineBacking | undefined;
assert(
	!sampleLive || sampleLive.boneRotation() !== 0,
	'a live backing’s clip ADVANCED (per-particle update drives the genuine state machine)',
);
assert(
	behavior.live.size === emitter.particleCount,
	`live backings === live particles (${behavior.live.size} === ${emitter.particleCount}) — no leak`,
);
assert(
	behavior.live.size + behavior.poolSize() === skeletonsAllocated,
	'pool + live partition the fixed allocation (no orphan)',
);
assert(
	layerHost.children.length === emitter.particleCount,
	'the layer host holds exactly the live spine views',
);

// Drain.
emitter.emit = false;
for (let i = 0; i < 120; i++) emitter.update(0.016);

console.log('fx SpineParticleBehavior — drain');
assert(emitter.particleCount === 0, 'every particle died after emit stopped');
assert(behavior.live.size === 0, 'every live backing recycled (none stranded)');
assert(
	behavior.poolSize() === skeletonsAllocated,
	`ALL ${skeletonsAllocated} backings back in pool`,
);
assert(layerHost.children.length === 0, 'the layer-host display tree is empty after drain');
assert(skeletonsAllocated === MAX_PARTICLES, 'STILL no extra allocation across the run');

// Dispose (layer unmount): every backing destroyed, sets cleared.
console.log('fx SpineParticleBehavior — dispose (layer unmount)');
behavior.dispose();
assert(
	destroyed === MAX_PARTICLES,
	`dispose destroyed all ${MAX_PARTICLES} backings (pool + live)`,
);
assert(behavior.poolSize() === 0 && behavior.live.size === 0, 'pool + live cleared after dispose');

emitter.destroy();

console.log('');
if (failures === 0) {
	console.log('FX SPINE-PARTICLE-BEHAVIOR: PASSED');
} else {
	console.error(`FX SPINE-PARTICLE-BEHAVIOR: ${failures} FAILURE(S)`);
	process.exit(1);
}
