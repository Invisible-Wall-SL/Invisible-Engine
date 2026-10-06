<script lang="ts">
	import { askText } from '$lib/dialogs.svelte';
	import type { MergeHistoryEntry, RevertResult } from '$lib/server/pipelineMerge';
	import Pill from './Pill.svelte';
	import {
		ROLLBACK_NEEDS_CAPABILITY_TEXT,
		apiErrorText,
		approvalsSummary,
		historyRowState,
		rollbackConfirmMessage,
		safeHref,
		shortSha,
		timeAgo,
	} from './view';

	let {
		merges,
		canMerge,
		now,
		onrollback,
		onreload,
	}: {
		merges: MergeHistoryEntry[];
		canMerge: boolean;
		now: number;
		/** A revert pull request was opened (or found open): show it on the Changes tab. */
		onrollback: (number: number) => void;
		/** Re-reads the history; a refusal means the row is out of date. */
		onreload: () => void;
	} = $props();

	let busy = $state<number | null>(null);
	let failures = $state<Record<number, string>>({});

	async function rollBack(entry: MergeHistoryEntry): Promise<void> {
		if (busy !== null) return;
		const n = entry.prNumber;
		const reason = await askText({
			title: `Roll back #${n}`,
			message: rollbackConfirmMessage(entry),
			label: 'Why (optional)',
			allowEmpty: true,
			confirmLabel: 'Open revert',
		});
		if (reason === null) return;
		busy = n;
		failures = { ...failures, [n]: '' };
		try {
			// No request id: the server names the branch after the merge, so a resend finds the
			// pull request the first call opened.
			const why = reason.trim();
			const res = await fetch(`/api/pipeline/merges/${n}/revert`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(why ? { reason: why } : {}),
			});
			const body: unknown = await res.json().catch(() => null);
			if (!res.ok) {
				failures = { ...failures, [n]: apiErrorText(res.status, body) };
				if (res.status === 404 || res.status === 409) onreload();
				return;
			}
			onrollback((body as RevertResult).number);
		} catch (err) {
			failures = { ...failures, [n]: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = null;
		}
	}
</script>

{#snippet link(url: string | null | undefined, text: string)}
	{@const href = safeHref(url)}
	{#if href}<a {href} target="_blank" rel="external noopener">{text}</a>{:else}{text}{/if}
{/snippet}

{#if !canMerge}<p class="note">{ROLLBACK_NEEDS_CAPABILITY_TEXT}</p>{/if}

<ol class="rows">
	{#each merges as entry (entry.id)}
		<li class="row">
			<div class="main">
				<span class="top">
					<span class="mono">
						#{entry.prNumber} · {@render link(entry.commitUrl, shortSha(entry.mergeSha))}
					</span>
					{#if entry.revertOf !== null}<Pill tone="amber" tag>revert</Pill>{/if}
				</span>
				<span class="title">{@render link(entry.url, entry.title)}</span>
				{#if entry.reverts}
					{@const target = entry.reverts}
					<span class="line">
						Rolls back {@render link(target.url, `#${target.number}`)}{target.title
							? ` — ${target.title}`
							: ''}
					</span>
				{/if}
				<span class="meta">Merged by {entry.mergedBy} · {timeAgo(entry.at, now)}</span>
				{#if entry.approvals.length}
					<details class="approvals">
						<summary>{approvalsSummary(entry)}</summary>
						<ul>
							{#each entry.approvals as a (a.diffId)}
								<li>
									{a.game} · {a.screen} — {a.approver}
									{#if a.note}<span class="note-text">(“{a.note}”)</span>{/if}
								</li>
							{/each}
						</ul>
					</details>
				{:else}
					<span class="meta">{approvalsSummary(entry)}</span>
				{/if}
			</div>
			<div class="side">
				{#if entry.revertedBy}
					<span class="line">
						Rolled back by {@render link(entry.revertedBy.url, `#${entry.revertedBy.number}`)} ·
						{timeAgo(entry.revertedBy.at, now)}
					</span>
				{:else if entry.revertOpen}
					<span class="line">
						Rollback {@render link(entry.revertOpen.url, `#${entry.revertOpen.number}`)} is open
					</span>
				{/if}
				{#if canMerge && historyRowState(entry) === 'rollbackable'}
					<button
						type="button"
						class="btn"
						disabled={busy !== null}
						onclick={() => rollBack(entry)}
					>
						{busy === entry.prNumber ? 'Opening…' : 'Roll back'}
					</button>
				{/if}
			</div>
			{#if failures[entry.prNumber]}
				<p class="err" role="alert">{failures[entry.prNumber]}</p>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.note {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #80808c;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px 16px;
		padding: 14px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		color: #e8e8ee;
		font-size: 13px;
	}
	.main {
		flex: 1 1 420px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
	}
	.side {
		flex: none;
		display: flex;
		align-items: center;
		min-height: 32px;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		color: #c9c9d1;
	}
	.title {
		font-size: 14px;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.title a {
		color: inherit;
		text-decoration: none;
	}
	.title a:hover {
		color: inherit;
		text-decoration: underline;
	}
	.line {
		font-size: 12px;
		color: #c9c9d1;
		overflow-wrap: anywhere;
	}
	.meta {
		font-size: 12px;
		color: #9a9aa6;
	}
	.approvals {
		font-size: 12px;
		color: #9a9aa6;
	}
	.approvals summary {
		cursor: pointer;
		width: fit-content;
	}
	.approvals ul {
		margin: 6px 0 0;
		padding: 0 0 0 16px;
		color: #c9c9d1;
	}
	.approvals li {
		padding: 2px 0;
		overflow-wrap: anywhere;
	}
	.note-text {
		font-style: italic;
	}
	.err {
		flex-basis: 100%;
		margin: 0;
		font-size: 12px;
		color: #ff9d9d;
	}
	a {
		color: #7ee0c0;
	}
	a:hover {
		color: #a8f0d8;
	}
	a:focus-visible,
	button:focus-visible,
	summary:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 0 14px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		background: #23232e;
		border-color: #3a3a48;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
