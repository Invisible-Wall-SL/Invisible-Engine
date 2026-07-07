<script lang="ts">
	import {
		previewFlowEvent,
		type FlowDoc,
		type FlowPreviewEntry,
		type FlowPreviewResult,
		type FunctionLibraryDoc,
		type TemplateVocabulary,
	} from 'engine-flow-v2';

	// The v2 DETERMINISTIC preview panel (Phase 2d). Pick one of the flow's event nodes and run its
	// authored handler headlessly through the real `previewFlowEvent` (virtual clock — no waiting),
	// then read the ordered side-effect timeline (effect / cue / delay / show / hide) with resolved
	// payloads + virtual `at` stamps. A FIXED sample trigger + engine feed makes each run reproducible,
	// so tuning a delay/compute and re-running shows the millisecond shift. This is NOT a visual
	// preview (that needs the running game) — it is the deterministic ORDER + TIMING of the flow.
	let {
		doc,
		library,
		vocab,
	}: {
		doc: FlowDoc;
		library: FunctionLibraryDoc;
		vocab: TemplateVocabulary;
	} = $props();

	// The event nodes authored in the MAIN flow graph — the entry points a preview can run from.
	const eventRefs = $derived(
		doc.graph.nodes.filter((n) => n.kind === 'event').map((n) => (n as { ref: string }).ref),
	);

	let selected = $state('');
	let speed = $state(1);
	let result = $state<FlowPreviewResult | null>(null);
	let running = $state(false);

	// Keep the selected event valid as the graph changes: default to the first, drop a stale pick.
	$effect(() => {
		if (eventRefs.length === 0) selected = '';
		else if (!eventRefs.includes(selected)) selected = eventRefs[0];
	});

	// A run is stale once the doc/library/event/speed changes — clear the timeline so the panel never
	// shows a result that no longer matches the graph.
	$effect(() => {
		void [doc, library, selected, speed];
		result = null;
	});

	const run = async (): Promise<void> => {
		if (!selected) return;
		running = true;
		try {
			// Snapshot the reactive doc/library to plain objects before handing them to the pure
			// interpreter (avoids any $state-proxy surprise on a deep walk).
			result = await previewFlowEvent(
				$state.snapshot(doc) as FlowDoc,
				{ vocab, library: $state.snapshot(library) as FunctionLibraryDoc },
				selected,
				{ speed },
			);
		} finally {
			running = false;
		}
	};

	const KIND_LABEL: Record<FlowPreviewEntry['kind'], string> = {
		effect: 'effect',
		cue: 'cue',
		delay: 'delay',
		show: 'show',
		hide: 'hide',
	};

	// The right-hand detail for one timeline entry (name + resolved payload, or the delay/container).
	const detail = (e: FlowPreviewEntry): string => {
		switch (e.kind) {
			case 'delay':
				return `${e.ms} ms`;
			case 'show':
				return `${e.container} · z ${e.z}`;
			case 'hide':
				return e.container;
			default:
				return e.name + (e.payload ? ` ${JSON.stringify(e.payload)}` : '');
		}
	};
</script>

<div class="preview">
	<h3>Preview</h3>
	{#if eventRefs.length === 0}
		<p class="hint">Add an <strong>event</strong> node to preview its handler.</p>
	{:else}
		<div class="controls">
			<select bind:value={selected} aria-label="Event to preview">
				{#each eventRefs as ref (ref)}
					<option value={ref}>{ref}</option>
				{/each}
			</select>
			<div class="speed" role="group" aria-label="Speed">
				<button type="button" class:on={speed === 1} onclick={() => (speed = 1)}>1×</button>
				<button type="button" class:on={speed === 2} onclick={() => (speed = 2)}>2×</button>
			</div>
			<button type="button" class="run" onclick={() => void run()} disabled={running}>
				{running ? '…' : 'Run'}
			</button>
		</div>

		{#if result}
			{#if result.timeline.length === 0}
				<p class="hint">No side effects — this event's handler is empty or un-authored.</p>
			{:else}
				<div class="total">{result.timeline.length} steps · {result.durationMs} ms</div>
				<ol class="timeline">
					{#each result.timeline as entry, i (i)}
						<li>
							<span class="at">{entry.at}</span>
							<span class="kind {entry.kind}">{KIND_LABEL[entry.kind]}</span>
							<span class="detail">{detail(entry)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.preview {
		border-top: 1px solid #1f2937;
		padding-top: 12px;
		margin-top: 12px;
	}
	.preview h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.hint {
		color: #94a3b8;
		font-size: 11px;
		margin: 0;
	}
	.controls {
		display: flex;
		gap: 6px;
		align-items: center;
		margin-bottom: 8px;
	}
	select {
		flex: 1;
		min-width: 0;
		background: #0f1420;
		color: #e5e7eb;
		border: 1px solid #334155;
		border-radius: 6px;
		padding: 4px 6px;
		font-size: 11px;
	}
	.speed {
		display: flex;
		border: 1px solid #334155;
		border-radius: 6px;
		overflow: hidden;
	}
	.speed button {
		background: #0f1420;
		color: #94a3b8;
		border: none;
		padding: 4px 8px;
		font-size: 11px;
		cursor: pointer;
	}
	.speed button.on {
		background: #1e293b;
		color: #e5e7eb;
	}
	.run {
		background: #1d4ed8;
		color: #fff;
		border: none;
		border-radius: 6px;
		padding: 4px 12px;
		font-size: 11px;
		cursor: pointer;
	}
	.run:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.total {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #94a3b8;
		margin-bottom: 6px;
	}
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: 340px;
		overflow-y: auto;
	}
	.timeline li {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 11px;
		line-height: 1.4;
	}
	.at {
		flex: none;
		width: 44px;
		text-align: right;
		color: #64748b;
		font-variant-numeric: tabular-nums;
		font-size: 10px;
	}
	.kind {
		flex: none;
		width: 44px;
		text-align: center;
		border-radius: 4px;
		padding: 1px 0;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.kind.effect {
		background: #1a2e1a;
		color: #86efac;
	}
	.kind.cue {
		background: #241a2e;
		color: #d8b4fe;
	}
	.kind.delay {
		background: #0e1a24;
		color: #7dd3fc;
	}
	.kind.show {
		background: #2e2a14;
		color: #fde68a;
	}
	.kind.hide {
		background: #241416;
		color: #fca5a5;
	}
	.detail {
		min-width: 0;
		color: #cbd5e1;
		word-break: break-word;
	}
</style>
