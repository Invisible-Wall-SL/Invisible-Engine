<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createContextParent, getContextParent } from 'pixi-svelte';
	import { Container } from 'pixi.js';

	import { registerProjectedLayer } from './worldDrawing.svelte';

	/**
	 * A projected world's top-level spawn layer, in a container of its own registered by the node's
	 * id (`worldDrawing.svelte.ts` `projectedLayer`), so art can stand pieces among its instances
	 * (Salmons' forest). Drawn in the node's place in the world's order (`zIndex`).
	 */
	type Props = { id: string; zIndex?: number; children: Snippet };
	const { id, zIndex = 0, children }: Props = $props();

	const parent = getContextParent();
	const container = new Container();
	$effect(() => {
		container.zIndex = zIndex;
	});
	parent.addToParent(container);
	createContextParent(container);
	$effect(() => registerProjectedLayer(id, container));
</script>

<div hidden>{@render children()}</div>
