<script lang="ts" module>
	import { type Props as BaseProps } from './BaseSpineProvider.svelte';
	import type { PixiPoint } from '../types';

	export type Props = Omit<BaseProps, 'spineData' | 'pivot' | 'scale'> & {
		debug?: boolean;
		key: string;
		anchor?: PixiPoint;
		scale?: PixiPoint;
		/**
		 * Render this rig as if its skeleton had been read at THIS load scale, whatever
		 * `parser.scale` its bundle was actually loaded with (`setSpineLoadScale`).
		 *
		 * The Spine readers scale the skeleton geometry but leave `skeleton.data.width/height`
		 * un-scaled, so the load scale is a bare multiplier that NO sizing path cancels — a
		 * bundle read at 2 is twice the size of the same bundle read at 1, both at natural size
		 * and at any requested `width`. A surface that must be pixel-identical with an authoring
		 * tool (which loads every rig at its own fixed scale) passes that scale here and stops
		 * caring what the game's asset index happens to say. Absent ⇒ factor 1 ⇒ unchanged.
		 */
		loadScaleBase?: number;
	};
</script>

<script lang="ts">
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	import BaseSpineProvider from './BaseSpineProvider.svelte';
	import { anchorToPivot } from '../utils.svelte';
	import { getContextApp } from '../context.svelte';
	import { getSpineLoadScale } from '../spineLoadScale';
	import { warnMissingAsset } from '../missingAsset';

	const {
		debug,
		key,
		anchor,
		children,
		scale: scaleProp,
		loadScaleBase,
		...baseSpineProps
	}: Props = $props();
	const context = getContextApp();
	// Resolved bundle + the key it is REGISTERED under (they differ for a doc-stored R2
	// prefix), so the load scale is read under the same key `assetLoad` recorded it with.
	const resolved = $derived.by(() => {
		const assets = context.stateApp.loadedAssets;
		const direct = assets?.[key] as SPINE_PIXI.SkeletonData | undefined;
		if (direct) return { data: direct, assetKey: key };
		// Editor scene docs store a spine key as its R2 bundle PREFIX
		// (`<client>/<project>/spines/<bundle>/`) so the editor can preview it from
		// R2; games register the spine under the plain `<bundle>` key. Fall back to
		// that so doc-driven spine nodes resolve in-game.
		const bundle = key.match(/(?:^|\/)spines\/(.+?)\/?$/)?.[1];
		const data = bundle ? (assets?.[bundle] as SPINE_PIXI.SkeletonData | undefined) : undefined;
		return data && bundle ? { data, assetKey: bundle } : undefined;
	});
	const spineData = $derived(resolved?.data);

	// `width`/`height` → scale is resolved in `BaseSpineProvider` (it sizes against the
	// pose-independent authored bounds, robust to animation/skin-driven art whose setup
	// pose is empty). Here we only forward the caller's raw `scale`; BaseSpineProvider
	// folds the size scale into it — plus, when the caller asked for one, the load-scale
	// correction (see `loadScaleBase`). Absent ⇒ 1 ⇒ byte-identical to before.
	const loadScaleFix = $derived(
		loadScaleBase === undefined || !resolved
			? 1
			: loadScaleBase / getSpineLoadScale(resolved.assetKey),
	);
	const scale = $derived.by(() => {
		const base =
			typeof scaleProp === 'number'
				? { x: scaleProp, y: scaleProp }
				: { x: scaleProp?.x ?? 1, y: scaleProp?.y ?? 1 };
		return { x: base.x * loadScaleFix, y: base.y * loadScaleFix };
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

<!-- Load-aware diagnostic: a spine mounted by the (now generically mounted) game tree
	 during the asset-load window has no `spineData` yet and resolves once its bundle
	 arrives — only flag it as missing once loading is done. See Sprite.svelte. -->
{#if !spineData && context.stateApp.loaded}
	{warnMissingAsset(`Spine: key "${key}" is not found in loadedAssets`)}
{/if}

{#if debug}
	{console.log('loadedAssets', $state.snapshot(context.stateApp).loadedAssets)}
{/if}

{#key spineData}
	{#if spineData}
		<BaseSpineProvider {...baseSpineProps} {scale} {pivot} {spineData} anchorFallback={anchor}>
			{@render children()}
		</BaseSpineProvider>
	{/if}
{/key}
