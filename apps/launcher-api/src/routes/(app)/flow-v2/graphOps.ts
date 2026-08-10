/**
 * Invisible Flow v2 — pure graph edits for the dev canvas (Phase 2b.1). Every editing
 * gesture (wire / delete / move / add-node) is a PURE function `FlowDoc → FlowDoc` over
 * `doc.graph`, so the caller can mutate the `$state` doc then re-seed the xyflow arrays
 * and let `derivePins` + `validateFlowDoc` react. Nothing here touches the vocabulary or
 * the function library — those stay the anti-drift source of pins (§2).
 *
 * SCOPE (2b.1): the graph-editing loop only — wire, delete, move, add. Node inspection
 * (setting a node's `ref` / fields / data-sources) is 2b.2; a freshly-added control node
 * is allowed to validate as `unfilled-data-in` until then (it demonstrates live validation).
 */

import type {
	ComputeOp,
	DataEdge,
	DataSource,
	ExecEdge,
	FlowDoc,
	Graph,
	Guard,
	Node as V2Node,
	NodeKind,
	TextMessageNode,
} from 'engine-flow-v2';
import { TEXT_MESSAGE_DEFAULTS } from 'engine-flow-v2';

// ---------------------------------------------------------------------------
// Graph-level ops (2c.3). Every structural edit is fundamentally a pure `Graph → Graph`;
// the doc-level exports below are thin wrappers that swap `doc.graph`. This split lets the
// SAME gestures edit EITHER the main `FlowDoc.graph` OR a `FunctionDef.body` (the "active
// graph" abstraction) — the caller writes the result back to whichever target is active.
// ---------------------------------------------------------------------------

/** Every node id in a graph INCLUDING those nested inside group bodies (recursively). A group's body
 *  KEEPS its selected node ids, and `flattenGroups` inlines them into this graph at runtime — so a
 *  freshly-minted id must avoid a body id too, else the flattened graph carries a DUPLICATE id (which
 *  the runtime's by-id index collapses, cross-wiring edges — the "press Spin shows the free-spin
 *  intro" bug). The top-level minter never saw body ids before, so it could re-mint `action-2`. */
const collectNodeIdsDeep = (graph: Graph, into: Set<string> = new Set<string>()): Set<string> => {
	for (const n of graph.nodes) {
		into.add(n.id);
		if (n.kind === 'group') collectNodeIdsDeep(n.body, into);
	}
	return into;
};

/** A fresh, collision-free node id keyed by kind (`event-1`, `delay-3`, …), scoped to a graph —
 *  unique against the whole graph AND every group body inlined into it at flatten (see above). */
export const freshNodeIdIn = (graph: Graph, kind: NodeKind): string => {
	const used = collectNodeIdsDeep(graph);
	let i = 1;
	let id = `${kind}-${i}`;
	while (used.has(id)) {
		i += 1;
		id = `${kind}-${i}`;
	}
	return id;
};

/** Append an exec edge (source exec-out → target exec-in) to a graph. */
export const addExecEdgeIn = (
	graph: Graph,
	from: { node: string; pin: string },
	to: { node: string; pin: string },
): Graph => {
	const edge: ExecEdge = { from, to };
	return { ...graph, exec: [...graph.exec, edge] };
};

/**
 * Append a data edge (source data-out → target data-in) to a graph, and mark the target pin `wire`.
 *
 * The edge WINS at runtime (`resolveDataIn` reads it before the node's own `inputs`), so any
 * literal/accessor already stored on that pin becomes silently dead — the `data-in-shadowed`
 * warning. Re-stamping the pin as `wire` (the sanctioned "use the edge" marker) makes the shadow
 * unreachable by construction: dragging a wire onto a pin that already had a literal is the ONE way
 * an author creates it, and the inspector hides the source editor for a wired pin, so they could
 * never clear it afterwards.
 */
export const addDataEdgeIn = (
	graph: Graph,
	from: { node: string; pin: string },
	to: { node: string; pin: string },
): Graph => {
	const edge: DataEdge = { from, to };
	return {
		...graph,
		data: [...graph.data, edge],
		nodes: graph.nodes.map((n) =>
			n.id === to.node && n.inputs?.[to.pin] && n.inputs[to.pin].kind !== 'wire'
				? { ...n, inputs: { ...n.inputs, [to.pin]: { kind: 'wire' } } }
				: n,
		),
	};
};

/** Write a node's new canvas position back into a graph (move on drag-stop). */
export const moveNodeIn = (graph: Graph, nodeId: string, pos: { x: number; y: number }): Graph => ({
	...graph,
	nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, pos } : n)),
});

