<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as PIXI from 'pixi.js';
	import { darkTintProgram } from 'engine-rig/pixi';

	import { getContextApp } from '../context.svelte';
	import { getProcessed } from '../assetLoad';
	import { collectTextureSources, compileProgram, warmGpu } from '../gpuWarmup';
	import { renderTier } from '../renderTier';
	import type { LoadedAssets, RawAsset } from '../types';

	type Props = { children: Snippet };

	const props: Props = $props();
	const context = getContextApp();

	let preLoaded = $state(false);

	const assetNameList = $derived(
		context.stateApp.assets
			? Object.keys(context.stateApp.assets).filter(
					(key) => Boolean(context.stateApp.assets?.[key].preload) === false,
				)
			: [],
	);

	const preAssetNameList = $derived(
		context.stateApp.assets
			? Object.keys(context.stateApp.assets).filter(
					(key) => context.stateApp.assets?.[key].preload === true,
				)
			: [],
	);

	let counter = 0;
	/** Every texture loaded, uploaded and kept resident before the game is told it is loaded. */
	const loadedSources = new Set<PIXI.TextureSource>();
	let loadedRigs = false;

	const onProgress = (value: number) => {
		if (preLoaded && value === 1) {
			counter = counter + 1;
			const ratio = counter / assetNameList.length;
			context.stateApp.loadingProgress = ratio * 100;
		}
	};

	const loadAssets = async (nameList: string[]) => {
		const loadedAssetsArray = await Promise.all(
			nameList.map(async (key) => {
				try {
					const { type, src, namespace, family } = context.stateApp.assets![key];
					const loadSrc =
						type === 'spine' ? Object.values(src).filter((item) => typeof item === 'string') : src;
					const rawAsset = await PIXI.Assets.load<RawAsset>(loadSrc, onProgress);
					collectTextureSources(rawAsset, loadedSources);
					if (type === 'spine') loadedRigs = true;
					const processed = getProcessed({ key, rawAsset, type, src, namespace, family });
					return processed;
				} catch (error) {
					console.error(error);
				}
			}),
		);

		return loadedAssetsArray.reduce(
			(acc, cur) => ({
				...acc,
				...cur,
			}),
			{} as LoadedAssets,
		);
	};

	$effect(() => {
		if (!preLoaded) {
			(async () => {
				if (preAssetNameList.length > 0) {
					const preLoadedAssets = await loadAssets(preAssetNameList);
					if (preLoadedAssets) context.stateApp.loadedAssets = preLoadedAssets;
				}
				preLoaded = true;
			})();
		}
	});

	$effect(() => {
		if (!context.stateApp.loaded && preLoaded) {
			(async () => {
				if (assetNameList.length > 0) {
					const postLoadedAssets = await loadAssets(assetNameList);
					if (postLoadedAssets)
						context.stateApp.loadedAssets = {
							...context.stateApp.loadedAssets,
							...postLoadedAssets,
						};
				}
				const renderer = context.stateApp.pixiApplication?.renderer;
				// Never in the way of the game starting: a warm-up that fails leaves the old lazy path.
				if (renderer) {
					try {
						if (loadedRigs) compileProgram(renderer, darkTintProgram());
						await warmGpu(renderer, loadedSources, { keepResident: renderTier() === 'full' });
					} catch (error) {
						console.warn('[gpu-warmup]', error);
					}
				}
				context.stateApp.loaded = true;
			})();
		}
	});
</script>

{#if preLoaded}
	{@render props.children()}
{/if}
