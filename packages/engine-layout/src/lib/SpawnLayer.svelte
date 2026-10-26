<script lang="ts" module>
	import type { ComponentInstanceNode, Scene, SpawnLayerNode } from './types';

	export type Props = {
		node: SpawnLayerNode;
		space?: Scene['space'];
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { Container, getContextParent } from 'pixi-svelte';
	import type { SpawnedInstance } from 'engine-flow-v2';

	import ComponentInstance from './ComponentInstance.svelte';
	import { getSceneIdContext } from './sceneIdContext';
	import { spawnLayerSpec } from './spawnLayerFields';
	import { registerSpawnLayerSpace, spawnStore } from './spawnLayers';

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
	const parent = getContextParent();
	$effect(() =>
		registerSpawnLayerSpace(node.id, (x, y) => {
			const local = parent.parent.toLocal({ x, y });
			return { x: local.x, y: local.y };
		}),
	);

	const instanceNode = (instance: SpawnedInstance): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: instance.id,
		componentId: instance.componentId,
		x: 0,
		y: 0,
	});
</script>

{#each instances as instance (instance.id)}
	<Container x={places[instance.id]?.x ?? instance.x} y={places[instance.id]?.y ?? instance.y}>
		<ComponentInstance node={instanceNode(instance)} {space} />
	</Container>
{/each}
