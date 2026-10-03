<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Anchor, Container } from 'pixi-svelte';
	import { RESPIN_COUNTER_ANCHOR } from 'engine-layout';
	import { getComponentParams, trackComponentMount } from 'engine-layout/svelte';

	import RespinCounterArt from './RespinCounterArt.svelte';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';

	/**
	 * The `respinCounter` component's coded part (Hold and Win Phase 12c). The author's own nodes
	 * inside it — the built-in's frame, caption and value — arrive as `skin` and draw at its origin,
	 * scaled by the counter's pulse on every reset and "+N" (`pulseScale`; 1, the default, keeps the
	 * authored counter still, as it always was). With nothing inside, it draws the coded counter.
	 * Either way it registers the `respinCounter` anchor the "+N" flies into and counts itself in
	 * under that name, so the coded default steps aside for any copy of the counter, whatever its id.
	 *
	 * A STAND-IN (`standIn`, mounted by `<ComponentInstance>` for a def that `standsFor` this part but
	 * no longer binds it — a counter saved before the part existed) draws nothing: the def's own nodes
	 * are the counter. It still counts in and anchors the "+N" on the instance.
	 */
	const { skin, standIn = false }: { skin?: Snippet; standIn?: boolean } = $props();
	const params = getComponentParams();
	const pulseScale = $derived.by(() => {
		const value = params.pulseScale;
		return typeof value === 'number' && value > 0 ? value : 1;
	});

	// Untracked: counting in reads the count it writes, which would re-run this effect forever.
	$effect(() => untrack(() => trackComponentMount(RESPIN_COUNTER_ANCHOR)));

	const pulse = new Tween(1);
	const pulses = () => stateRespinBoard.counter.resets + stateRespinBoard.counter.adds;
	let seenPulses = pulses();
	$effect(() => {
		const count = pulses();
		if (count === seenPulses) return;
		seenPulses = count;
		if (pulseScale === 1) return;
		pulse
			.set(pulseScale, { duration: 0 })
			.then(() => pulse.set(1, { duration: 450, easing: backOut }));
	});
</script>

{#if standIn}
	<Anchor name={RESPIN_COUNTER_ANCHOR} />
{:else if skin}
	<Container scale={pulse.current}>
		<Anchor name={RESPIN_COUNTER_ANCHOR} />
		{@render skin()}
	</Container>
{:else}
	<RespinCounterArt scale={pulse.current} />
{/if}
