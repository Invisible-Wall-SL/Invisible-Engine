<script lang="ts" module>
	import type { ComponentInstanceNode, Scene, SpawnLayerNode } from './types';

	export type Props = {
		node: SpawnLayerNode;
		space?: Scene['space'];
	};
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';
	import type { SpawnedInstance } from 'engine-flow-v2';

	import ComponentInstance from './ComponentInstance.svelte';
	import { getSceneIdContext } from './sceneIdContext';
	import { spawnLayerSpec } from './spawnLayerFields';
	import { spawnStore } from './spawnLayers';

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

	const instanceNode = (instance: SpawnedInstance): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: instance.id,
		componentId: instance.componentId,
		x: 0,
		y: 0,
	});
</script>

{#each instances as instance (instance.id)}
	<Container x={instance.x} y={instance.y}>
		<ComponentInstance node={instanceNode(instance)} {space} />
	</Container>
{/each}
