<script lang="ts">
	import { SvelteFlowProvider, type Connection, type Edge, type Node } from '@xyflow/svelte';
	import { onMount } from 'svelte';
	import {
		derivePins,
		validateFlowDoc,
		assignable,
		type FlowDoc,
		type NodeKind,
		type Node as V2Node,
		type Pin,
		type PinContext,
		type PinDir,
	} from 'engine-flow-v2';
	import { BOOK_OF_VOCAB, LIBRARY, SAMPLE_DOC } from './sample';
	import { typeColor } from './palette';
	import {
		addDataEdge,
		addExecEdge,
		addNode,
		deleteFromGraph,
		freshNodeId,
		makeNode,
		moveNode,
	} from './graphOps';
	import FlowV2Node from './FlowV2Node.svelte';
	import FlowCanvasV2 from './FlowCanvasV2.svelte';
	import AddNodePalette from './AddNodePalette.svelte';
	import ValidationPanelV2 from './ValidationPanelV2.svelte';
	import NodeInspector from './NodeInspector.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The FlowDoc is the single source of truth. It initializes from the project's saved v2
	// FlowDoc (loaded server-side from R2 at `flowV2DocKey`); when the project has none — or
	// this is the standalone dev route with no project — the server sends `doc: null` and we
	// fall back to the built-in `SAMPLE_DOC`. Every editing gesture (wire/add/delete/move/drop)
	// mutates this and triggers the debounced auto-save below.
	//
	// NOTE (out of scope, later increment): the template VOCABULARY (`BOOK_OF_VOCAB`) and the
	// shared FUNCTION LIBRARY (`LIBRARY`) still come from `sample.ts` — only the FlowDoc persists.
	const initialDoc = (data.doc ?? SAMPLE_DOC) as FlowDoc;
	let doc = $state<FlowDoc>(JSON.parse(JSON.stringify(initialDoc)) as FlowDoc);

	const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY };

	let selectedNodeId = $state<string | null>(null);

	// The selected node object (or null) — drives the inspector in the left panel. Reads the
	// live `doc` so an inspector edit that replaces the doc re-renders it with fresh fields.
	const selectedNode = $derived<V2Node | null>(
		selectedNodeId ? (doc.graph.nodes.find((n) => n.id === selectedNodeId) ?? null) : null,
	);

	// An inspector edit hands back the next `FlowDoc` (from a `graphOps` setter). Replace the
	// source-of-truth `doc`, re-seed the xyflow arrays (so derived pins/edge colors refresh),
	// and mark dirty (revalidate live + autosave — same contract as the wiring gestures).
	function applyDocEdit(next: FlowDoc): void {
		doc = next;
		syncCanvas();
		markDirty();
	}

	// The node types the canvas knows — one generic v2 node that derives its own pins.
	const nodeTypes = { v2: FlowV2Node };

	// A human title for a node (its ref, else its kind) shown in the node header.
	const nodeTitle = (n: V2Node): string => {
		switch (n.kind) {
			case 'event':
			case 'action':
			case 'fireCue':
				return n.ref;
			case 'functionCall': {
				const fn = LIBRARY.functions.find((f) => f.id === n.ref);
				return fn?.name ?? n.ref;
			}
			case 'showContainer':
			case 'hideContainer':
				return n.ref;
			default:
				return n.kind;
		}
	};

	// Validation runs reactively over the live doc — 2b editing revalidates for free.
	const issues = $derived(validateFlowDoc(doc, BOOK_OF_VOCAB, LIBRARY));

	// The derived pins per node, indexed once — used to type-color data edges by the SOURCE
	// pin's `TypeRef` (the wire reads the same color as the dot it leaves).
	const pinsByNode = $derived(
		new Map<string, Pin[]>(doc.graph.nodes.map((n) => [n.id, derivePins(n, ctx)])),
	);

	// xyflow owns these arrays for live drag/selection; we rebuild them from the doc on
	// structural changes (selection, doc replace). Reading the `$derived` at top-level init
	// would throw `state_unsafe_local_read` (Svelte 5), so seed on mount (mirrors /flow).
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);

	function buildNodes(): Node[] {
		return doc.graph.nodes.map((n) => ({
			id: n.id,
			type: 'v2',
			position: n.pos,
			selected: n.id === selectedNodeId,
			deletable: true,
			data: { node: n, ctx, title: nodeTitle(n) },
		}));
	}

	// Exec wires: white, thicker control edges with an arrowhead. Data wires: thin, colored
	// by the SOURCE data pin's `TypeRef` (mirroring the spike's type palette).
	const EXEC_COLOR = '#e2e8f0';

	function dataEdgeColor(fromNode: string, fromPin: string): string {
		const pin = pinsByNode.get(fromNode)?.find((p) => p.id === fromPin && p.dir === 'out');
		return pin?.dataType ? typeColor(pin.dataType) : '#94a3b8';
	}

	function buildEdges(): Edge[] {
		const exec: Edge[] = doc.graph.exec.map((e, i) => ({
			id: `exec-${i}`,
			source: e.from.node,
			target: e.to.node,
			sourceHandle: e.from.pin,
			targetHandle: e.to.pin,
			deletable: true,
			style: `stroke:${EXEC_COLOR}; stroke-width:2.25`,
			class: 'v2-exec',
			markerEnd: { type: 'arrowclosed', color: EXEC_COLOR },
		}));
		const data: Edge[] = doc.graph.data.map((e, i) => {
			const color = dataEdgeColor(e.from.node, e.from.pin);
			return {
				id: `data-${i}`,
				source: e.from.node,
				target: e.to.node,
				sourceHandle: e.from.pin,
				targetHandle: e.to.pin,
				deletable: true,
				style: `stroke:${color}; stroke-width:1.25`,
				class: 'v2-data',
			};
		});
		return [...exec, ...data];
	}

	function syncCanvas(): void {
		nodes = buildNodes();
		edges = buildEdges();
	}

	onMount(syncCanvas);

	// --- Persistence: debounced auto-save to R2 (Phase 2a persistence) ----------
	// Mirrors the Scene Editor's autosave feel: a mutation marks the doc dirty, which (re)starts
	// an ~800ms debounce; when it fires we POST the current doc to `/api/flow-v2/save` (which
	// gates on the `flow` tool + session-bound project and writes `flowV2DocKey`). Only a REAL
	// project persists — the standalone dev sample (server sent `doc: null`) is never saved.
	const AUTOSAVE_MS = 800;
	const hasProject = data.doc !== null;
	type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
	let saveStatus = $state<SaveStatus>('idle');
	let dirty = $state(false);

	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

	// Every editing gesture calls this after mutating `doc`. It arms the debounce; a fresh
	// gesture within the window resets it (coalescing a burst of edits into one save).
	function markDirty(): void {
		if (!hasProject) return; // standalone sample — never persist.
		dirty = true;
		if (autosaveTimer) clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(() => {
			autosaveTimer = null;
			void saveDoc();
		}, AUTOSAVE_MS);
	}

	let pendingSave = false;
	async function saveDoc(): Promise<void> {
		if (saveStatus === 'saving') {
			// Coalesce: the in-flight save's `finally` re-triggers if still dirty.
			pendingSave = true;
			return;
		}
		saveStatus = 'saving';
		try {
			const res = await fetch('/api/flow-v2/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc }),
			});
			if (!res.ok) throw new Error(`save failed (${res.status})`);
			dirty = false;
			saveStatus = 'saved';
		} catch {
			saveStatus = 'error';
		} finally {
			if (pendingSave) {
				pendingSave = false;
				if (dirty) void saveDoc();
			}
		}
	}

	function onNodeClick({ node }: { node: Node }): void {
		selectedNodeId = node.id;
		nodes = buildNodes();
	}
	function onPaneClick(): void {
		selectedNodeId = null;
		nodes = buildNodes();
	}

	// Issue click → select + re-seed so the node highlights (best-effort focus).
	function focusNode(nodeId: string): void {
		selectedNodeId = nodeId;
		nodes = buildNodes();
	}

	// --- Editing (Phase 2b.1) ---------------------------------------------------
	// Every gesture mutates the `doc` `$state` (the single source of truth) via a pure
	// `graphOps` op, then `syncCanvas()` re-seeds the xyflow arrays. `derivePins` +
	// the `$derived` `validateFlowDoc` react for free — the panel updates live.

	// The pins of a node, memoized per gesture (the `$derived` `pinsByNode` is for edge
	// coloring; connect/validate need a fresh lookup that also disambiguates exec by dir).
	function pinsOf(nodeId: string): Pin[] {
		const node = doc.graph.nodes.find((n) => n.id === nodeId);
		return node ? derivePins(node, ctx) : [];
	}

	// A node's exec-in and exec-out share the id `exec`; a lookup must disambiguate by
	// direction (mirrors the validator's `pinOf`). `handle` may be null on a bare-node drop.
	function pinByHandle(nodeId: string, handle: string | null, dir: PinDir): Pin | undefined {
		if (handle === null) return undefined;
		return pinsOf(nodeId).find((p) => p.id === handle && p.dir === dir);
	}

	// True iff any data edge already feeds the given (node,pin) data-in (fan-in = 1).
	function dataInTaken(nodeId: string, pin: string): boolean {
		return doc.graph.data.some((e) => e.to.node === nodeId && e.to.pin === pin);
	}
	// True iff any exec edge already feeds the given (node,pin) exec-in (fan-in = 1).
	function execInTaken(nodeId: string, pin: string): boolean {
		return doc.graph.exec.some((e) => e.to.node === nodeId && e.to.pin === pin);
	}

	// Strict connect-time gate (Unreal-style: an incompatible wire simply won't drop). Rejects
	// exec↔data mismatch, wrong direction, non-assignable data types, and fan-in violations.
	// `validateFlowDoc` stays the backstop for any doc loaded with pre-existing issues.
	function isValidConnection(edge: Edge | Connection): boolean {
		const source = edge.source;
		const target = edge.target;
		const sourceHandle = edge.sourceHandle ?? null;
		const targetHandle = edge.targetHandle ?? null;
		if (!source || !target) return false;

		const out = pinByHandle(source, sourceHandle, 'out');
		const inn = pinByHandle(target, targetHandle, 'in');
		if (!out || !inn) return false; // wrong direction or unknown handle.
		if (out.kind !== inn.kind) return false; // exec↔data mismatch.

		if (out.kind === 'exec') {
			return !execInTaken(target, inn.id); // exec-in fan-in = 1.
		}
		// data: types must be assignable AND the target data-in must be free.
		if (out.dataType && inn.dataType && !assignable(out.dataType, inn.dataType)) return false;
		return !dataInTaken(target, inn.id);
	}

	// A new connection → push the matching edge class, then re-seed. Guarded again by the same
	// checks (isValidConnection already ran, but stay defensive against direct-call paths).
	function onConnect(c: Connection): void {
		const sourceHandle = c.sourceHandle ?? null;
		const targetHandle = c.targetHandle ?? null;
		if (!c.source || !c.target || sourceHandle === null || targetHandle === null) return;
		const out = pinByHandle(c.source, sourceHandle, 'out');
		const inn = pinByHandle(c.target, targetHandle, 'in');
		if (!out || !inn || out.kind !== inn.kind) return;

		doc =
			out.kind === 'exec'
				? addExecEdge(
						doc,
						{ node: c.source, pin: sourceHandle },
						{ node: c.target, pin: targetHandle },
					)
				: addDataEdge(
						doc,
						{ node: c.source, pin: sourceHandle },
						{ node: c.target, pin: targetHandle },
					);
		syncCanvas();
		markDirty();
	}

	// Delete (Delete/Backspace on selection): remove nodes + their incident edges + any
	// explicitly-deleted edges, in one doc change, then re-seed. Clears a stale selection.
	function onGraphDelete({ nodes: dn, edges: de }: { nodes: Node[]; edges: Edge[] }): void {
		if (!dn?.length && !de?.length) return;
		const nodeIds = dn.map((n) => n.id);
		const edgeIds = de.map((e) => e.id);
		if (selectedNodeId && nodeIds.includes(selectedNodeId)) selectedNodeId = null;
		doc = deleteFromGraph(doc, nodeIds, edgeIds);
		syncCanvas();
		markDirty();
	}

	// Move (drag-stop only — kept cheap, not per-frame): write the new position back.
	function onNodeDragStop({ targetNode }: { targetNode: Node | null }): void {
		if (!targetNode) return;
		doc = moveNode(doc, targetNode.id, targetNode.position);
		syncCanvas();
		markDirty();
	}

	// Add a node at an explicit doc-space position — the PRIMARY path: the palette entry is
	// dragged onto the canvas, whose `drop` handler maps the cursor via `screenToFlowPosition`
	// (only reachable inside the flow's own context, hence `FlowCanvasV2` + `SvelteFlowProvider`)
	// and calls this with the resolved position. Reuses `graphOps` for the actual creation.
	function addNodeAt(kind: NodeKind, ref: string | undefined, pos: { x: number; y: number }): void {
		const id = freshNodeId(doc, kind);
		doc = addNode(doc, makeNode(kind, id, pos, ref));
		selectedNodeId = id;
		syncCanvas();
		markDirty();
	}

	// Place an added node in doc-space near the CENTROID of the existing graph, nudged by a
	// small staggered offset so successive adds don't stack exactly. Used by the click FALLBACK
	// (clicking a palette entry, when there's no drop point to map).
	function placementPos(): { x: number; y: number } {
		const ns = doc.graph.nodes;
		if (ns.length === 0) return { x: 200, y: 160 };
		const cx = ns.reduce((s, n) => s + n.pos.x, 0) / ns.length;
		const cy = ns.reduce((s, n) => s + n.pos.y, 0) / ns.length;
		const k = ns.length % 6;
		return { x: Math.round(cx + 40 + k * 28), y: Math.round(cy + 40 + k * 28) };
	}

	function addNodeOfKind(kind: NodeKind, ref?: string): void {
		addNodeAt(kind, ref, placementPos());
	}
