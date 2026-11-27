<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createContextParent, getContextParent } from 'pixi-svelte';
	import { Container } from 'pixi.js';

	import { setDepth } from './depthOrder';

	/**
	 * A spawned instance of a projected world (`<SpawnLayer>`), at its projected place and drawn in
	 * ground-depth order (`depth`) through `depthOrder.ts`, which sorts its layer only when a body's
	 * depth changes the order. Otherwise a `<Container x y zIndex visible>`.
	 */
	type Props = { x: number; y: number; depth: number; visible: boolean; children: Snippet };
	const { x, y, depth, visible, children }: Props = $props();

	const parent = getContextParent();
	const container = new Container();
	$effect(() => {
		container.x = x;
		container.y = y;
		container.visible = visible;
		setDepth(container, depth);
	});
	parent.addToParent(container);
	createContextParent(container);
</script>

<div hidden>{@render children()}</div>
