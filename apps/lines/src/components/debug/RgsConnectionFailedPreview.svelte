<script lang="ts">
	import { onMount } from 'svelte';
	import { publishRgsConnection } from 'constants-shared/rgsConnection';

	onMount(() => {
		publishRgsConnection({ state: 'failed', reason: 'debug preview' });
		return () => publishRgsConnection({ state: 'connected' });
	});
</script>
