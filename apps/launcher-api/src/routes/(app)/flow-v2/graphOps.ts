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
	ExecEdge,
	FlowDoc,
	Node as V2Node,
	NodeKind,
} from 'engine-flow-v2';

/** A fresh, collision-free node id keyed by kind (`event-1`, `delay-3`, …). */
export const freshNodeId = (doc: FlowDoc, kind: NodeKind): string => {
	const used = new Set(doc.graph.nodes.map((n) => n.id));
	let i = 1;
	let id = `${kind}-${i}`;
	while (used.has(id)) {
		i += 1;
		id = `${kind}-${i}`;
	}
	return id;
};

/** Append an exec edge (source exec-out → target exec-in). */
export const addExecEdge = (
	doc: FlowDoc,
	from: { node: string; pin: string },
	to: { node: string; pin: string },
): FlowDoc => {
	const edge: ExecEdge = { from, to };
	return { ...doc, graph: { ...doc.graph, exec: [...doc.graph.exec, edge] } };
};

/** Append a data edge (source data-out → target data-in). */
export const addDataEdge = (
	doc: FlowDoc,
	from: { node: string; pin: string },
	to: { node: string; pin: string },
): FlowDoc => {
	const edge: DataEdge = { from, to };
	return { ...doc, graph: { ...doc.graph, data: [...doc.graph.data, edge] } };
};

/** Write a node's new canvas position back into the doc (move on drag-stop). */
export const moveNode = (doc: FlowDoc, nodeId: string, pos: { x: number; y: number }): FlowDoc => ({
	...doc,
	graph: {
		...doc.graph,
		nodes: doc.graph.nodes.map((n) => (n.id === nodeId ? { ...n, pos } : n)),
	},
});

/**
 * Remove nodes AND every exec/data edge incident to them, plus any explicitly-deleted
 * edges (identified by their canvas id: `exec-<i>` / `data-<i>`, indexing the doc arrays
 * in `buildEdges` order). Node + edge deletes are reconciled in one pass so a Delete-key
 * batch (nodes + edges) lands as a single doc change.
 */
export const deleteFromGraph = (
	doc: FlowDoc,
	nodeIds: readonly string[],
	edgeIds: readonly string[],
): FlowDoc => {
	const removedNodes = new Set(nodeIds);
	const removedExec = new Set<number>();
	const removedData = new Set<number>();
	for (const id of edgeIds) {
		const m = /^(exec|data)-(\d+)$/.exec(id);
		if (!m) continue;
		(m[1] === 'exec' ? removedExec : removedData).add(Number(m[2]));
	}

	const nodes = doc.graph.nodes.filter((n) => !removedNodes.has(n.id));
	const incident = (e: ExecEdge | DataEdge) =>
		removedNodes.has(e.from.node) || removedNodes.has(e.to.node);
	const exec = doc.graph.exec.filter((e, i) => !removedExec.has(i) && !incident(e));
	const data = doc.graph.data.filter((e, i) => !removedData.has(i) && !incident(e));

	return { ...doc, graph: { ...doc.graph, nodes, exec, data } };
};

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
	graph: { ...doc.graph, nodes: [...doc.graph.nodes, node] },
});
