<script lang="ts">
	import type { FlowDiff } from 'engine-flow';

	// Flow-diff vs the coded default (design doc §7, Phase 7). Shows, per screen/event,
	// whether it is AUTHORED (interpreter-driven) or falls through to the CODED default —
	// so the author sees exactly what the FlowDoc overrides vs inherits. A compact summary
	// line + per-item indicators. Screen rows are clickable to focus the node.
	let {
		diff,
		onfocus,
	}: {
		diff: FlowDiff;
		onfocus: (screenId: string) => void;
	} = $props();
</script>

<div class="diff">
	<h3>Authored vs coded</h3>
	<p class="summary">{diff.summary}</p>

	{#if diff.screens.length > 0}
		<div class="group">
			<span class="grouphead">Screens</span>
			<ul>
				{#each diff.screens as s (s.screenId)}
					<li>
						<button class="row" onclick={() => onfocus(s.screenId)} title={s.label}>
							<span class="tag" class:authored={s.authored}>{s.authored ? 'authored' : 'coded'}</span>
							<span class="name">{s.label}{s.initial ? ' ·start' : ''}</span>
							{#if s.authored}
								<span class="phases">
									<span class:on={s.phases.enter} title="enter">e</span>
									<span class:on={s.phases.while} title="while">w</span>
									<span class:on={s.phases.exit} title="exit">x</span>
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if diff.events.length > 0}
		<div class="group">
			<span class="grouphead">Book events</span>
			<ul>
				{#each diff.events as e (e.event)}
					<li>
						<div class="row static" title={e.event}>
							<span class="tag" class:authored={e.authored}>{e.authored ? 'authored' : 'coded'}</span>
							<span class="name">{e.event}</span>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.diff {
		border-top: 1px solid #1f2937;
		padding-top: 12px;
		margin-top: 12px;
	}
	.diff h3 {
		margin: 0 0 6px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.summary {
		margin: 0 0 10px;
		font-size: 11px;
		color: #cbd5e1;
	}
	.group {
		margin-bottom: 10px;
	}
	.grouphead {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
		margin-bottom: 4px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		text-align: left;
		padding: 3px 6px;
		border-radius: 5px;
		border: 1px solid transparent;
		background: transparent;
		color: #cbd5e1;
		cursor: pointer;
		font-size: 11px;
	}
	.row.static {
		cursor: default;
	}
	.row:not(.static):hover {
		border-color: #2a323d;
		background: #14181f;
	}
	.tag {
		flex: none;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 5px;
		border-radius: 999px;
		background: #1b212b;
		color: #94a3b8;
	}
	.tag.authored {
		background: #1d3a6b;
		color: #bfdbfe;
	}
	.name {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.phases {
		flex: none;
		display: flex;
		gap: 2px;
		font-family: monospace;
		font-size: 10px;
	}
	.phases span {
		color: #3a4654;
	}
	.phases span.on {
		color: #60a5fa;
	}
</style>
