<script lang="ts" module>
	import type { Scene } from './types';

	export type Props = { scene: Scene };
</script>

<script lang="ts">
	import LayoutNodeView from './LayoutNodeView.svelte';

	const { scene }: Props = $props();
</script>

{#each scene.nodes as node (node.id)}
	<LayoutNodeView {node} />
{/each}
