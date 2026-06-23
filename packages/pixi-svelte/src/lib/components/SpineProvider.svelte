<script lang="ts" module>
	import { type Props as BaseProps } from './BaseSpineProvider.svelte';
	import type { PixiPoint } from '../types';

	export type Props = Omit<BaseProps, 'spineData' | 'pivot' | 'scale'> & {
		debug?: boolean;
		key: string;
		anchor?: PixiPoint;
		scale?: PixiPoint;
	};
</script>

<script lang="ts">
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	import BaseSpineProvider from './BaseSpineProvider.svelte';
	import { anchorToPivot } from '../utils.svelte';
	import { getContextApp } from '../context.svelte';

	const { debug, key, anchor, children, scale: scaleProp, ...baseSpineProps }: Props = $props();
	const context = getContextApp();
	const spineData = $derived.by(() => {
		const assets = context.stateApp.loadedAssets;
		const direct = assets?.[key] as SPINE_PIXI.SkeletonData | undefined;
		if (direct) return direct;
		// Editor scene docs store a spine key as its R2 bundle PREFIX
		// (`<client>/<project>/spines/<bundle>/`) so the editor can preview it from
		// R2; games register the spine under the plain `<bundle>` key. Fall back to
		// that so doc-driven spine nodes resolve in-game.
		const bundle = key.match(/(?:^|\/)spines\/(.+?)\/?$/)?.[1];
		return bundle ? (assets?.[bundle] as SPINE_PIXI.SkeletonData | undefined) : undefined;
	});

	// `width`/`height` → scale is resolved in `BaseSpineProvider` (it sizes against the
	// pose-independent authored bounds, robust to animation/skin-driven art whose setup
	// pose is empty). Here we only forward the caller's raw `scale`; BaseSpineProvider
	// folds the size scale into it.
	const scale = $derived.by(() => {
		if (typeof scaleProp === 'number') return { x: scaleProp, y: scaleProp };
		return { x: scaleProp?.x ?? 1, y: scaleProp?.y ?? 1 };
	});

	const pivot = $derived.by(() => {
		if (!spineData) return undefined;
		// Degenerate export (no skeleton width/height) → return `undefined` and let
		// BaseSpineProvider anchor from the LIVE animated bounds once the art appears. A
		// static pivot can't be computed (no size), and the synthesized one measured 0, so
		// the spine pinned to its origin (0,0 top-left). Authored bounds → standard pivot.
		if (!(spineData.width > 0) || !(spineData.height > 0)) return undefined;
		const factWidth = baseSpineProps.width || spineData.width;
		const factHeight = baseSpineProps.height || spineData.height;
		return anchorToPivot({ anchor, sizes: { width: factWidth, height: factHeight } });
	});
</script>

{#if !spineData}
	{console.error(`Spine: key "${key}" is not found in loadedAssets`)}
{/if}

{#if !spineData || debug}
	{console.log('loadedAssets', $state.snapshot(context.stateApp).loadedAssets)}
{/if}

{#key spineData}
	{#if spineData}
		<BaseSpineProvider {...baseSpineProps} {scale} {pivot} {spineData} anchorFallback={anchor}>
			{@render children()}
		</BaseSpineProvider>
	{/if}
{/key}
