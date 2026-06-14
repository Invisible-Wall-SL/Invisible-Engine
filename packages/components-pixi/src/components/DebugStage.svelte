<script lang="ts">
	import { stateDebug } from 'state-shared';

	const pixiTools = $derived(
		stateDebug.tools.filter((tool) => tool.surface === 'pixi' && stateDebug.active[tool.id]),
	);
</script>

{#if __IE_DEBUG__}
	{#each pixiTools as tool (tool.id)}
		<tool.component />
	{/each}
{/if}