/** Append a node to a graph. */
export const addNodeIn = (graph: Graph, node: V2Node): Graph => ({
	...graph,
	nodes: [...graph.nodes, node],
});

/**
 * Remove nodes AND every exec/data edge incident to them, plus any explicitly-deleted
 * edges (identified by their canvas id: `exec-<i>` / `data-<i>`, indexing the graph arrays
 * in `buildEdges` order), from a graph. Node + edge deletes reconcile in one pass so a
 * Delete-key batch lands as a single change.
 */
export const deleteFromGraphIn = (
	graph: Graph,
	nodeIds: readonly string[],
	edgeIds: readonly string[],
): Graph => {
	const removedNodes = new Set(nodeIds);
	const removedExec = new Set<number>();
	const removedData = new Set<number>();
	for (const id of edgeIds) {
		const m = /^(exec|data)-(\d+)$/.exec(id);
		if (!m) continue;
		(m[1] === 'exec' ? removedExec : removedData).add(Number(m[2]));
	}

	const nodes = graph.nodes.filter((n) => !removedNodes.has(n.id));
	const incident = (e: ExecEdge | DataEdge) =>
		removedNodes.has(e.from.node) || removedNodes.has(e.to.node);
	const exec = graph.exec.filter((e, i) => !removedExec.has(i) && !incident(e));
	const data = graph.data.filter((e, i) => !removedData.has(i) && !incident(e));

	return { ...graph, nodes, exec, data };
};

// ---------------------------------------------------------------------------
// Doc-level wrappers — the main-flow editing loop (unchanged behaviour). Each simply runs the
// graph-level op on `doc.graph` and swaps it back, so callers that edit the top-level flow keep
// working exactly as before.
// ---------------------------------------------------------------------------

/** A fresh, collision-free node id keyed by kind, scoped to the doc's graph. */
export const freshNodeId = (doc: FlowDoc, kind: NodeKind): string => freshNodeIdIn(doc.graph, kind);

/** Append an exec edge (source exec-out → target exec-in). */
export const addExecEdge = (
	doc: FlowDoc,
	from: { node: string; pin: string },
	to: { node: string; pin: string },
): FlowDoc => ({ ...doc, graph: addExecEdgeIn(doc.graph, from, to) });

/** Append a data edge (source data-out → target data-in). */
export const addDataEdge = (
	doc: FlowDoc,
	from: { node: string; pin: string },
	to: { node: string; pin: string },
): FlowDoc => ({ ...doc, graph: addDataEdgeIn(doc.graph, from, to) });

/** Write a node's new canvas position back into the doc (move on drag-stop). */
export const moveNode = (doc: FlowDoc, nodeId: string, pos: { x: number; y: number }): FlowDoc => ({
	...doc,
	graph: moveNodeIn(doc.graph, nodeId, pos),
});

/**
 * Remove nodes AND every exec/data edge incident to them, plus any explicitly-deleted
 * edges, in one doc change (delegates to `deleteFromGraphIn`).
 */
export const deleteFromGraph = (
	doc: FlowDoc,
	nodeIds: readonly string[],
	edgeIds: readonly string[],
): FlowDoc => ({ ...doc, graph: deleteFromGraphIn(doc.graph, nodeIds, edgeIds) });

/** A placeholder `compute` op (edited in 2b.2). Defaults to `mul` over two literal ints. */
const defaultComputeOp = (): ComputeOp => ({
	op: 'mul',
	a: { kind: 'literal', type: { t: 'int' }, value: 0 },
	b: { kind: 'literal', type: { t: 'int' }, value: 0 },
});

/** A new node of `kind` at `pos`, with the given `ref` (ignored for control kinds) and
 *  sensible per-kind defaults. Data-source-carrying fields are edited in 2b.2. */
export const makeNode = (
	kind: NodeKind,
	id: string,
	pos: { x: number; y: number },
	ref?: string,
): V2Node => {
	switch (kind) {
		case 'event':
		case 'action':
		case 'fireCue':
		case 'functionCall':
		case 'showContainer':
		case 'hideContainer':
			return { id, kind, pos, ref: ref ?? '' } as V2Node;
		case 'gameSignals':
			// The single mechanic-signal SOURCE node — ref-less, no fields; its pins are DERIVED from
			// the vocabulary (one exec-out per non-intent event). Shaped like `delay` (just id/kind/pos).
			return { id, kind, pos };
		case 'textMessage':
			// Presentation LEAF that CARRIES its own content (no vocab ref). Seed from the engine's coded
			// defaults (text/place/visibleWhile) so a freshly-dropped node renders + validates straight
			// away; `pos` is the drop point like every other kind. Spreading the shared defaults keeps the
			// editor and the game's render layer reading the SAME starting shape (they both import it).
			return { id, kind, pos, ...TEXT_MESSAGE_DEFAULTS };
		case 'delay':
			return { id, kind, pos };
		case 'branch':
			return { id, kind, pos, guard: { all: [] } };
		case 'forEach':
			return { id, kind, pos, mode: 'sequence' };
		case 'sequence':
		case 'parallel':
			return { id, kind, pos, count: 2 };
		case 'compute':
			return { id, kind, pos, compute: defaultComputeOp() };
	}
};

