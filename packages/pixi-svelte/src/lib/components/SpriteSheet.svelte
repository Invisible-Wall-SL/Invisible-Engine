<script lang="ts" module>
	import { type Props as BaseProps } from './AnimatedSprite.svelte';

	export type Props = Omit<BaseProps, 'textures'> & { key: string };
</script>

<script lang="ts">
	import AnimatedSprite from './AnimatedSprite.svelte';
	import { getContextApp } from '../context.svelte';
	import { warnMissingAsset } from '../missingAsset';
	import type { LoadedSpriteSheet } from '../types';

	const context = getContextApp();

	const { key, ...animateSpriteProps }: Props = $props();
	const textures = $derived(context.stateApp.loadedAssets?.[key] as LoadedSpriteSheet);
	const isValid = $derived(textures && 'length' in textures);
</script>

<!-- Load-aware diagnostic: an absent key is only knowably missing once loading is
	 done — during the load window a sheet mounted by the (now generically mounted) game
	 tree resolves later. See Sprite.svelte for the rationale. -->
{#if !isValid && context.stateApp.loaded}
	{warnMissingAsset(`SpriteSheet: key "${key}" is not found in loadedAssets`)}
{/if}

<AnimatedSprite {...animateSpriteProps} textures={isValid ? textures : []} />
