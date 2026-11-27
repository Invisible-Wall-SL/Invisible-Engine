<script lang="ts">
	import { untrack } from 'svelte';
	import type { Container } from 'pixi.js';

	import PropsInto from './PropsInto.svelte';
	import { spawnInstancesOf, spawnPropsOf, spawnTargetStale } from './arcadeProps.svelte';
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
	// Looked at every frame while there are pieces: mounted inside `<ProjectedLayer>`, this runs
	// before the layer registers itself (a child's effects run first) and before its instance
	// container is drawn, and a screen rebuilt in place registers a new layer container, so the
	// container found once may be gone. A new layer, or a container destroyed or taken off the
	// stage, is resolved again; `<PropsInto>` is mounted afresh in the new one.
	$effect(() => {
		if (!pieces.length) return;
		let layer: Container | undefined;
		let frame = 0;
		const look = () => {
			const now = projectedLayer(id);
			if (spawnTargetStale(layer, now, target)) {
				layer = now;
				const next = spawnInstancesOf(now, ISO_DEPTH_SPREAD);
				if (next !== target) target = next;
			}
			frame = requestAnimationFrame(look);
		};
		untrack(look);
		return () => cancelAnimationFrame(frame);
	});
</script>

{#if target && pieces.length}
	{#key target}
		<PropsInto {target} {pieces} />
	{/key}
{/if}
