<script lang="ts">
	import { resolveFrameArt } from 'engine-layout';
	import { getComponentParams } from 'engine-layout/svelte';

	import { claimRespinCellLook } from '../game/stateRespinBoard.svelte';

	/**
	 * The `respinCells` component's coded part. It draws nothing where it is placed: it hands its
	 * params — the tile under every respin cell and the gap between cells — to the respin board
	 * (`respinCellLook`), which stamps the tiles at the cells' own seats and insets each rolling window
	 * by the gap (a gap with no tile image is a look of its own: separate windows over the
	 * background). Unmounted ⇒ the coded look again.
	 */
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];

	const HEX = /^#[0-9a-f]{6}$/i;
	const MAX_GAP = 0.45;
	const claim = claimRespinCellLook();

	$effect(() => {
		const tint = param('tileTint');
		const gap = Number(param('gap'));
		claim.set({
			art: resolveFrameArt(param('tileImage')),
			tint: typeof tint === 'string' && HEX.test(tint) ? tint : undefined,
			gap: Number.isFinite(gap) ? Math.min(Math.max(gap, 0), MAX_GAP) : 0,
		});
	});
	$effect(() => claim.release);
</script>
