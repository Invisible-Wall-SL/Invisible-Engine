<script lang="ts">
	/**
	 * The ART BOUNDS editor for one atlas region — the sprite twin of the Rigger's Bounds box and
	 * of an Invisible Flipbook clip's, with the same drag overlay (`$lib/BoundsBox.svelte`).
	 *
	 * A box declares the space the region occupies. Every consumer sizes, anchors and cover-fits by
	 * THAT rather than by the rect the packer happened to produce — so art with a wide invisible
	 * flourish can be sized by the part that reads (box smaller than the art, which is legal and
	 * deliberate), and art padded with empty margin stops drawing small next to its neighbours.
	 * Before this the only fix was to re-crop and re-export the PNG.
	 *
	 * It edits the ART, not this placement: the box is stored per `<assetKey>::<region>` and applies
	 * everywhere that region is drawn, including other scenes and other tools. The panel says so.
	 */
	import BoundsBox, { type Box } from '$lib/BoundsBox.svelte';
	import { fitClipBounds } from 'engine-flipbook';
	import { fetchRegions, type RegionSet } from './editorRegions.client';
	import RegionThumb from './RegionThumb.svelte';
	import {
		artBoundsOf,
		artBoundsVersion,
		saveArtBounds,
		type ArtBoundsBox,
	} from './editorArtBounds.client.svelte';

	interface Props {
		assetKey: string;
		region: string;
	}
	let { assetKey, region }: Props = $props();

	const STAGE = 200;

	let set = $state<RegionSet | null>(null);
	let stageEl = $state<HTMLElement | null>(null);
	let error = $state('');

	// Lazily load the region's sheet — `fetchRegions` is module-cached, so a sheet the canvas
	// already read costs nothing.
	$effect(() => {
		const key = assetKey;
		if (!key) return;
		let live = true;
		void fetchRegions(key).then((s) => {
			if (live) set = s;
		});
		return () => {
			live = false;
		};
	});

	const record = $derived(set ? (set.regions.find((r) => r.name === region) ?? null) : null);

	/** Re-read on every change so the panel reflects a save (and another tab's, after a 409). */
	const bounds = $derived.by((): ArtBoundsBox | undefined => {
		void artBoundsVersion();
		return artBoundsOf(assetKey, region);
	});

	/** The box that just contains this region's art, origin-centred — what ⊙ Fit writes. */
	const autoBounds = $derived.by(() => {
		const r = record;
		if (!r) return undefined;
		return fitClipBounds([
			{
				origW: r.origW ?? r.w,
				origH: r.origH ?? r.h,
				offX: r.offX ?? 0,
				offY: r.offY ?? 0,
				artW: r.w,
				artH: r.h,
			},
		]);
	});

	/**
	 * The FIXED art-space window the stage is fitted to while editing — the art and the box
	 * together, with a margin. Fitting the box itself would rescale the art under the cursor on
	 * every pixel of a drag, which makes it impossible to judge where the box sits against the art.
	 */
	const viewBox = $derived.by(() => {
		const parts = [autoBounds, bounds].filter((b): b is Box => !!b);
		if (parts.length === 0) return undefined;
		const left = Math.min(...parts.map((b) => b.x));
		const top = Math.min(...parts.map((b) => b.y));
		const right = Math.max(...parts.map((b) => b.x + b.w));
		const bottom = Math.max(...parts.map((b) => b.y + b.h));
		const pad = Math.max(right - left, bottom - top) * 0.12;
		return { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 };
	});

	/** This region's geometry re-based onto `viewBox`, so the thumbnail draws the art in the same
	 * space the overlay is measured in. */
	const stageFrame = $derived.by(() => {
		const r = record;
		const v = viewBox;
		if (!r || !v) return null;
		return {
			origW: v.w,
			origH: v.h,
			offX: (r.offX ?? 0) - (r.origW ?? r.w) / 2 - v.x,
			offY: (r.offY ?? 0) - (r.origH ?? r.h) / 2 - v.y,
		};
	});

	/** Art pixels → stage pixels: the same centred contain-fit `RegionThumb` performs. */
	const fit = $derived.by(() => {
		const v = viewBox;
		if (!v || !(v.w > 0) || !(v.h > 0)) return null;
		const scale = Math.min(STAGE / v.w, STAGE / v.h);
		return {
			scale,
			originX: (STAGE - v.w * scale) / 2 - v.x * scale,
			originY: (STAGE - v.h * scale) / 2 - v.y * scale,
		};
	});

	/** One axis of the box, from the numeric fields. An explicit switch rather than a computed
	 * spread key, so the object stays an `ArtBoundsBox` to the type-checker — this app's build
	 * strips types without checking them, so an `any` here would never be caught. */
	function commitField(b: ArtBoundsBox, key: 'x' | 'y' | 'w' | 'h', v: number): void {
		void commit({
			x: key === 'x' ? v : b.x,
			y: key === 'y' ? v : b.y,
			w: key === 'w' ? v : b.w,
			h: key === 'h' ? v : b.h,
		});
	}

	async function commit(b: ArtBoundsBox | undefined): Promise<void> {
		const round = (n: number): number => Math.round(n * 100) / 100;
		const next = b
			? { x: round(b.x), y: round(b.y), w: round(Math.max(1, b.w)), h: round(Math.max(1, b.h)) }
			: undefined;
		error = (await saveArtBounds(assetKey, region, next)) ?? '';
	}
