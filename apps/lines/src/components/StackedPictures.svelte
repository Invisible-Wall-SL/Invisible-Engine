<script lang="ts">
	import { stackedPictureRuns } from '../game/stateGame.svelte';
	import StackedPicture from './StackedPicture.svelte';

	// The stacked-picture reel mode's overlay (docs/design/stacked-picture-mode.md). Renders one tall
	// picture per contiguous run of an eligible symbol on the SETTLED board. Empty when the mode is off
	// (the scan returns no runs) ⇒ zero nodes ⇒ byte-parity, so this can mount unconditionally.
	const runs = $derived(stackedPictureRuns());
</script>

{#each runs as run (`${run.reel}:${run.topRow}`)}
	<StackedPicture {run} />
{/each}
