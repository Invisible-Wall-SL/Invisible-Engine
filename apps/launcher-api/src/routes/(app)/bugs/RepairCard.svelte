<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MAX_DESCRIPTION, MAX_TITLE, bugRef } from '$lib/bugReports';
	import type { BugDetail } from '$lib/server/bugReports';
	import {
		ApiRefusal,
		NetworkLost,
		describe,
		newRequestId,
		resend,
	} from '../director/director.client';
	import Pill from '../pipeline/Pill.svelte';
	import { apiErrorText, timeAgo } from '../pipeline/view';
	import {
		derivedLabels,
		repairRuns,
		showEscalate,
		showRepairWithDirector,
		type RepairFacts,
	} from './view';

	/**
	 * A game bug's repair side (ADR-0012): the Director runs on it, where it stands on the pipeline,
	 * and the two ways to move it on: a Director repair run, or a triager's own escalation to the
	 * pipeline. Renders nothing when there is nothing to show or do.
	 */
	let {
		detail,
		repair,
		pipelineAreas,
		canOpenPipelineBugs,
		now,
		onchanged,
	}: {
		detail: BugDetail;
		repair: RepairFacts;
		pipelineAreas: { id: string; name: string }[];
		canOpenPipelineBugs: boolean;
		now: number;
		onchanged: (next: BugDetail) => void;
	} = $props();

	const labels = $derived(derivedLabels(detail));
	const runs = $derived(repairRuns(detail.events));
	const canRepair = $derived(showRepairWithDirector(repair, detail));
	const canEscalate = $derived(showEscalate(repair, detail));

	let busy = $state<'repair' | 'escalate' | null>(null);
	let failure = $state<string | null>(null);

	// One id per click, kept while the connection is lost so the resend is the same request.
	let repairRequestId: string | null = null;
	async function startRepair(): Promise<void> {
		busy = 'repair';
		failure = null;
		repairRequestId ??= newRequestId();
		try {
			const answer = await resend<{ run: { id: string } }>('/api/director/runs', {
				requestId: repairRequestId,
				bug: detail.number,
			});
			repairRequestId = null;
			await goto(resolve('/(app)/director/[runId]', { runId: answer.run.id }));
		} catch (e) {
			if (!(e instanceof NetworkLost) && !(e instanceof ApiRefusal && e.status >= 500)) {
				repairRequestId = null;
			}
			failure = describe(e);
		} finally {
			busy = null;
		}
	}

	let escalating = $state(false);
	let form = $state({ area: '', title: '', description: '' });

	async function escalate(): Promise<void> {
		busy = 'escalate';
		failure = null;
		try {
			const res = await fetch(`/api/bugs/${detail.number}/escalate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(form),
			});
			const answer: unknown = await res.json().catch(() => null);
			if (!res.ok) {
				failure = apiErrorText(res.status, answer);
				return;
			}
			escalating = false;
			onchanged(answer as BugDetail);
		} catch (e) {
			failure = describe(e);
		} finally {
			busy = null;
		}
	}
</script>

{#if labels.length || runs.length || canRepair || canEscalate}
	<section class="card" aria-labelledby="repair-h">
		<div class="card-head">
			<h3 id="repair-h">Repair</h3>
		</div>

		{#each labels as label (label.text)}
			<p class="line">
				<Pill tone={label.tone} large>{label.text}</Pill>
				{#if label.pipelineBug !== null && canOpenPipelineBugs}
					<a href="{resolve('/bugs')}?bug={label.pipelineBug}">Open it there</a>
				{/if}
			</p>
		{/each}

		{#if runs.length}
			<ul class="runs">
				{#each runs as run (run.runId)}
					<li>
						<a href={resolve('/(app)/director/[runId]', { runId: run.runId })}
							>Director repair run</a
						>
						<span class="muted">{run.state} · {timeAgo(run.at, now)}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if canRepair || canEscalate}
			<div class="actions">
				{#if canRepair}
					<button type="button" class="btn primary" disabled={busy !== null} onclick={startRepair}>
						{busy === 'repair' ? 'Creating the run…' : 'Repair with Director'}
					</button>
				{/if}
				{#if canEscalate && !escalating}
					<button
						type="button"
						class="btn"
						disabled={busy !== null}
						onclick={() => (escalating = true)}>Escalate to pipeline</button
					>
				{/if}
			</div>
			{#if canRepair}
				<p class="muted">
					Director opens a draft run for this bug. You see the cost and press Start there.
				</p>
			{/if}
		{/if}

		{#if canEscalate && escalating}
			<div class="escalate">
				<p class="muted">
					Use this when the cause is in the engine or a tool. It files one pipeline bug in this
					game's project and moves this bug to Working on. Write it in your own words.
				</p>
				<label class="field">
					<span>Tool or area</span>
					<select bind:value={form.area}>
						<option value="" disabled>Choose one…</option>
						{#each pipelineAreas as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
					</select>
				</label>
				<label class="field">
					<span>Title</span>
					<input type="text" bind:value={form.title} maxlength={MAX_TITLE} />
				</label>
				<label class="field">
					<span>What is wrong in the pipeline</span>
					<textarea bind:value={form.description} maxlength={MAX_DESCRIPTION} rows="5"></textarea>
				</label>
				<div class="actions">
					<button
						type="button"
						class="btn"
						disabled={busy !== null}
						onclick={() => (escalating = false)}>Cancel</button
					>
					<button
						type="button"
						class="btn primary"
						disabled={busy !== null || !form.area || !form.title.trim()}
						onclick={escalate}
					>
						{busy === 'escalate' ? 'Filing…' : `File it from ${bugRef(detail.number)}`}
					</button>
				</div>
			</div>
		{/if}

		{#if failure}<div class="error" role="alert">{failure}</div>{/if}
	</section>
{/if}

<style>
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0;
	}
	.runs {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.runs li {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.escalate {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding-top: 12px;
		border-top: 1px solid #23232e;
	}
	.escalate p {
		margin: 0;
	}
	a {
		color: #a9cfe4;
	}
</style>
