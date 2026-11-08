<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type Props = { children: Snippet };
</script>

<script lang="ts">
	import Container from './Container.svelte';
	import { getContextRestart } from '../context.svelte';

	/**
	 * Content that starts again when its screen restarts in place (`setContextRestart`): it is mounted
	 * afresh, as a remount of the screen would mount it. Inside a container of its own, which keeps
	 * its place among its siblings — a remounted child is otherwise appended after all of them. Off
	 * such a screen the content renders directly, with no container added.
	 */
	const props: Props = $props();
	const restart = getContextRestart();
</script>

{#if restart}
	<Container>
		{#key restart()}
			{@render props.children()}
		{/key}
	</Container>
{:else}
	{@render props.children()}
{/if}