</script>

<section>
	<h3>Art bounds</h3>
	{#if !record}
		<p class="muted small">
			{set ? `“${region}” is not in this sheet any more.` : 'Loading the region…'}
		</p>
	{:else}
		<div class="stage" bind:this={stageEl}>
			<RegionThumb {set} region={record} size={STAGE} box={stageFrame} />
			{#if bounds && fit}
				<BoundsBox
					{bounds}
					{fit}
					stage={stageEl}
					onchange={(b) => void commit(b)}
					color="#f59e0b"
				/>
			{/if}
		</div>
		<div class="row actions">
			<button
				disabled={!autoBounds}
				title="Fit the box to this region's art"
				onclick={() => void commit(autoBounds)}>⊙ Fit</button
			>
			<button
				disabled={!bounds}
				title="Centre the box on the region's origin"
				onclick={() => bounds && void commit({ ...bounds, x: -bounds.w / 2, y: -bounds.h / 2 })}
				>✥ Centre</button
			>
			<button disabled={!bounds} title="Remove the box" onclick={() => void commit(undefined)}
				>✕ Clear</button
			>
		</div>
		{#if bounds}
			{@const b = bounds}
			<div class="row">
				{#each [['x', b.x], ['y', b.y], ['w', b.w], ['h', b.h]] as const as [key, value] (key)}
					<label class="field">
						<span>{key}</span>
						<input
							type="number"
							step="1"
							{value}
							onchange={(e) => {
								const v = e.currentTarget.valueAsNumber;
								if (Number.isFinite(v)) commitField(b, key, v);
							}}
						/>
					</label>
				{/each}
			</div>
		{/if}
		{#if error}<p class="muted small warn">{error}</p>{/if}
		<p class="muted small">
			The box every use of this region is sized and anchored by — the sprite twin of a rig's Bounds.
			It edits the <strong>art</strong>, not this placement: the same box applies wherever
			<code>{region}</code> is drawn. A box <em>smaller</em> than the art is deliberate — the art then
			overflows it, which is how you size a symbol by the part that reads and let a flourish hang outside
			the cell. Ships with the next art export.
		</p>
	{/if}
</section>

<style>
	.stage {
		position: relative;
		width: 200px;
		height: 200px;
		margin: 0 auto 8px;
		border-radius: 6px;
		background: #07070b;
		border: 1px solid #23232c;
	}
	.actions {
		gap: 6px;
	}
</style>
