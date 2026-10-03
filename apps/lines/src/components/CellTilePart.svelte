<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import { getContext } from '../game/context';

	/**
	 * The `cellTile` component's coded part (Hold and Win Phase 12c) — one respin cell's tile, as the
	 * Respin Cell Tiles draw it under every cell. The author's own nodes inside it — the built-in's
	 * tile and held overlay — arrive as `skin` and draw at its origin, pulsed when a coin lands on the
	 * tile's own cell (`landPulseScale`; 1, the default, keeps it still, as the coded tiles are). The
	 * tile's `reel` and `row` say which cell it is. With nothing inside, the tile is whatever else its
	 * def draws.
	 */
	const { skin }: { skin?: Snippet } = $props();
	const params = getComponentParams();
	const context = getContext();
	// Fixed for the tile's life: the board mounts one tile per cell.
	const reel = typeof params.reel === 'number' ? params.reel : 0;
	const row = typeof params.row === 'number' ? params.row : 0;

	const pulse = new Tween(1);
	context.eventEmitter.subscribeOnMount({
		respinCoinsLand: (event) => {
			if (!event.cells.some((cell) => cell.reel === reel && cell.row === row)) return;
			const peak = typeof params.landPulseScale === 'number' ? params.landPulseScale : 1;
			if (!(peak > 0) || peak === 1) return;
			pulse.set(peak, { duration: 0 }).then(() => pulse.set(1, { duration: 450, easing: backOut }));
		},
	});
</script>

{#if skin}
	<Container scale={pulse.current}>
		{@render skin()}
	</Container>
{/if}
