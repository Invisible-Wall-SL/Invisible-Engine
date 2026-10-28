<script lang="ts">
	import BugTracker from '../bugs/BugTracker.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!-- Another project in the top bar is another list: the tracker starts over for it. -->
{#key data.projectKey}
	<BugTracker
		kind="game"
		tools={data.tools}
		user={data.user}
		projects={data.projects}
		canTriage={data.canTriage}
		repair={data.repair}
		pipelineAreas={data.pipelineAreas}
		selected={data.selected}
		report={data.report}
		areas={data.areas}
		scope={{ clientKey: data.clientKey, projectKey: data.projectKey }}
	/>
{/key}
