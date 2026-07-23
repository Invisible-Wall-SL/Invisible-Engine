<script lang="ts">
	import { winState } from '../game/winState.svelte';

	// Renders nothing — just publishes the WinCountUpProvider's live (snippet-scoped)
	// `countUpAmount` + the coin-fountain emit signal (`coinsEmit`, = `!countUpCompleted`)
	// into the shared win state so the positionable VISUAL's count text + `WinCoins` fountain
	// can read them (gate → visual bridge, mirroring `OutroStatePublisher`).
	const { countUpAmount, coinsEmit }: { countUpAmount: number; coinsEmit: boolean } = $props();

	$effect(() => {
		winState.countUpAmount = countUpAmount;
	});

	$effect(() => {
		winState.coinsEmit = coinsEmit;
	});
</script>
