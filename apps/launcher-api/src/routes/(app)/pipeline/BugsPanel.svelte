<script lang="ts">
	import { bugAreaName, bugBrief, bugPath, bugRef } from '$lib/bugReports';
	import type { BugSummary } from '$lib/server/bugReports';
	import { linkTone, priorityLabel, priorityTone, statusLabel, statusTone } from '../bugs/view';
	import Pill from './Pill.svelte';
	import { timeAgo } from './view';

	let {
		bugs,
		openChanges,
		canOpenBugs,
		now,
		onopenchange,
	}: {
		bugs: BugSummary[];
		/** The numbers the Changes tab lists, so a linked pull request opens there. */
		openChanges: Set<number>;
		/** The viewer has Invisible Pipeline Bug Reports, so each bug links to its page. */
		canOpenBugs: boolean;
		now: number;
		onopenchange: (number: number) => void;
	} = $props();

	let copied = $state<number | null>(null);
	let copyFailed = $state(false);

	async function copyBrief(bug: BugSummary): Promise<void> {
		try {
			await navigator.clipboard.writeText(bugBrief(bug, window.location.origin));
			copied = bug.number;
			copyFailed = false;
		} catch {
			copyFailed = true;
		}
	}
</script>

{#if copyFailed}
	<div class="error" role="alert">The browser did not allow copying to the clipboard.</div>
{/if}
<ul class="bugs">
	{#each bugs as b (b.number)}
		<li class="bug">
			<div class="bug-top">
				<span class="mono">{bugRef(b.number)}</span>
				<span class="tags">
					<Pill tone={priorityTone(b.priority)}>{priorityLabel(b.priority)}</Pill>
					<Pill tone={statusTone(b.status)}>{statusLabel(b.status)}</Pill>
				</span>
			</div>
			<span class="bug-title">{b.title}</span>
			<span class="bug-meta">
				{bugAreaName(b.kind, b.area)}{b.projectKey ? ` · ${b.projectKey}` : ''} · reported by {b.reporter}
				{timeAgo(b.createdAt, now)}{b.sentBy ? ` · sent by ${b.sentBy}` : ''}
			</span>
			{#if b.links.length}
				<ul class="links">
					{#each b.links as l (l.number)}
						<li>
							<Pill tone={linkTone(l.state)}>{l.state}</Pill>
							{#if openChanges.has(l.number)}
								<button type="button" class="linkish" onclick={() => onopenchange(l.number)}>
									#{l.number}
									{l.title}
								</button>
							{:else if l.url}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a href={l.url} target="_blank" rel="noopener noreferrer">#{l.number} {l.title} ↗</a
								>
							{:else}
								<span>#{l.number} {l.title}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<span class="bug-meta">
					No pull request names {bugRef(b.number)} yet.
				</span>
			{/if}
			<div class="actions">
				<button type="button" class="btn" onclick={() => copyBrief(b)}>
					{copied === b.number ? 'Copied' : 'Copy fix brief'}
				</button>
				{#if canOpenBugs}
					<!-- A query on another route: `resolve()` cannot carry one. -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="btn" href={bugPath(b)}>Open in Pipeline Bug Reports</a>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<style>
	.bugs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.bug {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		min-width: 0;
	}
	.bug-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		color: #c9c9d1;
	}
	.tags,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.actions {
		padding-top: 4px;
	}
	.bug-title {
		font-size: 14px;
		font-weight: 700;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	.bug-meta {
		font-size: 12px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	.links {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.links li {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	a,
	.linkish {
		color: #a9cfe4;
		font-size: 12px;
	}
	.linkish {
		padding: 0;
		background: none;
		border: none;
		font-family: inherit;
		text-align: left;
		text-decoration: underline;
		cursor: pointer;
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
	.btn:hover {
		background: #23232e;
		border-color: #3a3a48;
	}
	.btn:focus-visible,
	.linkish:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.error {
		padding: 12px 14px;
		background: #2a1416;
		border: 1px solid #6b2f33;
		border-radius: 10px;
		color: #ff9d9d;
		font-size: 13px;
	}
</style>
