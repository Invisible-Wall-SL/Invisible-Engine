<script lang="ts">
	import { BUG_STATUS_LABELS, BUG_TOOL, bugPath, isBugStatus, type BugKind } from '$lib/bugReports';
	import type { Verdict } from '$lib/profilerBudgets';
	import { fileFindingHref, filedLabel, type FiledFinding } from '$lib/profilerFindings/bug';
	import { RULE_TITLES, type Finding, type Severity } from '$lib/profilerFindings/finding';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import VerdictBadge from './VerdictBadge.svelte';

	interface Props {
		/** Null when they could not be computed this load. */
		findings: Finding[] | null;
		/** The bug each filed finding has (P5); null when it could not be read this load. */
		filed: Record<string, FiledFinding> | null;
		/** Which list each finding is filed in. */
		fileAs: Record<string, BugKind>;
		projectKey: string;
		/** The viewer's tools: File as bug needs the list's own. */
		bugTools: ReadonlySet<string>;
		onOpenBuild: (id: string) => void;
		onCompare: (a: string, b: string | null) => void;
	}
	const props: Props = $props();
	const { onOpenBuild, onCompare } = props;
	const filed = $derived(props.filed ?? {});
	const findings = $derived(props.findings ?? []);

	const SEVERITY_BADGE: Record<Severity, Verdict> = { high: 'fail', medium: 'warn', low: 'nodata' };
	const NO_DEVICE = '(build files)';

	let owner = $state('');
	let device = $state('');

	const owners = $derived(
		[...new Map(findings.map((f) => [f.owner.id, f.owner.label])).entries()].sort((a, b) =>
			a[1].localeCompare(b[1]),
		),
	);
	const devices = $derived(
		[...new Set(findings.map((f) => f.deviceClass ?? NO_DEVICE))].sort((a, b) =>
			a === NO_DEVICE ? 1 : b === NO_DEVICE ? -1 : a.localeCompare(b),
		),
	);
	// A filter whose value a re-read took away shows everything rather than an empty list.
	const ownerShown = $derived(owners.some(([id]) => id === owner) ? owner : '');
	const deviceShown = $derived(devices.includes(device) ? device : '');
	const shown = $derived(
		findings.filter(
			(f) =>
				(!ownerShown || f.owner.id === ownerShown) &&
				(!deviceShown || (f.deviceClass ?? NO_DEVICE) === deviceShown),
		),
	);

	/** A reading opens Compare: the finding's pair in its order, when it is one of them. */
	function compareFrom(f: Finding, id: string): void {
		const ids = f.evidence.filter((e) => e.type === 'reading').map((e) => e.id);
		if (ids.slice(0, 2).includes(id)) onCompare(ids[0], ids[1] ?? null);
		else onCompare(id, ids[0]);
	}
</script>

