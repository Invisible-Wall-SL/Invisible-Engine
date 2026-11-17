<script lang="ts">
	import { PERF_PHASES, type PerfPhase, type PerfReportListItem } from '$lib/profiler';
	import {
		deviceGroups,
		readingsByBuild,
		lineText,
		MIN_PHASE_FRAMES,
		VERDICT_TEXT,
		type BudgetMetric,
		type EffectiveBudget,
		type MetricVerdict,
	} from '$lib/profilerBudgets';
	import type { PerfBuildListItem } from '$lib/profilerBuilds';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import VerdictBadge from './VerdictBadge.svelte';

	interface Props {
		readings: PerfReportListItem[];
		builds: PerfBuildListItem[];
		budgets: EffectiveBudget[];
	}
	const { readings, builds, budgets }: Props = $props();

	const PHASE_LABEL: Record<PerfPhase, string> = {
		idle: 'Idle',
		spinning: 'Spinning',
		round: 'Round',
	};

	const groups = $derived(deviceGroups(readings, budgets));
	const leftOut = $derived(readings.length - groups.reduce((n, g) => n + g.readings.length, 0));
	let openId = $state<string | null>(null);
	const open = $derived(groups.find((g) => g.id === openId) ?? null);

	const metric = (ms: MetricVerdict[], m: BudgetMetric, phase: PerfPhase | '' = '') =>
		ms.find((x) => x.metric === m && x.phase === phase);

	const fmt = (v: number | null | undefined, digits = 1) =>
		v === null || v === undefined ? '—' : v.toFixed(digits);

	function cellTitle(m: MetricVerdict | undefined): string {
		if (!m) return '';
		const lines = [`warn ${lineText(m.metric, m.warn)}`, `fail ${lineText(m.metric, m.fail)}`];
		const head =
			m.verdict === 'nodata' && m.frames !== null
				? `not enough data — no reading has ${MIN_PHASE_FRAMES} frames in this phase`
				: VERDICT_TEXT[m.verdict];
		return m.warn === null && m.fail === null ? head : `${head} — ${lines.join(', ')}`;
	}

	const hitches = (rs: PerfReportListItem[], phase: PerfPhase) =>
		rs.reduce((n, r) => n + (r[phase]?.hitches ?? 0), 0);

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
</script>

