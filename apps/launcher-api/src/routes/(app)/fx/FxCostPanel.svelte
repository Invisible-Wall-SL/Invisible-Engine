<script lang="ts">
	/**
	 * Invisible FX — the PERFORMANCE COST readout under the preview: the effect's live particles and
	 * the screens of pixels they cover (measured by `FxStage` every frame), against the budgets in
	 * `FX_COST_BUDGET`, with each layer's cost-driving settings and hints. Read-only.
	 */
	import type { EmitterLayer } from 'engine-fx';
	import type { ResolvedArt } from './FxStage.svelte';
	import { largestFrame } from './fxMaterial.client';
	import {
		FX_COST_BUDGET,
		formatRate,
		formatScreens,
		layerCostHints,
		layerCostSettings,
		overBudget,
		type FxStageCost,
	} from './fxCost.client';

	interface Props {
		layers: EmitterLayer[];
		cost: FxStageCost | undefined;
		/** Each atlas's regions, by asset key, once resolved (a layer's largest frame is its art size). */
		regions: Record<string, ResolvedArt['regions']>;
		selectedKey: string;
		onselect: (key: string) => void;
	}

	let { layers, cost, regions, selectedKey, onselect }: Props = $props();

	let open = $state(false);

	const rows = $derived(
		layers.map((layer) => {
			const settings = layerCostSettings(layer, largestFrame(layer, regions[layer.art.assetKey]));
			const reading = cost?.layers[layer.key];
			const over = !!reading && overBudget(reading.peak, FX_COST_BUDGET.layer);
			return {
				layer,
				settings,
				reading,
				over,
				hints: layerCostHints(settings, reading?.peak),
			};
		}),
	);

	const totalOver = $derived(!!cost && overBudget(cost.total.peak, FX_COST_BUDGET.total));
	const layersOver = $derived(rows.filter((r) => r.over).length);
	const anyHints = $derived(rows.some((r) => r.hints.length));

	const life = (l: { min: number; max: number }): string =>
		l.min === l.max ? `${l.max}s` : `${l.min}–${l.max}s`;
	const art = (f: { w: number; h: number }): string => (f.w && f.h ? `${f.w}×${f.h}` : '—');
</script>

