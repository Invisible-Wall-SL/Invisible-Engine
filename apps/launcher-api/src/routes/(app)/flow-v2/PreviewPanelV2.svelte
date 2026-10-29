<script lang="ts">
	import {
		docComponentInstanceNodes,
		flowUsesState,
		PREVIEW_HORIZON_MS,
		previewFlowEvent,
		SCREEN_TRANSITION_ACTION,
		WAIT_FOR_SCREEN_TRANSITION_ACTION,
		spawnSpecsOf,
		type FlowDoc,
		type FlowPreviewEntry,
		type FlowPreviewResult,
		type FlowInstanceDecl,
		type FlowSpawnLayerDecl,
		type FunctionLibraryDoc,
		type TemplateVocabulary,
	} from 'engine-flow-v2';
	import { onDestroy } from 'svelte';
	import { openFlowStageChannel } from '$lib/flowStageBridge';

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
		instances = {},
		spawnLayers = {},
		projectKey = '',
	}: {
		doc: FlowDoc;
		library: FunctionLibraryDoc;
		vocab: TemplateVocabulary;
		/** The placed instances (node id → decl), to name a component for the stage bridge. */
		instances?: Record<string, FlowInstanceDecl>;
		/** The spawn layers on the flow's screens (layer id → decl): what a Spawn node may create. */
		spawnLayers?: Record<string, FlowSpawnLayerDecl>;
		projectKey?: string;
	} = $props();

	// Drive the editor stage (Rive plan §6.2 step 5): every instance op the run reaches is posted on
	// the project's bridge, and a State Machine panel open on that component in `/editor` plays it
	// through its own preview path. Off by default — a headless run should not move another tab.
	let driveStage = $state(false);
	const hasInstanceNodes = $derived(docComponentInstanceNodes(doc).length > 0);

	// The event nodes authored in the MAIN flow graph — the entry points a preview can run from.
	const eventRefs = $derived(
		doc.graph.nodes.filter((n) => n.kind === 'event').map((n) => (n as { ref: string }).ref),
	);

	// A doc with variables, timers or ticks runs on the virtual-time event queue (game-families §3.2)
	// for `horizon` ms, and may be previewed with no event at all: its ticks and timers alone.
	const usesState = $derived(flowUsesState(doc));
	let horizon = $state(PREVIEW_HORIZON_MS);

	let selected = $state('');
	let speed = $state(1);
	let result = $state<FlowPreviewResult | null>(null);
	let running = $state(false);

	// Keep the selected event valid as the graph changes: default to the first, drop a stale pick.
	$effect(() => {
		if (eventRefs.length === 0) selected = '';
		else if (!eventRefs.includes(selected) && !(usesState && selected === ''))
			selected = eventRefs[0];
	});

	// A run is stale once the doc/library/event/speed changes — clear the timeline so the panel never
	// shows a result that no longer matches the graph.
	$effect(() => {
		void [doc, library, selected, speed, horizon];
		result = null;
	});

	const run = async (): Promise<void> => {
		if (!selected && !usesState) return;
		running = true;
		try {
			// Snapshot the reactive doc/library to plain objects before handing them to the pure
			// interpreter (avoids any $state-proxy surprise on a deep walk).
			result = await previewFlowEvent(
				$state.snapshot(doc) as FlowDoc,
				{ vocab, library: $state.snapshot(library) as FunctionLibraryDoc },
				selected,
				{
					speed,
					horizonMs: horizon,
					spawnLayers: spawnSpecsOf(Object.values($state.snapshot(spawnLayers))),
				},
			);
			if (driveStage && result) sendToStage(result.timeline);
		} finally {
			running = false;
		}
	};

	/** The posts of the last run still to land on the stage; a new run, the tick going off or the
	 *  panel leaving clears them. */
	let stagePosts: ReturnType<typeof setTimeout>[] = [];
	let stageChannel: ReturnType<typeof openFlowStageChannel> = null;
	function clearStagePosts(): void {
		for (const t of stagePosts) clearTimeout(t);
		stagePosts = [];
		stageChannel?.close();
		stageChannel = null;
	}
	$effect(() => {
		if (!driveStage) clearStagePosts();
	});
	onDestroy(clearStagePosts);
	/** Post each fired trigger and set input to the stage bridge, each at its timeline time (`at`,
	 *  ms), so fire → wait → fire plays on the stage as the run paced it; a wait is the stage's own
	 *  to show. An instance the projection does not know names no component: skipped. A text set
	 *  travels as its key; the stage has nothing to show it on yet (7a §12). */
	function sendToStage(timeline: FlowPreviewEntry[]): void {
		clearStagePosts();
		const channel = openFlowStageChannel(projectKey);
		if (!channel) return;
		stageChannel = channel;
		const posts = timeline.flatMap((e) => {
			if (e.kind !== 'instance' || e.op === 'wait') return [];
			const decl = instances[e.instance];
			if (!decl) return [];
			const value = e.value;
			return [
				{
					at: e.at,
					message: {
						v: 1 as const,
						componentId: decl.componentId,
						instance: e.instance,
						op: e.op,
						name: e.name,
						...(typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
							? { value }
							: {}),
					},
				},
			];
		});
		const last = posts.length - 1;
		stagePosts = posts.map(({ at, message }, i) =>
			setTimeout(
				() => {
					channel.post(message);
					if (i === last) clearStagePosts();
				},
				Math.max(0, at),
			),
		);
		if (posts.length === 0) clearStagePosts();
	}

	const KIND_LABEL: Record<FlowPreviewEntry['kind'], string> = {
		effect: 'effect',
		cue: 'cue',
		delay: 'delay',
		show: 'show',
		hide: 'hide',
		instance: 'instance',
		var: 'var',
		timer: 'timer',
		input: 'key',
		spawn: 'spawn',
		despawn: 'despawn',
	};

	const layerName = (layer: string): string => spawnLayers[layer]?.name ?? layer;
	const REFUSED: Record<string, string> = {
		'unknown-layer': 'no such layer',
		'not-spawnable': 'the layer does not list it',
		cap: 'the layer is full',
		cell: 'the cell is off the grid',
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
			case 'instance':
				return `${e.instance} · ${e.op} ${e.name}${e.value !== undefined ? ` = ${JSON.stringify(e.value)}` : ''}`;
			case 'var':
				return `${e.id} = ${JSON.stringify(e.value)}`;
			case 'timer':
				return `${e.timer} ran out`;
			case 'input':
				return `${e.action} ${e.phase}`;
			case 'spawn':
				return `${e.componentId} → ${layerName(e.layer)}${e.instance ? ` · ${e.instance}` : ` · refused: ${REFUSED[e.refused ?? ''] ?? e.refused ?? 'unknown'}`}`;
			case 'despawn':
				return e.instance;
			case 'effect':
				return e.name + (e.payload ? ` ${JSON.stringify(e.payload)}` : '') + effectLength(e);
			default:
				return e.name + (e.payload ? ` ${JSON.stringify(e.payload)}` : '');
		}
	};

	/** A screen transition's length, and how long a Wait for transition holds (Shader Graph 8e). */
	const effectLength = (e: Extract<FlowPreviewEntry, { kind: 'effect' }>): string => {
		if (e.name === WAIT_FOR_SCREEN_TRANSITION_ACTION) {
			return e.lengthMs ? ` · holds ${e.lengthMs} ms` : ' · nothing playing';
		}
		if (e.name !== SCREEN_TRANSITION_ACTION) return '';
		if (e.lengthMs === undefined) return " · its effect's own length";
		return ` · ${e.lengthMs} ms${e.payload?.blocking === true ? ', holds the chain' : ''}`;
	};
