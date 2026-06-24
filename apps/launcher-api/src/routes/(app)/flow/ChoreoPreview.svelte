<script lang="ts">
	import {
		FIXED_PREVIEW_ENGINE,
		FIXED_PREVIEW_TRIGGER,
		previewChoreography,
		type ChoreographyNode,
		type PreviewEntry,
		type PreviewResult,
	} from 'engine-flow';

	// Deterministic live-preview panel (design doc §9.D / §11.6). It runs the authored
	// choreography through the REAL executor against a FIXED feed and a Speed dial, and logs
	// the ordered broadcast + delay timeline with the speed scalar applied — the SAME shape
	// the Phase-0 parity harness produces. This is the DETERMINISTIC half of preview: the
	// emitter-call ORDER + TIMING, reproducible run-to-run. The full VISUAL preview (the game
	// actually animating) needs the running game + emitter + Pixi mounter and is Phase 4 —
	// it is flagged here, not faked.
	let { root }: { root: ChoreographyNode | undefined } = $props();

	let speed = $state(1);
	let result = $state<PreviewResult | null>(null);
	let running = $state(false);

	async function run(): Promise<void> {
		if (!root) {
			result = null;
			return;
		}
		running = true;
		try {
			result = await previewChoreography(root, {
				speed,
				trigger: FIXED_PREVIEW_TRIGGER,
				engine: (key) => FIXED_PREVIEW_ENGINE[key],
			});
		} finally {
			running = false;
		}
	}

	function entryText(e: PreviewEntry): string {
		if (e.kind === 'delay') return `delay ${e.ms}ms → ${e.scaledMs}ms`;
		const payload = e.payload ? ` ${JSON.stringify(e.payload)}` : '';
		return `${e.event} [${e.mode}]${payload}`;
	}
</script>

<div class="preview">
	<div class="controls">
		<label>
			Speed
			<select bind:value={speed}>
				<option value={1}>1× (normal)</option>
				<option value={2}>2× (turbo)</option>
			</select>
		</label>
		<button onclick={run} disabled={running || !root}>{running ? 'Running…' : 'Run preview'}</button
		>
		{#if result}
			<span class="duration">{result.durationMs}ms @ {result.speed}×</span>
		{/if}
	</div>

	{#if !root}
		<p class="hint">Author a choreography to preview its timeline.</p>
	{:else if result}
		<ol class="timeline">
			{#each result.timeline as e, i (i)}
				<li class:delay={e.kind === 'delay'}>
					<span class="at">{e.at}ms</span>
					<span class="op">{entryText(e)}</span>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="hint">Run the preview to see the deterministic broadcast + delay timeline.</p>
	{/if}

	<p class="note">
		Deterministic timeline (fixed feed). Full visual preview — the game animating — needs the
		runtime mounter (Phase 4).
	</p>
</div>

<style>
	.preview {
		color: #cbd5e1;
		font-size: 12px;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}
	.controls label {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #94a3b8;
	}
	select,
	button {
		background: #0e131a;
		border: 1px solid #2a323d;
		border-radius: 5px;
		color: #e2e8f0;
		padding: 4px 8px;
		font-size: 12px;
		cursor: pointer;
	}
	.duration {
		color: #86efac;
	}
	.timeline {
		list-style: none;
		margin: 0 0 8px;
		padding: 0;
		max-height: 220px;
		overflow-y: auto;
		border: 1px solid #1f2937;
		border-radius: 6px;
	}
	.timeline li {
		display: flex;
		gap: 10px;
		padding: 3px 8px;
		border-bottom: 1px solid #161b22;
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.timeline li.delay {
		color: #c4b5fd;
	}
	.at {
		color: #64748b;
		min-width: 52px;
		text-align: right;
	}
	.op {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hint {
		color: #64748b;
	}
	.note {
		color: #64748b;
		font-size: 11px;
		border-top: 1px solid #1f2937;
		padding-top: 8px;
	}
</style>
