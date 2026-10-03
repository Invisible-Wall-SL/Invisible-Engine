<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import HoldAndWinLetter from './HoldAndWinLetter.svelte';
	import { stateLetters } from '../game/holdAndWinLetters.svelte';

	/**
	 * The `letterTile` component's coded part (Hold and Win Phase 12c) — one of Grand's column
	 * letters, as a Letters Strip draws it per reel. The author's own nodes inside it — the built-in's
	 * dim and lit art and letter — arrive as `skin` and draw at its origin, pulsed each time the
	 * tile's letter lights (`pulseScale`, the coded letter's 1.6 by default). The tile's `reel` says
	 * which letter it is. With nothing inside, it draws the coded letter, which pulses on its own.
	 */
	const { skin }: { skin?: Snippet } = $props();
	const params = getComponentParams();
	// Fixed for the tile's life: the strip remounts a tile rather than re-pointing it.
	const reel = typeof params.reel === 'number' ? params.reel : 0;
	const letter = typeof params.letter === 'string' ? params.letter : '';

	const pulse = new Tween(1);
	let seenPulses = stateLetters.pulses[reel] ?? 0;
	$effect(() => {
		const pulses = stateLetters.pulses[reel] ?? 0;
		if (pulses === seenPulses) return;
		seenPulses = pulses;
		const peak = typeof params.pulseScale === 'number' ? params.pulseScale : 1.6;
		if (!(peak > 0) || peak === 1) return;
		pulse.set(peak, { duration: 0 }).then(() => pulse.set(1, { duration: 600, easing: backOut }));
	});
</script>

{#if skin}
	<Container scale={pulse.current}>
		{@render skin()}
	</Container>
{:else}
	<HoldAndWinLetter {reel} {letter} x={0} y={0} />
{/if}
