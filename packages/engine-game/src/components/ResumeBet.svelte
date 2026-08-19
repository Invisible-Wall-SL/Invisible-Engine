<script lang="ts">
	import { stateBet } from 'state-shared';
	import { getGameContext } from '../game/context';
	import { onMount } from 'svelte';

	const context = getGameContext();

	onMount(() => {
		if (stateBet.betToResume?.active && stateBet.betToResume.mode) {
			stateBet.activeBetModeKey = stateBet.betToResume.mode;
		}
		context.eventEmitter.broadcast({ type: 'resumeBet' });
	});
</script>
