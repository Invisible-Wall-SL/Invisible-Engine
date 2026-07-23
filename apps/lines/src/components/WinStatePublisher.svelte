<script lang="ts">
	import { winState } from '../game/winState.svelte';

	// Renders nothing — just publishes the WinCountUpProvider's live (snippet-scoped)
	// `countUpAmount` into the shared win state so the positionable VISUAL's count text
	// can read it (gate → visual bridge, mirroring `OutroStatePublisher`).
	const { countUpAmount }: { countUpAmount: number } = $props();

	$effect(() => {
		winState.countUpAmount = countUpAmount;
	});
</script>
