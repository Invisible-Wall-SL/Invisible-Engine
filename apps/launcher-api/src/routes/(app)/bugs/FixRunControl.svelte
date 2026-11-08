<script lang="ts">
	import { bugRef } from '$lib/bugReports';
	import type { FixFacts, FixRunView } from '$lib/bugFixRuns';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { NetworkLost, api, describe, newRequestId, resend } from '../director/director.client';
	import Pill from '../pipeline/Pill.svelte';
	import { safeHref } from '../pipeline/view';
	import { fileSecondBugHref, fixControl, fixRunLine, secondBugText } from './fixView';

	/**
	 * Start fix / Send and start fix and the run lines of one pipeline bug (ADR-0013 card 13C), on
	 * the Bugs tab of Pipeline Changes and on the bug page. What shows is decided by `fixControl` and
	 * `fixRunLine`; the server checks every rule again. Text from a run is rendered as text.
	 */
	let {
		number,
		sent,
		runs,
		facts,
		canFile,
		limit = 1,
		showControl = true,
		onchanged,
	}: {
		number: number;
		sent: boolean;
		runs: FixRunView[];
		facts: FixFacts;
		/** The viewer may file a proposed second bug: pipeline triage and the Bug Reports tool. */
		canFile: boolean;
		/** How many runs to list, newest first. */
		limit?: number;
		/** False on a finished bug: its runs show, there is nothing to start. */
		showControl?: boolean;
		/** The bug changed on the server (a run started or stopped): read it again. */
		onchanged: () => void;
	} = $props();

	const control = $derived(showControl ? fixControl(facts, sent) : { kind: 'hidden' as const });
	const shown = $derived(runs.slice(0, limit));

	let busy = $state<string | null>(null);
	let failure = $state<string | null>(null);
	// One id per click, kept while the answer is unknown so the resend is the same request.
	let requestId: string | null = null;

	async function start(): Promise<void> {
		if (busy || control.kind !== 'start') return;
		const confirmed = await askConfirm({
			title: `${control.label}: ${bugRef(number)}`,
			message: `${control.sends ? 'Sends the bug to Pipeline Changes, then starts' : 'Starts'} a fix run: Claude Code works on the bug in a GitHub Actions job and proposes a draft pull request. It spends on the Anthropic API, and the pull request is public on GitHub. Nothing merges without the owner.`,
			confirmLabel: control.label,
		});
		if (!confirmed) return;
		busy = 'start';
		failure = null;
		requestId ??= newRequestId();
		try {
			await resend(`/api/bugs/${number}/fix-runs`, { requestId });
			requestId = null;
			onchanged();
		} catch (e) {
			if (!(e instanceof NetworkLost)) requestId = null;
			failure = describe(e);
			// A refusal says the bug is not what the page showed: read it again.
			if (!(e instanceof NetworkLost)) onchanged();
		} finally {
			busy = null;
		}
	}

	async function stop(run: FixRunView): Promise<void> {
		if (busy) return;
		const confirmed = await askConfirm({
			title: `Stop fix run ${run.id}`,
			message:
				'Cancels the job on GitHub. What it has spent so far is not recovered, and no pull request opens from it.',
			confirmLabel: 'Stop',
		});
		if (!confirmed) return;
		busy = `stop-${run.id}`;
		failure = null;
		try {
			await api(`/api/bugs/${number}/fix-runs/${run.id}/stop`, { method: 'POST', json: {} });
		} catch (e) {
			failure = describe(e);
		} finally {
			busy = null;
			onchanged();
		}
	}
</script>

{#if control.kind !== 'hidden' || shown.length || failure}
	<div class="fix">
		{#if control.kind === 'start'}
			<div class="actions">
				<button type="button" class="btn primary" disabled={busy !== null} onclick={start}>
					{busy === 'start' ? 'Starting…' : control.label}
				</button>
			</div>
		{:else if control.kind === 'blocked'}
			<div class="actions">
				<button type="button" class="btn" disabled>{control.label}</button>
				<span class="why">{control.why}</span>
			</div>
		{/if}
		{#if failure}<div class="error" role="alert">{failure}</div>{/if}
		{#if shown.length}
			<ul class="runs">
				{#each shown as run (run.id)}
					{@const line = fixRunLine(run)}
					{@const pr = safeHref(run.prUrl)}
					{@const actions = safeHref(run.actionsUrl)}
					{@const file = canFile ? fileSecondBugHref(run, number) : null}
					<li>
						<div class="run-line">
							<Pill tone={line.tone}>{line.label}</Pill>
							<span class="text">{line.text}</span>
							{#if pr}
								<a href={pr} target="_blank" rel="external noopener noreferrer">#{run.prNumber} ↗</a
								>
							{/if}
							{#if actions}
								<a href={actions} target="_blank" rel="external noopener noreferrer"
									>Actions run ↗</a
								>
							{/if}
							{#if line.spend}<span class="dim">{line.spend}</span>{/if}
							{#if run.canStop}
								<button
									type="button"
									class="btn small"
									disabled={busy !== null}
									onclick={() => stop(run)}
								>
									{busy === `stop-${run.id}` ? 'Stopping…' : 'Stop'}
								</button>
							{/if}
						</div>
						{#if line.note}<p class="note">{line.note}</p>{/if}
						{#if run.secondBug}
							<p class="second">
								{secondBugText(run.secondBug)}
								{#if file}
									<!-- A query on another page that reads it once: a full load, not a client navigation. -->
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
									<a class="btn small" href={file} data-sveltekit-reload>File it</a>
								{/if}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.fix {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.actions,
	.run-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.why,
	.dim {
		font-size: 12px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	.runs {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.text {
		font-size: 13px;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	.note,
	.second {
		margin: 4px 0 0;
		font-size: 12px;
		color: #b9b9c4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	a {
		color: #a9cfe4;
		font-size: 12px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		padding: 0 12px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.btn.small {
		min-height: 26px;
		padding: 0 10px;
	}
	.btn.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.btn:hover:not(:disabled) {
		background: #23232e;
		border-color: #3a3a48;
	}
	.btn.primary:hover:not(:disabled) {
		background: #26846a;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.btn:focus-visible,
	a:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.error {
		padding: 10px 12px;
		background: #2a1416;
		border: 1px solid #6b2f33;
		border-radius: 10px;
		color: #ff9d9d;
		font-size: 13px;
	}
</style>