</script>

<svelte:head><title>Invisible Flow v2 · dev</title></svelte:head>

<div class="page">
	<div class="subbar">
		<strong>Invisible Flow v2</strong>
		<span class="tag">dev</span>
		<span class="scope" title="Active client / project this canvas persists to">
			{data.clientKey} / {data.projectKey}
		</span>
		<span class="legend">
			<span class="key exec">▷ exec</span>
			<span class="key data">● data</span>
		</span>
		<span class="spacer"></span>
		{#if hasProject}
			{#if saveStatus === 'saving'}
				<span class="save-pill busy">Saving…</span>
			{:else if saveStatus === 'error'}
				<button class="save-pill error" type="button" onclick={() => void saveDoc()}
					>Save failed — retry</button
				>
			{:else if dirty}
				<span class="save-pill dirty">Unsaved changes</span>
			{:else}
				<span class="save-pill ok">Saved</span>
			{/if}
		{:else}
			<span class="save-pill ok" title="Standalone dev sample — no project bound, not persisted"
				>sample · not saved</span
			>
		{/if}
		<span class="count">
			{doc.graph.nodes.length} nodes · {doc.graph.exec.length} exec · {doc.graph.data.length} data
		</span>
		{#if issues.length > 0}
			<span class="warn" title="See the Validation panel"
				>⚠ {issues.length} issue{issues.length === 1 ? '' : 's'}</span
			>
		{:else}
			<span class="valid">✓ valid</span>
		{/if}
	</div>

	<div class="body">
		<aside class="side">
			{#if selectedNode}
				<div class="inspector-head">
					<h3>Inspector</h3>
					<button class="close" type="button" onclick={onPaneClick} title="Deselect (show palette)"
						>✕</button
					>
				</div>
				<NodeInspector {doc} node={selectedNode} {ctx} onchange={applyDocEdit} />
			{:else}
				<h3>Flow v2 · dev</h3>
				<p class="hint">
					Editable canvas (Phase 2b.2). Template <code>{doc.templateId}</code>. Pins are
					<strong>derived</strong> from the vocabulary — drag between them to wire; incompatible wires
					won't drop. Select a node to edit its fields; Delete removes selection.
				</p>
				<AddNodePalette vocab={BOOK_OF_VOCAB} library={LIBRARY} {doc} onadd={addNodeOfKind} />
			{/if}
			<ValidationPanelV2 {issues} onfocus={focusNode} />
		</aside>

		<SvelteFlowProvider>
			<FlowCanvasV2
				bind:nodes
				bind:edges
				{nodeTypes}
				{isValidConnection}
				{onConnect}
				{onGraphDelete}
				{onNodeDragStop}
				{onNodeClick}
				{onPaneClick}
				ondropnode={addNodeAt}
			/>
		</SvelteFlowProvider>
	</div>
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
	.scope {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #11161d;
		border: 1px solid #1f2937;
		color: #94a3b8;
	}
	.save-pill {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #1f2937;
		background: #16161c;
		color: #888;
		letter-spacing: 0.02em;
	}
	.save-pill.busy {
		color: #7ee0c0;
		border-color: #234038;
	}
	.save-pill.dirty {
		color: #f0c878;
		border-color: #3a3020;
	}
	.save-pill.error {
		color: #ff9a9a;
		border-color: #4a2a30;
		cursor: pointer;
		font: inherit;
	}
	.save-pill.ok {
		color: #86efac;
	}
	.legend {
		display: inline-flex;
		gap: 6px;
	}
	.legend .key {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 4px;
		border: 1px solid #2a323d;
	}
	.legend .key.exec {
		color: #e2e8f0;
		border-color: #3a4655;
	}
	.legend .key.data {
		color: #38bdf8;
		border-color: #1e4a5f;
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
	.valid {
		color: #86efac;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.side {
		width: 260px;
		flex: none;
		border-right: 1px solid #1f2937;
		padding: 12px;
		overflow-y: auto;
		color: #cbd5e1;
		font-size: 13px;
	}
	.side h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.inspector-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.inspector-head h3 {
		margin: 0;
	}
	.close {
		font-size: 11px;
		line-height: 1;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #94a3b8;
		cursor: pointer;
	}
	.close:hover {
		border-color: #3a4655;
		color: #e2e8f0;
	}
	.hint {
		color: #64748b;
		font-size: 12px;
		line-height: 1.5;
	}
	.hint code {
		color: #93c5fd;
		background: #11161d;
		padding: 1px 4px;
		border-radius: 4px;
	}
	/* The canvas + its flow-edge styling now live in FlowCanvasV2 (extracted so it can call
	   `useSvelteFlow` inside the provider). The `.body` flex row still sizes it via `flex: 1`. */
</style>
