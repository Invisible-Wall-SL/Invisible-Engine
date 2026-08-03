<script lang="ts">
	import { onMount, onDestroy, type Snippet } from 'svelte';

	import { getContextApp } from '../context.svelte';

	import InitialiseApplication from './InitialiseApplication.svelte';
	import InitialiseParent from './InitialiseParent.svelte';
	import AssetsLoader from './AssetsLoader.svelte';
	import MemoryHud from './MemoryHud.svelte';

	type Props = { children: Snippet };

	const props: Props = $props();
	const context = getContextApp();

	onMount(() => context.stateApp.reset());
	onDestroy(() => context.stateApp.reset());
</script>

<InitialiseApplication>
	<InitialiseParent>
		<AssetsLoader>
			{@render props.children()}
		</AssetsLoader>
	</InitialiseParent>
</InitialiseApplication>

<!-- On-device memory readout — inert unless the URL carries `?memhud=1`. -->
<MemoryHud />
