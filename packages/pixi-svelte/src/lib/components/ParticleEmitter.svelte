<script lang="ts" module>
	import {
		Emitter,
		upgradeConfig,
		type EmitterConfigV3,
		type EmitterConfigV2,
		type EmitterConfigV1,
	} from '@barvynkoa/particle-emitter';
	import { bindArt, behaviorsOf, type BehaviorEntry } from 'engine-fx';

	import type { LoadedSpriteSheet } from '../types';
	import {
		SPINE_PARTICLE_BEHAVIOR_TYPE,
		type SpineParticleBehaviorConfig,
		type LayerHostLike,
	} from '../spineParticleBehavior';

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
		 * Tier C (`particleKind: 'spine'`): when present, EACH particle is a pooled `Spine`
		 * instance playing this config's clip instead of a textured sprite. The component
		 * registers the `spineParticle` behavior and injects this config into the emitter's
		 * `behaviors` (textureless particles — their art IS the pooled spine view), so the
		 * sprite `bindArt`/`key` path is SKIPPED entirely. Absent ⇒ the sprite path (Tiers A/B),
		 * byte-identical. Supplies the clip + the runtime-only pieces (the layer host container +
		 * the pooled-`Spine` factory bound to the resolved `loadedAssets` skeleton).
		 */
		spineParticle?: Omit<SpineParticleBehaviorConfig, 'layerHost'>;
	};

	/**
	 * Inject the Tier-C `spineParticle` behavior into a V3 config, returning a NEW config the
	 * `Emitter` renders by pooling `Spine` instances. Like `bindArt` it clones the config (no art
	 * behavior needed — particles are textureless) and attaches the live runtime objects (the
	 * factory + layer host) AFTER cloning, so the result must NOT be JSON-cloned again.
	 */
	function bindSpineParticle(
		config: EmitterConfigV3,
		spineParticle: SpineParticleBehaviorConfig,
	): EmitterConfigV3 {
		const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
		const behaviors = behaviorsOf(next).filter((b) => b.type !== SPINE_PARTICLE_BEHAVIOR_TYPE);
		const entry: BehaviorEntry = {
			type: SPINE_PARTICLE_BEHAVIOR_TYPE,
			config: spineParticle as unknown as Record<string, unknown>,
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
		textures: LoadedSpriteSheet | undefined,
		animated: boolean,
	): EmitterConfigV3 {
		const art = textures ?? [];
		if (config && 'behaviors' in config) {
			return bindArt(config as EmitterConfigV3, art, animated);
		}
		return upgradeConfig(config, art);
	}
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getContextApp, getContextParent } from '../context.svelte';
	import { propsSyncEffect } from '../utils.svelte';
	import { registerSpineParticleBehavior, SpineParticleBehavior } from '../spineParticleBehavior';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();

	// Tier C: a `spineParticle` layer pools `Spine` instances instead of binding sprite textures.
	// Register the behavior so the `Emitter` knows the type, then inject the config (with the layer
	// host container the pooled spine views render into) — SKIPPING the sprite `bindArt`/`key`
	// path. Absent ⇒ the sprite path below, byte-identical.
	const isSpineParticle = !!props.spineParticle;
	if (isSpineParticle) registerSpineParticleBehavior();

	const textures = $derived(context.stateApp.loadedAssets?.[props.key] as LoadedSpriteSheet);
	const updatedConfig = $derived(
		props.spineParticle && props.config && 'behaviors' in props.config
			? bindSpineParticle(props.config as EmitterConfigV3, {
					...props.spineParticle,
					// The pooled spine views ARE real `ContainerChild`s at runtime; the host's
					// `LayerHostLike` surface is intentionally renderer-agnostic (so the pool stays
					// unit-coverable), so a structural cast bridges the conservative PIXI generic.
					layerHost: parentContext.parent as unknown as LayerHostLike,
				})
			: bindConfig(props.config, textures, props.animated ?? false),
	);
	// svelte-ignore state_referenced_locally
	const emitter = new Emitter(parentContext.parent, updatedConfig);

	propsSyncEffect({ props, target: emitter, ignore: ['emit', 'animated', 'spineParticle'] });

	$effect(() => {
		// `emit` true ⇒ (re)start the emitter from the bound config; false ⇒ stop spawning so
		// an event-triggered layer that has run its `duration` actually ceases (existing
		// particles still fade out via their lifetime). Ambient layers keep `emit` true, so
		// they take the same `init` branch as before — byte-identical to the prior behaviour.
		if (props.emit) emitter.init(updatedConfig);
		else emitter.emit = false;
	});

	if (context.stateApp.pixiApplication) {
		context.stateApp.pixiApplication.ticker.add(() => {
			if (context.stateApp.pixiApplication) {
				const deltaUpdate =
					context.stateApp.pixiApplication.ticker.deltaMS * (props.emitSpeed || 0.00234);
				emitter.update(deltaUpdate);
			}
		});
	}

	onDestroy(() => {
		emitter.emit = false;
		// Free the pooled `Spine` instances (pool + live) before the emitter tears down — the
		// behavior owns skeletons the emitter's own `destroy` never sees.
		if (isSpineParticle) {
			const behavior = emitter.getBehavior(SPINE_PARTICLE_BEHAVIOR_TYPE);
			if (behavior instanceof SpineParticleBehavior) behavior.dispose();
		}
		emitter.destroy();
	});
</script>
