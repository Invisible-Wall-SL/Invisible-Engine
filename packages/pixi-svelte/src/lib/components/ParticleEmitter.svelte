<script lang="ts" module>
	import {
		Emitter,
		upgradeConfig,
		type EmitterConfigV3,
		type EmitterConfigV2,
		type EmitterConfigV1,
	} from '@barvynkoa/particle-emitter';
	import {
		bindArt,
		behaviorsOf,
		createEffectParamApplier,
		emitterDeltaSeconds,
		registerFxBehaviors,
		type BehaviorEntry,
		type EffectParam,
		type EffectParamApplier,
		type EffectParamValues,
		type EmitterLayer,
	} from 'engine-fx';
	import type { Texture } from 'pixi.js';

	// Teach the library our two custom behaviors (`fxAlpha`, `fxColorOverlay` — per-particle alpha
	// variation + a randomly-graded colour overlay, neither of which the stock library has). A
	// config only carries them when the author enabled that knob in `/fx`, but registration must
	// happen before ANY emitter inits, so it runs at module load. Idempotent.
	registerFxBehaviors(Emitter);

	import type { LoadedSpriteSheet } from '../types';
	import {
		RIG_PARTICLE_BEHAVIOR_TYPE,
		type RigParticleBehaviorConfig,
		type LayerHostLike,
	} from '../rigParticleBehavior';

	/** What an emitter needs to apply an effect's exposed parameters live (`engine-fx` `params.ts`). */
	export interface ParticleEmitterParams {
		/** The effect's `params`. */
		params: readonly EffectParam[];
		/** The layer this emitter draws — its key picks the drives, its offset is the base. */
		layer: EmitterLayer;
		/** The live values, read on the ticker — never through Svelte reactivity. */
		values: () => EffectParamValues | undefined;
		/** Moves the layer's offset container. Absent ⇒ the emitter's parent container is moved. */
		setOffset?: (x: number, y: number) => void;
	}

	export type Props = Partial<Emitter> & {
		key: string;
		emitSpeed?: number;
		config: EmitterConfigV3 | EmitterConfigV2 | EmitterConfigV1;
		/**
		 * For a V3 `config` only: render the layer's textures as an `animatedSingle`
		 * flipbook (one particle cycling all frames) rather than `textureRandom` (each
		 * particle a random frame). Ignored for a V1/V2 config (their art binds through
		 * `upgradeConfig`). See `bindArt`.
		 */
		animated?: boolean;
		/**
		 * Tier C (`particleKind: 'spine'`): when present, EACH particle is a pooled `RigView`
		 * instance playing this config's clip instead of a textured sprite. The component
		 * registers the `spineParticle` behavior and injects this config into the emitter's
		 * `behaviors` (textureless particles — their art IS the pooled rig view), so the
		 * sprite `bindArt`/`key` path is SKIPPED entirely. Absent ⇒ the sprite path (Tiers A/B),
		 * byte-identical. Supplies the clip + the runtime-only pieces (the layer host container +
		 * the pooled-`RigView` factory bound to the resolved `loadedAssets` skeleton).
		 */
		spineParticle?: Omit<RigParticleBehaviorConfig, 'layerHost'>;
		/**
		 * Explicit per-frame textures for a V3 sprite layer — the layer's `art.frames` already
		 * resolved (by `EffectLayer`) to the loaded per-frame `Texture`s, in frame order. When
		 * present these are bound INSTEAD of the whole `loadedAssets[key]` sheet, so an effect that
		 * selected a SUBSET of an atlas renders exactly those frames. Absent ⇒ the whole-sheet
		 * fallback (back-compat with a game-bundled spritesheet `key`).
		 */
		textures?: Texture[];
		/**
		 * Relative per-frame spawn weights (parallel to `textures`) for a static mix — forwarded to
		 * `bindArt`, which realises them as a repeated-texture multiset. Ignored for the flipbook
		 * (`animated`) path and when no explicit `textures` are supplied.
		 */
		weights?: number[];
		/**
		 * Flipbook playback for the `animated` path — the layer's authored `art.framerate` /
		 * `art.loop`. Absent (or a non-positive framerate) ⇒ match-life: the sequence is stretched
		 * across the particle's lifetime, the original and still-default behaviour.
		 */
		flipbook?: { framerate?: number; loop?: boolean };
		/**
		 * A MOVING OWNER, for a trail. Read every tick and handed to `emitter.updateOwnerPos` before
		 * `update`, in the emitter parent's local space: new particles spawn along the path (the
		 * library lerps the spawns within a frame) while the ones already out stay where they were
		 * born. The parent must stay still — moving the container instead carries every particle
		 * along rigidly, which is what every other mount does. Absent ⇒ the owner stays at the origin,
		 * exactly as before.
		 */
		ownerPos?: () => { x: number; y: number };
		/**
		 * The emitter's rotation, radians — read every tick with {@link ownerPos} and handed to
		 * `emitter.rotate`, which turns every NEW particle (its art, launch direction and spawn
		 * offset) by it; the ones already out keep theirs. A flight's trail passes its heading here
		 * so it follows the arc. A `noRotation` layer still pins its art. Absent ⇒ unrotated.
		 */
		ownerRotation?: () => number;
		/**
		 * Apply the effect's exposed parameters live: each frame the values are read and a changed one
		 * rebuilds only the behaviour it drives (no `init`, so no particle is lost). Absent ⇒ no
		 * parameter work at all.
		 */
		fxParams?: ParticleEmitterParams;
		/** Multiplies the emit speed, read every tick (an effect-level `effect.timeScale` drive). */
		timeScale?: () => number;
	};

	/**
	 * Inject the Tier-C `spineParticle` behavior into a V3 config, returning a NEW config the
	 * `Emitter` renders by pooling `RigView` instances. Like `bindArt` it clones the config (no art
	 * behavior needed — particles are textureless) and attaches the live runtime objects (the
	 * factory + layer host) AFTER cloning, so the result must NOT be JSON-cloned again.
	 */
	function bindRigParticle(
		config: EmitterConfigV3,
		rigParticle: RigParticleBehaviorConfig,
	): EmitterConfigV3 {
		const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
		const behaviors = behaviorsOf(next).filter((b) => b.type !== RIG_PARTICLE_BEHAVIOR_TYPE);
		const entry: BehaviorEntry = {
			type: RIG_PARTICLE_BEHAVIOR_TYPE,
			config: rigParticle as unknown as Record<string, unknown>,
		};
		behaviors.push(entry);
		(next as { behaviors: BehaviorEntry[] }).behaviors = behaviors;
		return next;
	}

	/**
	 * Bind the loaded `key` textures into the config so the emitter actually renders.
	 *
	 * A V1/V2 config carries its art through the library's `upgradeConfig(config, art)` —
	 * EXACTLY as before, byte-identical for the existing fountain story. But `upgradeConfig`
	 * is a NO-OP for a V3 config (it returns it unchanged the moment it sees a `behaviors`
	 * array), so a V3 config MUST inject its textures as its OWN `textureRandom` /
	 * `animatedSingle` behavior via the shared `engine-fx` `bindArt` — otherwise it spawns
	 * textureless, invisible particles. This is the `ParticleEmitter` runtime contract the
	 * `EffectDoc` (V3) reduces to (`invisible-fx.md` §3/§4.4).
	 */
	function bindConfig(
		config: EmitterConfigV3 | EmitterConfigV2 | EmitterConfigV1,
		textures: LoadedSpriteSheet | Texture[] | undefined,
		animated: boolean,
		weights?: number[],
		flipbook?: { framerate?: number; loop?: boolean },
	): EmitterConfigV3 {
		const art = textures ?? [];
		if (config && 'behaviors' in config) {
			return bindArt(config as EmitterConfigV3, art, animated, weights, flipbook);
		}
		return upgradeConfig(config, art);
	}
