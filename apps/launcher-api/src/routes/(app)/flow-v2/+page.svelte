<script lang="ts">
	import { SvelteFlowProvider, type Connection, type Edge, type Node } from '@xyflow/svelte';
	import { onMount } from 'svelte';
	import {
		collapseToFunction,
		derivePins,
		templateVocabulary,
		validateFlowDoc,
		validateFunctionDef,
		assignable,
		type ContainerEventDecl,
		type FlowComment,
		type FlowDoc,
		type FunctionDef,
		type FunctionLibraryDoc,
		type Graph,
		type NodeKind,
		type Node as V2Node,
		type Pin,
		type PinContext,
		type PinDir,
	} from 'engine-flow-v2';
	import { LIBRARY, SAMPLE_CONTAINER_EVENTS, SAMPLE_DOC } from './sample';
	import { typeColor } from './palette';
	import {
		addDataEdgeIn,
		addExecEdgeIn,
		addNodeIn,
		deleteFromGraphIn,
		freshNodeIdIn,
		makeNode,
		moveNodeIn,
	} from './graphOps';
	import FlowV2Node from './FlowV2Node.svelte';
	import CommentNode from './CommentNode.svelte';
	import FlowCanvasV2 from './FlowCanvasV2.svelte';
	import AddNodePalette from './AddNodePalette.svelte';
	import ValidationPanelV2 from './ValidationPanelV2.svelte';
	import PreviewPanelV2 from './PreviewPanelV2.svelte';
	import NodeInspector from './NodeInspector.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The FlowDoc is the single source of truth. It initializes from the project's saved v2
	// FlowDoc (loaded server-side from R2 at `flowV2DocKey`); when the project has none — or
	// this is the standalone dev route with no project — the server sends `doc: null` and we
	// fall back to the built-in `SAMPLE_DOC`. Every editing gesture (wire/add/delete/move/drop)
	// mutates this and triggers the debounced auto-save below.
	//
	// The template VOCABULARY (`BOOK_OF_VOCAB`) is the SHARED, single-source-of-truth contract
	// shipped from `engine-flow-v2` (Phase 4c) — the SAME vocab the apps/lines runtime backs —
	// re-exported through `sample.ts` so this import is unchanged. The shared FUNCTION LIBRARY
	// PERSISTS (Part 2c): it initializes from the GLOBAL `_shared/flow-v2/functions.json`
	// (`data.library`), falling back to the sample `LIBRARY` when absent, and grows via the
	// "Collapse to Function" gesture below.
	const initialDoc = (data.doc ?? SAMPLE_DOC) as FlowDoc;
	let doc = $state<FlowDoc>(JSON.parse(JSON.stringify(initialDoc)) as FlowDoc);

	// The live function library — the single source of truth for the palette's Functions section,
	// the inspector's functionCall ref dropdown, and `derivePins` on functionCall nodes. Held in
	// `$state` and threaded through `ctx` (below) so collapsing a selection immediately surfaces
	// the new function everywhere.
	const initialLibrary = (data.library ?? LIBRARY) as FunctionLibraryDoc;
	let library = $state<FunctionLibraryDoc>(
		JSON.parse(JSON.stringify(initialLibrary)) as FunctionLibraryDoc,
	);

	// The template VOCABULARY is resolved from the doc's `templateId` via the shared registry
	// (Phase — per-project vocab loading), not hardcoded — so a future template is a data change.
	// Only `book-of` exists today; an unknown id falls back to it (registry-side).
	const vocab = $derived(templateVocabulary(doc.templateId));

	// §6.1 — the container-event surface (ContainerId → its configured component-event decls). On a
	// real project the server projects the actual Scene-Editor scenes (`data.containerEvents`); on the
	// standalone dev route (server sent `doc: null`) we fall back to the sample surface so the fused
	// exec-out pins still demonstrate. Threaded through `ctx` below so `derivePins` fuses them onto the
	// matching `showContainer` node, and into `validateFlowDoc` (4th arg) + the preview.
	const containerEvents = $derived<Record<string, ContainerEventDecl[]>>(
		data.doc === null ? SAMPLE_CONTAINER_EVENTS : (data.containerEvents ?? {}),
	);

	// `ctx` reads the LIVE `library` state (a getter, not a snapshot), so every consumer —
	// `derivePins`, `validateFlowDoc`, the palette, the inspector — sees the current library. It also
	// carries the container-event surface so a `showContainer` node fuses its component events (§6.1).
	const ctx = $derived<PinContext>({ vocab, library, containerEvents });

	// --- The editing TARGET (2c.3) ---------------------------------------------
	// The canvas + all tools edit an "active graph": either the main `FlowDoc.graph` or a
	// `FunctionDef.body`. `view` names which; `activeGraph` resolves it. Every editing handler
	// reads/writes the active graph via `applyGraphEdit` (below), which routes the write back to
	// the right target + arms the matching autosave. Default is the main flow (`{ kind: 'flow' }`).
	type FlowView = { kind: 'flow' } | { kind: 'function'; functionId: string };
	let view = $state<FlowView>({ kind: 'flow' });

	// The FunctionDef currently open in function view (or null when in flow view / it vanished).
	const activeFn = $derived<FunctionDef | null>(
		view.kind === 'function'
			? (library.functions.find((f) => f.id === view.functionId) ?? null)
			: null,
	);

	// The graph the canvas + tools operate on. In flow view it is `doc.graph`; in function view it
	// is the open function's `body`. Falls back to the flow graph if the function is gone (guarded
	// by the effect below that snaps `view` back to flow when its function disappears).
	const activeGraph = $derived<Graph>(
		view.kind === 'function' ? (activeFn?.body ?? doc.graph) : doc.graph,
	);

	// If the open function is deleted (or otherwise vanishes), return to the flow view so the
	// canvas never edits a dangling graph.
	$effect(() => {
		if (view.kind === 'function' && !activeFn) view = { kind: 'flow' };
	});

	// A monotonically-bumped signal that tells the canvas to re-fit the view (on a target switch).
	let fitSignal = $state(0);

	// Write an edited `Graph` back to whichever target is active, and arm the matching autosave:
	//  - flow view     → replace `doc.graph`,               `markDirty()`.
	//  - function view → replace `library.functions[i].body`, `markLibraryDirty()`.
	// Then re-seed the canvas (derived pins / edge colors refresh). The single write-back path
	// that keeps main-flow editing byte-for-byte unchanged while enabling body editing.
	function applyGraphEdit(nextGraph: Graph): void {
		if (view.kind === 'function') {
			const fnId = view.functionId;
			library = {
				...library,
				functions: library.functions.map((f) => (f.id === fnId ? { ...f, body: nextGraph } : f)),
			};
			syncCanvas();
			markLibraryDirty();
		} else {
			doc = { ...doc, graph: nextGraph };
			syncCanvas();
			markDirty();
		}
	}

	let selectedNodeId = $state<string | null>(null);

	// The selected node object (or null) — drives the inspector in the left panel. Reads the
	// ACTIVE graph so an inspector edit re-renders it with fresh fields in either view.
	const selectedNode = $derived<V2Node | null>(
		selectedNodeId ? (activeGraph.nodes.find((n) => n.id === selectedNodeId) ?? null) : null,
	);

	// The inspector is handed a SYNTHETIC doc whose `graph` is the active graph, so its existing
	// doc-level setters keep working in both views. Its `onchange(nextDoc)` hands back a full doc;
	// we extract `.graph` and route it through `applyGraphEdit` (which writes to the right target).
	const inspectorDoc = $derived<FlowDoc>({ ...doc, graph: activeGraph });

	// The palette reads `doc` only for its `containers` (the show/hide-container entries). A
	// function body has no containers, so in function view we hand it a container-less doc — a
	// body must not offer showContainer/hideContainer nodes (they'd never resolve there).
	const paletteDoc = $derived<FlowDoc>(
		view.kind === 'function' ? { ...inspectorDoc, containers: [] } : inspectorDoc,
	);

	function applyDocEdit(next: FlowDoc): void {
		applyGraphEdit(next.graph);
	}

	// The node types the canvas knows — the generic v2 node (derives its own pins) + the editor-only
	// comment/group box (a `FlowComment`, drawn behind the graph; the runtime ignores it).
	const nodeTypes = { v2: FlowV2Node, comment: CommentNode };

	// --- Comment / group boxes (editor-only annotations on `doc.comments`) -------
	// Mutating a comment re-seeds the canvas and arms the SAME autosave as a graph edit, so the boxes
	// persist in `editor/flow-v2.json` (which the runtime carries but never reads). Flow view only —
	// function bodies have no comments.
	function updateComment(id: string, patch: Partial<FlowComment>): void {
		doc = {
			...doc,
			comments: (doc.comments ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
		};
		syncCanvas();
		markDirty();
	}

	function addComment(): void {
		const id = `comment_${Date.now().toString(36)}_${(doc.comments ?? []).length}`;
		const PAD = 40;
		const HEAD = 46; // extra top room for the box's header bar
		// If nodes are selected, WRAP the selection: size the box to their bounding box + padding and
		// leave the nodes exactly where they are (the padded perimeter is empty ⇒ grabbable). Otherwise
		// drop a default box in OPEN SPACE above the graph, so a fresh box isn't buried under the nodes.
		const sel = nodes.filter((nd) => nd.selected && nd.type !== 'comment');
		let c: FlowComment;
		if (sel.length) {
			let minX = Infinity,
				minY = Infinity,
				maxX = -Infinity,
				maxY = -Infinity;
			for (const nd of sel) {
				const w = nd.measured?.width ?? nd.width ?? 200;
				const h = nd.measured?.height ?? nd.height ?? 120;
				minX = Math.min(minX, nd.position.x);
				minY = Math.min(minY, nd.position.y);
				maxX = Math.max(maxX, nd.position.x + w);
				maxY = Math.max(maxY, nd.position.y + h);
			}
			c = {
				id,
				label: '',
				x: Math.round(minX - PAD),
				y: Math.round(minY - PAD - HEAD),
				width: Math.round(maxX - minX + PAD * 2),
				height: Math.round(maxY - minY + PAD * 2 + HEAD),
			};
		} else {
			const ns = activeGraph.nodes;
			const x = ns.length ? Math.min(...ns.map((nd) => nd.pos.x)) : 200;
			const y = (ns.length ? Math.min(...ns.map((nd) => nd.pos.y)) : 160) - 300;
			c = { id, label: '', x: Math.round(x), y: Math.round(y), width: 360, height: 220 };
		}
		doc = { ...doc, comments: [...(doc.comments ?? []), c] };
		syncCanvas();
		markDirty();
	}

	function deleteComments(ids: string[]): void {
		if (!ids.length) return;
		const drop = new Set(ids);
		doc = { ...doc, comments: (doc.comments ?? []).filter((c) => !drop.has(c.id)) };
		syncCanvas();
		markDirty();
	}

	// Map a container ref → its Scene Editor friendly NAME (e.g. `hud_kv04zk3j` → "HUD - Bottom BAR"),
	// via the container's `sceneId`. Falls back to the raw id when the name is unknown (unsaved /
	// standalone project). The raw id still shows small in the node body (`refLine` in FlowV2Node).
	const containerLabel = (ref: string): string => {
		const sceneId = doc.containers.find((c) => c.id === ref)?.sceneId ?? ref;
		return data.sceneNames?.[sceneId] ?? data.sceneNames?.[ref] ?? ref;
	};

	// A human title for a node (its ref, else its kind) shown in the node header.
	const nodeTitle = (n: V2Node): string => {
		switch (n.kind) {
			case 'event':
			case 'action':
			case 'fireCue':
				return n.ref;
			case 'functionCall': {
				const fn = library.functions.find((f) => f.id === n.ref);
				return fn?.name ?? n.ref;
			}
			case 'showContainer':
			case 'hideContainer':
				return containerLabel(n.ref);
			case 'functionEntry':
				return 'Entry';
			case 'functionResult':
				return 'Result';
			case 'gameSignals':
				return 'Game Signals';
			default:
				return n.kind;
		}
	};

	// Validation runs reactively over the ACTIVE graph: the main flow via `validateFlowDoc`, a
	// function body via `validateFunctionDef` (entry/result are legal there). The panel shows the
	// active graph's issues; the subbar count/valid pill follow suit.
	const issues = $derived(
		view.kind === 'function' && activeFn
			? validateFunctionDef(activeFn, vocab, library)
			: validateFlowDoc(doc, vocab, library, containerEvents),
	);

	// The derived pins per node, indexed once — used to type-color data edges by the SOURCE
	// pin's `TypeRef` (the wire reads the same color as the dot it leaves). Over the active graph.
	const pinsByNode = $derived(
		new Map<string, Pin[]>(activeGraph.nodes.map((n) => [n.id, derivePins(n, ctx)])),
	);

	// xyflow owns these arrays for live drag/selection; we rebuild them from the doc on
	// structural changes (selection, doc replace). Reading the `$derived` at top-level init
	// would throw `state_unsafe_local_read` (Svelte 5), so seed on mount (mirrors /flow).
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);

	// The function's entry/result nodes are the body's FIXED signature (§5) — they carry the
	// function's declared pins. Editing a body rewires INTERNAL logic only, so they are never
	// deletable. (Adding/removing function inputs/outputs — which WOULD change these — is a later
	// feature.)
	const isSignatureNode = (n: V2Node): boolean =>
		n.kind === 'functionEntry' || n.kind === 'functionResult';

	function buildNodes(): Node[] {
		const graphNodes: Node[] = activeGraph.nodes.map((n) => ({
			id: n.id,
			type: 'v2',
			position: n.pos,
			selected: n.id === selectedNodeId,
			deletable: !isSignatureNode(n),
			zIndex: 1,
			data: { node: n, ctx, title: nodeTitle(n) },
		}));
		// Comment/group boxes. Flow view only — function bodies carry no comments. Listed FIRST so at
		// the SAME zIndex as the graph nodes they paint BEHIND them (DOM order) while still sitting
		// ABOVE the selection pane (which is also z 1) so the box is clickable. NodeResizer mutates the
		// size; `updateComment` persists it on resize-end.
		const commentNodes: Node[] =
			view.kind === 'flow'
				? (doc.comments ?? []).map((c) => ({
						id: c.id,
						type: 'comment',
						position: { x: c.x, y: c.y },
						// Track selection like the graph nodes — `onNodeClick` rebuilds the whole array via
						// buildNodes, so WITHOUT this a click rebuilds the box DESELECTED (the "can't select the
						// box" bug that only surfaces in the full page, not an isolated probe).
						selected: c.id === selectedNodeId,
						// Size via `style` ONLY. Setting BOTH `width`/`height` AND `style` fights xyflow's
						// controlled-dimensions logic and spins an infinite measure loop that FREEZES the whole
						// canvas (nothing grabbable) — the bug behind "can't select/drag the box". Verified in a
						// live probe: style-only is fully selectable / draggable / resizable.
						style: `width:${c.width}px;height:${c.height}px`,
						draggable: true,
						selectable: true,
						deletable: true,
						// z 1 (like the graph nodes) keeps the box above the z-1 selection pane so clicks land
						// on it; first-in-array keeps it painted behind the nodes. Selecting elevates it (xyflow
						// default); the translucent fill keeps the nodes visible through it.
						zIndex: 1,
						data: {
							comment: c,
							onchange: (patch: Partial<FlowComment>) => updateComment(c.id, patch),
						},
					}))
				: [];
		return [...commentNodes, ...graphNodes];
	}

	// Exec wires: white, thicker control edges with an arrowhead. Data wires: thin, colored
	// by the SOURCE data pin's `TypeRef` (mirroring the spike's type palette).
	const EXEC_COLOR = '#e2e8f0';

	function dataEdgeColor(fromNode: string, fromPin: string): string {
		const pin = pinsByNode.get(fromNode)?.find((p) => p.id === fromPin && p.dir === 'out');
		return pin?.dataType ? typeColor(pin.dataType) : '#94a3b8';
	}

	function buildEdges(): Edge[] {
		const exec: Edge[] = activeGraph.exec.map((e, i) => ({
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
		const data: Edge[] = activeGraph.data.map((e, i) => {
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

	// --- Persistence: debounced auto-save for the shared FUNCTION LIBRARY --------
	// The library is GLOBAL (not project-scoped), but we still only persist when a flow scope
	// exists (`hasProject`) — the standalone dev sample must not write the shared library. A
	// mutation (only "Collapse to Function" today) calls `markLibraryDirty`, which debounces a
	// POST to `/api/flow-v2/library/save` writing the fixed `_shared/flow-v2/functions.json`.
	let librarySaveStatus = $state<SaveStatus>('idle');
	let libraryDirty = $state(false);
	let libraryAutosaveTimer: ReturnType<typeof setTimeout> | null = null;

	function markLibraryDirty(): void {
		if (!hasProject) return; // standalone sample — never persist the shared library.
		libraryDirty = true;
		if (libraryAutosaveTimer) clearTimeout(libraryAutosaveTimer);
		libraryAutosaveTimer = setTimeout(() => {
			libraryAutosaveTimer = null;
			void saveLibrary();
		}, AUTOSAVE_MS);
	}

	let pendingLibrarySave = false;
	async function saveLibrary(): Promise<void> {
		if (librarySaveStatus === 'saving') {
			pendingLibrarySave = true;
			return;
		}
		librarySaveStatus = 'saving';
		try {
			const res = await fetch('/api/flow-v2/library/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ library }),
			});
			if (!res.ok) throw new Error(`library save failed (${res.status})`);
			libraryDirty = false;
			librarySaveStatus = 'saved';
		} catch {
			librarySaveStatus = 'error';
		} finally {
			if (pendingLibrarySave) {
				pendingLibrarySave = false;
				if (libraryDirty) void saveLibrary();
			}
		}
	}

	// xyflow 1.6 has no node-double-click event, so detect it (mirrors v1 /flow): two clicks on
	// the SAME node within 350ms of a `functionCall` OPENS its body for editing (2c.3).
	let lastClickId: string | null = null;
	let lastClickAt = 0;
	function onNodeClick({ node }: { node: Node }): void {
		const now = Date.now();
		if (node.id === lastClickId && now - lastClickAt < 350) {
			lastClickId = null;
			const model = activeGraph.nodes.find((n) => n.id === node.id);
			if (model?.kind === 'functionCall') {
				openFunction(model.ref);
				return;
			}
		}
		lastClickId = node.id;
		lastClickAt = now;
		selectedNodeId = node.id;
		nodes = buildNodes();
	}
	function onPaneClick(): void {
		selectedNodeId = null;
		nodes = buildNodes();
	}

	// --- View navigation (2c.3): open a function body / return to the flow -------
	// Switch the editing TARGET. Clearing the selection + bumping `fitSignal` re-frames the new
	// graph; `syncCanvas` re-seeds the canvas arrays from the now-active graph.
	function openFunction(functionId: string): void {
		if (!library.functions.some((f) => f.id === functionId)) return;
		view = { kind: 'function', functionId };
		selectedNodeId = null;
		lastClickId = null;
		fitSignal += 1;
		syncCanvas();
	}
	function backToFlow(): void {
		view = { kind: 'flow' };
		selectedNodeId = null;
		lastClickId = null;
		fitSignal += 1;
		syncCanvas();
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
	// Reads the ACTIVE graph so wiring works identically inside a function body.
	function pinsOf(nodeId: string): Pin[] {
		const node = activeGraph.nodes.find((n) => n.id === nodeId);
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
		return activeGraph.data.some((e) => e.to.node === nodeId && e.to.pin === pin);
	}
	// True iff any exec edge already feeds the given (node,pin) exec-in (fan-in = 1).
	function execInTaken(nodeId: string, pin: string): boolean {
		return activeGraph.exec.some((e) => e.to.node === nodeId && e.to.pin === pin);
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

		const next =
			out.kind === 'exec'
				? addExecEdgeIn(
						activeGraph,
						{ node: c.source, pin: sourceHandle },
						{ node: c.target, pin: targetHandle },
					)
				: addDataEdgeIn(
						activeGraph,
						{ node: c.source, pin: sourceHandle },
						{ node: c.target, pin: targetHandle },
					);
		applyGraphEdit(next);
	}

	// Delete (Delete/Backspace on selection): remove nodes + their incident edges + any
	// explicitly-deleted edges, in one change, then re-seed. Clears a stale selection. Signature
	// nodes (functionEntry/functionResult) are non-deletable (their canvas node carries
	// `deletable: false`), so xyflow never includes them here.
	function onGraphDelete({ nodes: dn, edges: de }: { nodes: Node[]; edges: Edge[] }): void {
		if (!dn?.length && !de?.length) return;
		// Comment boxes delete off `doc.comments`; graph nodes/edges through the graph path.
		const commentIds = dn.filter((n) => n.type === 'comment').map((n) => n.id);
		if (commentIds.length) deleteComments(commentIds);
		const nodeIds = dn.filter((n) => n.type !== 'comment').map((n) => n.id);
		const edgeIds = de.map((e) => e.id);
		if (!nodeIds.length && !edgeIds.length) return;
		if (selectedNodeId && nodeIds.includes(selectedNodeId)) selectedNodeId = null;
		applyGraphEdit(deleteFromGraphIn(activeGraph, nodeIds, edgeIds));
	}

	// Move (drag-stop only — kept cheap, not per-frame): write the new position(s) back. A marquee /
	// group drag moves EVERY selected node at once; xyflow updates them all in the bound `nodes`, so we
	// persist every graph node whose position changed — not just the grabbed one, or the rest snap back
	// on the next canvas sync. (Canvas-only nodes like comment boxes aren't in the graph, so they're
	// skipped here and persist through their own path.)
	function onNodeDragStop(): void {
		let g = activeGraph;
		let graphChanged = false;
		const shifted = new Set<string>(); // graph nodes a comment box just carried — don't re-persist below
		let comments = doc.comments ?? [];
		let commentsChanged = false;

		// 1. Comment boxes (flow view): a moved box carries the graph nodes inside its OLD rect by the
		//    same delta (Unreal-style grouping). Compute each box's delta from its stored position.
		if (view.kind === 'flow') {
			for (const fn of nodes) {
				if (fn.type !== 'comment') continue;
				const c = comments.find((x) => x.id === fn.id);
				if (!c) continue;
				const dx = Math.round(fn.position.x) - c.x;
				const dy = Math.round(fn.position.y) - c.y;
				if (dx === 0 && dy === 0) continue;
				for (const gn of g.nodes) {
					const inside =
						gn.pos.x >= c.x &&
						gn.pos.x <= c.x + c.width &&
						gn.pos.y >= c.y &&
						gn.pos.y <= c.y + c.height;
					if (!inside) continue;
					g = moveNodeIn(g, gn.id, { x: gn.pos.x + dx, y: gn.pos.y + dy });
					shifted.add(gn.id);
					graphChanged = true;
				}
				comments = comments.map((x) =>
					x.id === c.id ? { ...x, x: Math.round(fn.position.x), y: Math.round(fn.position.y) } : x,
				);
				commentsChanged = true;
			}
		}

		// 2. Graph nodes the user dragged directly (single / marquee). Skip any a box just carried —
		//    their canvas position is stale (they weren't the dragged node), so persisting it reverts them.
		for (const fn of nodes) {
			if (fn.type === 'comment' || shifted.has(fn.id)) continue;
			const dn = g.nodes.find((n) => n.id === fn.id);
			if (dn && (dn.pos.x !== fn.position.x || dn.pos.y !== fn.position.y)) {
				g = moveNodeIn(g, fn.id, fn.position);
				graphChanged = true;
			}
		}

		if (view.kind === 'function') {
			if (graphChanged) applyGraphEdit(g);
			return;
		}
		if (!graphChanged && !commentsChanged) return;
		doc = { ...doc, graph: g, comments };
		syncCanvas();
		markDirty();
	}

	// Add a node at an explicit doc-space position — the PRIMARY path: the palette entry is
	// dragged onto the canvas, whose `drop` handler maps the cursor via `screenToFlowPosition`
	// (only reachable inside the flow's own context, hence `FlowCanvasV2` + `SvelteFlowProvider`)
	// and calls this with the resolved position. Reuses `graphOps` for the actual creation, over
	// whichever graph is active.
	function addNodeAt(kind: NodeKind, ref: string | undefined, pos: { x: number; y: number }): void {
		const id = freshNodeIdIn(activeGraph, kind);
		selectedNodeId = id;
		applyGraphEdit(addNodeIn(activeGraph, makeNode(kind, id, pos, ref)));
	}

	// Place an added node in doc-space near the CENTROID of the existing graph, nudged by a
	// small staggered offset so successive adds don't stack exactly. Used by the click FALLBACK
	// (clicking a palette entry, when there's no drop point to map). Over the active graph.
	function placementPos(): { x: number; y: number } {
		const ns = activeGraph.nodes;
		if (ns.length === 0) return { x: 200, y: 160 };
		const cx = ns.reduce((s, n) => s + n.pos.x, 0) / ns.length;
		const cy = ns.reduce((s, n) => s + n.pos.y, 0) / ns.length;
		const k = ns.length % 6;
		return { x: Math.round(cx + 40 + k * 28), y: Math.round(cy + 40 + k * 28) };
	}

	function addNodeOfKind(kind: NodeKind, ref?: string): void {
		addNodeAt(kind, ref, placementPos());
	}

	// --- Collapse to Function (Part 2c) -----------------------------------------
	// xyflow owns the live selection: marquee-drag and shift-click set each node's `selected`
	// flag directly on the bound `nodes` array. We READ that set reactively (the array is
	// `$state`), so no selection-change wiring is needed — the toolbar enables the moment ≥2
	// nodes are selected.
	const selectedIds = $derived(nodes.filter((n) => n.selected).map((n) => n.id));
	// Collapse operates on the top-level `doc.graph` (it mints a functionCall there), so it is
	// only offered in the flow view — a nested body cannot itself be collapsed here.
	const canCollapse = $derived(view.kind === 'flow' && selectedIds.length >= 2);

	// The inline "name this function" prompt (shown by the toolbar button) + a non-blocking
	// error surfaced when the pure `collapseToFunction` rejects a selection.
	let collapsing = $state(false);
	let collapseName = $state('');
	let collapseError = $state<string | null>(null);

	function beginCollapse(): void {
		if (!canCollapse) return;
		collapseError = null;
		collapseName = `Function ${library.functions.length + 1}`;
		collapsing = true;
	}
	function cancelCollapse(): void {
		collapsing = false;
		collapseName = '';
		collapseError = null;
	}

	// Mint a `functionId` from the name that does not collide with an existing function id.
	function mintFunctionId(name: string): string {
		const base = name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
		const stem = `fn.${base || 'function'}`;
		const taken = new Set(library.functions.map((f) => f.id));
		if (!taken.has(stem)) return stem;
		let i = 2;
		while (taken.has(`${stem}-${i}`)) i += 1;
		return `${stem}-${i}`;
	}

	// Run the (pure) collapse: on error surface it and mutate NOTHING; on success adopt the new
	// doc + library, persist BOTH, and select the freshly-minted functionCall node (the one node
	// in the result graph absent from the pre-collapse graph).
	function confirmCollapse(): void {
		if (!canCollapse) return;
		const name = collapseName.trim();
		if (!name) {
			collapseError = 'Enter a function name.';
			return;
		}
		const selection = [...selectedIds];
		const functionId = mintFunctionId(name);
		const before = new Set(doc.graph.nodes.map((n) => n.id));

		const result = collapseToFunction(
			{ doc, library, selection, functionId, functionName: name },
			ctx,
		);
		if ('error' in result) {
			collapseError = result.error;
			return;
		}

		doc = result.doc;
		library = result.library;
		const callNode = result.doc.graph.nodes.find((n) => !before.has(n.id));
		selectedNodeId = callNode?.id ?? null;
		syncCanvas();
		markDirty();
		markLibraryDirty();
		collapsing = false;
		collapseName = '';
		collapseError = null;
	}

	// --- Library management (2c.3): rename + delete a function -------------------
	// Rename the OPEN function. The `id` stays stable (call sites resolve by id), so only the
	// display `name` changes; every functionCall's header re-reads it live via `nodeTitle`.
	function renameActiveFunction(name: string): void {
		if (view.kind !== 'function') return;
		const fnId = view.functionId;
		library = {
			...library,
			functions: library.functions.map((f) => (f.id === fnId ? { ...f, name } : f)),
		};
		markLibraryDirty();
	}

	// How many call sites reference `functionId` — the top-level flow graph AND every OTHER
	// function body (a function may call another). Used to guard delete.
	function callSiteCount(functionId: string): number {
		let n = 0;
		const scan = (g: Graph): void => {
			for (const node of g.nodes) {
				if (node.kind === 'functionCall' && node.ref === functionId) n += 1;
			}
		};
		scan(doc.graph);
		for (const f of library.functions) {
			if (f.id === functionId) continue; // its own body's entry/result don't count as calls.
			scan(f.body);
		}
		return n;
	}

	// A non-blocking message shown when a delete is blocked (function in use).
	let deleteError = $state<string | null>(null);

	// Delete a function. Guard: block if any functionCall (in the flow or any other body) still
	// references it. If currently viewing it, return to the flow first so the canvas never edits a
	// dangling graph. Id-stable removal keeps the remaining call sites resolving.
	function deleteFunction(functionId: string): void {
		deleteError = null;
		const uses = callSiteCount(functionId);
		if (uses > 0) {
			deleteError = `in use by ${uses} call${uses === 1 ? '' : 's'}`;
			return;
		}
		if (view.kind === 'function' && view.functionId === functionId) backToFlow();
		library = {
			...library,
			functions: library.functions.filter((f) => f.id !== functionId),
		};
		markLibraryDirty();
	}
</script>

<svelte:head><title>Invisible Flow v2 · dev</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="flow"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	/>

	<div class="subbar">
		<strong>Invisible Flow</strong>

		<!-- Breadcrumb: `Flow` in flow view; `Flow ↳ <FunctionName>` with a back button + inline
		     rename while editing a function body. The name field renames the OPEN function (id
		     stays stable, so call sites keep resolving). -->
		<span class="crumb">
			<button
				class="crumb-link"
				type="button"
				disabled={view.kind === 'flow'}
				onclick={backToFlow}
				title="Back to the main flow"
			>
				Flow
			</button>
			{#if view.kind === 'function' && activeFn}
				<span class="crumb-sep">↳</span>
				<input
					class="fn-name"
					type="text"
					value={activeFn.name}
					title="Rename this function (its id stays stable)"
					onchange={(e) => renameActiveFunction(e.currentTarget.value.trim() || activeFn.name)}
				/>
				<button class="back-btn" type="button" onclick={backToFlow} title="Return to the main flow"
					>← Back to flow</button
				>
			{/if}
		</span>

		<span class="legend">
			<span class="key exec">▷ exec</span>
			<span class="key data">● data</span>
		</span>
		{#if view.kind === 'flow'}
			<button
				class="collapse-btn"
				type="button"
				onclick={addComment}
				title="Add a labelled comment box to group + annotate part of the flow"
			>
				＋ Comment
			</button>
			<button
				class="collapse-btn"
				type="button"
				disabled={!canCollapse}
				onclick={beginCollapse}
				title={canCollapse
					? 'Collapse the selected nodes into a reusable function'
					: 'Select 2 or more nodes (marquee-drag or shift-click) to collapse'}
			>
				⤵ Collapse{canCollapse ? ` ${selectedIds.length} nodes` : ''}
			</button>
		{/if}
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
		{#if hasProject && librarySaveStatus !== 'idle'}
			{#if librarySaveStatus === 'saving'}
				<span class="save-pill busy" title="Shared function library">Library…</span>
			{:else if librarySaveStatus === 'error'}
				<button class="save-pill error" type="button" onclick={() => void saveLibrary()}
					>Library save failed — retry</button
				>
			{:else if libraryDirty}
				<span class="save-pill dirty" title="Shared function library">Library unsaved</span>
			{:else}
				<span class="save-pill ok" title="Shared function library saved">Library saved</span>
			{/if}
		{/if}
		<span class="count">
			{activeGraph.nodes.length} nodes · {activeGraph.exec.length} exec · {activeGraph.data.length}
			data
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
				<NodeInspector doc={inspectorDoc} node={selectedNode} {ctx} onchange={applyDocEdit} />
			{:else if view.kind === 'function' && activeFn}
				<h3>Function body</h3>
				<p class="hint">
					Editing <strong>{activeFn.name}</strong>'s body. Wire between the
					<strong>Entry</strong> and <strong>Result</strong> nodes to define its logic — the signature
					(its inputs/outputs) is fixed here; Entry/Result can't be deleted. Drag nodes from the palette;
					Delete removes internal nodes.
				</p>
				<AddNodePalette {vocab} {library} doc={paletteDoc} onadd={addNodeOfKind} />
			{:else}
				<h3>Flow v2 · dev</h3>
				<p class="hint">
					Editable canvas (Phase 2b.2). Template <code>{doc.templateId}</code>. Pins are
					<strong>derived</strong> from the vocabulary — drag between them to wire; incompatible
					wires won't drop. Select a node to edit its fields; Delete removes selection. Double-click
					a <strong>function</strong> node to edit its body.
				</p>
				<AddNodePalette
					{vocab}
					{library}
					doc={paletteDoc}
					onadd={addNodeOfKind}
					onopen={openFunction}
					ondelete={deleteFunction}
					{deleteError}
				/>
			{/if}
			<ValidationPanelV2 {issues} onfocus={focusNode} />
			{#if view.kind === 'flow'}
				<PreviewPanelV2 {doc} {library} {vocab} />
			{/if}
		</aside>

		<div class="canvas-wrap">
			<SvelteFlowProvider>
				<FlowCanvasV2
					bind:nodes
					bind:edges
					{nodeTypes}
					{fitSignal}
					{isValidConnection}
					{onConnect}
					{onGraphDelete}
					{onNodeDragStop}
					{onNodeClick}
					{onPaneClick}
					ondropnode={addNodeAt}
				/>
			</SvelteFlowProvider>

			{#if collapsing}
				<div class="collapse-prompt" role="dialog" aria-label="Name the new function">
					<h4>Collapse {selectedIds.length} nodes → function</h4>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="collapse-input"
						type="text"
						autofocus
						placeholder="Function name"
						bind:value={collapseName}
						onkeydown={(e) => {
							if (e.key === 'Enter') confirmCollapse();
							else if (e.key === 'Escape') cancelCollapse();
						}}
					/>
					{#if collapseError}
						<p class="collapse-error">{collapseError}</p>
					{/if}
					<div class="collapse-actions">
						<button type="button" class="ghost" onclick={cancelCollapse}>Cancel</button>
						<button type="button" class="primary" onclick={confirmCollapse}>Collapse</button>
					</div>
				</div>
			{/if}
		</div>
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
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.crumb-link {
		font-size: 12px;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #cbd5e1;
		cursor: pointer;
	}
	.crumb-link:hover:not(:disabled) {
		border-color: #3a4655;
		color: #e2e8f0;
	}
	.crumb-link:disabled {
		opacity: 0.85;
		cursor: default;
		color: #93c5fd;
		border-color: #2a4a6a;
	}
	.crumb-sep {
		color: #64748b;
	}
	.fn-name {
		box-sizing: border-box;
		background: #11161d;
		border: 1px solid #2a4a6a;
		border-radius: 6px;
		color: #eab308;
		font-size: 12px;
		font-weight: 600;
		padding: 3px 8px;
		width: 160px;
	}
	.fn-name:focus {
		outline: none;
		border-color: #eab308;
	}
	.back-btn {
		font-size: 12px;
		padding: 3px 9px;
		border-radius: 6px;
		border: 1px solid #2a4a6a;
		background: #10233a;
		color: #93c5fd;
		cursor: pointer;
	}
	.back-btn:hover {
		border-color: #3b82f6;
		color: #dbeafe;
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
	   `useSvelteFlow` inside the provider). `.canvas-wrap` is the flex cell that sizes it and
	   positions the floating collapse prompt over it. */
	.canvas-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.collapse-btn {
		font-size: 12px;
		padding: 4px 11px;
		border-radius: 6px;
		border: 1px solid #2a4a6a;
		background: #10233a;
		color: #93c5fd;
		cursor: pointer;
		letter-spacing: 0.02em;
	}
	.collapse-btn:hover:not(:disabled) {
		border-color: #3b82f6;
		background: #163150;
		color: #dbeafe;
	}
	.collapse-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.collapse-prompt {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		width: 320px;
		padding: 14px 16px;
		border-radius: 10px;
		border: 1px solid #2a4a6a;
		background: #0d1420;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.collapse-prompt h4 {
		margin: 0;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #93c5fd;
	}
	.collapse-input {
		width: 100%;
		box-sizing: border-box;
		background: #11161d;
		border: 1px solid #2a323d;
		border-radius: 6px;
		color: #e2e8f0;
		font-size: 13px;
		padding: 7px 9px;
	}
	.collapse-input:focus {
		outline: none;
		border-color: #2563eb;
	}
	.collapse-error {
		margin: 0;
		font-size: 12px;
		color: #ff9a9a;
	}
	.collapse-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.collapse-actions button {
		font-size: 12px;
		padding: 5px 12px;
		border-radius: 6px;
		cursor: pointer;
	}
	.collapse-actions .ghost {
		border: 1px solid #2a323d;
		background: #14181f;
		color: #94a3b8;
	}
	.collapse-actions .ghost:hover {
		border-color: #3a4655;
		color: #e2e8f0;
	}
	.collapse-actions .primary {
		border: 1px solid #2563eb;
		background: #1d4ed8;
		color: #eff6ff;
	}
	.collapse-actions .primary:hover {
		background: #2563eb;
	}
</style>
