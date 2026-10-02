<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Anchor, Container } from 'pixi-svelte';
	import { TOTAL_WIN_BAR_ANCHOR } from 'engine-layout';
	import { getComponentParams } from 'engine-layout/svelte';

	import { getContext } from '../game/context';
	import { FLIGHT_TARGET_TOTAL } from '../game/flights.svelte';

	/**
	 * The `totalWinBar` component's coded part (Hold and Win Phase 12c). The author's own nodes inside
	 * it — the built-in's frame, caption and value — arrive as `skin` and draw at its origin, pulsed on
	 * every head that lands in the total (`landPulseScale`; 1, the default, keeps the bar still, as it
	 * always was). With `catchesCoins` on it registers the `totalWinBar` anchor, so those heads land
	 * on this bar instead of the HUD's win meter; off, the default, they fly where they always did.
	 *
	 * A STAND-IN (`standIn`, mounted by `<ComponentInstance>` for a def that `standsFor` this part but
	 * no longer binds it) draws nothing and still catches the coins on the instance when asked to.
	 */
	const { skin, standIn = false }: { skin?: Snippet; standIn?: boolean } = $props();
	const params = getComponentParams();
	const context = getContext();
	const catches = $derived(params.catchesCoins === true);

	const pulse = new Tween(1);
	context.eventEmitter.subscribeOnMount({
		flightArrive: (event) => {
			if (event.target !== FLIGHT_TARGET_TOTAL) return;
			const peak = typeof params.landPulseScale === 'number' ? params.landPulseScale : 1;
			if (!(peak > 0) || peak === 1) return;
			pulse.set(peak, { duration: 0 }).then(() => pulse.set(1, { duration: 450, easing: backOut }));
		},
	});
</script>

{#if skin && !standIn}
	<Container scale={pulse.current}>
		{#if catches}<Anchor name={TOTAL_WIN_BAR_ANCHOR} />{/if}
		{@render skin()}
	</Container>
{:else if catches}
	<Anchor name={TOTAL_WIN_BAR_ANCHOR} />
{/if}
