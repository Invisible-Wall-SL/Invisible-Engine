<script lang="ts">
	import {
		TILE_COLLIDES,
		TILEMAP_MAX_SIDE,
		TILEMAP_MAX_TILES,
		TILE_AUTOTILE_VARIANTS,
		autotileMaskLabel,
		parseScopedFrameRef,
		tilemapTiles,
		type SceneProjection,
		type TileCollide,
		type TilemapNode,
	} from 'engine-layout';
	import {
		TILEMAP_TOOLS,
		addTilesetEntry,
		brushAfterRemove,
		removeTilesetEntry,
		resizeTilemap,
		setTilemapTileSize,
		setTilesetAutotile,
		setTilesetCollide,
		setTilesetRegion,
	} from '$lib/editor/tilemapEdit';
	import { fetchRegions, type RegionSet } from './editorRegions.client';
	import RegionPicker from './RegionPicker.svelte';
	import RegionThumb from './RegionThumb.svelte';
	import { tilemapPaint } from './tilemapPaint.client.svelte';

	/**
	 * Properties of a `tilemap` (game-families §4.4): its grid, its tileset (each entry's art and
	 * how it collides) and the stage's paint tools. The arcade loop stands characters on, and stops
	 * them at, the tiles marked solid or one-way. On an isometric screen (P11.4) the grid is painted
	 * as 2:1 diamonds and an entry may pick its art by its neighbours (autotile).
	 */
	type Props = {
		node: TilemapNode;
		projection?: SceneProjection;
		sheets: { key: string; name: string }[];
		onChange: () => void;
	};
	const { node, projection, sheets, onChange }: Props = $props();
	const iso = $derived(projection === 'isometric');
	const MASKS = Array.from({ length: TILE_AUTOTILE_VARIANTS }, (_, mask) => mask);

	const COLLIDE_LABEL: Record<TileCollide, string> = {
		none: 'none',
		solid: 'solid',
		oneWay: 'one-way',
	};

	const tileset = $derived(node.tileset ?? []);
	// The brush is shared across tilemaps: one with fewer entries pulls it back to its last, so the
	// row shown as the brush is the one the canvas paints with.
	$effect(() => {
		if (tileset.length && tilemapPaint.brush >= tileset.length)
			tilemapPaint.brush = tileset.length - 1;
	});
	const brush = $derived(Math.min(tilemapPaint.brush, tileset.length - 1));
	const used = $derived.by(() => {
		const counts: number[] = tileset.map(() => 0);
		for (const t of tilemapTiles(node)) if (t >= 0) counts[t] += 1;
		return counts;
	});

	/** Each atlas an entry's region names, loaded once for its thumbnail. */
	let sets = $state<Record<string, RegionSet | null>>({});
	$effect(() => {
		for (const entry of tileset) {
			const key = parseScopedFrameRef(entry.region).assetKey;
			if (!key || key in sets) continue;
			sets[key] = null;
			void fetchRegions(key)
				.then((set) => (sets[key] = set))
				.catch(() => undefined);
		}
	});

	function thumbOf(
		region: string,
	): { set: RegionSet; region: RegionSet['regions'][number] } | null {
		const ref = parseScopedFrameRef(region);
		const set = ref.assetKey ? sets[ref.assetKey] : null;
		const r = set?.regions.find((x) => x.name === ref.region);
		return set && r ? { set, region: r } : null;
	}

	function addEntry(region: string): void {
		if (!region) return;
		tilemapPaint.brush = addTilesetEntry(node, region);
		if (tilemapPaint.tool === 'move' || tilemapPaint.tool === 'erase') tilemapPaint.tool = 'brush';
		onChange();
	}

	function removeEntry(i: number): void {
		if (!removeTilesetEntry(node, i)) return;
		tilemapPaint.brush = brushAfterRemove(tilemapPaint.brush, i, node.tileset.length);
		onChange();
	}

	function resize(cols: number, rows: number): void {
		if (resizeTilemap(node, cols, rows)) onChange();
	}
</script>

