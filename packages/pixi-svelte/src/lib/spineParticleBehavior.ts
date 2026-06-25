/**
 * Invisible FX — Tier C runtime: the pooled-`Spine`-instance particle behavior.
 *
 * `@barvynkoa/particle-emitter` hard-codes `class Particle extends Sprite` and `new Particle()`
 * at every spawn site — there is NO particle-class factory hook, so a particle can NEVER be a
 * `Spine`. But the behavior system is fully pluggable (`Emitter.registerBehavior` + the
 * `IEmitterBehavior` `{ order, initParticles, updateParticle?, recycleParticle? }` interface),
 * and a `Particle` is a `Sprite` ⇒ a `Container`. So the native Tier-C mechanism — PROVEN by the
 * Phase-0 spike (`tools/fx-spike/spineParticle.ts`, 18/18 GREEN) — is a custom behavior that owns
 * a POOL of `Spine` instances: on spawn take one from the pool, play its clip, add its view to the
 * layer container; each frame advance the clip + track the (textureless) particle's transform; on
 * recycle reset + return to the pool. NEVER a skeleton per-particle-per-frame.
 *
 * THE POOL IS INJECTABLE. The bookkeeping (pre-warm, take/return, per-particle lifecycle, no-leak)
 * is decoupled from the renderer through a {@link SpineBackingFactory}: the runtime injects a real
 * pixi-v8 `Spine`-backed factory, while the headless harness injects a spine-core backing (the
 * un-mangled animation machinery the spike used). The behavior class itself is renderer-agnostic.
 *
 * Registration is owned here so a single `import` from a consumer (e.g. `<EffectLayer>`) ensures
 * the `'spineParticle'` type is known to every `Emitter` before it inits.
 */

import { Emitter, type Particle } from '@barvynkoa/particle-emitter';

import type { LayerHostLike } from './spineBacking';
import type { SpineBacking, SpineBackingFactory } from './spineBacking';

export type {
	SpineBacking,
	SpineBackingFactory,
	ContainerLike,
	LayerHostLike,
} from './spineBacking';

/**
 * The library's behavior interface (`behaviors/Behaviors`) is type-only and not re-exported from
 * the package index, so we restate the exact shape the `Emitter` calls against (verified against
 * `lib/behaviors/Behaviors.d.ts`): `order` + `initParticles`, optional `updateParticle` /
 * `recycleParticle`. A behavior CLASS additionally needs a static `type` + `new (config)`.
 */
export interface IEmitterBehavior {
	order: number;
	initParticles(first: Particle): void;
	updateParticle?(particle: Particle, deltaSec: number): void | boolean;
	recycleParticle?(particle: Particle, natural: boolean): void;
}

/** Behavior type string registered with `@barvynkoa/particle-emitter`. */
export const SPINE_PARTICLE_BEHAVIOR_TYPE = 'spineParticle';

/**
 * The behavior's config — what `<EffectLayer>` injects into the emitter's `behaviors` entry. It
 * mirrors the EffectDoc's `spineParticle` ({ `skeletonKey`, `animation`, `loop` }) PLUS the two
 * things only the runtime can supply: the layer container the spine views render into, and the
 * pooled-backing factory (which resolves `skeletonKey` against the game's `loadedAssets`).
 */
export interface SpineParticleBehaviorConfig {
	/** The clip each pooled particle skeleton plays. */
	animation: string;
	/** Whether each particle's clip loops. */
	loop: boolean;
	/** Pool pre-warm count (derived from the emitter's `maxParticles`). */
	prewarm: number;
	/** The container the pooled spine views render in (the emitter's layer container). */
	layerHost: LayerHostLike;
	/** Builds a pooled backing (a `Spine` + its `view`); injected so the pool is renderer-agnostic. */
	createBacking: SpineBackingFactory;
}

/**
 * The Tier-C custom particle behavior. Pools {@link SpineBacking}s; on spawn it takes one from the
 * pool, plays the clip, and adds its view to the layer container; each frame it advances the clip +
 * tracks the (textureless) particle's transform/alpha; on recycle it resets + returns the backing
 * to the pool — bounded allocation, zero leak (the spike's exact, proven shape).
 */
export class SpineParticleBehavior implements IEmitterBehavior {
	static type = SPINE_PARTICLE_BEHAVIOR_TYPE;
	/** Spawn order — runs alongside the other spawn-time behaviors (`BehaviorOrder.Spawn`). */
	order = 0;

	private readonly animation: string;
	private readonly loop: boolean;
	private readonly layerHost: LayerHostLike;
	private readonly createBacking: SpineBackingFactory;

	/** Idle backings ready to reuse. */
	private readonly pool: SpineBacking[] = [];
	/**
	 * Particle → its attached backing. The library never clears `particle.config`, but a WeakMap
	 * keeps the mapping self-contained (no per-particle field leak) and GC-safe.
	 */
	private readonly attached = new WeakMap<Particle, SpineBacking>();
	/** Backings currently driving a live particle (== live particle count; the no-leak invariant). */
	readonly live = new Set<SpineBacking>();
	/** Total backings ever allocated — the bounded-allocation invariant rides on this. */
	private allocated = 0;

	constructor(config: SpineParticleBehaviorConfig) {
		this.animation = config.animation;
		this.loop = config.loop;
		this.layerHost = config.layerHost;
		this.createBacking = config.createBacking;
		// UP-FRONT allocation — fill the pool once so no skeleton is built per-particle-per-frame.
		for (let i = 0; i < Math.max(0, config.prewarm); i++) {
			this.pool.push(this.allocate());
		}
	}

	private allocate(): SpineBacking {
		this.allocated++;
		return this.createBacking();
	}

	/** Reuse from the pool; only allocate if genuinely exhausted (a bounded high-water mark). */
	private take(): SpineBacking {
		return this.pool.pop() ?? this.allocate();
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
		const backing = this.attached.get(particle);
		if (!backing) return;
		// Advance the genuine animation state machine + weld the spine view to the particle.
		backing.advance(deltaSec);
		backing.view.position.set(particle.x, particle.y);
		backing.view.rotation = particle.rotation;
		backing.view.scale.set(particle.scale.x, particle.scale.y);
		backing.view.alpha = particle.alpha;
	}

	recycleParticle(particle: Particle): void {
		const backing = this.attached.get(particle);
		if (!backing) return;
		backing.view.removeFromParent();
		backing.reset();
		this.attached.delete(particle);
		this.live.delete(backing);
		this.pool.push(backing);
	}

	/** Idle backings (for tests / introspection). */
	poolSize(): number {
		return this.pool.length;
	}

	/** Total backings ever allocated (the bounded-allocation invariant). */
	allocatedCount(): number {
		return this.allocated;
	}

	/** Destroy every backing (pool + live) and clear — called when the layer unmounts. */
	dispose(): void {
		for (const backing of this.live) {
			backing.view.removeFromParent();
			backing.destroy();
		}
		for (const backing of this.pool) {
			backing.destroy();
		}
		this.live.clear();
		this.pool.length = 0;
	}
}

let registered = false;

/**
 * Register `SpineParticleBehavior` with the library ONCE (idempotent — re-registering the same
 * type just overrides it, but we guard so multiple `<EffectLayer>` mounts don't thrash). Call this
 * before constructing an `Emitter` whose config carries a `spineParticle` behavior entry.
 */
export function registerSpineParticleBehavior(): void {
	if (registered) return;
	Emitter.registerBehavior(SpineParticleBehavior as never);
	registered = true;
}
