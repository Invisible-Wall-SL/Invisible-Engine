<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	export type Props = {
		key: string;
		size: number;
		init: (particles: PIXI.Particle[]) => void;
		update: (particles: PIXI.Particle[]) => void;
	};
</script>

<script lang="ts">
	import type { LoadedSprite } from '../types';
	import { getContextApp, getContextParticleParent } from '../context.svelte';
	import { hasAssetKey, warnMissingAsset } from '../missingAsset';

	const props: Props = $props();
	const context = getContextApp();
	const particleContainer = getContextParticleParent();
	const texture = $derived(
		(context.stateApp.loadedAssets?.[props.key] || PIXI.Texture.EMPTY) as LoadedSprite,
	);

	const particles: PIXI.Particle[] = Array.from(
		{ length: props.size },
		() => new PIXI.Particle(texture),
	);
	particleContainer.addParticle(...particles);
	props.init(particles);

	if (context.stateApp.pixiApplication) {
		context.stateApp.pixiApplication.ticker.add(() => {
			props.update(particles);
			particleContainer.update();
		});
	}
</script>

<!-- Load-aware diagnostic: only flag a missing key once loading is done (a particle
	 mounted during the asset-load window resolves later). See Sprite.svelte. -->
{#if texture === PIXI.Texture.EMPTY && context.stateApp.loaded && hasAssetKey(props.key)}
	{warnMissingAsset(`Particle: key "${props.key}" is not found in the loadedAssets`)}
{/if}
