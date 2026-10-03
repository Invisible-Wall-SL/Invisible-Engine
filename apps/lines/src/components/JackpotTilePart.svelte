<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';
	import { scopeKey } from 'utils-event-emitter';

	import { getContext } from '../game/context';

	/**
	 * The `jackpotTile` component's coded part (Hold and Win Phase 12c). The author's own nodes inside
	 * it — the built-in's frame, caption and value — arrive as `skin` and draw at its origin, pulsed
	 * when the tile's OWN tier is won (`winPulseScale`; 1, the default, keeps the tile still, as it
	 * always was). The tier comes from the tile's `source`: `jackpot.<tier>` pulses on a Hold and Win
	 * jackpot win of that tier, `platformJackpot.<tier>` on the operator platform's. With nothing
	 * inside, the tile is whatever else its def draws.
	 */
	const { skin }: { skin?: Snippet } = $props();
	const params = getComponentParams();
	const context = getContext();

	const pulse = new Tween(1);
	const pulseOnWin = (family: string, tier: string) => {
		const source = typeof params.source === 'string' ? params.source : '';
		if (source.split('.')[0] !== family || scopeKey(source) !== scopeKey(tier)) return;
		const peak = typeof params.winPulseScale === 'number' ? params.winPulseScale : 1;
		if (!(peak > 0) || peak === 1) return;
		pulse.set(peak, { duration: 0 }).then(() => pulse.set(1, { duration: 450, easing: backOut }));
	};
	context.eventEmitter.subscribeOnMount({
		respinJackpotWin: (event) => pulseOnWin('jackpot', event.tier),
		platformJackpotCelebration: (event) => pulseOnWin('platformJackpot', event.tier),
	});
</script>

{#if skin}
	<Container scale={pulse.current}>
		{@render skin()}
	</Container>
{/if}
