<script lang="ts" module>
	import {
		Emitter,
		upgradeConfig,
		type EmitterConfigV3,
		type EmitterConfigV2,
		type EmitterConfigV1,
	} from '@barvynkoa/particle-emitter';
	import { bindArt } from 'engine-fx';

	import type { LoadedSpriteSheet } from '../types';

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
	};

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

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();
	const textures = $derived(context.stateApp.loadedAssets?.[props.key] as LoadedSpriteSheet);
	const updatedConfig = $derived(bindConfig(props.config, textures, props.animated ?? false));
	// svelte-ignore state_referenced_locally
	const emitter = new Emitter(parentContext.parent, updatedConfig);

	propsSyncEffect({ props, target: emitter, ignore: ['emit', 'animated'] });

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
		emitter.destroy();
	});
</script>
