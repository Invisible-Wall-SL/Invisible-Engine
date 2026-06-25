/**
 * Invisible FX — Phase 0 / Tier C SPIKE: spine-clips-AS-particles (the make-or-break gate).
 *
 *   pnpm --filter fx-spike run spine-particle
 *
 * THE QUESTION (design doc §5 Tier C + §7 Phase 0 + §10): can each particle be a POOLED
 * `Spine` skeleton instance playing a clip (a burst of N spinning coins, each a real
 * skeleton) that renders + animates + recycles at a real particle count — OR must Tier C
 * ship via the already-decided flipbook-bake fallback (bake the clip to a sprite-sheet,
 * ride Tier A `animatedSingle`)?
 *
 * WHAT THE LIBRARY SOURCE DECIDES (quoted in the verdict): `@barvynkoa/particle-emitter`
 * hard-codes `class Particle extends Sprite` and `new Particle(this)` at every spawn site —
 * there is NO particle-class factory hook. So a particle can never BE a `Spine`. BUT the
 * library's behavior system is fully pluggable (`Emitter.registerBehavior`, the
 * `IEmitterBehavior` { initParticles / updateParticle / recycleParticle } interface), and a
 * `Particle` is a `Sprite` i.e. a `Container` — so a custom behavior can PARENT a pooled
 * `Spine` (itself a `Container`) UNDER each particle, drive its `AnimationState` per-particle
 * in `updateParticle`, and RETURN it to the pool in `recycleParticle`. That is the native
 * Tier-C mechanism this spike proves.
 *
 * WHAT IS / ISN'T HEADLESS-VERIFIABLE (per the minified-spine gotcha + the sibling spikes):
 * rendering pixels are NOT headless — that's owner-verify-live. The POOLING + per-particle
 * LIFECYCLE + COMPOSITION-WITH-THE-EMITTER mechanics ARE, and they are the whole risk. We
 * drive the REAL `@barvynkoa` `Emitter` (it runs in Node — Pixi `Container`/`Sprite`
 * construct without a renderer) and a custom behavior backed by a pool of REAL
 * `@esotericsoftware/spine-core` `Skeleton` + `AnimationState` instances (the un-mangled core,
 * so the animation machinery + class names are genuine — the synthetic clip `spin` rotates a
 * bone 0→360° over 1s, a real timeline). The pooled display object is a real Pixi `Container`
 * (what a pixi-v8 `Spine` extends — `Spine extends ViewContainer`).
 *
 * PROVES, exactly the three Phase-0 asks:
 *   (a) a POOL of N skeleton instances allocates UP-FRONT and RECYCLES on particle death —
 *       the allocation count stays BOUNDED across many spawn/death cycles (never a skeleton
 *       per-particle-per-frame).
 *   (b) the per-particle LIFECYCLE drives the skeleton: spawn → `state.setAnimation` →
 *       `update(dt)` advances the clip → on death, reset + return to pool.
 *   (c) it COMPOSES with the emitter's particle lifecycle (frequency / lifetime / maxParticles)
 *       without leaking — at the end, live skeletons === live particles, and the pool +
 *       live sets partition the fixed allocation.
 */

import { Container } from 'pixi.js';
import { Emitter, type EmitterConfigV3, type Particle } from '@barvynkoa/particle-emitter';
import {
	AnimationState,
	AnimationStateData,
	Physics,
	Skeleton,
	SkeletonData,
	SkeletonJson,
	type AttachmentLoader,
} from '@esotericsoftware/spine-core';

/**
 * The library's behavior interface (`behaviors/Behaviors`) is type-only and not re-exported
 * from the package index, so we restate the exact shape the `Emitter` calls against (verified
 * against `lib/behaviors/Behaviors.d.ts`): `order` + `initParticles`, optional `updateParticle`
 * / `recycleParticle`. A behavior CLASS additionally needs a static `type` + `new (config)`.
 */
interface IEmitterBehavior {
	order: number;
	initParticles(first: Particle): void;
	updateParticle?(particle: Particle, deltaSec: number): void | boolean;
	recycleParticle?(particle: Particle, natural: boolean): void;
}

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
// A real (synthetic) Spine skeleton + clip, via the UN-MANGLED spine-core, so the
// animation state machine is genuine (not a stub). The `spin` clip rotates a bone
// 0→360° over 1s — a real, advanceable timeline.
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

console.log('Tier C spike — synthetic spine clip');
assert(skeletonData.findAnimation('spin') !== null, 'the synthetic skeleton carries a `spin` clip');
assert(
	(skeletonData.findAnimation('spin')?.duration ?? 0) === 1,
	'the `spin` clip is a real 1s timeline',
);

