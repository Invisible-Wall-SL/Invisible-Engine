<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { LINE_OVERLAY_MOUNT } from 'engine-layout';
	import { getComponentParams, trackComponentMount } from 'engine-layout/svelte';

	import { claimLineOverlayLook, lineOverlayLookFrom } from '../game/coinBoard.svelte';

	/**
	 * The `lineOverlay` component's coded part (`docs/design/hold-and-win-coin-board.md` §1.4). It counts
	 * the instance in as the Line Overlay, so the coded overlay steps aside for a copy of any id, and
	 * hands its params to the coin board, which draws the lines on its own cells
	 * (`CoinBoardLineOverlay`). Where it is placed does not matter. Nodes the author put inside it draw
	 * at the instance.
	 *
	 * A STAND-IN (`standIn`, mounted by `<ComponentInstance>` for a copy that no longer binds this part:
	 * the author draws the lines with their own nodes) hands over no look, so the board draws no lines.
	 * It still counts in.
	 */
	const { skin, standIn = false }: { skin?: Snippet; standIn?: boolean } = $props();
	const params = getComponentParams();

	// Untracked: counting in reads the count it writes, which would re-run this effect forever.
	$effect(() => untrack(() => trackComponentMount(LINE_OVERLAY_MOUNT)));

	const claim = standIn ? undefined : claimLineOverlayLook();
	$effect(() => {
		claim?.set(lineOverlayLookFrom({ ...params }));
	});
	$effect(() => claim?.release);
</script>

{#if skin && !standIn}
	{@render skin()}
{/if}
