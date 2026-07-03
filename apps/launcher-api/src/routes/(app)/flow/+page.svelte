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
		bookEventTypes,
		DEFAULT_CODED_EVENTS,
		diffFlowDoc,
		edgeSemantics,
		isPersistentScreen,
		validateFlowDoc,
		type FlowDoc,
		type FlowTransition,
		type FlowTrigger,
		type OrphanSummary,
	} from 'engine-flow';
	import { ENGINE_PARAM_CATALOG } from 'engine-layout';
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
		DEFAULT_FADE_TRANSITION,
		editTransition,
		moveScreen,
		pasteScreens,
		removeScreen,
		removeTransition,
		setGameplayHost,
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

	// The game's book-event trigger vocabulary (design doc §14 FS-2) — the `typesBookEvent.ts` union
	// exported through the `EmitterVocabulary`, projected as `bookEvent` trigger input pins on every
	// screen so an author draws a book-event edge FROM a real event pin (empty ⇒ typed-name only).
	const flowBookEvents = bookEventTypes(data.vocabulary);

	// The derived view: placed screens (with pins/orphans) + the unplaced-scene palette.
	const model = $derived(buildFlowModel(doc, data.doc, data.components, flowBookEvents));

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
	// The bounded accessor vocabularies the `unresolved-accessor` check validates against:
	// the engine value keys (`ENGINE_PARAM_CATALOG`) + the known `$context.*` roots (today
	// just the dispatch context's `bookEvents` list). A typo in either silently becomes a
	// literal at runtime — this surfaces it as a non-blocking warning (§11.4).
	const engineKeys = ENGINE_PARAM_CATALOG.map((p) => p.key);
	const contextRoots = ['bookEvents'];
	// Value-dataflow validation (design doc §11.6): the producer feeds a `value` edge may name
	// (the engine catalog keys) + the LIVE consumer value-pin keys `${instanceId}::${source}` its
	// `sink` may target — so a typo'd producer or an orphaned sink (deleted display) is warned.
	const valueSinkKeys = $derived(
		model.screens.flatMap((s) =>
			s.pins.filter((p) => p.role === 'value' && p.key).map((p) => `${p.instanceId}::${p.key}`),
		),
	);
	const issues = $derived(
		validateFlowDoc(doc, orphanSummary, {
			engineKeys,
			contextRoots,
			producerFeeds: engineKeys,
			valueSinkKeys,
			// The game's book-event vocabulary (design doc §14 FS-2) — an edge naming an event not in
			// it references a book-event pin that doesn't exist; warned, never dropped.
			bookEvents: flowBookEvents,
		}),
	);
	// Consumer value INPUT pin ids that HAVE an incoming `value` binding edge — an EXPLICIT
	// override (design doc §11.5). A value pin NOT in this set is AUTO-WIRED by its own `source`
	// name. Threaded to the node so it can mark auto-vs-explicit on each value pin.
	const boundValuePinIds = $derived(
		new Set(doc.transitions.filter((t) => t.trigger.kind === 'value').map((t) => t.toPin ?? '')),
	);
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
			// Screens are removed via the inspector's explicit "Remove screen" button, never by the
			// Delete key — so the Delete/Backspace key deletes only selected EDGES (a pin connection),
			// and a stray Delete can't drop a whole node + its edges (design doc §8, edge-delete).
			deletable: false,
			data: {
				label: view.screen.label ?? view.scene.name,
				pins: view.pins,
				orphanCount: view.orphanedPins.length,
				initial: view.screen.initial ?? false,
				// Computed, read-only: a screen with no outgoing `complete` edge PERSISTS in the
				// active set (never removes itself) — the base game's defining property. Pure
				// derivation over the transitions, no schema field (design doc active-SET model).
				persistent: isPersistentScreen(doc, view.screen.id),
				// The resolved intent host (design doc §8.6) — the screen carrying the game's intent
				// input pins. Shown as a badge so the author sees which node owns Spin/etc.
				intentHost: view.screen.id === model.intentHostId,
				// Consumer value pins WITH an incoming value binding edge (design doc §11.5) — the node
				// marks these EXPLICIT vs the auto-wired (unbound) value pins.
				boundValuePinIds,
				invalid: invalidScreenIds.has(view.screen.id),
			},
		}));
	}

	// Handoff edges (source hides) read in a cool slate; layering edges (source persists) read
	// in amber — the same hue the "layers over" overlay concept uses elsewhere. The selected
	// edge overrides to the accent blue. One colour per active-SET class, so the graph's
	// hide-vs-layer structure is legible without an on-edge text label (removed — it overlapped
	// and cluttered; the trigger/guard/fade details live in the edge inspector on selection).
	const HANDOFF_COLOR = '#64748b';
	const LAYER_COLOR = '#f59e0b';
	// Value binding edges (design doc §11) read in the bright sky-blue of the producer pin — a
	// reactive subscription, visually its own thing (thin, static) vs the active-set hide/layer edges.
	const VALUE_EDGE_COLOR = '#38bdf8';
	const SELECTED_EDGE_COLOR = '#2563eb';

	// The exact xyflow source/target HANDLES for an edge — so the wire renders from the REAL pins the
	// author connected (an action→intent edge draws spin-out → spin-in, not Complete → Enter), and two
	// edges between the same screens use DISTINCT handles (xyflow blocks a second edge sharing both
	// endpoints AND handles — the "can't connect the second pin" bug). Prefer the persisted
	// `fromPin`/`toPin`; fall back to inferring from the trigger for legacy edges (pre-fromPin docs).
	function edgeHandles(t: FlowTransition): { sourceHandle?: string; targetHandle?: string } {
		if (t.fromPin || t.toPin) return { sourceHandle: t.fromPin, targetHandle: t.toPin };
		if (t.trigger.kind === 'complete') {
			return { sourceHandle: `${t.from}::complete`, targetHandle: `${t.to}::enter` };
		}
		if (t.trigger.kind === 'action') {
			const src = model.screens
				.find((s) => s.screen.id === t.from)
				?.pins.find((p) => p.role === 'action' && p.key === t.trigger.pin);
			return { sourceHandle: src?.id, targetHandle: `${t.to}::intent:${t.trigger.intent}` };
		}
		if (t.trigger.kind === 'value') {
			// producer OUTPUT (`${from}::produces:<feed>`) → consumer value INPUT (`${sink}::value:<src>`).
			return {
				sourceHandle: `${t.from}::produces:${t.trigger.producer}`,
				targetHandle: `${t.trigger.sink.instanceId}::value:${t.trigger.sink.source}`,
			};
		}
		// bookEvent / signal / condition activate the target's Enter; a legacy source pin is unknown.
		return { targetHandle: `${t.to}::enter` };
	}

	function buildEdges(): Edge[] {
		return doc.transitions.map((t) => {
			const selected = t.id === selectedEdgeId;
			const semantic = edgeSemantics(t);
			const color = selected
				? SELECTED_EDGE_COLOR
				: semantic === 'handoff'
					? HANDOFF_COLOR
					: semantic === 'value'
						? VALUE_EDGE_COLOR
						: LAYER_COLOR;
			const { sourceHandle, targetHandle } = edgeHandles(t);
			// A value binding edge is its OWN class — a thin value-blue line (design doc §11.5), NOT
			// the handoff-solid / layer-dashed active-set styling, since it moves no state.
			const edgeClass =
				semantic === 'value'
					? 'flow-edge-value'
					: semantic === 'layer'
						? 'flow-edge-layer'
						: 'flow-edge-handoff';
			return {
				id: t.id,
				source: t.from,
				target: t.to,
				sourceHandle,
				targetHandle,
				style: `stroke:${color}`,
				// A layering edge is dashed (the target rides OVER the persistent source, not a
				// clean baton-pass); a handoff edge is solid. Book-event edges stay animated.
				animated: t.trigger.kind === 'bookEvent',
				class: edgeClass,
				selected,
			};
		});
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

	// Extract the KEY tail from a `${instanceId}::${role}:${key}` dynamic pin id (design doc §12).
	// Returns the substring after the LAST `:` when the handle matches `::<role>:<key>`, else undefined.
	function pinRoleKey(handle: string | null | undefined, role: string): string | undefined {
		const marker = `::${role}:`;
		const at = handle?.lastIndexOf(marker);
		return at !== undefined && at >= 0 ? handle!.slice(at + marker.length) : undefined;
	}

	// Extract the INSTANCE-ID prefix from a `${instanceId}::${role}:${key}` dynamic pin id — the
	// substring BEFORE `::<role>:`. Used to build a value edge's `sink.instanceId` from the consumer
	// value pin the author dropped onto (design doc §11.4). Undefined when the handle isn't that role.
	function pinInstanceId(handle: string | null | undefined, role: string): string | undefined {
		const marker = `::${role}:`;
		const at = handle?.lastIndexOf(marker);
		return at !== undefined && at >= 0 ? handle!.slice(0, at) : undefined;
	}

	function onConnect(c: Connection): void {
		if (!c.source || !c.target) return;
		// An ACTION → INTENT wire (design doc §8): dragging FROM a button's `::action:<key>` output
		// INTO the host's `::intent:<key>` input mints an `action` edge that INVOKES a game intent
		// (base game stays active — this does NOT move the active set). Matched by action KEY, not
		// instance id (`registerComponentActions` shares one action across every button instance).
		// An action source dropped onto a NON-intent target is rejected (kept valid, no blank edge).
		const actionKey = pinRoleKey(c.sourceHandle, 'action');
		if (actionKey !== undefined) {
			const intentKey = pinRoleKey(c.targetHandle, 'intent');
			if (intentKey === undefined) return; // action → non-intent: ignore (invalid connection)
			commit(
				addTransition(
					doc,
					c.source,
					c.target,
					{ kind: 'action', pin: actionKey, intent: intentKey },
					{ fromPin: c.sourceHandle, toPin: c.targetHandle },
				),
			);
			return;
		}
		// A PRODUCER → VALUE wire (design doc §11): dragging FROM the host's `::produces:<feed>` OUTPUT
		// pin INTO a HUD display's `::value:<source>` INPUT pin mints a `value` binding edge — the
		// display then SUBSCRIBES to the producer feed's store instead of its own `source` name (a
		// reactive subscription override, never a copy; it moves NO active set). Orientation: the
		// producer is the OUTPUT (xyflow source/right handle), the consumer value pin is the INPUT
		// (target/left handle), so `sourceHandle` carries `produces` and `targetHandle` carries
		// `value`. A producer dropped onto a NON-value target is rejected (no blank edge).
		const producerKey = pinRoleKey(c.sourceHandle, 'produces');
		if (producerKey !== undefined) {
			const sinkSource = pinRoleKey(c.targetHandle, 'value');
			const sinkInstanceId = pinInstanceId(c.targetHandle, 'value');
			if (sinkSource === undefined || sinkInstanceId === undefined) return; // producer → non-value
			commit(
				addTransition(
					doc,
					c.source,
					c.target,
					{
						kind: 'value',
						producer: producerKey,
						sink: { instanceId: sinkInstanceId, source: sinkSource },
					},
					{ fromPin: c.sourceHandle, toPin: c.targetHandle },
				),
			);
			return;
		}
		// A BOOK-EVENT trigger wire (design doc §14 FS-2): dropping ONTO a screen's `::bookEvent:<event>`
		// INPUT pin mints a `bookEvent` (layer) edge whose `trigger.event` is that pin's event — exactly
		// what the interpreter already matches on (`onBookEvent`), so it is an authoring-surface change
		// only (no runtime change). The event name comes from the REAL pin, not a typed string. Mirrors
		// the action→intent wire; a source pin is any outgoing pin (usually the base's Complete/anywhere).
		const bookEventKey = pinRoleKey(c.targetHandle, 'bookEvent');
		if (bookEventKey !== undefined) {
			commit(
				addTransition(
					doc,
					c.source,
					c.target,
					{ kind: 'bookEvent', event: bookEventKey },
					{ fromPin: c.sourceHandle, toPin: c.targetHandle },
				),
			);
			return;
		}
		// Otherwise infer the active-SET semantic from the SOURCE pin the author dragged FROM. The
		// structural Complete pin id is `${screenId}::complete` (engine-flow `pins.ts`); wiring
		// FROM it means "hand off when this screen completes" ⇒ a `complete` (handoff) edge.
		// Dragging from any other source pin means "activate the target while I persist" ⇒ a
		// `bookEvent` (layer) edge the author names in the inspector. Either is refined after.
		const fromComplete = c.sourceHandle?.endsWith('::complete') ?? false;
		const trigger: FlowTrigger = fromComplete
			? { kind: 'complete' }
			: { kind: 'bookEvent', event: '' };
		commit(
			addTransition(doc, c.source, c.target, trigger, {
				fromPin: c.sourceHandle,
				toPin: c.targetHandle,
			}),
		);
	}

	// --- Droppable "Transition (fade)" (design doc §6) --------------------------
	// The author drags the palette chip and drops it ONTO an edge to give that edge's TARGET
	// screen a fade-in. It is EDGE-BACKED data (`FlowTransition.transition`), NOT a new graph
	// node — screens stay the only real nodes; the runtime just reads `edge.transition`.
	const TRANSITION_DRAG_MIME = 'application/x-flow-transition';
	// True while dragging the transition chip (drives a canvas drop-hint highlight).
	let draggingTransition = $state(false);

	function onTransitionDragStart(e: DragEvent): void {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData(TRANSITION_DRAG_MIME, 'fade');
		e.dataTransfer.effectAllowed = 'copy';
		draggingTransition = true;
	}
	function onTransitionDragEnd(): void {
		draggingTransition = false;
	}

	// Find the FlowDoc transition id under a drop point by hit-testing the xyflow edge SVG. xyflow
	// renders each edge as `<g class="svelte-flow__edge" data-id="…">` with an invisible wide
	// `.svelte-flow__edge-interaction` path for easy hovering; `elementsFromPoint` walks the stack
	// at the pointer so a drop on (or near) the wire resolves its edge id. Returns undefined off-edge.
	function edgeIdAtPoint(clientX: number, clientY: number): string | undefined {
		const stack = document.elementsFromPoint(clientX, clientY);
		for (const el of stack) {
			const g = el.closest('.svelte-flow__edge');
			const id = g?.getAttribute('data-id');
			if (id && doc.transitions.some((t) => t.id === id)) return id;
		}
		return undefined;
	}

	function onCanvasDragOver(e: DragEvent): void {
		if (!draggingTransition && !e.dataTransfer?.types.includes(TRANSITION_DRAG_MIME)) return;
		e.preventDefault(); // allow the drop
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}

	function onCanvasDrop(e: DragEvent): void {
		const isTransition =
			draggingTransition || (e.dataTransfer?.getData(TRANSITION_DRAG_MIME) ?? '') !== '';
		draggingTransition = false;
		if (!isTransition) return;
		e.preventDefault();
		const id = edgeIdAtPoint(e.clientX, e.clientY);
		if (!id) return; // dropped off any edge — no-op
		selectedEdgeId = id;
		selectedScreenId = null;
		commit(editTransition(doc, id, { transition: { ...DEFAULT_FADE_TRANSITION } }));
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

	// SvelteFlow deleted element(s) via its own key handling (Delete/Backspace on a selected edge).
	// Screens are `deletable:false`, so only edges arrive here — reconcile them into the FlowDoc so
	// the removal PERSISTS (drop each `FlowTransition` by id). Without this, xyflow removes the wire
	// from its own array only and it reappears on the next rebuild-from-doc (move/reload). One commit
	// for the whole batch = one undo step; also drops the inspector selection if it was deleted.
	function onGraphDelete({ edges: deleted }: { nodes: Node[]; edges: Edge[] }): void {
		if (!deleted?.length) return;
		let next = doc;
		for (const e of deleted) next = removeTransition(next, e.id);
		if (deleted.some((e) => e.id === selectedEdgeId)) selectedEdgeId = null;
		commit(next);
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

	// Toggle the selected screen as the gameplay/intent HOST (design doc §8.6) — the screen that
	// exposes the game's intent INPUT pins (Spin, …). Single-host, so this also clears the flag
	// elsewhere. Cleared ⇒ the generic resolver picks the host (the reachable persistent screen with
	// no action pins). `checked` reflects the EXPLICIT flag, not the resolved fallback.
	function toggleGameplayHost(on: boolean): void {
		if (selectedScreenId) commit(setGameplayHost(doc, selectedScreenId, on));
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
		// NOTE: Delete/Backspace for edges is owned by SvelteFlow's own key handling (which ignores
		// input fields and only targets SELECTED elements), reconciled into the doc via `onGraphDelete`
		// (screens are `deletable:false`, so only edges delete). No custom branch needed here.
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
		<span
			class="legend"
			title="Edge semantics: a 'Screen complete' edge HANDS OFF (source screen hides); any other trigger LAYERS the target over the still-active source (a celebration over a persistent base)."
		>
			<span class="key handoff">⇥ handoff</span>
			<span class="key layer">⧉ layer</span>
		</span>
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
			<input class="search" type="text" placeholder="Filter screens…" bind:value={paletteQuery} />
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

			{#if doc.transitions.length > 0}
				<h3>Transitions</h3>
				<!-- Droppable "Transition (fade)" (design doc §6): drag onto a connection to give its
						 TARGET screen a fade-in. Edge-backed data, not a graph node. -->
				<div
					class="drop-chip"
					role="button"
					tabindex="0"
					draggable="true"
					ondragstart={onTransitionDragStart}
					ondragend={onTransitionDragEnd}
					title="Drag onto an edge to fade its target screen in"
				>
					◐ Transition (fade)
				</div>
				<p class="hint">Drag onto an edge to fade its target screen in.</p>
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
					<label class="row" title="Expose the game's intent input pins (Spin, …) on this screen">
						<input
							type="checkbox"
							checked={selectedScreen.screen.gameplayHost ?? false}
							onchange={(e) => toggleGameplayHost(e.currentTarget.checked)}
						/>
						Gameplay host
						{#if !selectedScreen.screen.gameplayHost && model.intentHostId === selectedScreen.screen.id}
							<span class="hint">(auto)</span>
						{/if}
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

		<!-- The drop target for the "Transition (fade)" chip: `ondragover.preventDefault` allows the
				 drop, `ondrop` hit-tests the pointer against the xyflow edge SVG and attaches the fade
				 to that edge (design doc §6). `dropping` adds a subtle highlight while dragging. -->
		<div
			class="canvas"
			class:dropping={draggingTransition}
			role="region"
			ondragover={onCanvasDragOver}
			ondrop={onCanvasDrop}
		>
			{#if model.screens.length === 0 && model.available.length === 0}
				<div class="empty">This project's layout has no screens yet.</div>
			{:else}
				<SvelteFlow
					bind:nodes
					bind:edges
					{nodeTypes}
					colorMode="dark"
					fitView
					deleteKeyCode={['Delete', 'Backspace']}
					onconnect={onConnect}
					ondelete={onGraphDelete}
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
			vocab={data.vocabulary}
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
	/* The edge-semantics key — mirrors the canvas edge colours (slate handoff, amber layer). */
	.legend {
		display: inline-flex;
		gap: 6px;
		cursor: help;
	}
	.legend .key {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 4px;
		border: 1px solid #2a323d;
	}
	.legend .key.handoff {
		color: #94a3b8;
		border-color: #3a4655;
	}
	.legend .key.layer {
		color: #fdba74;
		border-color: #4a3a1c;
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
	/* The droppable "Transition (fade)" palette chip (design doc §6) — amber like a LAYER edge,
	   dashed so it reads as a draggable that attaches to a wire. */
	.drop-chip {
		display: inline-block;
		border: 1px dashed #f59e0b;
		border-radius: 6px;
		background: #1c1608;
		color: #fdba74;
		padding: 6px 10px;
		font-size: 12px;
		cursor: grab;
		user-select: none;
		margin-bottom: 4px;
	}
	.drop-chip:active {
		cursor: grabbing;
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
	/* Subtle amber inset while dragging the transition chip, hinting the canvas is a drop target. */
	.canvas.dropping {
		outline: 2px dashed #f59e0b66;
		outline-offset: -2px;
	}
	.canvas :global(.svelte-flow) {
		background: #0b0e13;
	}
	/* A LAYER edge (target rides OVER the persistent source) is dashed; a HANDOFF edge (clean
	   source-hides baton-pass) stays solid. The per-edge `style` sets the stroke colour; this
	   only adds the dash pattern for the layer class (xyflow's `animated` flag would override a
	   static dash, so the dash reads on non-animated layer edges — condition/signal). */
	.canvas :global(.svelte-flow__edge.flow-edge-layer:not(.animated) .svelte-flow__edge-path) {
		stroke-dasharray: 6 4;
	}
	/* A VALUE binding edge (design doc §11) — a THIN, static value-blue line, visually distinct
	   from the active-set hide/layer edges (it moves no state, it's a reactive subscription). */
	.canvas :global(.svelte-flow__edge.flow-edge-value .svelte-flow__edge-path) {
		stroke-width: 1.25;
		stroke-dasharray: 2 3;
	}
	/* The SELECTED edge (click to select, Delete/Backspace to remove) — thicken the wire so the
	   pick reads at a glance, on top of the accent-blue stroke the per-edge `style` already sets
	   for a selected edge. */
	.canvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
		stroke-width: 2.5;
	}
	.empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: #64748b;
	}
</style>
