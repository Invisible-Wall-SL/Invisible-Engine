<script lang="ts">
	import { WinCoins } from 'engine-game';
	import { getComponentParams } from 'engine-layout/svelte';

	import { winState } from '../game/winState.svelte';

	// The coin fountain as the `winPresentation` def's bound child (Rive plan Phase 8b): the coded
	// `WinCoins` exactly as `WinVisual` mounted it — emitting while the gate's count-up runs, the
	// per-tier coin look from the tier on show — read off `winState`, honouring the instance's
	// `showCoins` param. Renders at the node's origin inside the authored visual, so the instance
	// node places it as it placed the coded part.
	// Not dead: a bound part is registered as `BoundComponent` (`Component<Record<string, unknown>>`),
	// and a component that declares no props types as `Component<Record<string, never>>`, which that
	// registry rejects. This declares the props shape; the part reads none of them.
	const _props: Record<string, unknown> = $props();
	const showCoins = $derived(getComponentParams()['showCoins'] !== false);
</script>

{#if showCoins}
	<WinCoins emit={winState.coinsEmit} levelAlias={winState.winLevelData?.alias} />
{/if}
