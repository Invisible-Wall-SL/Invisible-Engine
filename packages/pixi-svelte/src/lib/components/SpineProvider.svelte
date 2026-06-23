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
		if (!spineData) return 0;
		if (!spineData?.width || !spineData?.height) return 0;
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

<!--
	Spine size debug — set `window.__IW_SPINE_DEBUG__ = true` in the console BEFORE the
	spine mounts (e.g. before triggering the free-spin intro), then read the `[IW-SPINE]`
	line. `natural` = the skeleton's authored bounds; `nodeScale` = the scale this node
	applies; `mainBoxUnit` = natural×nodeScale (the size in MAIN-box units, BEFORE the
	MainContainer's window scale). Compare this number to the editor's [IW-SPINE] log: if
	they MATCH, the in-game size differs only by window scale (not a bug — size it smaller);
	if they DIFFER, it's a real editor↔game mismatch and the numbers show where.
-->
{#if spineData && typeof window !== 'undefined' && (window as unknown as { __IW_SPINE_DEBUG__?: boolean }).__IW_SPINE_DEBUG__}
	{console.log(
		'[IW-SPINE game]',
		key,
		'natural=',
		Math.round(spineData.width ?? 0),
		Math.round(spineData.height ?? 0),
		'nodeScale=',
		Number(scale.x.toFixed(4)),
		'mainBoxUnit=',
		Math.round((spineData.width ?? 0) * scale.x),
		Math.round((spineData.height ?? 0) * scale.y),
	)}
{/if}

{#key spineData}
	{#if spineData}
		<BaseSpineProvider {...baseSpineProps} {scale} {pivot} {spineData}>
			{@render children()}
		</BaseSpineProvider>
	{/if}
{/key}
