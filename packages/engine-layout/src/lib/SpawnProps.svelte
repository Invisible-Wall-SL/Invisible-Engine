<script lang="ts">
	import type { Container } from 'pixi.js';

	import PropsInto from './PropsInto.svelte';
	import { spawnInstancesOf, spawnPropsOf } from './arcadeProps.svelte';
	import { ISO_DEPTH_SPREAD } from './projection';
	import { projectedLayer } from './worldDrawing.svelte';

	/**
	 * The `sorted` and `over` pieces of the props standing in spawn layer `id`
	 * (`arcadeProps.svelte.ts`), drawn IN the container its instances are drawn in, so they sort
	 * among the players. Nothing is drawn, and nothing searched, while the layer has none.
	 */
	const { id }: { id: string } = $props();
	const pieces = $derived(spawnPropsOf(id).filter((p) => p.band === 'sorted' || p.band === 'over'));
	let target = $state.raw<Container | undefined>();
	$effect(() => {
		if (pieces.length && !target) target = spawnInstancesOf(projectedLayer(id), ISO_DEPTH_SPREAD);
	});
</script>

{#if target && pieces.length}
	<PropsInto {target} {pieces} />
{/if}
