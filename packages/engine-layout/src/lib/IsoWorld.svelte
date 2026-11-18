<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Container } from 'pixi-svelte';

	import IsoTilemap from './IsoTilemap.svelte';
	import MountedArt from './MountedArt.svelte';
	import { fieldArtOf } from './arcadeArt.svelte';
	import { isoDepthOrder } from './projection';
	import type { LayoutNode } from './types';
	import { setWorldProjection, worldCameraView } from './worldCameraView.svelte';
	import { worldDrawing } from './worldDrawing.svelte';

	/**
	 * A WORLD SCREEN DRAWN ISOMETRIC (`Scene.projection`, P11.4), in `<LayoutScene>`'s world
	 * container's place. The camera's centre is drawn at the view's centre; nothing is drawn until a
	 * loop has given the view its size. Each top-level node is drawn by its kind, every one through
	 * `<LayoutNodeView>` (so bindings, FX and visibility work as flat):
	 * - a `spawnLayer` upright, its instances at their projected places in ground-depth order
	 *   (`<SpawnLayer>` reads the scope this sets, by its id);
	 * - a `tilemap` as 2:1 diamonds (`<LayoutNodeView>` draws it with `<IsoTilemap>`, by its id);
	 * - both drawn at their projected place (`<LayoutNodeView>` projects their bound position), so a
	 *   world point inside them is their place plus the point, projected;
	 * - anything else as ground: the node drawn flat, then the plane turned 45° and squashed to half
	 *   its height, so a rectangle of the world is the diamond it covers. A spawn layer or tilemap
	 *   nested in it is drawn there as it would be flat, never projected twice;
	 * - a ground node an online room draws in code (`arcadeArt.svelte.ts`: Salmons' river) by that
	 *   art instead, at the projected origin (the art projects its own world points).
	 * The places themselves stay flat world px: the loop and the room never see the projection.
	 * The projector and the zoom are the runtime's (`worldDrawing.svelte.ts`: it sets them from the
	 * world screen as it takes its camera, before the view has a size): a `mirrored` screen draws it
	 * all mirrored left to right, the ground's turn included; the zoom scales the whole world about
	 * the view's centre (the view is the camera's, in world px; zoom 1 draws as before).
	 */
	type Props = { nodes: readonly LayoutNode[]; node: Snippet<[LayoutNode]> };
	const { nodes, node: render }: Props = $props();
	const drawing = worldDrawing();

	const idsOf = (kind: LayoutNode['kind']) =>
		new Set(untrack(() => nodes.filter((n) => n.kind === kind).map((n) => n.id)));
	setWorldProjection({
		layers: idsOf('spawnLayer'),
		tilemaps: idsOf('tilemap'),
		tilemap: IsoTilemap,
		get projector() {
			return drawing.projector;
		},
		project: (x, y) => drawing.projector.project(x, y),
		unproject: (x, y) => drawing.projector.unproject(x, y),
		depth: isoDepthOrder,
	});
	const view = worldCameraView();
	const origin = $derived.by(() => {
		const centre = drawing.projector.project(view.x + view.w / 2, view.y + view.h / 2);
		const z = drawing.zoom;
		return {
			x: z * (view.shakeX + view.w / 2 - centre.x),
			y: z * (view.shakeY + view.h / 2 - centre.y),
		};
	});
</script>

{#if view.w > 0 && view.h > 0}
	{@const turn = drawing.projector.ground}
	<!-- Keyed on the projector: one that changed after the world was drawn redraws it whole. -->
	{#key drawing.projector}
		<Container x={origin.x} y={origin.y} scale={drawing.zoom}>
			{#each nodes as n (n.id)}
				{@const art = fieldArtOf(n.id)}
				{#if n.kind === 'spawnLayer' || n.kind === 'tilemap'}
					{@render render(n)}
				{:else if art}
					{#key art}
						<MountedArt mount={art} zIndex={n.zIndex} />
					{/key}
				{:else}
					<Container scale={{ x: 1, y: 0.5 }} zIndex={n.zIndex}>
						<Container
							rotation={turn.rotation}
							scale={{ x: turn.flip * Math.SQRT2, y: Math.SQRT2 }}
						>
							{@render render(n)}
						</Container>
					</Container>
				{/if}
			{/each}
		</Container>
	{/key}
{/if}
