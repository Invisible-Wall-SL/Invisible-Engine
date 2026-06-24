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
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import {
		DEFAULT_CODED_EVENTS,
		DEFAULT_EMITTER_VOCABULARY,
		diffFlowDoc,
		validateFlowDoc,
		type FlowDoc,
		type FlowTransition,
		type FlowTrigger,
		type OrphanSummary,
	} from 'engine-flow';
	import EdgeInspector from './EdgeInspector.svelte';
	import FlowScreenNode from './FlowScreenNode.svelte';
	import ChoreographyEditor from './ChoreographyEditor.svelte';
	import ValidationPanel from './ValidationPanel.svelte';
	import FlowDiffPanel from './FlowDiffPanel.svelte';
	import {
		addScreen,
		addTransition,
		buildFlowModel,
		copyScreens,
		createFlowHistory,
		editTransition,
		moveScreen,
		pasteScreens,
		removeScreen,
		removeTransition,
		setInitialScreen,
		type AvailableScene,
		type FlowClipboard,
		type TransitionEdit,
	} from './flowModel.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The FlowDoc is the single source of truth. Initialize from the loaded doc; every
	// mutation replaces it via a pure command helper and is recorded for undo/redo.
	let doc = $state<FlowDoc>(JSON.parse(JSON.stringify(data.flow)) as FlowDoc);
	let dirty = $state(false);
	let saving = $state(false);
	let saveMsg = $state('');
	let selectedEdgeId = $state<string | null>(null);
	let selectedScreenId = $state<string | null>(null);
	// Palette filter (unplaced scenes) + canvas node-find (placed screens) — Phase 7 search.
	let paletteQuery = $state('');
	let findQuery = $state('');
	// Copy/paste clipboard (Phase 7) — the selected subgraph (screens + internal edges).
	let clipboard: FlowClipboard | null = null;

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

	// Validation (design doc §4/§6, Phase 7): orphaned pins + unreachable / dead-end /
	// no-initial / multiple-initial — surfaced as warnings, never blocking authoring.
	const orphanSummary = $derived<OrphanSummary>(
		Object.fromEntries(model.screens.map((s) => [s.screen.id, s.orphanedPins.length])),
	);
	const issues = $derived(validateFlowDoc(doc, orphanSummary));
	// Screen ids the validation pass flagged — drives the inline node marker.
	const invalidScreenIds = $derived(
		new Set(issues.map((i) => i.screenId).filter((id): id is string => Boolean(id))),
	);

	// Flow-diff vs the coded default (design doc §7, Phase 7): authored vs fall-through.
	const diff = $derived(diffFlowDoc(doc, DEFAULT_CODED_EVENTS));

	// xyflow owns these arrays for live drag/selection; we rebuild them from the doc only
	// on STRUCTURAL changes (add/remove screen+edge, undo/redo), not on every drag frame.
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);

	function buildNodes(): Node[] {
		return model.screens.map((view) => ({
			id: view.screen.id,
			type: 'screen',
			position: view.screen.position ?? { x: 0, y: 0 },
			selected: view.screen.id === selectedScreenId,
			data: {
				label: view.screen.label ?? view.scene.name,
				pins: view.pins,
				orphanCount: view.orphanedPins.length,
				initial: view.screen.initial ?? false,
				invalid: invalidScreenIds.has(view.screen.id),
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

	// Seed the canvas once after mount. Must NOT run during component init — reading the
	// `model` $derived synchronously at top-level throws `state_unsafe_local_read` (Svelte 5).
	onMount(syncCanvas);

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

	// --- Search + node-find (Phase 7) -------------------------------------------

	// Filter the unplaced-scene palette by name/id.
	const filteredAvailable = $derived(
		paletteQuery.trim()
			? model.available.filter((s) =>
					`${s.name} ${s.id}`.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
				)
			: model.available,
	);

	// Placed screens matching the canvas node-find query (by name/id) — jump-to list.
	const findMatches = $derived(
		findQuery.trim()
			? model.screens.filter((s) =>
					`${s.screen.label ?? s.scene.name} ${s.screen.id}`
						.toLowerCase()
						.includes(findQuery.trim().toLowerCase()),
				)
			: [],
	);

	// Select + center a placed screen on the canvas (validation/diff/find click target).
	function focusScreen(screenId: string): void {
		selectedScreenId = screenId;
		selectedEdgeId = null;
		nodes = buildNodes();
		edges = buildEdges();
	}

	// --- Copy / paste subgraphs (Phase 7, design doc §12) -----------------------

	function copySelection(): void {
		if (!selectedScreenId) return;
		clipboard = copyScreens(doc, [selectedScreenId]);
	}

	function pasteClipboard(): void {
		if (!clipboard || clipboard.screens.length === 0) return;
		// A screen's id IS its backing scene id, and a scene is placed at most once. Map
		// each copied screen onto a target scene: re-paste the SAME scene when it's free
		// (e.g. after a cut), else onto the next UNPLACED scene (carrying the choreography).
		const placed = new Set(doc.screens.map((s) => s.id));
		const spare = model.available.map((s) => s.id).filter((id) => !placed.has(id));
		let spareIdx = 0;
		const targetSceneFor = (originalId: string): string | undefined => {
			if (!placed.has(originalId)) return originalId; // scene free — re-paste in place
			return spare[spareIdx++]; // else consume the next unplaced scene
		};
		const { doc: next, pastedIds } = pasteScreens(doc, clipboard, targetSceneFor);
		if (pastedIds.length === 0) return; // nothing free to paste onto
		commit(next);
		selectedScreenId = pastedIds[0];
	}

	function undo(): void {
		const prev = history.undo();
		if (prev) apply(prev);
	}
	function redo(): void {
		const next = history.redo();
		if (next) apply(next);
	}

	// True when the keyboard focus is in a text field — don't hijack Ctrl+C/V/Z there.
	function inTextField(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
	}

	function onKeydown(e: KeyboardEvent): void {
		const mod = e.ctrlKey || e.metaKey;
		const editing = inTextField(e.target);
		if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
			if (editing) return;
			e.preventDefault();
			undo();
		} else if (
			mod &&
			(e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
		) {
			if (editing) return;
			e.preventDefault();
			redo();
		} else if (mod && e.key.toLowerCase() === 'c' && !e.shiftKey) {
			if (editing || !selectedScreenId) return;
			e.preventDefault();
			copySelection();
		} else if (mod && e.key.toLowerCase() === 'v' && !e.shiftKey) {
			if (editing || !clipboard) return;
			e.preventDefault();
			pasteClipboard();
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
		{#if issues.length > 0}
			<span class="warn" title="See the Validation panel"
				>⚠ {issues.length} issue{issues.length === 1 ? '' : 's'}</span
			>
		{/if}
		{#if saveMsg}<span class="msg">{saveMsg}</span>{/if}
		<button class="save" onclick={save} disabled={saving || !dirty}>
			{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
		</button>
	</div>

	<div class="body">
		<aside class="palette">
			<h3>Screens</h3>
			<input
				class="search"
				type="text"
				placeholder="Filter screens…"
				bind:value={paletteQuery}
			/>
			{#if model.available.length === 0}
				<p class="hint">All screens placed.</p>
			{:else if filteredAvailable.length === 0}
				<p class="hint">No screen matches "{paletteQuery}".</p>
			{:else}
				<ul>
					{#each filteredAvailable as scene (scene.id)}
						<li>
							<button class="add" onclick={() => place(scene)}>+ {scene.name || scene.id}</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if model.screens.length > 0}
				<h3>Find on canvas</h3>
				<input
					class="search"
					type="text"
					placeholder="Jump to a placed screen…"
					bind:value={findQuery}
				/>
				{#if findMatches.length > 0}
					<ul>
						{#each findMatches as match (match.screen.id)}
							<li>
								<button class="find" onclick={() => focusScreen(match.screen.id)}>
									{match.screen.label ?? match.scene.name}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
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
					<div class="btnrow">
						<button onclick={copySelection} title="Copy screen + choreography (Ctrl+C)">
							Copy
						</button>
						<button onclick={pasteClipboard} disabled={!clipboard} title="Paste (Ctrl+V)">
							Paste
						</button>
					</div>
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

			{#if model.screens.length > 0}
				<ValidationPanel {issues} onfocus={focusScreen} />
				<FlowDiffPanel {diff} onfocus={focusScreen} />
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
	.palette .search {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 8px;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e1218;
		color: #e2e8f0;
		font-size: 12px;
	}
	.palette .search:focus {
		outline: none;
		border-color: #2563eb;
	}
	.palette .find {
		width: 100%;
		text-align: left;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #11161d;
		color: #cbd5e1;
		cursor: pointer;
		font-size: 12px;
	}
	.palette .find:hover {
		border-color: #3b82f6;
	}
	.btnrow {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
	}
	.btnrow button {
		flex: 1;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		cursor: pointer;
		font-size: 12px;
	}
	.btnrow button:disabled {
		opacity: 0.45;
		cursor: default;
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
	/* Edge transition labels: xyflow's default light pill washes out on the dark
	   canvas. Force a solid dark chip with light text + rounded corners. The label bg is
	   an unclassed SVG <rect> inside the wrapper <g>, so target the rect generically. */
	.canvas :global(.svelte-flow__edge-textwrapper rect) {
		fill: #161b22;
		stroke: #2a323d;
		stroke-width: 1px;
		rx: 5px;
		ry: 5px;
	}
	.canvas :global(.svelte-flow__edge-text) {
		fill: #cbd5e1;
		font-size: 11px;
		font-weight: 500;
	}
	/* Selected edge: lift the chip to the blue accent so the active transition reads. */
	.canvas :global(.svelte-flow__edge.selected .svelte-flow__edge-textwrapper rect) {
		stroke: #2563eb;
	}
	.empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: #64748b;
	}
</style>
