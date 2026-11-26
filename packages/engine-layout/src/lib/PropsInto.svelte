<script lang="ts">
	import { Container, createContextParent } from 'pixi-svelte';
	import type { Container as PixiContainer } from 'pixi.js';

	import ComponentInstance from './ComponentInstance.svelte';
	import { SPAWN_PROP_LABEL, type SpawnProp } from './arcadeProps.svelte';
	import type { ComponentInstanceNode } from './types';
	import { worldProjection } from './worldCameraView.svelte';

	/**
	 * Draws `pieces` into `target` (a spawn layer's instance container, `<SpawnProps>`): each at its
	 * projected place raised by its `lift`, in the layer's ground-depth order with its `bias` (as a
	 * code piece among the players is: no spawn order, so `seq` 0).
	 */
	const { target, pieces }: { target: PixiContainer; pieces: readonly SpawnProp[] } = $props();
	createContextParent(target);
	const projection = worldProjection();
	const nodeOf = (piece: SpawnProp): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: piece.id,
		componentId: piece.componentId,
		x: 0,
		y: 0,
		...(piece.params ? { params: piece.params } : {}),
	});
</script>

{#if projection}
	{#each pieces as piece (piece.id)}
		{@const at = projection.project(piece.x, piece.y)}
		<Container
			label={SPAWN_PROP_LABEL}
			x={at.x}
			y={at.y - (piece.lift ?? 0)}
			zIndex={projection.depth(piece.x, piece.y, 0, piece.bias ?? 0)}
		>
			<ComponentInstance
				node={nodeOf(piece)}
				inputValues={piece.inputValues}
				inputSources={piece.inputSources}
			/>
		</Container>
	{/each}
{/if}
