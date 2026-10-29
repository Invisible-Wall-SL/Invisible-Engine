<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Container } from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';

	import IsoTilemap from './IsoTilemap.svelte';
	import { isoDepthOrder, isoNodeShift, isoProject, isoUnproject } from './projection';
	import { resolveTransform } from './resolveTransform';
	import type { LayoutNode } from './types';
	import { setWorldProjection, worldCameraView } from './worldCameraView.svelte';

	/**
	 * A WORLD SCREEN DRAWN ISOMETRIC (`Scene.projection`, P11.4), in `<LayoutScene>`'s world
	 * container's place. The camera's centre is drawn at the view's centre; nothing is drawn until a
	 * loop has given the view its size. Each top-level node is drawn by its kind, every one through
	 * `<LayoutNodeView>` (so bindings, FX and visibility work as flat):
	 * - a `spawnLayer` upright, its instances at their projected places in ground-depth order
	 *   (`<SpawnLayer>` reads the scope this sets, by its id);
	 * - a `tilemap` as 2:1 diamonds (`<LayoutNodeView>` draws it with `<IsoTilemap>`, by its id);
	 * - both moved from their world place to its projected one (`isoNodeShift`), so a world point
	 *   inside them is their place plus the point, projected;
	 * - anything else as ground: the node drawn flat, then the plane turned 45° and squashed to half
	 *   its height, so a rectangle of the world is the diamond it covers. A spawn layer or tilemap
	 *   nested in it is drawn there as it would be flat, never projected twice.
	 * The places themselves stay flat world px: the loop and the room never see the projection.
	 */
	type Props = { nodes: readonly LayoutNode[]; node: Snippet<[LayoutNode]> };
	const { nodes, node: render }: Props = $props();

	const idsOf = (kind: LayoutNode['kind']) =>
		new Set(untrack(() => nodes.filter((n) => n.kind === kind).map((n) => n.id)));
	setWorldProjection({
		layers: idsOf('spawnLayer'),
		tilemaps: idsOf('tilemap'),
		tilemap: IsoTilemap,
		project: isoProject,
		unproject: isoUnproject,
		depth: isoDepthOrder,
	});
	const layout = getContextLayout();
	const view = worldCameraView();
	const origin = $derived.by(() => {
		const centre = isoProject(view.x + view.w / 2, view.y + view.h / 2);
		return { x: view.shakeX + view.w / 2 - centre.x, y: view.shakeY + view.h / 2 - centre.y };
	});
</script>

{#if view.w > 0 && view.h > 0}
	<Container x={origin.x} y={origin.y}>
		{#each nodes as n (n.id)}
			{#if n.kind === 'spawnLayer' || n.kind === 'tilemap'}
				{@const t = resolveTransform(n, layout.stateLayoutDerived.layoutType())}
				{@const shift = isoNodeShift(t.x, t.y)}
				<Container x={shift.x} y={shift.y} zIndex={n.zIndex}>
					{@render render(n)}
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
{/if}