/** Append a node to the graph. */
export const addNode = (doc: FlowDoc, node: V2Node): FlowDoc => ({
	...doc,
	graph: addNodeIn(doc.graph, node),
});

// ---------------------------------------------------------------------------
// Node inspection setters (Phase 2b.2). Each is a pure `FlowDoc → FlowDoc` that clones
// and replaces JUST the target node (all else shares reference identity), mirroring the
// structural ops above. They edit a node's stored REFERENCE / per-kind fields / data-source
// inputs — never pins (those stay derived) and never edges (those are the wiring loop).
//
// Each is a thin wrapper over a `Graph → Graph` core (`*In`), so the inspector can edit a
// node in EITHER the main flow or a function body (2c.3). The core replaces just the target.
// ---------------------------------------------------------------------------

/** Replace just the node with id `nodeId` in a graph, mapped through `fn`. */
const replaceNodeIn = (graph: Graph, nodeId: string, fn: (n: V2Node) => V2Node): Graph => ({
	...graph,
	nodes: graph.nodes.map((n) => (n.id === nodeId ? fn(n) : n)),
});

/** Replace just the node with id `nodeId`, mapped through `fn` (identity for others). */
const replaceNode = (doc: FlowDoc, nodeId: string, fn: (n: V2Node) => V2Node): FlowDoc => ({
	...doc,
	graph: replaceNodeIn(doc.graph, nodeId, fn),
});

/** Set a ref-carrying node's `ref` (event/action/fireCue/functionCall/show|hideContainer). */
export const setNodeRef = (doc: FlowDoc, nodeId: string, ref: string): FlowDoc =>
	replaceNode(doc, nodeId, (n) => {
		switch (n.kind) {
			case 'event':
			case 'action':
			case 'fireCue':
			case 'functionCall':
			case 'showContainer':
			case 'hideContainer':
				return { ...n, ref };
			default:
				return n; // control kinds carry no ref.
		}
	});

/**
 * Set (or clear) the `DataSource` feeding a node's data-in pin `pinId`. Passing `undefined`
 * removes the entry (the pin falls back to a plain `wire`/unfilled state). Operates on the
 * shared `inputs` map — a `wire` source means "look at the data edges".
 */
export const setNodeInput = (
	doc: FlowDoc,
	nodeId: string,
	pinId: string,
	src: DataSource | undefined,
): FlowDoc =>
	replaceNode(doc, nodeId, (n) => {
		const inputs = { ...(n.inputs ?? {}) };
		if (src === undefined) delete inputs[pinId];
		else inputs[pinId] = src;
		const next = { ...n, inputs };
		if (Object.keys(inputs).length === 0) delete next.inputs;
		return next as V2Node;
	});

/** Toggle a `showContainer` node's ROUND-BLOCK HOLD (`awaitComplete`): when on, the exec chain
 *  blocks after mounting until this container completes (a tap on a `tapToContinue` overlay). Omit
 *  the field when off so an un-held show stays byte-identical. */
export const setShowContainerAwaitComplete = (
	doc: FlowDoc,
	nodeId: string,
	awaitComplete: boolean,
): FlowDoc =>
	replaceNode(doc, nodeId, (n) => {
		if (n.kind !== 'showContainer') return n;
		if (!awaitComplete) {
			const { awaitComplete: _drop, ...rest } = n;
			return rest as V2Node;
		}
		return { ...n, awaitComplete: true };
	});

/** Toggle a `fireCue` node's `await`: when on, the exec chain blocks until the cue's subscribers
 *  finish (the interpreter awaits the broadcast), matching a coded handler's `broadcastAsync`; when
 *  off the cue is fire-and-forget (`broadcast`) and the chain runs straight on. Authoring this
 *  matters whenever a LATER node undoes what the cue starts — e.g. `boardWithAnimateSymbols` must be
 *  awaited or the `hideWinLine` after it erases the win line before the symbols finish. Omit the
 *  field when off so a fire-and-forget cue stays byte-identical. */
