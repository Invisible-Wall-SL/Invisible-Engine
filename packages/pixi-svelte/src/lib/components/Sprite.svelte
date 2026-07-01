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
		/** When set, interpret `width`/`height` as a BOUNDING BOX: the texture is
		 * scaled by a single uniform factor `min(width/tex.width, height/tex.height)`
		 * so it fits inside the box preserving its native aspect (contain-fit). When
		 * absent/false, `width`/`height` are applied directly (today's stretch). */
		contain?: boolean;
	};
</script>

<script lang="ts">
	import BaseSprite from './BaseSprite.svelte';
	import { getContextApp } from '../context.svelte';
	import type { LoadedSprite } from '../types';

	const { debug, key, fallbackKey, contain, ...baseSpriteProps }: Props = $props();
	const context = getContextApp();
	const texture = $derived(
		(context.stateApp.loadedAssets?.[key] ||
			(fallbackKey ? context.stateApp.loadedAssets?.[fallbackKey] : undefined) ||
			PIXI.Texture.EMPTY) as LoadedSprite,
	);

	// Contain-fit: treat the passed `width`/`height` as a bounding box and scale the
	// texture by a single uniform factor so it fits inside, preserving aspect. Reactive
	// to the texture loading (starts as `Texture.EMPTY`, whose 1×1 size yields no usable
	// fit — fall back to the raw box until the real texture resolves). `anchor` is left
	// to the base sprite, so the smaller fitted box centres on the same seat.
	const containSize = $derived.by(() => {
		if (!contain) return undefined;
		const boxW = baseSpriteProps.width;
		const boxH = baseSpriteProps.height;
		const texW = texture.width;
		const texH = texture.height;
		if (
			texture === PIXI.Texture.EMPTY ||
			typeof boxW !== 'number' ||
			typeof boxH !== 'number' ||
			!(texW > 0) ||
			!(texH > 0)
		) {
			return undefined;
		}
		const s = Math.min(boxW / texW, boxH / texH);
		return { width: texW * s, height: texH * s };
	});
</script>

<!-- Only a MISSING asset is an error, and it is only knowably missing once loading
	 has finished: a sprite that mounts during the asset-load window (the game tree now
	 mounts generically behind the loading screen, not gated behind it) legitimately
	 renders `Texture.EMPTY` until its bundle arrives, then resolves reactively. Gate the
	 diagnostic on `stateApp.loaded` so it flags a genuinely absent key, not one in flight.
	 `debug` still forces the log. -->
{#if (texture === PIXI.Texture.EMPTY && context.stateApp.loaded) || debug}
	{console.error(
		`Sprite: key "${key}"${fallbackKey ? ` (fallback "${fallbackKey}")` : ''} is not found in the loadedAssets`,
	)}
	{console.log('loadedAssets', $state.snapshot(context.stateApp).loadedAssets)}
{/if}

<BaseSprite {...baseSpriteProps} {...containSize} {texture} />