// ---------------------------------------------------------------------------
// The pooled spine "particle backing". In the real runtime this wraps a pixi-v8
// `Spine` (which `extends ViewContainer` — a Container); here a real Pixi `Container`
// stands in for the display object, owning a real `Skeleton` + `AnimationState`.
// ALLOCATION IS COUNTED — the entire perf claim rides on this staying bounded.
// ---------------------------------------------------------------------------
let skeletonsAllocated = 0;

class SpineBacking {
	readonly view = new Container();
	readonly skeleton: Skeleton;
	readonly state: AnimationState;

	constructor() {
		skeletonsAllocated++;
		this.skeleton = new Skeleton(skeletonData);
		this.state = new AnimationState(new AnimationStateData(skeletonData));
	}

	/** spawn: bind the clip, reset the pose/clock. */
	activate(animation: string, loop: boolean): void {
		this.state.clearTracks();
		this.skeleton.setToSetupPose();
		this.state.setAnimation(0, animation, loop);
		this.view.visible = true;
	}

	/** per-frame: advance the genuine animation state machine. */
	advance(deltaSec: number): void {
		this.state.update(deltaSec);
		this.state.apply(this.skeleton);
		this.skeleton.updateWorldTransform(Physics.update);
	}

	/** death: reset so a recycled instance carries no stale pose, hide it. */
	reset(): void {
		this.state.clearTracks();
		this.skeleton.setToSetupPose();
		this.view.visible = false;
	}

	boneRotation(): number {
		return this.skeleton.findBone('spin')?.rotation ?? 0;
	}
}

/**
 * The Tier-C custom particle behavior. Pools `SpineBacking`s; on spawn it takes one from the
 * pool, plays the clip, and adds its view to the layer container; each frame it advances the
 * clip + tracks the (textureless) particle's transform; on recycle it resets + returns the
 * backing to the pool. This is exactly the shape the real `SpineParticle` runtime behavior takes.
 */
class SpineParticleBehavior implements IEmitterBehavior {
	static type = 'spineParticle';
	// Spawn order so it runs alongside the other spawn-time behaviors.
	order = 0;

	private pool: SpineBacking[] = [];
	private readonly animation: string;
	private readonly loop: boolean;
	// The container the spine views live in (the emitter's layer container). The particles
	// themselves stay textureless; the spine views render here, tracking the particle transform.
	private readonly layerHost: Container;
	// Map a particle to its attached backing, so update/recycle find it. (The real
	// runtime would stash it on `particle.config`, which the library never clears.)
	private readonly attached = new WeakMap<Particle, SpineBacking>();
	live = new Set<SpineBacking>();

	constructor(config: { animation: string; loop: boolean; prewarm: number; layerHost: Container }) {
		this.animation = config.animation;
		this.loop = config.loop;
		this.layerHost = config.layerHost;
		// (a) UP-FRONT allocation — fill the pool once.
		for (let i = 0; i < config.prewarm; i++) this.pool.push(new SpineBacking());
	}

	private take(): SpineBacking {
		// Reuse from the pool; only allocate if genuinely exhausted (then it too is pooled
		// for later — a bounded high-water mark, never per-frame churn).
		return this.pool.pop() ?? new SpineBacking();
	}

	initParticles(first: Particle): void {
		let next: Particle | null = first;
		while (next) {
			const backing = this.take();
			backing.activate(this.animation, this.loop);
			this.layerHost.addChild(backing.view);
			this.attached.set(next, backing);
			this.live.add(backing);
			next = next.next as Particle | null;
		}
	}

	updateParticle(particle: Particle, deltaSec: number): void {
		// (b) per-particle lifecycle drives the skeleton clock + tracks the particle transform.
		const backing = this.attached.get(particle);
		if (!backing) return;
		backing.advance(deltaSec);
		backing.view.position.set(particle.x, particle.y);
		backing.view.rotation = particle.rotation;
		backing.view.scale.set(particle.scale.x, particle.scale.y);
		backing.view.alpha = particle.alpha;
	}

	recycleParticle(particle: Particle): void {
		// (b)/(c) on death: reset + return to pool — no allocation, no leak.
		const backing = this.attached.get(particle);
		if (!backing) return;
		backing.view.removeFromParent();
		backing.reset();
		this.attached.delete(particle);
		this.live.delete(backing);
		this.pool.push(backing);
	}

	poolSize(): number {
		return this.pool.length;
	}
}

Emitter.registerBehavior(SpineParticleBehavior as never);

// ---------------------------------------------------------------------------
// Drive a REAL emitter with the custom behavior at a REAL particle count.
// ---------------------------------------------------------------------------
const MAX_PARTICLES = 30; // the doc's "burst of 30 spinning coins"
const PREWARM = MAX_PARTICLES;

