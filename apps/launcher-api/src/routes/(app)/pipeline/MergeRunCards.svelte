<script lang="ts">
	import { askConfirm } from '$lib/dialogs.svelte';
	import type { MergeRunsAnswer } from '$lib/mergeMainRuns';
	import type { ChangeDetail } from '$lib/server/pipelineChanges';
	import IconButton from '$lib/ui/IconButton.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import {
		acceptBody,
		apiErrorText,
		hunkColumns,
		mergeBrief,
		mergeRunLine,
		mergedInCard,
		proposalBar,
		proposalSections,
		PUSHED_RECENTLY_TEXT,
		shortSha,
		takesWord,
	} from './view';

	/**
	 * The three cards of Resolve conflict (ADR-0015 §5): the newest run's line while it works or when
	 * it ended without a proposal, the proposal waiting for Accept or Discard, and the "Main merged in"
	 * card of an accepted run. Everything a run wrote is shown as text, never as HTML.
	 */
	let {
		detail,
		merge,
		canMerge,
		now,
		onchanged,
	}: {
		detail: ChangeDetail;
		merge: MergeRunsAnswer | null;
		canMerge: boolean;
		now: number;
		/** Re-reads the change and its merge runs. */
		onchanged: () => Promise<void>;
	} = $props();

	let busy = $state<'accept' | 'discard' | null>(null);
	let failure = $state<string | null>(null);
	let copied = $state(false);

	const run = $derived(merge?.run ?? null);
	const line = $derived(mergeRunLine(run, now));
	const proposal = $derived(run && merge ? proposalBar(run, detail, merge, canMerge, now) : null);
	const sections = $derived(run?.explanation ? proposalSections(run.explanation, run.files) : []);
	const hunks = $derived(run?.explanation?.hunks ?? []);
	const mergedIn = $derived(mergedInCard(merge?.accepted ?? null, now));

	async function send(action: 'accept' | 'discard'): Promise<void> {
		if (busy || !run) return;
		// The head the person is looking at when they click, not whatever a refresh brings while the
		// confirmation is open.
		const shown = acceptBody(detail);
		const confirmed = await askConfirm(
			action === 'accept'
				? {
						title: `Accept the resolution for #${detail.number}`,
						message: `The pipeline pushes a merge commit of main (${shortSha(run.mainSha)}) onto ${detail.branch}, with the choices shown. CI re-runs on the new head and approvals start again. It does not merge the change.`,
						confirmLabel: 'Accept',
					}
				: {
						title: `Discard the resolution for #${detail.number}`,
						message: 'Nothing is pushed. The change keeps its conflict.',
						confirmLabel: 'Discard',
					},
		);
		if (!confirmed) return;
		busy = action;
		failure = null;
		try {
			const res = await fetch(
				`/api/pipeline/changes/${detail.number}/merge-runs/${run.id}/${action}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(action === 'accept' ? shown : {}),
				},
			);
			const body: unknown = await res.json().catch(() => null);
			if (!res.ok) failure = apiErrorText(res.status, body);
			await onchanged();
		} catch (err) {
			failure = err instanceof Error ? err.message : String(err);
		} finally {
			busy = null;
		}
	}

	async function copyBrief(): Promise<void> {
		if (!run) return;
		try {
			await navigator.clipboard.writeText(mergeBrief(detail, run));
			copied = true;
		} catch {
			failure = 'The browser would not let the page copy the brief.';
		}
	}
</script>

{#if line}
	<div class="callout {line.tone}" role="status">
		<span>{line.text}</span>
		{#if line.brief}
			<button type="button" class="btn" onclick={copyBrief}>
				{copied ? 'Copied' : 'Copy merge brief'}
			</button>
		{/if}
		{#if run && (run.status === 'dispatched' || run.status === 'running') && canMerge}
			<IconButton
				icon="trash"
				label="Stop this run"
				danger
				disabled={busy !== null}
				onclick={() => void send('discard')}
			/>
		{/if}
	</div>
{/if}

{#if run && proposal}
	<SectionCard scope="pipeline" id="merge-proposal" title="Proposed resolution of the conflict">
		{#snippet info()}A run merged main into this change and proposes how to settle what conflicts.
			Nothing is pushed until you accept.{/snippet}
		{#snippet actions()}
			{#if proposal.canAct}
				<IconButton
					icon="trash"
					label="Discard this resolution"
					danger
					disabled={busy !== null}
					onclick={() => void send('discard')}
				/>
			{/if}
		{/snippet}
		<p class="headline">
			{proposal.headline}
			{#if proposal.cost}<span class="dim">{proposal.cost}</span>{/if}
		</p>
		{#if proposal.pushedRecently}
			<p class="warn" role="alert">{PUSHED_RECENTLY_TEXT}</p>
		{/if}
		{#each sections as s (s.key)}
			<h4>{s.title}</h4>
			{#each s.lines as text, i (i)}<p class="plain">{text}</p>{/each}
		{/each}
		{#if hunks.length}
			<h4>Each hunk</h4>
			{#each hunks as h (`${h.path}:${h.index}`)}
				{@const cols = hunkColumns(h)}
				<div class="hunk">
					<span class="hunk-name">{h.path} · hunk {h.index + 1} · takes {takesWord(h.takes)}</span>
					<div class="cols">
						<div>
							<span class="col-title">main</span>
							<pre>{cols.main}</pre>
						</div>
						<div>
							<span class="col-title">this change</span>
							<pre>{cols.change}</pre>
						</div>
						<div>
							<span class="col-title">result</span>
							<pre>{cols.result}</pre>
						</div>
					</div>
				</div>
			{/each}
		{/if}
		{#if run.files.length}
			<h4>Files written</h4>
			{#each run.files as f (f.path)}
				<p class="plain mono">{f.path}</p>
			{/each}
		{/if}
		{#if proposal.blocked}
			<p class="warn" role="alert">{proposal.blocked}</p>
		{:else if proposal.canAct}
			<div class="actions">
				<button
					type="button"
					class="btn primary"
					disabled={busy !== null}
					onclick={() => void send('accept')}
				>
					{busy === 'accept' ? 'Accepting…' : 'Accept'}
				</button>
			</div>
		{/if}
		{#if failure}<p class="warn" role="alert">{failure}</p>{/if}
	</SectionCard>
{/if}

{#if mergedIn}
	<SectionCard scope="pipeline" id="main-merged-in" title="Main merged in">
		{#snippet info()}An accepted resolution put main into this branch: each file's choice.{/snippet}
		<p class="headline">{mergedIn.title}</p>
		{#each mergedIn.rows as r (r.path)}
			<p class="plain"><span class="mono">{r.path}</span>: {r.text}</p>
		{/each}
	</SectionCard>
{/if}

<style>
	.callout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 10px 14px;
		border: 1px solid;
		border-radius: 10px;
		font-size: 13px;
	}
	.callout.red {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.callout.amber {
		background: #2d2516;
		border-color: #5a4620;
		color: #f5b95c;
	}
	.callout.blue {
		background: #141b2a;
		border-color: #2c4470;
		color: #9bbcf5;
	}
	h4 {
		margin: 10px 0 4px;
		font-size: 11px;
		font-weight: 700;
		color: #9a9aa6;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #c9c9d1;
	}
	.headline {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-weight: 600;
	}
	.dim {
		color: #9a9aa6;
		font-weight: 400;
	}
	.plain {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.mono,
	pre {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
	}
	.warn {
		margin-top: 8px;
		font-weight: 600;
		color: #f5b95c;
	}
	.hunk {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
	}
	.hunk-name {
		font-size: 12px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.col-title {
		font-size: 11px;
		font-weight: 700;
		color: #8a8a96;
	}
	pre {
		margin: 2px 0 0;
		padding: 8px;
		max-height: 220px;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 12px;
		color: #c9c9d1;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 8px;
	}
	.actions {
		margin-top: 12px;
	}
	.btn {
		padding: 6px 12px;
		font-size: 13px;
		color: #e8e8ee;
		background: #1d1d27;
		border: 1px solid #33333f;
		border-radius: 8px;
		cursor: pointer;
	}
	.btn.primary {
		color: #0b1a14;
		background: #7ee0c0;
		border-color: #7ee0c0;
		font-weight: 600;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	@media (max-width: 720px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
</style>
