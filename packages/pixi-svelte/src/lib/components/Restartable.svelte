<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type Props = { children: Snippet };
</script>

<script lang="ts">
	import Container from './Container.svelte';
	import { getContextDormant, getContextRestart } from '../context.svelte';

	/**
	 * Content that starts again when its screen restarts in place (`setContextRestart`): it is mounted
	 * afresh, as a remount of the screen would mount it. Inside a container of its own, which keeps
	 * its place among its siblings — a remounted child is otherwise appended after all of them. Off
	 * such a screen the content renders directly, with no container added. On a screen mounted ahead
	 * of its first show (`setContextDormant`) it is not mounted until that show.
	 */
	const props: Props = $props();
	const restart = getContextRestart();
	const dormant = getContextDormant();
</script>

{#if restart}
	<Container>
		{#if !dormant?.()}
			{#key restart()}
				{@render props.children()}
			{/key}
		{/if}
	</Container>
{:else}
	{@render props.children()}
{/if}