<SectionCard scope="profiler" id="findings" title="Findings ({shown.length})">
	{#snippet info()}
		<p>
			What to cut, ranked: severity first (high = a budget fails, medium = a warn or a cost worth
			cutting), then the estimated saving as a share of a typical budget. Every estimate is a
			measurement — a test switch's delta, a file's bytes, a breakdown figure — or it says
			"unmeasured". Each finding names the agent (or person) who owns the fix and links the readings
			and builds it was read from: a reading opens Compare, a build its detail on the Builds tab.
			Lab runs count only where the rule reads counts, never fps. File as bug opens Bug Reports
			filled in — a game bug for the game's own content, a pipeline bug for the engine or a tool —
			and keeps the readings and builds it cites for as long as the bug exists.
		</p>
	{/snippet}
	{#snippet actions()}
		<label class="filter">
			Owner
			<select bind:value={owner}>
				<option value="">All</option>
				{#each owners as [id, label] (id)}<option value={id}>{label}</option>{/each}
			</select>
		</label>
		<label class="filter">
			Device
			<select bind:value={device}>
				<option value="">All</option>
				{#each devices as d (d)}<option value={d}>{d}</option>{/each}
			</select>
		</label>
	{/snippet}
	{#if !props.findings}
		<p class="error">The findings could not be worked out on this load — reload the page.</p>
	{:else if !findings.length}
		<p class="muted">
			Nothing to cut yet — the rules need readings (Readings tab) or build records (Builds tab).
		</p>
	{:else if !shown.length}
		<p class="muted">No finding matches these filters.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Severity</th>
						<th>Finding</th>
						<th class="num" title="What fixing it would save, from a measurement">Saving</th>
						<th>Owner</th>
						<th>Evidence</th>
						<th>Bug</th>
					</tr>
				</thead>
				<tbody>
					{#each shown as f (f.id)}
						<tr>
							<td><VerdictBadge verdict={SEVERITY_BADGE[f.severity]} label={f.severity} /></td>
							<td>
								<strong>{f.title}</strong>
								<div class="sub">{RULE_TITLES[f.rule]}{f.gameKey ? ` · ${f.gameKey}` : ''}</div>
								{#if f.detail.length}
									<ul class="detail">
										{#each f.detail as line, i (i)}<li>{line}</li>{/each}
									</ul>
								{/if}
							</td>
							<td class="num">
								{#if f.estimate}
									<strong>{f.estimate.value} {f.estimate.unit}</strong>
									<div class="sub">{f.estimate.basis}</div>
								{:else}
									<span class="muted" title="No measurement behind a number">unmeasured</span>
								{/if}
							</td>
							<td class="nowrap">
								{#if f.owner.kind === 'agent'}<code>{f.owner.label}</code>{:else}{f.owner
										.label}{/if}
							</td>
							<td>
								<div class="evidence">
									{#each f.evidence as e (e.type + e.id)}
										{#if e.type === 'build'}
											<button type="button" class="linkish" onclick={() => onOpenBuild(e.id)}
												>{e.label}</button
											>
										{:else}
											<button
												type="button"
												class="linkish"
												title="Open in Compare"
												onclick={() => compareFrom(f, e.id)}>{e.label}</button
											>
										{/if}
									{/each}
								</div>
							</td>
							<td class="nowrap">
								{#if filed[f.id]}
									{@const bug = filed[f.id]}
									<!-- A query on another route: `resolve()` cannot carry one. -->
									<!-- eslint-disable svelte/no-navigation-without-resolve -->
									<a
										href={bugPath({
											number: bug.number,
											kind: bug.kind,
											projectKey: props.projectKey,
										})}>{filedLabel(bug)}</a
									>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
									<div class="sub">
										{isBugStatus(bug.status) ? BUG_STATUS_LABELS[bug.status] : bug.status}
									</div>
								{:else if !props.filed}
									<span class="muted" title="The filed bugs could not be read this load">?</span>
								{:else if props.bugTools.has(BUG_TOOL[props.fileAs[f.id]])}
									<!-- A query on another route: `resolve()` cannot carry one. -->
									<!-- eslint-disable svelte/no-navigation-without-resolve -->
									<a
										class="file"
										href={fileFindingHref(f, props.projectKey, props.fileAs[f.id])}
										title={`Opens the ${props.fileAs[f.id]} bug form, filled in from this finding`}
										>File as bug</a
									>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{:else}
									<span class="muted" title="Your role does not have this bug list">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</SectionCard>

<style>
	.muted,
	.sub {
		color: #8a8a99;
	}
	.error {
		color: #ff7b7b;
	}
	.sub {
		font-size: 11px;
	}
	.filter {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: #a9a9b8;
		margin-left: 8px;
	}
	.filter select {
		max-width: 200px;
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
	.detail {
		margin: 4px 0 0;
		padding-left: 16px;
		color: #b9b9c6;
		font-size: 11px;
	}
	.evidence {
		display: flex;
		flex-direction: column;
		gap: 2px;
		align-items: flex-start;
	}
	a {
		color: #8ab4ff;
	}
	.file {
		display: inline-block;
		border: 1px solid #2c2c38;
		border-radius: 6px;
		padding: 2px 8px;
		text-decoration: none;
	}
	.linkish {
		background: none;
		border: none;
		color: #8ab4ff;
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		padding: 0;
		text-align: left;
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
		padding: 6px 8px;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		vertical-align: top;
	}
	th {
		color: #a9a9b8;
		font-weight: 600;
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.nowrap {
		white-space: nowrap;
	}
</style>
