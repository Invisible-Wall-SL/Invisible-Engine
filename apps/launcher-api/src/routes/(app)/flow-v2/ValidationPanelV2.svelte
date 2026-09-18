<script lang="ts">
	import type { FlowIssue } from 'engine-flow-v2';

	// The v2 validation panel. Lists every `FlowIssue` (code + message) from
	// `validateFlowDoc`, keyed by its stable `code`. Node/pin-located issues are clickable
	// to select + focus the offending node on the canvas (best-effort — edge-located issues
	// resolve to their target node). Runs reactively upstream, so when editing lands in 2b
	// it already revalidates live.
	let {
		issues,
		onfocus,
		duplicateCount = 0,
		onfixduplicates,
	}: {
		issues: FlowIssue[];
		onfocus: (nodeId: string) => void;
		// Count of `duplicate-id` warnings + a one-click repair. When both are present the panel shows a
		// "Fix" banner (the duplicate lives in a collapsed group body, so clicking a row can't reach it).
		duplicateCount?: number;
		onfixduplicates?: () => void;
	} = $props();

	const ICON: Record<string, string> = {
		'ref-unresolved': '✗',
		'exec-in-fanin': '⇉',
		'data-in-fanin': '⇉',
		'entry-has-exec-in': '⤳',
		'edge-endpoint': '⊘',
		'type-mismatch': '≠',
		'unfilled-data-in': '○',
		'data-in-shadowed': '⊗',
		'signal-cross-event': '⤫',
		'literal-type': '≠',
		'accessor-unresolved': '✗',
		'fn-requires': '⚠',
		'duplicate-id': '⧉',
		'hold-without-release': '⏳',
		'tap-without-hold': 'ℹ',
	};

	// Best-effort node id an issue points at — a node/pin `at`, or an edge's TARGET node.
	const nodeOf = (issue: FlowIssue): string | undefined => {
		switch (issue.at.on) {
			case 'node':
			case 'pin':
				return issue.at.node;
			case 'execEdge':
			case 'dataEdge':
				return issue.at.to.node;
		}
	};
</script>

<div class="validation">
	<h3>Validation</h3>
	{#if duplicateCount > 0 && onfixduplicates}
		<div class="fixbar">
			<span class="fixmsg">
				{duplicateCount} duplicate node id{duplicateCount === 1 ? '' : 's'} — hidden inside a collapsed
				group. Harmless at runtime (the flatten re-namespaces them), but worth clearing.
			</span>
			<button class="fixbtn" onclick={() => onfixduplicates?.()}>Re-mint & clear</button>
		</div>
	{/if}
	{#if issues.length === 0}
		<p class="ok">✓ No issues.</p>
	{:else}
		<ul>
			{#each issues as issue, i (i)}
				{@const node = nodeOf(issue)}
				<li>
					{#if node}
						<button
							class="issue"
							class:error={issue.severity === 'error'}
							class:info={issue.severity === 'info'}
							onclick={() => onfocus(node)}
							title={issue.message}
						>
							<span class="icon">{ICON[issue.code] ?? '⚠'}</span>
							<span class="body">
								<span class="code">{issue.code}</span>
								<span class="msg">{issue.message}</span>
							</span>
						</button>
					{:else}
						<div
							class="issue static"
							class:error={issue.severity === 'error'}
							class:info={issue.severity === 'info'}
							title={issue.message}
						>
							<span class="icon">{ICON[issue.code] ?? '⚠'}</span>
							<span class="body">
								<span class="code">{issue.code}</span>
								<span class="msg">{issue.message}</span>
							</span>
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
	.fixbar {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		margin-bottom: 8px;
		border: 1px solid #4a3a1c;
		border-radius: 6px;
		background: #1a160e;
	}
	.fixmsg {
		font-size: 11px;
		line-height: 1.4;
		color: #fdba74;
	}
	.fixbtn {
		align-self: flex-start;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #f59e0b;
		background: #f59e0b1a;
		color: #fbbf24;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}
	.fixbtn:hover {
		background: #f59e0b33;
		border-color: #fbbf24;
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
	.issue.error {
		border-color: #7f1d1d;
		background: #1a0e0e;
		color: #fca5a5;
	}
	.issue.error:not(.static):hover {
		border-color: #ef4444;
	}
	/* `info` is a HINT (the doc runs) — it must not read like the amber warning next to it. */
	.issue.info {
		border-color: #1e3a5f;
		background: #0e141a;
		color: #93c5fd;
	}
	.issue.info:not(.static):hover {
		border-color: #3b82f6;
	}
	.icon {
		flex: none;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.code {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.75;
	}
	.msg {
		min-width: 0;
	}
</style>
