<script lang="ts">
	import type { PageData } from './$types';
	import BugTracker from './BugTracker.svelte';

	let { data }: { data: PageData } = $props();
</script>

<BugTracker
	kind="pipeline"
	tools={data.tools}
	user={data.user}
	projects={data.projects}
	canTriage={data.canTriage}
	selected={data.selected}
	report={data.report}
	areas={data.areas}
	scope={null}
/>
