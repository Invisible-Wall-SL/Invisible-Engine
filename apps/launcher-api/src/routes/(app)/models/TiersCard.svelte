<script lang="ts">
	/**
	 * What each quality tier ships for the open model: the tier switcher, a row per tier (LODs, top
	 * triangles, download, GPU memory) and the chosen tier's levels and maps — all read from the
	 * Viewer's derive, with a "not derived yet" state before the first one.
	 */
	import {
		MODEL_LOD_ULTRA,
		MODEL_SCENE_BUDGETS,
		MODEL_TIERS,
		type ModelLodScreenSize,
		type ModelMap,
		type ModelTierId,
	} from 'constants-shared/modelTiers';
	import type { ModelExportTier } from 'constants-shared/models';
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import { MODEL_TIER_LABEL, lodLabel } from '$lib/models/modelProfile';
	import type { ModelDerivedIndex } from '$lib/server/modelViewer';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import { formatBytes, formatCount, type DeriveState } from './models.client';

	interface Props {
		/** The Viewer's last derive of this model, or `null`. */
		index: ModelDerivedIndex | null;
		status: DeriveState;
		publishedTiers: readonly ModelTierId[];
		/** The screen sizes in effect (this model's, the Game Config's or the default). */
		screenSize: ModelLodScreenSize;
		tier: ModelTierId;
		deriving: boolean;
		error: string;
		/** False while the page is read-only or holds unsaved settings. */
		canDerive: boolean;
		onderive: () => void;
		ontier: (tier: ModelTierId) => void;
	}
	const {
		index,
		status,
		publishedTiers,
		screenSize,
		tier,
		deriving,
		error,
		canDerive,
		onderive,
		ontier,
	}: Props = $props();

	const TIER_TARGET: Record<ModelTierId, string> = {
		ultra: 'Latest desktop GPUs, opt-in',
		full: 'Desktop game, and every fallback',
		half: 'Web desktop',
		quarter: 'Web mobile',
	};
	const MAP_LABEL: Record<ModelMap, string> = {
		baseColor: 'Base colour',
		normal: 'Normal',
		orm: 'ORM',
		emissive: 'Emissive',
		ramp: 'Toon ramp',
	};
	const ENCODING_LABEL = { uastc: 'UASTC', etc1s: 'ETC1S', png: 'PNG' } as const;

	const options = MODEL_TIERS.map((id) => ({
		value: id,
		label: MODEL_TIER_LABEL[id],
		title: TIER_TARGET[id],
	}));

	/** The files a tier loads: its own, or `full`'s when its derive equals full. */
	const entryOf = (id: ModelTierId): ModelExportTier | null =>
		index ? (index.tiers[id] ?? index.tiers.full) : null;
	const sameAsFull = (id: ModelTierId): boolean => !!index && id !== 'full' && !index.tiers[id];

	const chosen = $derived(entryOf(tier));
	const budget = $derived(MODEL_SCENE_BUDGETS[tier]);

	const lodsText = (entry: ModelExportTier): string => {
		const levels = entry.lods.map((l) => l.level);
		if (!levels.length) return '—';
		const first = lodLabel(levels[0]);
		const last = levels[levels.length - 1];
		return levels.length === 1 ? first : `${first}–${last}`;
	};
	const topTris = (entry: ModelExportTier): number => Math.max(0, ...entry.lods.map((l) => l.tris));

	/** The smallest share of the screen height at which a master level is drawn. */
	const screenOf = (level: number): string => {
		const size = level === MODEL_LOD_ULTRA ? screenSize.ultra : screenSize.levels[level];
		return size === undefined ? '—' : `${+(size * 100).toFixed(2)}%`;
	};
	const when = (iso: string): string => {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
	};
</script>

