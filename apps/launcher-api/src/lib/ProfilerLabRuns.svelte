<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PerfReportListItem } from '$lib/profiler';
	import {
		LAB_COUNT_KEYS,
		LAB_COUNT_LABELS,
		LAB_PHASES,
		labComparison,
		previousLabReading,
		type LabCountRow,
		type PerfCounts,
	} from '$lib/profilerLab';
	import SectionCard from '$lib/ui/SectionCard.svelte';

	/**
	 * Invisible Profiler lab runs (P6): per game, the newest `lab` reading's counts beside the
	 * previous lab reading of the same game and switches. Fps is never compared here.
	 */
	const { readings }: { readings: PerfReportListItem[] } = $props();

	type LabItem = PerfReportListItem & { counts: PerfCounts };
	const lab = $derived(
		readings.filter((r): r is LabItem => r.source === 'lab' && r.counts !== null),
	);
	/** The newest lab reading of each game, newest first (`readings` is newest first). */
	const newest = $derived(
		lab.filter((r, i) => lab.findIndex((o) => o.gameKey === r.gameKey) === i),
	);

	const when = (iso: string) =>
		new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
	const fmt = (v: number | null) => (v === null ? '—' : String(Math.round(v * 10) / 10));
	const signed = (v: number | null) =>
		v === null ? '' : v > 0 ? `+${fmt(v)}` : v < 0 ? fmt(v) : '±0';
	const cell = (rows: LabCountRow[], phase: LabCountRow['phase'], key: LabCountRow['key']) =>
		rows.find((x) => x.phase === phase && x.key === key);
</script>

<SectionCard
	scope="profiler"
	id="lab"
	title="Lab runs ({newest.length} {newest.length === 1 ? 'game' : 'games'})"
>
	{#snippet info()}
		<p>
			A scripted headless run of each live game, nightly and on demand (GitHub Actions "Profiler lab
			run"): 20 s idle, then 10 spins. Each game's newest lab reading is shown beside the previous
			one of the same game, per frame. Compared on counts only: lab fps is not comparable, as a
			shared runner renders in software and swings about 2× run to run. A change past the run-to-run
			tolerance is marked.
		</p>
	{/snippet}
	{#if !newest.length}
		<p class="muted">No lab readings yet.</p>
	{:else}
		{#each newest as r (r.id)}
			{@const before = previousLabReading(lab, r)}
			{@const rows = labComparison(r.counts, before?.counts ?? null)}
			<div class="run">
				<p class="head">
					<strong>{r.gameKey ?? 'game?'}</strong>
					{#if r.buildVersion}<span>v{r.buildVersion}</span>{/if}
					<span title={r.capturedAt}>{when(r.capturedAt)}</span>
					<span class="muted"
						>{before
							? `vs ${when(before.capturedAt)}`
							: 'no earlier lab run with these switches'}</span
					>
					{#if r.counts.textureMb !== null}
						{@const t = cell(rows, 'all', 'textureMb')}
						<span class:changed={t?.changed}
							>{fmt(t?.value ?? null)} texture MB {signed(t?.delta ?? null)}</span
						>
					{/if}
					<span class="muted" title="A shared runner renders in software and swings ~2× run to run"
						>fps: not comparable</span
					>
					<a
						href={resolve('/api/profiler/reports/[id]', { id: r.id })}
						target="_blank"
						rel="noopener">JSON</a
					>
				</p>
				<table>
					<thead>
						<tr>
							<th>per frame</th>
							{#each LAB_PHASES as phase (phase)}
								{#if r.counts[phase]}<th colspan="3">{phase}</th>{/if}
							{/each}
						</tr>
						<tr>
							<th></th>
							{#each LAB_PHASES as phase (phase)}
								{#if r.counts[phase]}<th>now</th><th>before</th><th>Δ</th>{/if}
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each LAB_COUNT_KEYS as key (key)}
							<tr>
								<td>{LAB_COUNT_LABELS[key]}</td>
								{#each LAB_PHASES as phase (phase)}
									{#if r.counts[phase]}
										{@const c = cell(rows, phase, key)}
										<td class="num">{fmt(c?.value ?? null)}</td>
										<td class="num muted">{fmt(c?.previous ?? null)}</td>
										<td class="num" class:changed={c?.changed}>{signed(c?.delta ?? null)}</td>
									{/if}
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/each}
	{/if}
</SectionCard>

<style>
	.run + .run {
		margin-top: 1rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: baseline;
		margin: 0 0 0.35rem;
	}
	.muted {
		opacity: 0.65;
	}
	table {
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		padding: 0.2rem 0.6rem;
		text-align: left;
		border-bottom: 1px solid rgba(127, 127, 127, 0.2);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.changed {
		color: #e8a33d;
		font-weight: 600;
	}
</style>
