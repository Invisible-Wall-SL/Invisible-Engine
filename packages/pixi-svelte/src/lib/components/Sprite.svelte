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
		/** Stronger than {@link contain}: fit the texture's VISIBLE CONTENT (opaque
		 * pixels, ignoring transparent margin baked into the art) into the `width`/`height`
		 * box, and re-anchor so the content centres on the sprite position. Makes a padded
		 * icon and a tight one render at the same on-screen size. Degrades to plain
		 * `contain` when the content can't be measured (cross-origin taint, etc.). */
		containContent?: boolean;
	};
</script>

<script lang="ts">
	import BaseSprite from './BaseSprite.svelte';
	import { getContextApp } from '../context.svelte';
	import { textureContentBox } from '../utils.svelte';
	import type { LoadedSprite } from '../types';

	const { debug, key, fallbackKey, contain, containContent, ...baseSpriteProps }: Props = $props();
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

	// Content-fit: scale so the texture's OPAQUE CONTENT fills the box (ignoring transparent
	// margin) and re-anchor to the content centre, so a padded and a tight icon read the same
	// size. Falls back to `containSize` (plain contain) when the content can't be measured.
	const contentFit = $derived.by(() => {
		if (!containContent) return undefined;
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
		const c = textureContentBox(texture as unknown as Parameters<typeof textureContentBox>[0]);
		if (!c) return undefined; // unmeasurable → caller falls back to plain contain
		const contentW = c.cw * texW;
		const contentH = c.ch * texH;
		if (!(contentW > 0) || !(contentH > 0)) return undefined;
		const s = Math.min(boxW / contentW, boxH / contentH);
		return { width: texW * s, height: texH * s, anchor: { x: c.cx, y: c.cy } };
	});
</script>

{#if texture === PIXI.Texture.EMPTY || debug}
	{console.error(
		`Sprite: key "${key}"${fallbackKey ? ` (fallback "${fallbackKey}")` : ''} is not found in the loadedAssets`,
	)}
	{console.log('loadedAssets', $state.snapshot(context.stateApp).loadedAssets)}
{/if}

<BaseSprite {...baseSpriteProps} {...contentFit ?? containSize} {texture} />