</script>

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { getContextApp, getContextParent } from '../context.svelte';
	import { propsSyncEffect } from '../utils.svelte';
	import { registerRigParticleBehavior, RigParticleBehavior } from '../rigParticleBehavior';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();

	// Tier C: a `spineParticle` layer pools `RigView` instances instead of binding sprite textures.
	// Register the behavior so the `Emitter` knows the type, then inject the config (with the layer
	// host container the pooled rig views render into) — SKIPPING the sprite `bindArt`/`key`
	// path. Absent ⇒ the sprite path below, byte-identical.
	const isRigParticle = !!props.spineParticle;
	if (isRigParticle) registerRigParticleBehavior();

	// A sprite layer binds its authored per-frame `textures` (resolved by `EffectLayer` from
	// `art.frames`) when supplied; otherwise the whole `loadedAssets[key]` sheet (back-compat).
	const sheetTextures = $derived(context.stateApp.loadedAssets?.[props.key] as LoadedSpriteSheet);
	const spriteTextures = $derived(props.textures ?? sheetTextures);
	const updatedConfig = $derived(
		props.spineParticle && props.config && 'behaviors' in props.config
			? bindRigParticle(props.config as EmitterConfigV3, {
					...props.spineParticle,
					// The pooled rig views ARE real `ContainerChild`s at runtime; the host's
					// `LayerHostLike` surface is intentionally renderer-agnostic (so the pool stays
					// unit-coverable), so a structural cast bridges the conservative PIXI generic.
					layerHost: parentContext.parent as unknown as LayerHostLike,
				})
			: bindConfig(
					props.config,
					spriteTextures,
					props.animated ?? false,
					props.weights,
					props.flipbook,
				),
	);
	// svelte-ignore state_referenced_locally
	const emitter = new Emitter(parentContext.parent, updatedConfig);
	/** The config the emitter was last initialised from — what a parameter applier rebuilds against. */
	// svelte-ignore state_referenced_locally
	let initConfig = updatedConfig;
	let applier: EffectParamApplier | undefined;
	/** A fresh applier for the emitter as it stands now, at once given the current values. */
	const bindParams = (): void => {
		const fx = props.fxParams;
		applier = fx
			? createEffectParamApplier({
					params: fx.params,
					layer: fx.layer,
					config: initConfig,
					emitter,
					setOffset: fx.setOffset ?? ((x, y) => parentContext.parent.position.set(x, y)),
				})
			: undefined;
		applier?.apply(fx?.values());
	};

	propsSyncEffect({
		props,
		target: emitter,
		// `ownerPos` is a getter, not a field: the emitter's own `ownerPos` is a Point the library
		// owns, and assigning the function over it would break every spawn.
		ignore: [
			'emit',
			'animated',
			'spineParticle',
			'textures',
			'weights',
			'ownerPos',
			'ownerRotation',
			'fxParams',
			'timeScale',
		],
	});

	/** Hand the owner's position to the emitter. `init` resets it to the origin, so this runs after. */
	let ownerTracked = false;
	const syncOwner = () => {
		if (props.ownerRotation) emitter.rotate(props.ownerRotation());
		const read = props.ownerPos;
		if (!read) return;
		const { x, y } = read();
		emitter.updateOwnerPos(x, y);
		// The first position is a placement, not a move: no lerp from wherever the owner was before.
		if (!ownerTracked) {
			emitter.resetPositionTracking();
			ownerTracked = true;
		}
	};

	$effect(() => {
		// `emit` true ⇒ (re)start the emitter from the bound config; false ⇒ stop spawning so
		// an event-triggered layer that has run its `duration` actually ceases (existing
		// particles still fade out via their lifetime). Ambient layers keep `emit` true, so
		// they take the same `init` branch as before — byte-identical to the prior behaviour.
		if (props.emit) {
			emitter.init(updatedConfig);
			initConfig = updatedConfig;
			ownerTracked = false;
			// Untracked: the getter reads live position state, which must not re-run this `init`.
			untrack(syncOwner);
			// `init` rebuilt every behaviour from the config, so the old applier's view is stale.
			untrack(bindParams);
		} else emitter.emit = false;
	});

	// A new parameter set (rare at runtime) puts the old drives back before the new ones apply.
	$effect(() => {
		void props.fxParams;
		untrack(() => {
			applier?.restore();
			bindParams();
		});
	});

	const tick = () => {
		if (context.stateApp.pixiApplication) {
			syncOwner();
			applier?.apply(props.fxParams?.values());
			const deltaUpdate =
				emitterDeltaSeconds(context.stateApp.pixiApplication.ticker.deltaMS, props.emitSpeed) *
				(props.timeScale?.() ?? 1);
			emitter.update(deltaUpdate);
		}
	};
	const ticker = context.stateApp.pixiApplication?.ticker;
	ticker?.add(tick);

	onDestroy(() => {
		ticker?.remove(tick);
		emitter.emit = false;
		// Free the pooled `RigView` instances (pool + live) before the emitter tears down — the
		// behavior owns skeletons the emitter's own `destroy` never sees.
		if (isRigParticle) {
			const behavior = emitter.getBehavior(RIG_PARTICLE_BEHAVIOR_TYPE);
			if (behavior instanceof RigParticleBehavior) behavior.dispose();
		}
		emitter.destroy();
	});
</script>
