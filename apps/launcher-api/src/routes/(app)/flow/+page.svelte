<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Connection,
		type Edge,
		type Node,
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import {
		DEFAULT_EMITTER_VOCABULARY,
		type FlowDoc,
		type FlowTransition,
		type FlowTrigger,
	} from 'engine-flow';
	import EdgeInspector from './EdgeInspector.svelte';
	import FlowScreenNode from './FlowScreenNode.svelte';
	import ChoreographyEditor from './ChoreographyEditor.svelte';
	import {
		addScreen,
		addTransition,
		buildFlowModel,
		createFlowHistory,
		editTransition,
		moveScreen,
		removeScreen,
		removeTransition,
		setInitialScreen,
		type AvailableScene,
		type TransitionEdit,
	} from './flowModel.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The FlowDoc is the single source of truth. Initialize from the loaded doc; every
	// mutation replaces it via a pure command helper and is recorded for undo/redo.
	let doc = $state<FlowDoc>(structuredClone(data.flow));
	let dirty = $state(false);
	let saving = $state(false);
	let saveMsg = $state('');
	let selectedEdgeId = $state<string | null>(null);

	const history = createFlowHistory<FlowDoc>(doc);

	// The derived view: placed screens (with pins/orphans) + the unplaced-scene palette.
	const model = $derived(buildFlowModel(doc, data.doc, data.components));

	// Commit a new doc: record it for undo and mark dirty. Rebuilds the canvas arrays.
	function commit(next: FlowDoc): void {
		if (next === doc) return;
		doc = next;
		history.record(doc);
		dirty = true;
		saveMsg = '';
		syncCanvas();
	}

	// Apply an already-known doc (undo/redo result) without re-recording it.
	function apply(next: FlowDoc): void {
		doc = next;
		dirty = true;
		saveMsg = '';
		syncCanvas();
	}

	const nodeTypes = { screen: FlowScreenNode };

	// xyflow owns these arrays for live drag/selection; we rebuild them from the doc only
	// on STRUCTURAL changes (add/remove screen+edge, undo/redo), not on every drag frame.
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);

	function buildNodes(): Node[] {
		return model.screens.map((view) => ({
			id: view.screen.id,
			type: 'screen',
			position: view.screen.position ?? { x: 0, y: 0 },
			data: {
				label: view.screen.label ?? view.scene.name,
				pins: view.pins,
				orphanCount: view.orphanedPins.length,
				initial: view.screen.initial ?? false,
			},
		}));
	}

	function edgeLabel(t: FlowTransition): string {
		const base = triggerLabel(t.trigger);
		const extra = [t.guard ? 'guard' : '', t.delayMs ? `+${t.delayMs}ms` : '']
			.filter(Boolean)
			.join(' ');
		return extra ? `${base} · ${extra}` : base;
	}

	function triggerLabel(trigger: FlowTrigger): string {
		switch (trigger.kind) {
			case 'bookEvent':
				return `event: ${trigger.event || '…'}`;
			case 'complete':
				return 'on complete';
			case 'condition':
				return 'condition';
		}
	}

	function buildEdges(): Edge[] {
		return doc.transitions.map((t) => ({
			id: t.id,
			source: t.from,
			target: t.to,
			label: edgeLabel(t),
			animated: t.trigger.kind === 'bookEvent',
			selected: t.id === selectedEdgeId,
		}));
	}

	function syncCanvas(): void {
		nodes = buildNodes();
		edges = buildEdges();
	}

	// Seed the canvas once on mount (model is derived, so it's ready synchronously here).
	syncCanvas();

	// --- Authoring interactions -------------------------------------------------

	function place(scene: AvailableScene): void {
		// Stagger new nodes so they don't stack exactly on top of each other.
		const n = model.screens.length;
		commit(addScreen(doc, scene, { x: 80 + (n % 4) * 300, y: 80 + Math.floor(n / 4) * 220 }));
	}

	function onConnect(c: Connection): void {
		if (!c.source || !c.target) return;
		commit(addTransition(doc, c.source, c.target));
	}

	function onNodeDragStop({ targetNode }: { targetNode: Node | null }): void {
		if (!targetNode) return;
		// A drag is a position-only change; coalesce it into one undo step via the burst.
		commit(moveScreen(doc, targetNode.id, targetNode.position));
	}

	function onEdgeClick({ edge }: { edge: Edge }): void {
		selectedEdgeId = edge.id;
		edges = buildEdges();
	}

	function onPaneClick(): void {
		selectedEdgeId = null;
		edges = buildEdges();
	}

	function deleteSelectedEdge(): void {
		if (!selectedEdgeId) return;
		const id = selectedEdgeId;
		selectedEdgeId = null;
		commit(removeTransition(doc, id));
	}

	function applyEdgeEdit(edit: TransitionEdit): void {
		if (!selectedEdgeId) return;
		commit(editTransition(doc, selectedEdgeId, edit));
	}

	let selectedScreenId = $state<string | null>(null);
	// The screen whose choreography sub-editor is open (double-click a node, design doc §9.A).
	let choreoScreenId = $state<string | null>(null);

	// xyflow 1.6 has no node-double-click event, so detect it: two clicks on the SAME node
	// within 350ms opens its choreography sub-editor.
	let lastClickId: string | null = null;
	let lastClickAt = 0;
	function onNodeClick({ node }: { node: Node }): void {
		const now = Date.now();
		if (node.id === lastClickId && now - lastClickAt < 350) {
			openChoreography(node.id);
			lastClickId = null;
			return;
		}
		lastClickId = node.id;
		lastClickAt = now;
		selectedScreenId = node.id;
		selectedEdgeId = null;
		edges = buildEdges();
	}

	function openChoreography(screenId: string): void {
		choreoScreenId = screenId;
	}
	function closeChoreography(): void {
		choreoScreenId = null;
		syncCanvas();
	}

	const choreoScreen = $derived(
		choreoScreenId ? model.screens.find((s) => s.screen.id === choreoScreenId) : undefined,
	);

	function makeInitial(): void {
		if (selectedScreenId) commit(setInitialScreen(doc, selectedScreenId));
	}

	function deleteSelectedScreen(): void {
		if (!selectedScreenId) return;
		const id = selectedScreenId;
		selectedScreenId = null;
		commit(removeScreen(doc, id));
	}

	function undo(): void {
		const prev = history.undo();
		if (prev) apply(prev);
	}
	function redo(): void {
		const next = history.redo();
		if (next) apply(next);
	}

	function onKeydown(e: KeyboardEvent): void {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if (
			mod &&
			(e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
		) {
			e.preventDefault();
			redo();
		}
	}

	async function save(): Promise<void> {
		saving = true;
		saveMsg = '';
		try {
			const res = await fetch('/api/flow/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc }),
			});
			if (!res.ok) {
				saveMsg = `Save failed (${res.status})`;
				return;
			}
			dirty = false;
			saveMsg = 'Saved';
		} catch {
			saveMsg = 'Save failed';
		} finally {
			saving = false;
		}
	}

	const selectedScreen = $derived(
		selectedScreenId ? model.screens.find((s) => s.screen.id === selectedScreenId) : undefined,
	);
	const selectedEdge = $derived(
		selectedEdgeId ? doc.transitions.find((t) => t.id === selectedEdgeId) : undefined,
	);
	const orphanTotal = $derived(model.screens.reduce((n, s) => n + s.orphanedPins.length, 0));
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>Invisible Flow</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="flow"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	/>

	<div class="subbar">
		<strong>Invisible Flow</strong>
		<span class="tag">macro graph</span>
		<button onclick={undo} disabled={!history.canUndo()} title="Undo (Ctrl+Z)">↶ Undo</button>
		<button onclick={redo} disabled={!history.canRedo()} title="Redo (Ctrl+Y)">↷ Redo</button>
		<span class="spacer"></span>
		<span class="count">{model.screens.length} screens · {doc.transitions.length} transitions</span>
		{#if orphanTotal > 0}
			<span class="warn">⚠ {orphanTotal} orphaned pin{orphanTotal === 1 ? '' : 's'}</span>
		{/if}
		{#if saveMsg}<span class="msg">{saveMsg}</span>{/if}
		<button class="save" onclick={save} disabled={saving || !dirty}>
			{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
		</button>
	</div>

	<div class="body">
		<aside class="palette">
			<h3>Screens</h3>
			{#if model.available.length === 0}
				<p class="hint">All screens placed.</p>
			{:else}
				<ul>
					{#each model.available as scene (scene.id)}
						<li>
							<button class="add" onclick={() => place(scene)}>+ {scene.name || scene.id}</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if selectedScreen}
				<div class="inspector">
					<h3>{selectedScreen.screen.label ?? selectedScreen.scene.name}</h3>
					<label class="row">
						<input
							type="checkbox"
							checked={selectedScreen.screen.initial ?? false}
							onchange={makeInitial}
							disabled={selectedScreen.screen.initial ?? false}
						/>
						Initial screen
					</label>
					<button class="choreo" onclick={() => openChoreography(selectedScreen.screen.id)}>
						Edit choreography…
					</button>
					<button class="danger" onclick={deleteSelectedScreen}>Remove screen</button>
				</div>
			{/if}

			{#if selectedEdge}
				<EdgeInspector
					edge={selectedEdge}
					screens={model.screens.map((s) => ({
						id: s.screen.id,
						label: s.screen.label ?? s.scene.name,
					}))}
					onedit={applyEdgeEdit}
					ondelete={deleteSelectedEdge}
				/>
			{/if}
		</aside>

		<div class="canvas">
			{#if model.screens.length === 0 && model.available.length === 0}
				<div class="empty">This project's layout has no screens yet.</div>
			{:else}
				<SvelteFlow
					bind:nodes
					bind:edges
					{nodeTypes}
					fitView
					onconnect={onConnect}
					onnodedragstop={onNodeDragStop}
					onnodeclick={onNodeClick}
					onedgeclick={onEdgeClick}
					onpaneclick={onPaneClick}
				>
					<Background />
					<Controls showLock={false} />
				</SvelteFlow>
			{/if}
		</div>
	</div>

	{#if choreoScreen}
		<ChoreographyEditor
			{doc}
			screenId={choreoScreen.screen.id}
			screenLabel={choreoScreen.screen.label ?? choreoScreen.scene.name}
			vocab={DEFAULT_EMITTER_VOCABULARY}
			oncommit={commit}
			onclose={closeChoreography}
		/>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0e13;
	}
	.subbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-bottom: 1px solid #1f2937;
		color: #cbd5e1;
		font-size: 13px;
	}
	.subbar strong {
		color: #e2e8f0;
	}
	.tag {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		color: #93c5fd;
	}
	.subbar button {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		cursor: pointer;
	}
	.subbar button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.subbar button.save {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	.spacer {
		flex: 1;
	}
	.count {
		color: #94a3b8;
	}
	.warn {
		color: #fdba74;
	}
	.msg {
		color: #86efac;
		font-size: 12px;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.palette {
		width: 240px;
		flex: none;
		border-right: 1px solid #1f2937;
		padding: 12px;
		overflow-y: auto;
		color: #cbd5e1;
		font-size: 13px;
	}
	.palette h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.palette ul {
		list-style: none;
		margin: 0 0 16px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.palette .add {
		width: 100%;
		text-align: left;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #e2e8f0;
		cursor: pointer;
		font-size: 12px;
	}
	.palette .add:hover {
		border-color: #3b82f6;
	}
	.hint {
		color: #64748b;
		font-size: 12px;
	}
	.inspector {
		border-top: 1px solid #1f2937;
		padding-top: 12px;
		margin-top: 4px;
	}
	.inspector .row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 10px;
		font-size: 12px;
	}
	.danger {
		width: 100%;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #5b2a2a;
		background: #1d1416;
		color: #fca5a5;
		cursor: pointer;
		font-size: 12px;
	}
	.choreo {
		width: 100%;
		margin-bottom: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #2563eb;
		background: #14181f;
		color: #bfdbfe;
		cursor: pointer;
		font-size: 12px;
	}
	.canvas {
		flex: 1;
		min-width: 0;
	}
	.canvas :global(.svelte-flow) {
		background: #0b0e13;
	}
	.empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: #64748b;
	}
</style>
