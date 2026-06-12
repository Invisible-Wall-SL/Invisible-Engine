<script lang="ts">
	import {
		fetchRegions,
		type EditorRegion,
		type RegionSet,
	} from '../editor/editorRegions.client';
	import RegionThumb from '../editor/RegionThumb.svelte';
	import CellLoading from './CellLoading.svelte';

	interface Sheet {
		key: string;
		name: string;
	}
	interface Props {
		/** Sprite frame name to render (the cell's `assetKey`). */
		frame: string;
		/** Project atlases/sheets to search for the frame. */
		sheets: Sheet[];
		size: number;
	}
	let { frame, sheets, size }: Props = $props();

	let resolved = $state<{ set: RegionSet; region: EditorRegion } | null>(null);
	let searching = $state(true);

	/**
	 * Resolve the frame to a region by scanning the project's sheets (lazy, cached
	 * per-sheet by `fetchRegions`). Default-art frames often won't be in the
	 * project's R2 until a seeding step — when nothing matches we show a labeled
	 * placeholder chip rather than erroring (see `SymbolCell` in the page).
	 */
	$effect(() => {
		const target = frame;
		const list = sheets;
		searching = true;
		resolved = null;
		let cancelled = false;
		void (async () => {
			for (const sheet of list) {
				const set = await fetchRegions(sheet.key);
				if (cancelled) return;
				const region = set.regions.find((r) => r.name === target);
				if (region) {
					resolved = { set, region };
					searching = false;
					return;
				}
			}
			if (!cancelled) searching = false;
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

{#if resolved}
	<RegionThumb set={resolved.set} region={resolved.region} {size} />
{:else if searching}
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