export const setFireCueAwait = (doc: FlowDoc, nodeId: string, await_: boolean): FlowDoc =>
	replaceNode(doc, nodeId, (n) => {
		if (n.kind !== 'fireCue') return n;
		if (!await_) {
			const { await: _drop, ...rest } = n;
			return rest as V2Node;
		}
		return { ...n, await: true };
	});

/** Set a `forEach` node's iteration `mode` (sequence | parallel). */
export const setForEachMode = (
	doc: FlowDoc,
	nodeId: string,
	mode: 'sequence' | 'parallel',
): FlowDoc => replaceNode(doc, nodeId, (n) => (n.kind === 'forEach' ? { ...n, mode } : n));

/** Set a `sequence`/`parallel` node's exec-out `count` (clamped to ≥ 1). */
export const setCount = (doc: FlowDoc, nodeId: string, count: number): FlowDoc =>
	replaceNode(doc, nodeId, (n) =>
		n.kind === 'sequence' || n.kind === 'parallel'
			? { ...n, count: Math.max(1, Math.floor(count)) }
			: n,
	);

/** Replace a `compute` node's whole `ComputeOp` (op + operands). */
export const setComputeOp = (doc: FlowDoc, nodeId: string, op: ComputeOp): FlowDoc =>
	replaceNode(doc, nodeId, (n) => (n.kind === 'compute' ? { ...n, compute: op } : n));

/** Replace a `branch` node's `Guard` (its `all[]` / `any[]` comparison set). */
export const setBranchGuard = (doc: FlowDoc, nodeId: string, guard: Guard): FlowDoc =>
	replaceNode(doc, nodeId, (n) => (n.kind === 'branch' ? { ...n, guard } : n));

/** Rename a `group` node (its display `label`; §5.2). Purely cosmetic — the group is a fold, so its
 *  label has no runtime meaning. A blank/whitespace name falls back to the current label. */
export const setGroupLabel = (doc: FlowDoc, nodeId: string, label: string): FlowDoc =>
	replaceNode(doc, nodeId, (n) =>
		n.kind === 'group' ? { ...n, label: label.trim() || n.label } : n,
	);

/** The `textMessage` content fields the inspector edits. `text`/`place`/`visibleWhile` are always
 *  present on the node; `autoHideMs`/`style` are optional — passing `undefined` for either CLEARS it
 *  (drops the key) so an unused field never gets stored as `undefined` (which would defeat the
 *  "absent ⇒ stay shown / engine default" semantics and bloat the doc). */
type TextMessagePatch = Partial<
	Pick<TextMessageNode, 'text' | 'place' | 'visibleWhile' | 'placement' | 'autoHideMs' | 'style'>
>;

/** Patch a `textMessage` node's carried content (schema §6.3). Only the keys present in `patch`
 *  change; a key whose value is `undefined` is DELETED rather than set (see `TextMessagePatch`), so
 *  `autoHideMs: undefined` / `style: undefined` cleanly clear the optional field. All other nodes
 *  pass through untouched, mirroring the per-kind setters above. */
export const setTextMessageFields = (
	doc: FlowDoc,
	nodeId: string,
	patch: TextMessagePatch,
): FlowDoc =>
	replaceNode(doc, nodeId, (n) => {
		if (n.kind !== 'textMessage') return n;
		// The three ALWAYS-PRESENT fields are only overwritten when the patch supplies them (the editor
		// always sends a value for these, never `undefined`); spreading an absent key changes nothing.
		const next: TextMessageNode = {
			...n,
			...(patch.text !== undefined ? { text: patch.text } : {}),
			...(patch.place !== undefined ? { place: patch.place } : {}),
			...(patch.visibleWhile !== undefined ? { visibleWhile: patch.visibleWhile } : {}),
			...(patch.placement !== undefined ? { placement: patch.placement } : {}),
		};
		// `autoHideMs` / `style` are OPTIONAL — an EXPLICIT `undefined` in the patch clears them (drops
		// the key), while omitting the key leaves the existing value. `'x' in patch` distinguishes the
		// two; `delete` is legal here because both fields are declared optional on the node.
		if ('autoHideMs' in patch) {
			if (patch.autoHideMs === undefined) delete next.autoHideMs;
			else next.autoHideMs = patch.autoHideMs;
		}
		if ('style' in patch) {
			if (patch.style === undefined) delete next.style;
			else next.style = patch.style;
		}
		return next;
	});
