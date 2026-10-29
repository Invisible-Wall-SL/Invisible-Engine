<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Container } from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import IsoTilemap from './IsoTilemap.svelte';
	import { isoDepth, isoProject, isoUnproject } from './projection';
	import { resolveTransform } from './resolveTransform';
	import type { LayoutNode } from './types';
	import { setSpawnProjection, worldCameraView } from './worldCameraView.svelte';

	/**
	 * A WORLD SCREEN DRAWN ISOMETRIC (`Scene.projection`, P11.4), in `<LayoutScene>`'s world
	 * container's place. The camera's centre is drawn at the view's centre. Each top-level node is
	 * drawn by its kind:
	 * - a `spawnLayer` upright, its instances at their projected places in ground-depth order
	 *   (`<SpawnLayer>` reads the projection this sets);
	 * - a `tilemap` as 2:1 diamonds, from its projected corner (`<IsoTilemap>`);
	 * - anything else as ground: the node drawn flat, then the plane turned 45° and squashed to half
	 *   its height, so a rectangle of the world is the diamond it covers.
	 * The places themselves stay flat world px: the loop and the room never see the projection.
	 */
	type Props = { nodes: readonly LayoutNode[]; node: Snippet<[LayoutNode]> };
	const { nodes, node: render }: Props = $props();

	setSpawnProjection({ project: isoProject, unproject: isoUnproject, depth: isoDepth });
	const layout = getContextLayout();
	const view = worldCameraView();
	const origin = $derived.by(() => {
		const centre = isoProject(view.x + view.w / 2, view.y + view.h / 2);
		return { x: view.shakeX + view.w / 2 - centre.x, y: view.shakeY + view.h / 2 - centre.y };
	});
</script>

<Container x={origin.x} y={origin.y}>
	{#each nodes as n (n.id)}
		{#if n.kind === 'spawnLayer'}
			{@render render(n)}
		{:else if n.kind === 'tilemap'}
			{@const t = resolveTransform(n, layout.stateLayoutDerived.layoutType())}
			{@const at = isoProject(t.x, t.y)}
			<Container
				x={at.x}
				y={at.y}
				scale={{ x: Math.abs(t.scale?.x ?? 1), y: Math.abs(t.scale?.y ?? 1) }}
				alpha={t.alpha}
				visible={t.visible !== false}
				zIndex={t.zIndex}
			>
				<IsoTilemap node={n} />
			</Container>
		{:else}
			<Container scale={{ x: 1, y: 0.5 }} zIndex={n.zIndex}>
				<Container rotation={Math.PI / 4} scale={Math.SQRT2}>
					{@render render(n)}
				</Container>
			</Container>
		{/if}
	{/each}
</Container>
