<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = { scene: Scene };
</script>

<script lang="ts">
	import { MainContainer } from 'components-layout';

	import LayoutNodeView from './LayoutNodeView.svelte';

	const { scene }: Props = $props();

	const space = $derived(scene.space ?? 'game');
</script>

{#snippet nodes()}
	{#each scene.nodes as node (node.id)}
		<LayoutNodeView {node} {space} />
	{/each}
{/snippet}

{#if space === 'game'}
	<MainContainer>
		{@render nodes()}
	</MainContainer>
{:else if space === 'standard'}
	<MainContainer
		standard
		alignVertical={scene.align?.vertical}
		alignHorizontal={scene.align?.horizontal}
	>
		{@render nodes()}
	</MainContainer>
{:else}
	{@render nodes()}
{/if}