// The layer container the spine views render in (the emitter's parent, in the real runtime).
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
			type: 'spineParticle',
			config: { animation: 'spin', loop: true, prewarm: PREWARM, layerHost },
		},
	],
};

const parent = new Container();
const emitter = new Emitter(parent, config);
const behavior = emitter.getBehavior('spineParticle') as unknown as SpineParticleBehavior;
assert(!!behavior, 'the custom `spineParticle` behavior is live on the emitter');

const allocatedAfterPrewarm = skeletonsAllocated;
assert(allocatedAfterPrewarm === PREWARM, `pool pre-allocates ${PREWARM} skeletons up-front`);

// Run a long stress: many spawn/death cycles. Each frame advances clips + recycles dead ones.
emitter.emit = true;
let peakParticles = 0;
let peakLive = 0;
const STEPS = 1500; // ~24s at 16ms — dozens of full particle lifetimes
for (let i = 0; i < STEPS; i++) {
	emitter.update(0.016);
	peakParticles = Math.max(peakParticles, emitter.particleCount);
	peakLive = Math.max(peakLive, behavior.live.size);
}

console.log('Tier C spike — pooling + lifecycle under load');

// (a) BOUNDED ALLOCATION — the whole perf claim. Across ~94 particle-lifetimes' worth of
// spawn/death, total skeletons EVER allocated must stay at (or barely above) the pool size,
// never grow with frames.
assert(
	skeletonsAllocated <= MAX_PARTICLES,
	`allocation BOUNDED: ${skeletonsAllocated} skeletons ever made after ${STEPS} frames (ceiling ${MAX_PARTICLES})`,
);
assert(
	skeletonsAllocated === allocatedAfterPrewarm,
	'NOT ONE skeleton allocated after prewarm — every particle reused a pooled instance',
);

// (b) the lifecycle actually drove the skeletons (the clip advanced on live ones).
const sampleLive = [...behavior.live][0];
assert(
	peakParticles > 0 && peakLive > 0,
	`particles + skeletons went live (peak ${peakParticles} particles / ${peakLive} skeletons)`,
);
assert(
	!sampleLive || sampleLive.boneRotation() !== 0,
	'a live skeleton’s clip ADVANCED its bone (the per-particle `update(dt)` drives the state machine)',
);

// (c) NO LEAK — live skeletons exactly track live particles; pool + live partition the
// fixed allocation; the display tree holds exactly the live particles.
assert(
	behavior.live.size === emitter.particleCount,
	`live skeletons === live particles (${behavior.live.size} === ${emitter.particleCount}) — no leak`,
);
assert(
	behavior.live.size + behavior.poolSize() === skeletonsAllocated,
	`pool + live partition the fixed ${skeletonsAllocated} allocation (no orphaned skeleton)`,
);
assert(
	layerHost.children.length === emitter.particleCount,
	'the display tree holds exactly the live spine views (one per live particle)',
);
assert(
	parent.children.length === emitter.particleCount,
	'each live particle is on the emitter parent (its spine view tracks its transform)',
);

// (d) full drain: stop emitting, let every particle die — ALL skeletons return to the pool,
// nothing leaks, allocation still bounded.
emitter.emit = false;
for (let i = 0; i < 120; i++) emitter.update(0.016);

console.log('Tier C spike — drain (emit off)');
assert(emitter.particleCount === 0, 'every particle died after emit stopped');
assert(behavior.live.size === 0, 'every live skeleton was recycled (none stranded)');
assert(
	behavior.poolSize() === skeletonsAllocated,
	`ALL ${skeletonsAllocated} skeletons are back in the pool (full recycle, zero leak)`,
);
assert(layerHost.children.length === 0, 'the spine-view display tree is empty after drain');
assert(parent.children.length === 0, 'the particle display tree is empty after drain');
assert(skeletonsAllocated === PREWARM, 'STILL no extra allocation across the entire run');

emitter.destroy();

// ---------------------------------------------------------------------------
// Verdict line.
// ---------------------------------------------------------------------------
console.log('');
if (failures === 0) {
	console.log(
		'VERDICT (headless): NATIVE pooled-Spine-particle mechanics are VIABLE — a custom\n' +
			'`spineParticle` behavior pools real skeleton+AnimationState instances, plays one per\n' +
			'`Particle`, tracks the particle transform, drives each per-particle clip, and recycles on death\n' +
			'with BOUNDED allocation + zero leak, composing cleanly with the real `Emitter` lifecycle.\n' +
			'Rendering pixels + real-clip perf at the target count remain owner-verify-live.',
	);
} else {
	console.error(`\n${failures} assertion(s) FAILED — see above.`);
}

process.exit(failures === 0 ? 0 : 1);
