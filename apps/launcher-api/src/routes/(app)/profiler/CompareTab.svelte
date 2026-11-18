<script lang="ts">
	import type { PerfReportListItem } from '$lib/profiler';
	import { compareReadings, type CompareRow } from '$lib/profilerFindings/compare';
	import SectionCard from '$lib/ui/SectionCard.svelte';

	interface Props {
		readings: PerfReportListItem[];
		a: string | null;
		b: string | null;
		onPick: (a: string | null, b: string | null) => void;
	}
	const { readings, a, b, onPick }: Props = $props();

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

	const describe = (r: PerfReportListItem) =>
		[
			when(r.capturedAt),
			`${r.deviceClass ?? '?'} · ${r.gpu ?? 'unknown GPU'}`,
			r.label,
			r.gameKey,
			r.buildVersion ? `v${r.buildVersion}` : null,
			r.source === 'lab' ? 'lab' : null,
			...Object.entries(r.flags).map(([k, v]) => `${k}=${v}`),
		]
			.filter(Boolean)
			.join(' · ');

	const ra = $derived(readings.find((r) => r.id === a) ?? null);
	const rb = $derived(readings.find((r) => r.id === b) ?? null);
	const rows = $derived(ra && rb ? compareReadings(ra, rb) : []);
	const groups = $derived([...new Set(rows.map((r) => r.group))]);
	const labVsPhone = $derived(!!ra && !!rb && (ra.source === 'lab') !== (rb.source === 'lab'));

	const fmt = (v: number | null) => (v === null ? '—' : String(Math.round(v * 10) / 10));
	const tone = (r: CompareRow) =>
		r.delta === null || r.delta === 0 || r.better === 'none'
			? ''
			: r.delta > 0 === (r.better === 'higher')
				? 'good'
				: 'bad';
</script>

<SectionCard scope="profiler" id="compare" title="Compare">
	{#snippet info()}
		<p>
			Any two readings side by side: per phase fps, p95 frame time, frames over 33 ms and frames,
			then what each frame did (draws, passes, texture uploads, GL calls, JS ms) and texture memory,
			with B − A. Green is better, red worse — a difference, not a verdict: two devices, or a lab
			run beside a phone, differ for reasons a build did not cause.
		</p>
	{/snippet}
	<div class="pick">
		<label>
			A
			<select value={a ?? ''} onchange={(e) => onPick(e.currentTarget.value || null, b)}>
				<option value="">Choose a reading…</option>
				{#each readings as r (r.id)}<option value={r.id}>{describe(r)}</option>{/each}
			</select>
		</label>
		<label>
			B
			<select value={b ?? ''} onchange={(e) => onPick(a, e.currentTarget.value || null)}>
				<option value="">Choose a reading…</option>
				{#each readings as r (r.id)}<option value={r.id}>{describe(r)}</option>{/each}
			</select>
		</label>
	</div>
	{#if !ra || !rb}
		<p class="muted">Pick two readings — or open one from a finding's evidence.</p>
	{:else}
		{#if labVsPhone}
			<p class="warn">A lab run beside a device: compare the counts, not the fps.</p>
		{/if}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th></th>
						<th class="num">A</th>
						<th class="num">B</th>
						<th class="num">B − A</th>
					</tr>
				</thead>
				{#each groups as g (g)}
					<tbody>
						<tr class="group"><th colspan="4">{g}</th></tr>
						{#each rows.filter((r) => r.group === g) as r (r.label)}
							<tr>
								<td>{r.label}</td>
								<td class="num">{fmt(r.a)}</td>
								<td class="num">{fmt(r.b)}</td>
								<td class="num {tone(r)}"
									>{r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${fmt(r.delta)}`}</td
								>
							</tr>
						{/each}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}
</SectionCard>

<style>
	.muted {
		color: #8a8a99;
	}
	.warn {
		color: #ffb347;
		font-size: 12px;
	}
	.pick {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 10px;
	}
	.pick label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #a9a9b8;
		flex: 1 1 320px;
	}
	.pick select {
		flex: 1;
		min-width: 0;
	}
	select {
		background: #16161e;
		color: #e8e8ee;
		border: 1px solid #2c2c38;
		border-radius: 6px;
		padding: 4px 6px;
		font: inherit;
		font-size: 12px;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 12px;
		width: 100%;
		max-width: 640px;
	}
	th,
	td {
		padding: 4px 8px;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
	}
	th {
		color: #a9a9b8;
		font-weight: 600;
	}
	tr.group th {
		padding-top: 10px;
		text-transform: capitalize;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.good {
		color: #7ee787;
	}
	.bad {
		color: #ff7b7b;
	}
</style>