<section>
	<h3>Tilemap</h3>
	<p class="muted small">
		A grid of tiles painted on the stage — an arcade level. Characters stand on <strong
			>solid</strong
		>
		tiles and are stopped by them; a <strong>one-way</strong> tile is a platform they can jump up through.
	</p>

	<span class="sub-label">paint</span>
	<div class="tools" role="toolbar" aria-label="Tilemap paint tools">
		{#each TILEMAP_TOOLS as tool (tool.id)}
			<button
				type="button"
				class="tool"
				class:on={tilemapPaint.tool === tool.id}
				aria-pressed={tilemapPaint.tool === tool.id}
				title={`${tool.does} (${tool.key})`}
				onclick={() => (tilemapPaint.tool = tool.id)}
			>
				{tool.label} <kbd>{tool.key}</kbd>
			</button>
		{/each}
	</div>
	{#if tilemapPaint.tool !== 'move' && tileset.length === 0}
		<p class="muted small">Add a tile to the tileset below to paint with it.</p>
	{/if}

	<span class="sub-label">grid</span>
	<div class="row">
		<label class="field" title="Each tile's width, px (before the node's scale).">
			<span>tile w</span>
			<input
				type="number"
				min="1"
				step="1"
				value={node.tileWidth}
				oninput={(e) => {
					if (setTilemapTileSize(node, 'tileWidth', e.currentTarget.valueAsNumber)) onChange();
				}}
			/>
		</label>
		<label class="field" title="Each tile's height, px (before the node's scale).">
			<span>tile h</span>
			<input
				type="number"
				min="1"
				step="1"
				value={node.tileHeight}
				oninput={(e) => {
					if (setTilemapTileSize(node, 'tileHeight', e.currentTarget.valueAsNumber)) onChange();
				}}
			/>
		</label>
	</div>
	<div
		class="row"
		title={`Up to ${TILEMAP_MAX_SIDE} a side and ${TILEMAP_MAX_TILES.toLocaleString()} tiles. Resizing keeps the top-left; cells cut off are lost.`}
	>
		<label class="field">
			<span>columns</span>
			<input
				type="number"
				min="1"
				max={TILEMAP_MAX_SIDE}
				step="1"
				value={node.cols}
				onchange={(e) => resize(e.currentTarget.valueAsNumber, node.rows)}
			/>
		</label>
		<label class="field">
			<span>rows</span>
			<input
				type="number"
				min="1"
				max={TILEMAP_MAX_SIDE}
				step="1"
				value={node.rows}
				onchange={(e) => resize(node.cols, e.currentTarget.valueAsNumber)}
			/>
		</label>
	</div>
	<p class="muted small">
		{node.cols * node.tileWidth} × {node.rows * node.tileHeight} px{#if iso}
			of world, each tile drawn as a {node.tileWidth + node.tileHeight} × {(node.tileWidth +
				node.tileHeight) /
				2} diamond (isometric screen){/if}
	</p>

	<span class="sub-label">tileset</span>
	<ul class="tileset">
		{#each tileset as entry, i (i)}
			{@const thumb = thumbOf(entry.region)}
			<li class:brush={i === brush}>
				<button
					type="button"
					class="pick"
					title="Paint with this tile"
					aria-pressed={i === brush}
					onclick={() => {
						tilemapPaint.brush = i;
						if (tilemapPaint.tool !== 'fill') tilemapPaint.tool = 'brush';
					}}
				>
					{#if thumb}
						<RegionThumb set={thumb.set} region={thumb.region} size={28} />
					{:else}
						<span class="glyph">{i}</span>
					{/if}
				</button>
				<div class="entry">
					<RegionPicker
						{sheets}
						value={entry.region}
						scoped
						onSelect={(region) => {
							if (setTilesetRegion(node, i, region)) onChange();
						}}
					/>
					<div class="entry-row">
						<select
							title="How a character meets this tile"
							value={entry.collide ?? 'none'}
							onchange={(e) => {
								if (setTilesetCollide(node, i, e.currentTarget.value as TileCollide)) onChange();
							}}
						>
							{#each TILE_COLLIDES as c (c)}
								<option value={c}>{COLLIDE_LABEL[c]}</option>
							{/each}
						</select>
						<span class="count">{used[i]} placed</span>
						<button
							type="button"
							class="ghost-sm"
							title="Remove this tile; the cells painted with it are cleared"
							onclick={() => removeEntry(i)}>×</button
						>
					</div>
					{#if iso}
						<details class="autotile">
							<summary
								title="Neighbour autotiling: the art a cell of this tile draws, by which of its four neighbours (↑ → ↓ ← on the grid) hold this same tile. An empty slot draws the tile's own art."
							>
								autotile · {(entry.autotile ?? []).filter(Boolean).length} / {TILE_AUTOTILE_VARIANTS}
							</summary>
							{#each MASKS as mask (mask)}
								<div class="variant">
									<span class="mask">{autotileMaskLabel(mask)}</span>
									<RegionPicker
										{sheets}
										value={entry.autotile?.[mask] ?? ''}
										scoped
										onSelect={(region) => {
											if (setTilesetAutotile(node, i, mask, region)) onChange();
										}}
									/>
								</div>
							{/each}
						</details>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	<span class="sub-label">add a tile</span>
	<RegionPicker {sheets} value="" scoped onSelect={addEntry} />
</section>

<style>
	section {
		margin-bottom: 14px;
	}
	h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 8px;
	}
	.sub-label {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a9aa6;
		margin: 10px 0 6px;
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.tool {
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		color: #c8c8d0;
		font-size: 11px;
		padding: 4px 7px;
		cursor: pointer;
	}
	.tool.on {
		border-color: #6b5bff;
		background: #241f4a;
		color: #fff;
	}
	kbd {
		font-family: inherit;
		font-size: 9px;
		color: #8a8a96;
		margin-left: 2px;
	}
	.row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
		align-items: flex-end;
	}
	.field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	input[type='number'],
	select {
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
		min-width: 0;
	}
	input[type='number']:focus,
	select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.tileset {
		list-style: none;
		padding: 0;
		margin: 0 0 6px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tileset li {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		padding: 4px;
		border: 1px solid transparent;
		border-radius: 6px;
	}
	.tileset li.brush {
		border-color: #6b5bff;
	}
	.pick {
		flex: 0 0 34px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 0;
		cursor: pointer;
	}
	.glyph {
		color: #9a9aa6;
		font-size: 11px;
	}
	.entry {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.entry-row {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.entry-row select {
		flex: 1;
		padding: 3px 6px;
	}
	.autotile summary {
		color: #9a9aa6;
		font-size: 10px;
		cursor: pointer;
	}
	.variant {
		display: flex;
		gap: 4px;
		align-items: center;
		margin-top: 4px;
	}
	.mask {
		flex: 0 0 34px;
		color: #c8c8d0;
		font-size: 11px;
	}
	.count {
		color: #8a8a96;
		font-size: 10px;
		white-space: nowrap;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.ghost-sm {
		background: transparent;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		color: #aaa;
		font-size: 11px;
		padding: 2px 6px;
		cursor: pointer;
	}
</style>
