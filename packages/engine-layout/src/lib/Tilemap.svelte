<script lang="ts">
	import { Sprite } from 'pixi-svelte';

	import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
	import { TILE_EMPTY, tilemapTiles, tilemapTileset } from './tilemapNodes';
	import type { TilemapNode } from './types';

	// A tilemap (game-families §4.4, P10.13): one sprite per painted tile, at its cell, sized to the
	// tile. A tile's region resolves as a sprite's does: an atlas-scoped ref looks up the frame
	// registered under its manifest first, then the bare name.
	const { node }: { node: TilemapNode } = $props();

	const keys = $derived(
		tilemapTileset(node).map((entry) => {
			const scoped = parseScopedFrameRef(entry.region);
			if (!scoped.region) return undefined;
			return scoped.assetKey && isManifestAssetKey(scoped.assetKey)
				? { key: editorArtTextureKey(scoped.assetKey, scoped.region), fallbackKey: scoped.region }
				: { key: scoped.region, fallbackKey: undefined };
		}),
	);
	const drawn = $derived.by(() => {
		const out: { i: number; col: number; row: number; key: string; fallbackKey?: string }[] = [];
		tilemapTiles(node).forEach((tile, i) => {
			const ref = tile === TILE_EMPTY ? undefined : keys[tile];
			if (ref) out.push({ i, col: i % node.cols, row: Math.floor(i / node.cols), ...ref });
		});
		return out;
	});
</script>

{#each drawn as cell (cell.i)}
	<Sprite
		key={cell.key}
		fallbackKey={cell.fallbackKey}
		x={cell.col * node.tileWidth}
		y={cell.row * node.tileHeight}
		width={node.tileWidth}
		height={node.tileHeight}
	/>
{/each}
