<script lang="ts">
	import { Sprite } from 'pixi-svelte';

	import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
	import { isoCellBox, isoTileRegions } from './projection';
	import type { TilemapNode } from './types';

	// A tilemap on an isometric screen (P11.4): one sprite per painted tile, filling its cell's 2:1
	// diamond box, the region its neighbours pick (`autotile`), drawn back to front (by `col + row`,
	// then by column), so a tile's art taller than its diamond overlaps the ones behind it. A tile's
	// region resolves as `<Tilemap>`'s does.
	const { node }: { node: TilemapNode } = $props();

	const keyOf = (region: string) => {
		const scoped = parseScopedFrameRef(region);
		if (!scoped.region) return undefined;
		return scoped.assetKey && isManifestAssetKey(scoped.assetKey)
			? { key: editorArtTextureKey(scoped.assetKey, scoped.region), fallbackKey: scoped.region }
			: { key: scoped.region, fallbackKey: undefined };
	};
	const drawn = $derived.by(() => {
		type Cell = { i: number; depth: number; col: number; key: string; fallbackKey?: string };
		const out: (Cell & ReturnType<typeof isoCellBox>)[] = [];
		isoTileRegions(node).forEach((region, i) => {
			const ref = region ? keyOf(region) : undefined;
			if (!ref) return;
			const col = i % node.cols;
			const row = Math.floor(i / node.cols);
			out.push({ i, depth: col + row, col, ...isoCellBox(node, col, row), ...ref });
		});
		return out.sort((a, b) => a.depth - b.depth || a.col - b.col);
	});
</script>

{#each drawn as cell (cell.i)}
	<Sprite
		key={cell.key}
		fallbackKey={cell.fallbackKey}
		x={cell.x}
		y={cell.y}
		width={cell.w}
		height={cell.h}
	/>
{/each}
