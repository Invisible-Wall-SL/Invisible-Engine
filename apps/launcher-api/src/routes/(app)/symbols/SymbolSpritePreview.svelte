<script lang="ts">
	import { parseScopedFrameRef } from 'engine-layout';
	import { frameStem, type EditorRegion, type RegionSet } from '../editor/editorRegions.client';
	import RegionThumb from '../editor/RegionThumb.svelte';
	import CellLoading from './CellLoading.svelte';

	interface Props {
		/** Sprite frame name to render (the cell's `assetKey`). */
		frame: string;
		/**
		 * Shared frame→region index, built ONCE by the page (every sheet fetched in
		 * parallel) instead of each cell scanning the sheet list. `null` while that
		 * first build is in flight → show a loading bar. Default-art frames often
		 * won't be in the project's R2 until a seeding step — when the built index
		 * has no entry we show a labelled placeholder rather than erroring.
		 */
		index: Map<string, { set: RegionSet; region: EditorRegion }> | null;
		size: number;
	}
	let { frame, index, size }: Props = $props();

	// Exact ref, then bare region, then an extension/case-insensitive STEM — the last
	// resolves a coded default (`w.png`) against a region synced under a different
	// extension or casing (`w.webp`, `W`) instead of drawing a blank placeholder.
	const region = $derived(parseScopedFrameRef(frame).region);
	const hit = $derived(
		index?.get(frame) ?? index?.get(region) ?? index?.get(frameStem(region)) ?? null,
	);
</script>

{#if hit}
	<RegionThumb set={hit.set} region={hit.region} {size} />
{:else if index === null}
	<CellLoading {size} />
{:else}
	<div class="ph" style:width="{size}px" style:height="{size}px" title={frame}>
		<span class="ph-label">{frame}</span>
	</div>
{/if}

<style>
	.ph {
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: #16161c;
		border: 1px dashed #2a2a33;
		color: #6a6a76;
		padding: 2px;
	}
	.ph-label {
		font-size: 9px;
		line-height: 1.1;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