</script>

<div class="preview">
	<h3>Preview</h3>
	{#if eventRefs.length === 0 && !usesState}
		<p class="hint">Add an <strong>event</strong> node to preview its handler.</p>
	{:else}
		<div class="controls">
			<select bind:value={selected} aria-label="Event to preview">
				{#if usesState}
					<option value="">No event — ticks and timers</option>
				{/if}
				{#each eventRefs as ref (ref)}
					<option value={ref}>{ref}</option>
				{/each}
			</select>
			<div class="speed" role="group" aria-label="Speed">
				<button type="button" class:on={speed === 1} onclick={() => (speed = 1)}>1×</button>
				<button type="button" class:on={speed === 2} onclick={() => (speed = 2)}>2×</button>
			</div>
			{#if usesState}
				<label class="horizon" title="How long the virtual clock runs for ticks and timers">
					<input type="number" min="0" step="500" bind:value={horizon} aria-label="Run for (ms)" />
					<span>ms</span>
				</label>
			{/if}
			<button type="button" class="run" onclick={() => void run()} disabled={running}>
				{running ? '…' : 'Run'}
			</button>
			{#if hasInstanceNodes}
				<label
					class="stage"
					title="Also play each fired trigger and set input on the State Machine panel open on that component in the Scene Editor (same project, another tab)"
				>
					<input type="checkbox" bind:checked={driveStage} />
					<span>Drive the editor stage</span>
				</label>
			{/if}
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
							<span
								class="kind {entry.kind}"
								class:refused={entry.kind === 'spawn' && entry.refused !== undefined}
								>{KIND_LABEL[entry.kind]}</span
							>
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
	.horizon {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 11px;
		color: #94a3b8;
	}
	.horizon input {
		width: 5em;
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
	.kind.var,
	.kind.timer,
	.kind.input {
		background: #102420;
		color: #5eead4;
	}
	.kind.spawn,
	.kind.despawn {
		background: #1c2410;
		color: #bef264;
	}
	.kind.spawn.refused {
		background: #241416;
		color: #fca5a5;
	}
	.detail {
		min-width: 0;
		color: #cbd5e1;
		word-break: break-word;
	}
</style>