{#snippet phaseCells(ms: MetricVerdict[], rs: PerfReportListItem[])}
	{#each PERF_PHASES as phase (phase)}
		{@const fps = metric(ms, 'fps', phase)}
		{@const p95 = metric(ms, 'p95', phase)}
		<td class="num v-{fps?.verdict}" title={cellTitle(fps)}>{fmt(fps?.value)}</td>
		<td class="num v-{p95?.verdict}" title={cellTitle(p95)}>{fmt(p95?.value)}</td>
		<td class="num">{hitches(rs, phase)}</td>
	{/each}
	{@const gpu = metric(ms, 'gpuMb')}
	{@const draws = metric(ms, 'draws')}
	<td class="num v-{draws?.verdict}" title={cellTitle(draws)}>{fmt(draws?.value, 0)}</td>
	<td class="num v-{gpu?.verdict}" title={cellTitle(gpu)}>{fmt(gpu?.value)}</td>
{/snippet}

{#snippet head(first: string)}
	<thead>
		<tr>
			<th rowspan="2">{first}</th>
			<th rowspan="2" class="num">Readings</th>
			<th rowspan="2">Verdict</th>
			{#each PERF_PHASES as phase (phase)}
				<th colspan="3" class="group">{PHASE_LABEL[phase]}</th>
			{/each}
			<th rowspan="2" class="num" title="Mean draw calls a frame (spinning, else idle)">Draws</th>
			<th rowspan="2" class="num" title="Texture memory the GPU held (MB)">GPU MB</th>
		</tr>
		<tr>
			{#each PERF_PHASES as phase (phase)}
				<th class="num" title="Frames a second (median over the readings)">fps</th>
				<th class="num" title="95th-percentile frame time, ms (median over the readings)">p95</th>
				<th class="num" title="Frames over 33 ms, summed over the readings">&gt;33</th>
			{/each}
		</tr>
	</thead>
{/snippet}

<SectionCard scope="profiler" id="devices" title="Devices ({groups.length})">
	{#snippet info()}
		<p>
			This project's readings grouped by device class and GPU, the worst first. Each number is the
			median over the group's readings — a phase counts only from readings with at least
			{MIN_PHASE_FRAMES} frames in it, otherwise it says "not enough data", never pass. A cell is coloured
			by this project's budget (Budgets tab); hover it for the lines. Readings taken with a test switch
			(particles off, …) measure a feature's cost, so they are left out here. Click a device to see its
			readings build by build.
		</p>
	{/snippet}
	{#if !groups.length}
		<p class="muted">
			No as-shipped readings yet — open a capture on the Readings tab and play the game on a phone.
		</p>
	{:else}
		<div class="table-wrap">
			<table>
				{@render head('Device')}
				<tbody>
					{#each groups as g (g.id)}
						<tr class:selected={openId === g.id}>
							<td>
								<button
									type="button"
									class="linkish"
									title="Show this device's readings build by build"
									onclick={() => (openId = openId === g.id ? null : g.id)}
									><strong>{g.deviceClass}</strong></button
								>
								<div class="sub gpu" title={g.gpu}>{g.gpu}</div>
							</td>
							<td class="num">{g.readings.length}</td>
							<td><VerdictBadge verdict={g.verdict} /></td>
							{@render phaseCells(g.metrics, g.readings)}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if leftOut > 0}
		<p class="sub">
			{leftOut} reading{leftOut === 1 ? '' : 's'} left out: taken with a test switch, or from a device
			class the probe did not name.
		</p>
	{/if}
</SectionCard>

{#if open}
	<SectionCard scope="profiler" id="device-builds" title="{open.deviceClass} · {open.gpu}">
		{#snippet info()}
			<p>
				This device's as-shipped readings per build, newest first — a build is the one its build
				record names (Builds tab), else the build number the game stamped. Coloured by the budget,
				as above.
			</p>
		{/snippet}
		<div class="table-wrap">
			<table>
				{@render head('Build')}
				<tbody>
					{#each readingsByBuild(open, builds, budgets) as b (b.id)}
						<tr>
							<td class="nowrap">
								<strong>{b.label}</strong>
								<div class="sub">{b.sub} · {when(b.newest)}</div>
							</td>
							<td class="num">{b.readings.length}</td>
							<td><VerdictBadge verdict={b.verdict} /></td>
							{@render phaseCells(b.metrics, b.readings)}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</SectionCard>
{/if}

<style>
	.muted,
	.sub {
		color: #8a8a99;
	}
	.sub {
		font-size: 11px;
		margin: 8px 0 0;
	}
	td .sub {
		margin: 0;
	}
	.linkish {
		background: none;
		border: none;
		color: #8ab4ff;
		cursor: pointer;
		font: inherit;
		padding: 0;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 12px;
		width: 100%;
	}
	th,
	td {
		padding: 5px 8px;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		vertical-align: top;
	}
	th {
		color: #a9a9b8;
		font-weight: 600;
		white-space: nowrap;
	}
	th.group {
		text-align: center;
		border-left: 1px solid #1d1d26;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.nowrap {
		white-space: nowrap;
	}
	.gpu {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	tr.selected td {
		background: #1a1a24;
	}
	.v-pass {
		color: #7ee787;
	}
	.v-warn {
		color: #ffb347;
		background: rgba(255, 179, 71, 0.08);
	}
	.v-fail {
		color: #ff7b7b;
		background: rgba(255, 123, 123, 0.1);
	}
	.v-nodata {
		color: #6c6c7a;
	}
</style>
