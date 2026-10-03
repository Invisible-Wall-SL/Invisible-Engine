<script lang="ts">
	import { resolveComponent, resolveFrameArt } from 'engine-layout';
	import { getComponentNestState, getComponentParams } from 'engine-layout/svelte';

	import { claimRespinCellLook, insideRespinCellTile } from '../game/stateRespinBoard.svelte';

	/**
	 * The `respinCells` component's coded part. It draws nothing where it is placed: it hands its
	 * params — the tile under every respin cell and the gap between cells — to the respin board
	 * (`respinCellLook`), which stamps the tiles at the cells' own seats and insets each rolling window
	 * by the gap (a gap with no tile image is a look of its own: separate windows over the
	 * background). Unmounted ⇒ the coded look again.
	 *
	 * `tile` (Phase 12c) names a component every cell draws on instead of `tileImage` — a project's
	 * Cell Tile copy, which the board mounts per cell. One that is not registered, or that names this
	 * component itself, is ignored, so the cells keep `tileImage`. Mounted inside a cell's own tile, it
	 * publishes nothing (`insideRespinCellTile`).
	 */
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];
	const nest = getComponentNestState();
	const tileComponent = (): string | undefined => {
		const value = param('tile');
		if (typeof value !== 'string' || !value || nest.visited.has(value)) return undefined;
		return resolveComponent(value).def ? value : undefined;
	};

	const HEX = /^#[0-9a-f]{6}$/i;
	const MAX_GAP = 0.45;
	const claim = insideRespinCellTile() ? undefined : claimRespinCellLook();

	$effect(() => {
		if (!claim) return;
		const tint = param('tileTint');
		const gap = Number(param('gap'));
		claim.set({
			art: resolveFrameArt(param('tileImage')),
			tint: typeof tint === 'string' && HEX.test(tint) ? tint : undefined,
			gap: Number.isFinite(gap) ? Math.min(Math.max(gap, 0), MAX_GAP) : 0,
			tile: tileComponent(),
		});
	});
	$effect(() => claim?.release);
</script>