<div class="cost" class:over={totalOver || layersOver > 0}>
	<button
		class="costbar"
		title="What this effect costs to draw. Coverage = the particles' on-screen area ÷ the viewport's area: roughly how many full screens of pixels the GPU blends each frame."
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="lbl">Cost</span>
		{#if cost}
			<span class="total" class:bad={cost.total.peak.live > FX_COST_BUDGET.total.live}>
				{cost.total.now.live} live
				<small>peak {cost.total.peak.live} / {FX_COST_BUDGET.total.live}</small>
			</span>
			<span class="total" class:bad={cost.total.peak.coverage > FX_COST_BUDGET.total.coverage}>
				{formatScreens(cost.total.now.coverage)} screens
				<small>
					peak {formatScreens(cost.total.peak.coverage)} / {formatScreens(
						FX_COST_BUDGET.total.coverage,
					)}
				</small>
			</span>
			{#if totalOver}
				<span class="flag">Over budget</span>
			{:else if layersOver}
				<span class="flag">{layersOver} layer{layersOver === 1 ? '' : 's'} over budget</span>
			{:else if anyHints}
				<span class="flag soft">Hints</span>
			{/if}
		{:else}
			<span class="hint">measuring…</span>
		{/if}
		<span class="chev">{open ? '▾' : '▸'}</span>
	</button>
	{#if open}
		<div class="costbody">
			<p class="hint">
				Measured against the <b>preview viewport</b>
				{#if cost}({cost.viewport.w}×{cost.viewport.h} px at {Math.round(cost.viewport.zoom * 100)}%
					zoom){/if}: /fx has no game canvas frame, so zooming or resizing the preview changes
				coverage. Peaks reset when the effect or the view changes. Budget per layer: {FX_COST_BUDGET
					.layer.live} live, {formatScreens(FX_COST_BUDGET.layer.coverage)} screens; whole effect: {FX_COST_BUDGET
					.total.live} live, {formatScreens(FX_COST_BUDGET.total.coverage)} screens.
			</p>
			<table>
				<thead>
					<tr>
						<th>Layer</th>
						<th title="Live particles now (peak)">Live</th>
						<th title="Screens of pixels covered now (peak)">Coverage</th>
						<th title="Max particles">Max</th>
						<th title="Particles asked for per second: per wave × spawn chance ÷ frequency">Rate</th
						>
						<th title="Particle lifetime">Life</th>
						<th>Blend</th>
						<th title="Largest art frame, pixels × the largest scale">Art</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.layer.key)}
						<tr class:over={row.over} class:sel={row.layer.key === selectedKey}>
							<td class="name">
								<button title="Select this layer" onclick={() => onselect(row.layer.key)}>
									{row.layer.key}
								</button>
							</td>
							<td class:bad={!!row.reading && row.reading.peak.live > FX_COST_BUDGET.layer.live}>
								{#if row.reading}
									{row.reading.now.live} <small>({row.reading.peak.live})</small>
								{:else}—{/if}
							</td>
							<td
								class:bad={!!row.reading &&
									row.reading.peak.coverage > FX_COST_BUDGET.layer.coverage}
							>
								{#if row.reading}
									{formatScreens(row.reading.now.coverage)}
									<small>({formatScreens(row.reading.peak.coverage)})</small>
								{:else}—{/if}
							</td>
							<td>{row.settings.maxParticles}</td>
							<td class:bad={row.hints.some((h) => h.kind === 'cap')}>
								{formatRate(row.settings.spawnRate)}
							</td>
							<td>{life(row.settings.lifetime)}</td>
							<td class:bad={row.hints.some((h) => h.kind === 'additive')}>
								{row.settings.blend}
							</td>
							<td class:bad={row.hints.some((h) => h.kind === 'large')}>
								{art(row.settings.frame)}{row.settings.scale !== 1
									? ` ×${Math.round(row.settings.scale * 100) / 100}`
									: ''}
							</td>
						</tr>
						{#each row.hints as hint (hint.kind)}
							<tr class="hintrow" class:over={row.over}>
								<td colspan="8">{hint.text}</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.cost {
		border-top: 1px solid #1f2937;
		background: #0e131a;
		font-size: 12px;
		color: #cbd5e1;
	}
	.costbar {
		display: flex;
		align-items: baseline;
		gap: 12px;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.lbl {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.total small,
	td small {
		color: #64748b;
		font-size: 10px;
	}
	.bad,
	.total.bad {
		color: #fca5a5;
	}
	.flag {
		padding: 1px 6px;
		border-radius: 4px;
		background: #3b1219;
		color: #fca5a5;
		font-size: 11px;
	}
	.flag.soft {
		background: #221b0c;
		color: #fcd34d;
	}
	.chev {
		margin-left: auto;
		color: #64748b;
	}
	.cost.over .costbar {
		box-shadow: inset 3px 0 0 #ef4444;
	}
	.costbody {
		max-height: 220px;
		overflow: auto;
		padding: 0 12px 8px;
	}
	.hint {
		margin: 0 0 6px;
		color: #64748b;
		font-size: 11px;
	}
	.hint b {
		color: #94a3b8;
		font-weight: 600;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-weight: 500;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 2px 6px;
	}
	td {
		padding: 3px 6px;
		border-top: 1px solid #1f2937;
		white-space: nowrap;
	}
	td.name button {
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	tr.sel td.name {
		color: #93c5fd;
	}
	tr.over td.name {
		color: #fca5a5;
	}
	tr.hintrow td {
		border-top: none;
		padding: 0 6px 4px 18px;
		white-space: normal;
		font-size: 11px;
		color: #fcd34d;
	}
	tr.hintrow.over td {
		color: #fca5a5;
	}
</style>