<SectionCard scope="models" id="tiers" title="Tiers">
	{#snippet info()}
		<p>
			What each quality tier ships for this model, derived from the master the way a publish derives
			it: a window on the LOD chain, each map resized and encoded, the rest compressed.
		</p>
		<p>
			Every tier is shown, also one this project does not publish, so you can see what it would
			cost. A tier whose files would equal Full's gets no copy: the game loads Full.
		</p>
	{/snippet}

	<div class="status" class:warn={status === 'stale' || status === 'unsaved'}>
		{#if deriving}
			<span class="spinner" aria-hidden="true"></span>
			<span>Deriving every tier… large maps the cache has not seen can take a minute.</span>
		{:else if status === 'none'}
			<span>Not derived yet.</span>
		{:else if status === 'unsaved'}
			<span>These numbers are from the saved settings. Save, then derive again.</span>
		{:else if status === 'stale'}
			<span>Out of date: the master or its settings changed since this derive.</span>
		{:else if index}
			<span class="dim">Derived {when(index.derivedAt)} from {index.source}.</span>
		{/if}
		<span class="grow"></span>
		<button type="button" disabled={!canDerive || deriving} onclick={onderive}>
			{status === 'none' ? 'Derive tiers' : 'Derive again'}
		</button>
	</div>
	{#if error}<p class="err" role="alert">{error}</p>{/if}

	<div class="switch">
		<CanvasModeBar {options} value={tier} onChange={ontier} ariaLabel="Quality tier" inline />
		<span class="target">{TIER_TARGET[tier]}</span>
		<InfoTip label="Scene budget" alignEnd>
			A whole scene on the {MODEL_TIER_LABEL[tier]} tier may cost {formatCount(budget.tris)} triangles,
			{budget.drawCalls} draw calls and {formatBytes(budget.gpuTextureBytes)} of textures on the GPU;
			{budget.packaged ? 'the packaged game' : 'the first load'} stays under {formatBytes(
				budget.payloadBytes,
			)}.
		</InfoTip>
	</div>

	<table class="tiers">
		<thead>
			<tr>
				<th>Tier</th>
				<th>Published</th>
				<th>LODs</th>
				<th class="num">Top level</th>
				<th class="num">Download</th>
				<th class="num">GPU memory</th>
			</tr>
		</thead>
		<tbody>
			{#each MODEL_TIERS as id (id)}
				{@const entry = entryOf(id)}
				<tr class:on={id === tier}>
					<th scope="row">{MODEL_TIER_LABEL[id]}</th>
					<td>
						{#if publishedTiers.includes(id)}
							<span class="tag yes">Published</span>
						{:else}
							<span
								class="tag"
								title="This project's tier list (the layout's resolutionTiers) does not name it, so a publish does not write it."
								>Not published</span
							>
						{/if}
					</td>
					{#if !entry}
						<td colspan="4" class="dim">Not derived yet</td>
					{:else if sameAsFull(id)}
						<td colspan="4" class="dim">Same as Full: no copy, the game loads Full</td>
					{:else}
						<td>{lodsText(entry)}</td>
						<td class="num">{formatCount(topTris(entry))} tris</td>
						<td class="num">{formatBytes(entry.bytes)}</td>
						<td class="num">{formatBytes(entry.vramBytes)}</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>

	{#if chosen}
		<div class="detail">
			<div>
				<h3>
					{MODEL_TIER_LABEL[tier]} levels
					{#if sameAsFull(tier)}<span class="dim">(Full's)</span>{/if}
				</h3>
				<table>
					<thead>
						<tr>
							<th>Level</th>
							<th class="num">Triangles</th>
							<th>From</th>
							<th class="num">
								Drawn above
								<InfoTip alignEnd>
									The share of the screen height the model must cover for this level to draw. Set
									under LOD screen sizes.
								</InfoTip>
							</th>
						</tr>
					</thead>
					<tbody>
						{#each chosen.lods as lod (lod.level)}
							<tr>
								<th scope="row">{lodLabel(lod.level)}</th>
								<td class="num">{formatCount(lod.tris)}</td>
								<td>{lod.source === 'authored' ? 'The master' : 'Generated'}</td>
								<td class="num">{screenOf(lod.level)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div>
				<h3>{MODEL_TIER_LABEL[tier]} maps</h3>
				<table>
					<thead>
						<tr>
							<th>Map</th>
							<th class="num">Size</th>
							<th>Encoding</th>
							<th class="num">Mips</th>
						</tr>
					</thead>
					<tbody>
						{#each Object.entries(chosen.maps) as [map, shipped] (map)}
							<tr>
								<th scope="row">{MAP_LABEL[map as ModelMap] ?? map}</th>
								{#if shipped === 'dropped'}
									<td colspan="3" class="dim">Dropped on this tier</td>
								{:else}
									<td class="num">{shipped.w}×{shipped.h}</td>
									<td>{ENCODING_LABEL[shipped.enc] ?? shipped.enc}</td>
									<td class="num">{shipped.mips}</td>
								{/if}
							</tr>
						{:else}
							<tr><td colspan="4" class="dim">No textures</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</SectionCard>

<style>
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.status.warn {
		color: #d3b483;
	}
	.grow {
		flex: 1;
	}
	.dim {
		color: #8b8b98;
	}
	.err {
		margin: 0 0 12px;
		font-size: 12px;
		color: #ff9a9a;
	}
	button {
		font: inherit;
		font-size: 12px;
		padding: 5px 10px;
		border: 1px solid #2a8a69;
		border-radius: 6px;
		background: #1f6f54;
		color: #e8e8ee;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #2e2e3a;
		border-top-color: #7ee0c0;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}
	.target {
		flex: 1;
		font-size: 12px;
		color: #8b8b98;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	th,
	td {
		padding: 6px 10px;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		font-weight: 400;
		white-space: nowrap;
	}
	thead th {
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #8b8b98;
	}
	tbody th {
		color: #e8e8ee;
		font-weight: 600;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.tiers tbody tr.on {
		background: #16211e;
		box-shadow: inset 2px 0 0 #7ee0c0;
	}
	.tag {
		font-size: 11px;
		padding: 1px 7px;
		border: 1px solid #2a2a35;
		border-radius: 999px;
		color: #8b8b98;
	}
	.tag.yes {
		border-color: #2a6a55;
		color: #7ee0c0;
	}
	.detail {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 20px;
		margin: 16px 0 8px;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 12px;
		font-weight: 600;
		color: #b9b9c4;
	}
</style>
