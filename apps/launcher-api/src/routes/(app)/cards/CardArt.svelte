<script lang="ts">
	import { parseScopedFrameRef } from 'engine-layout';
	import { fetchRegions, type EditorRegion, type RegionSet } from '../editor/editorRegions.client';
	import RegionThumb from '../editor/RegionThumb.svelte';

	/** A card's art: a scoped frame ref (`<atlas>::<region>`) drawn from the project's atlas, as the
	 *  frame's sprite draws it. A bare or unknown ref draws nothing. */
	let { value, size }: { value: string; size: number } = $props();

	let found = $state<{ set: RegionSet; region: EditorRegion } | null>(null);

	$effect(() => {
		const { assetKey, region } = parseScopedFrameRef(value);
		found = null;
		if (!assetKey || !region) return;
		let live = true;
		void fetchRegions(assetKey)
			.then((set) => {
				const r = set.regions.find((x) => x.name === region);
				if (live && r) found = { set, region: r };
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	});
</script>

{#if found}<RegionThumb set={found.set} region={found.region} {size} />{/if}
