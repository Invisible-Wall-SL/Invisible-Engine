<script lang="ts">
	/**
	 * The 9-SLICE INSETS editor for one atlas region: four guide lines over the region's packed art,
	 * dragged or typed. Like `ArtBoundsEditor` it edits the ART, stored per `<assetKey>::<region>`,
	 * so every sliced use of the region shares the insets; a node only opts in (its 9-slice mode).
	 */
	import { clampSliceInsets, type SliceInsets } from 'engine-layout';
	import { fetchRegions, type RegionSet } from './editorRegions.client';
	import RegionThumb from './RegionThumb.svelte';
	import { artSliceOf, artSlicesVersion, saveArtSlice } from './editorArtSlices.client.svelte';

	interface Props {
		assetKey: string;
		region: string;
	}
	let { assetKey, region }: Props = $props();

	const STAGE = 200;
	const SIDES = ['left', 'top', 'right', 'bottom'] as const;
	type Side = (typeof SIDES)[number];

	let set = $state<RegionSet | null>(null);
	let error = $state('');
	/** The insets while a guide is being dragged; saved once on release. */
	let dragging = $state<SliceInsets | null>(null);

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
	const saved = $derived.by((): SliceInsets | undefined => {
		void artSlicesVersion();
		return set ? artSliceOf(set.assetKey, region) : undefined;
	});
	const insets = $derived(dragging ?? saved ?? { left: 0, top: 0, right: 0, bottom: 0 });

	/** The thumbnail fits the packed art itself: the space the insets are measured in. */
	const frame = $derived(record ? { origW: record.w, origH: record.h, offX: 0, offY: 0 } : null);
	const fit = $derived.by(() => {
		if (!record) return null;
		const k = Math.min(STAGE / record.w, STAGE / record.h);
		return { k, x: (STAGE - record.w * k) / 2, y: (STAGE - record.h * k) / 2 };
	});

	async function commit(next: SliceInsets | undefined): Promise<void> {
		if (!set || !record) return;
		const clamped = next ? clampSliceInsets(roundInsets(next), record.w, record.h) : undefined;
		const empty = !clamped || clamped.left + clamped.top + clamped.right + clamped.bottom === 0;
		error = (await saveArtSlice(set.assetKey, region, empty ? undefined : clamped)) ?? '';
	}

	function roundInsets(i: SliceInsets): SliceInsets {
		return {
			left: Math.round(i.left),
			top: Math.round(i.top),
			right: Math.round(i.right),
			bottom: Math.round(i.bottom),
		};
	}

	/** Where a guide sits on the stage, in px. */
	function guidePos(side: Side): number {
		if (!fit || !record) return 0;
		if (side === 'left') return fit.x + insets.left * fit.k;
		if (side === 'right') return fit.x + (record.w - insets.right) * fit.k;
		if (side === 'top') return fit.y + insets.top * fit.k;
		return fit.y + (record.h - insets.bottom) * fit.k;
	}

	function startDrag(side: Side, e: PointerEvent): void {
		const el = e.currentTarget as HTMLElement;
		const stage = el.parentElement;
		if (!stage || !fit || !record) return;
		el.setPointerCapture(e.pointerId);
		const f = fit;
		const r = record;
		const rect = stage.getBoundingClientRect();
		const move = (ev: PointerEvent): void => {
			const px = (ev.clientX - rect.left - f.x) / f.k;
			const py = (ev.clientY - rect.top - f.y) / f.k;
			const next = { ...insets };
			if (side === 'left') next.left = px;
			else if (side === 'right') next.right = r.w - px;
			else if (side === 'top') next.top = py;
			else next.bottom = r.h - py;
			dragging = clampSliceInsets(roundInsets(next), r.w, r.h);
		};
		const up = (): void => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
			const done = dragging;
			dragging = null;
			if (done) void commit(done);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}
</script>

<section>
	<h3>9-slice insets</h3>
	{#if !record || !set || !frame}
		<p class="muted small">
			{set ? `“${region}” is not in this sheet any more.` : 'Loading the region…'}
		</p>
	{:else}
		<div class="stage">
			<div class="thumbwrap" style:width="{STAGE}px" style:height="{STAGE}px">
				<RegionThumb {set} region={record} size={STAGE} box={frame} />
				{#each SIDES as side (side)}
					{@const vertical = side === 'left' || side === 'right'}
					<div
						class="guide"
						class:vertical
						role="slider"
						tabindex="-1"
						aria-label="{side} inset"
						aria-valuenow={insets[side]}
						style:left={vertical ? `${guidePos(side) - 4}px` : '0'}
						style:top={vertical ? '0' : `${guidePos(side) - 4}px`}
						onpointerdown={(e) => startDrag(side, e)}
					></div>
				{/each}
			</div>
		</div>
		<div class="row">
			{#each SIDES as side (side)}
				<label class="field">
					<span>{side}</span>
					<input
						type="number"
						min="0"
						step="1"
						value={insets[side]}
						onchange={(e) => {
							const v = e.currentTarget.valueAsNumber;
							if (Number.isFinite(v)) void commit({ ...insets, [side]: v });
						}}
					/>
				</label>
			{/each}
		</div>
		<div class="row actions">
			<button disabled={!saved} title="Remove the insets" onclick={() => void commit(undefined)}
				>✕ Clear</button
			>
		</div>
		{#if error}<p class="muted small warn">{error}</p>{/if}
		<p class="muted small">
			Pixels kept at their art size from each edge of <code>{region}</code> ({record.w} × {record.h}).
			A sprite whose <strong>9-slice</strong> is on stretches or tiles everything between them.
			These edit the <strong>art</strong>: every sliced use of this region shares them. Ships with
			the next art export.
		</p>
	{/if}
</section>

<style>
	.stage {
		display: grid;
		place-items: center;
		width: 200px;
		height: 200px;
		margin: 0 auto 8px;
		border-radius: 6px;
		background: #07070b;
		border: 1px solid #23232c;
	}
	.thumbwrap {
		position: relative;
	}
	.guide {
		position: absolute;
		width: 100%;
		height: 9px;
		cursor: ns-resize;
		touch-action: none;
		background: linear-gradient(transparent 4px, #22d3ee 4px, #22d3ee 5px, transparent 5px);
	}
	.guide.vertical {
		width: 9px;
		height: 100%;
		cursor: ew-resize;
		background: linear-gradient(90deg, transparent 4px, #22d3ee 4px, #22d3ee 5px, transparent 5px);
	}
	.actions {
		gap: 6px;
	}
</style>
