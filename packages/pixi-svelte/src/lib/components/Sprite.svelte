<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	import { type Props as BaseProps } from './BaseSprite.svelte';

	export type Props = Omit<BaseProps, 'texture'> & {
		debug?: boolean;
		key: string;
		/** Resolved when `key` is absent from `loadedAssets`. Lets a caller pass a
		 * scoped lookup key (e.g. an editor-art `<assetKey>::<region>`) while still
		 * degrading to the bare key when the scoped texture was not registered (a
		 * game whose asset registration predates the namespacing). */
		fallbackKey?: string;
	};
</script>

<script lang="ts">
	import BaseSprite from './BaseSprite.svelte';
	import { getContextApp } from '../context.svelte';
	import type { LoadedSprite } from '../types';

	const { debug, key, fallbackKey, ...baseSpriteProps }: Props = $props();
	const context = getContextApp();
	const texture = $derived(
		(context.stateApp.loadedAssets?.[key] ||
			(fallbackKey ? context.stateApp.loadedAssets?.[fallbackKey] : undefined) ||
			PIXI.Texture.EMPTY) as LoadedSprite,
	);
</script>

{#if texture === PIXI.Texture.EMPTY || debug}
	{console.error(
		`Sprite: key "${key}"${fallbackKey ? ` (fallback "${fallbackKey}")` : ''} is not found in the loadedAssets`,
	)}
	{console.log('loadedAssets', $state.snapshot(context.stateApp).loadedAssets)}
{/if}

<BaseSprite {...baseSpriteProps} {texture} />
