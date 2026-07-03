<script lang="ts">
	import type { FlowIssue } from 'engine-flow';

	// The validation panel (design doc §4/§6, Phase 7). Lists the FlowDoc's authoring
	// issues — orphaned pins, unreachable screens, dead-ends, missing/duplicate initial —
	// as WARNINGS (never blocks authoring). Each node-scoped issue is clickable to
	// select/focus the offending screen on the canvas.
	let {
		issues,
		onfocus,
	}: {
		issues: FlowIssue[];
		onfocus: (screenId: string) => void;
	} = $props();

	const ICON: Record<string, string> = {
		'no-initial': '◎',
		'multiple-initial': '◎',
		unreachable: '⤳',
		'dead-end': '⊘',
		'orphaned-pins': '⚠',
		'stuck-overlay': '⧉',
		'unresolved-accessor': '✗',
		'unresolved-producer': '✗',
		'unknown-book-event': '✗',
	};
</script>

<div class="validation">
	<h3>Validation</h3>
	{#if issues.length === 0}
		<p class="ok">✓ No issues.</p>
	{:else}
		<ul>
			{#each issues as issue, i (i)}
				<li>
					{#if issue.screenId}
						<button class="issue" onclick={() => onfocus(issue.screenId!)} title={issue.message}>
							<span class="icon">{ICON[issue.kind] ?? '⚠'}</span>
							<span class="msg">{issue.message}</span>
						</button>
					{:else}
						<div class="issue static" title={issue.message}>
							<span class="icon">{ICON[issue.kind] ?? '⚠'}</span>
							<span class="msg">{issue.message}</span>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.validation {
		border-top: 1px solid #1f2937;
		padding-top: 12px;
		margin-top: 12px;
	}
	.validation h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.ok {
		color: #86efac;
		font-size: 12px;
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.issue {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 6px;
		text-align: left;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #4a3a1c;
		background: #1a160e;
		color: #fdba74;
		cursor: pointer;
		font-size: 11px;
		line-height: 1.4;
	}
	.issue.static {
		cursor: default;
	}
	.issue:not(.static):hover {
		border-color: #f59e0b;
	}
	.icon {
		flex: none;
	}
	.msg {
		flex: 1;
		min-width: 0;
	}
</style>
