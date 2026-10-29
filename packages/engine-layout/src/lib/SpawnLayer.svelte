<script lang="ts" module>
	import type { ComponentInstanceNode, Scene, SpawnLayerNode } from './types';

	export type Props = {
		node: SpawnLayerNode;
		space?: Scene['space'];
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { Container, Graphics, getContextParent } from 'pixi-svelte';
	import type { SpawnedInstance } from 'engine-flow-v2';
	import type { Graphics as PixiGraphics } from 'pixi.js';

	import ComponentInstance from './ComponentInstance.svelte';
	import { getSceneIdContext } from './sceneIdContext';
	import { spawnLayerSpec } from './spawnLayerFields';
	import { registerSpawnLayerSpace, spawnStore } from './spawnLayers';
	import { liftOf, liftsOn } from './arcadeLifts.svelte';
	import { hidingOn, inWorldCamera, isCulled, worldProjection } from './worldCameraView.svelte';

	const { node, space }: Props = $props();

	// The layer declares itself (idempotent: the game declares every layer of its screens at boot,
	// so a spawn into one not yet on screen is kept), then draws whatever the live set holds for it —
	// one <ComponentInstance> per live instance at its spawned place, keyed by its handle id, so a
	// despawn unmounts exactly that one. Each instance's synthetic node id IS its handle id: the
	// instance registers its Flow handle under it (`flowInstances.ts`), which is how an Instance ref
	// reaches it and how its raised events find their `instanceRef` chain.
	const live = spawnStore();
	live.declare(spawnLayerSpec(node, getSceneIdContext()));
	let instances = $state<SpawnedInstance[]>([]);
	$effect(() =>
		live.subscribe(node.id, (next) => {
			instances = next;
		}),
	);
	// Where a moved instance is now (an arcade game's loop moves them, P10.8): only the place of the
	// instances that moved changes, so a frame of motion re-draws no instance that did not.
	const places: Record<string, { x: number; y: number }> = $state({});
	$effect(() =>
		live.subscribePlaces(node.id, (moved) => {
			for (const { id, x, y } of moved) {
				const place = places[id];
				if (place) {
					place.x = x;
					place.y = y;
				} else places[id] = { x, y };
			}
		}),
	);
	$effect(() => {
		const alive = new Set(instances.map((i) => i.id));
		untrack(() => {
			for (const id of Object.keys(places)) if (!alive.has(id)) delete places[id];
		});
	});

	// The layer's space for a pointer (P10.11): the container the node's transform places it in.
	// A projected screen's top-level layer (P11.4) un-projects the point back to the world: its
	// instances are drawn at their projected places in this space.
	const parent = getContextParent();
	const scope = worldProjection();
	const projection = scope?.layers.has(node.id) ? scope : undefined;
	$effect(() =>
		registerSpawnLayerSpace(node.id, (x, y) => {
			const local = parent.parent.toLocal({ x, y });
			return projection ? projection.unproject(local.x, local.y) : { x: local.x, y: local.y };
		}),
	);

	// On a world-camera screen (P10.12) an instance the arcade loop finds out of view is not drawn;
	// it stays mounted, so its state machine runs on. Elsewhere nothing is culled (parity), unless
	// the game hides characters its abilities put out (P11.5, `setHiding`).
	// `hidingOn` is read reactively: the arcade runtime may turn it on after this layer mounted.
	const inWorld = inWorldCamera();
	const culling = $derived(inWorld || hidingOn());

	// A hopping character (P10.13) is drawn raised by its height over a shadow on the ground. Only a
	// game whose loop publishes lifts takes this branch; elsewhere the markup is as before.
	const shadowOf = (width: number) => (g: PixiGraphics) => {
		if (width > 0) g.ellipse(0, 0, width / 2, width / 6).fill({ color: 0x000000, alpha: 0.28 });
	};

	const instanceNode = (instance: SpawnedInstance): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: instance.id,
		componentId: instance.componentId,
		x: 0,
		y: 0,
	});
</script>

{#each instances as instance, seq (instance.id)}
	{#if projection}
		<!-- A projected screen (P11.4): drawn upright at the projected place, in ground-depth order
		     (the zIndex; spawn order breaks a tie), culled by the loop's projected view. -->
		{@const place = places[instance.id] ?? instance}
		{@const at = projection.project(place.x, place.y)}
		{@const lift = liftsOn() ? liftOf(instance.id) : undefined}
		<Container
			x={at.x}
			y={at.y}
			zIndex={projection.depth(place.x, place.y, seq)}
			visible={!culling || !isCulled(instance.id)}
		>
			{#if lift}
				<Graphics y={lift.foot} draw={shadowOf(lift.shadow)} />
			{/if}
			<Container y={-(lift?.z ?? 0)}>
				<ComponentInstance node={instanceNode(instance)} {space} />
			</Container>
		</Container>
	{:else if liftsOn()}
		{@const lift = liftOf(instance.id)}
		<Container
			x={places[instance.id]?.x ?? instance.x}
			y={places[instance.id]?.y ?? instance.y}
			visible={!culling || !isCulled(instance.id)}
		>
			{#if lift}
				<Graphics y={lift.foot} draw={shadowOf(lift.shadow)} />
			{/if}
			<Container y={-(lift?.z ?? 0)}>
				<ComponentInstance node={instanceNode(instance)} {space} />
			</Container>
		</Container>
	{:else if culling}
		<Container
			x={places[instance.id]?.x ?? instance.x}
			y={places[instance.id]?.y ?? instance.y}
			visible={!isCulled(instance.id)}
		>
			<ComponentInstance node={instanceNode(instance)} {space} />
		</Container>
	{:else}
		<Container x={places[instance.id]?.x ?? instance.x} y={places[instance.id]?.y ?? instance.y}>
			<ComponentInstance node={instanceNode(instance)} {space} />
		</Container>
	{/if}
{/each}
