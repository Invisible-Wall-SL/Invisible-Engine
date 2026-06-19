<script lang="ts">
	import { freeSpinOutroState } from '../game/freeSpinOutroState.svelte';

	// Renders nothing — just publishes the WinCountUpProvider's live (snippet-scoped)
	// `countUpAmount` into the shared outro state so the positionable VISUAL's count text
	// can read it (§17 Phase 3 gate → visual bridge).
	const { countUpAmount }: { countUpAmount: number } = $props();

	$effect(() => {
		freeSpinOutroState.countUpAmount = countUpAmount;
	});
</script>
