/**
 * Invisible Flow v2 — the GRAPH-level pin pass. `derivePins` (schema §2) sees ONE node, so two
 * facts are invisible to it: which forEach body a node sits in (`$item`'s type), and what type an
 * incoming data EDGE carries (e.g. `gameSignals.winInfo.wins → forEach.in`, the normal way a loop
 * is fed). Both are properties of the GRAPH, so they are resolved here once and threaded into
 * `derivePins` as a `PinScope`.
 *
 * `deriveGraphPins(graph, ctx)` is the entry point every graph-wide consumer should use instead of
 * mapping `derivePins` over the nodes: the validator, and the editor's connect gate + canvas (so a
 * wire is rejected at DRAG time by the same types the panel reports).
 *
 * Two rules keep it honest:
 *  - NEVER GUESS. A type is emitted only when it is genuinely derivable; anything ambiguous
 *    (a node reachable both inside and outside a loop, a cyclic feed, an unresolvable source)
 *    resolves to `undefined` — the pre-scope behaviour, which callers already treat as "unknown,
 *    don't check".
 *  - TERMINATE. The exec walk is keyed by (node × loop stack) and refuses to re-enter a loop it is
 *    already inside, so a cyclic graph is bounded; the type resolution guards its own recursion
 *    (a loop fed — directly or transitively — by its own body resolves to unknown, not a hang).
 */

import { derivePins, dataSourceType, type PinContext, type PinScope } from './pins';
import type { Graph, Node, NodeId, Pin, PinPath, TypeRef } from './types';

export interface GraphPins {
	/** Every node's derived pins, scope-aware. Keyed by node id. */
	pins: Map<NodeId, Pin[]>;
	/** The enclosing forEach's ELEMENT type per node — what `$item` reads inside a loop body.
	 *  `undefined` (or absent) = the node is in no loop, or the element type isn't derivable. */
	scopeItem: Map<NodeId, TypeRef | undefined>;
	/** The resolved `PinScope` per node — for consumers that re-derive a single node's pins on
	 *  their own (a canvas node component, an inspector) and must land on the SAME types. */
	scopes: Map<NodeId, PinScope>;
}

/** A node's loop owner: the id of the innermost enclosing forEach, `null` for "no loop", and
 *  `AMBIGUOUS` when the walk reaches it under two different owners (⇒ nothing is claimed). */
const AMBIGUOUS = Symbol('ambiguous');
type LoopOwner = NodeId | null | typeof AMBIGUOUS;

/**
 * Map each node to the innermost forEach whose `body` chain reaches it. Walks the exec edges from
 * every ROOT (a node with no incoming exec edge — an `event`, a `gameSignals`, an orphan chain),
 * carrying a stack of the loops entered: a forEach's `body` pin pushes it, every other pin (its
 * `done` included) keeps the current stack.
 */
const loopOwners = (graph: Graph): Map<NodeId, LoopOwner> => {
	const nodeById = new Map<NodeId, Node>(graph.nodes.map((n) => [n.id, n]));
	const owners = new Map<NodeId, LoopOwner>();
	const seen = new Set<string>();

	const walk = (nodeId: NodeId, stack: NodeId[]): void => {
		const stackKey = `${nodeId}|${stack.join('>')}`;
		if (seen.has(stackKey)) return;
		seen.add(stackKey);

		const owner: LoopOwner = stack.length > 0 ? stack[stack.length - 1] : null;
		const prior = owners.get(nodeId);
		owners.set(nodeId, prior === undefined || prior === owner ? owner : AMBIGUOUS);

		const node = nodeById.get(nodeId);
		for (const edge of graph.exec) {
			if (edge.from.node !== nodeId) continue;
			const entersBody = node?.kind === 'forEach' && edge.from.pin === 'body';
			// A loop can never nest inside ITSELF — an exec cycle back into a body would otherwise grow
			// the stack forever.
			if (entersBody && stack.includes(nodeId)) continue;
			walk(edge.to.node, entersBody ? [...stack, nodeId] : stack);
		}
	};

	const hasExecIn = new Set<NodeId>(graph.exec.map((e) => e.to.node));
	for (const node of graph.nodes) if (!hasExecIn.has(node.id)) walk(node.id, []);
	return owners;
};

/**
 * Derive every node's pins with its graph scope resolved. Pin types and loop-element types are
 * mutually recursive (a loop's `item` type comes from whatever feeds its `in` pin, which may be a
 * node inside another loop), so both resolve lazily through memoized helpers; a cycle resolves to
 * `undefined` rather than recursing.
 */
export const deriveGraphPins = (graph: Graph, ctx: PinContext): GraphPins => {
	const nodeById = new Map<NodeId, Node>(graph.nodes.map((n) => [n.id, n]));
	const owners = loopOwners(graph);

	const pinsMemo = new Map<NodeId, Pin[]>();
	const scopeMemo = new Map<NodeId, PinScope>();
	const itemMemo = new Map<NodeId, TypeRef | undefined>();
	const pinsInFlight = new Set<NodeId>();
	const itemInFlight = new Set<NodeId>();

	/** The element type of the loop a node sits in (`$item`'s type), if derivable. */
	const scopeItemOf = (nodeId: NodeId): TypeRef | undefined => {
		const owner = owners.get(nodeId);
		return typeof owner === 'string' ? loopItemType(owner) : undefined;
	};

	const loopItemType = (forEachId: NodeId): TypeRef | undefined => {
		if (itemMemo.has(forEachId)) return itemMemo.get(forEachId);
		if (itemInFlight.has(forEachId)) return undefined; // cyclic feed → unknown.
		itemInFlight.add(forEachId);
		const list = loopListType(forEachId);
		const item = list?.t === 'list' ? list.of : undefined;
		itemInFlight.delete(forEachId);
		itemMemo.set(forEachId, item);
		return item;
	};

	/** The type of a forEach's `in` list — the incoming edge first (the runtime's precedence),
	 *  else the node's own `inputs.in` source. */
	const loopListType = (forEachId: NodeId): TypeRef | undefined => {
		const edge = graph.data.find((e) => e.to.node === forEachId && e.to.pin === 'in');
		if (edge) return dataOutType(edge.from);
		const src = nodeById.get(forEachId)?.inputs?.in;
		return src ? dataSourceType(ctx, src, scopeItemOf(forEachId)) : undefined;
	};

	const dataOutType = (from: PinPath): TypeRef | undefined =>
		pinsOf(from.node).find((p) => p.id === from.pin && p.dir === 'out' && p.kind === 'data')
			?.dataType;

	/** The types of a node's data-ins that arrive by EDGE — what `derivePins` cannot see. */
	const wiredInsOf = (nodeId: NodeId): Record<string, TypeRef> => {
		const wired: Record<string, TypeRef> = {};
		for (const edge of graph.data) {
			if (edge.to.node !== nodeId) continue;
			const type = dataOutType(edge.from);
			if (type) wired[edge.to.pin] = type;
		}
		return wired;
	};

	const pinsOf = (nodeId: NodeId): Pin[] => {
		const memo = pinsMemo.get(nodeId);
		if (memo) return memo;
		const node = nodeById.get(nodeId);
		if (!node) return [];
		// Re-entered while resolving its own scope (a node wired, transitively, to itself): fall back
		// to the scope-free pins WITHOUT memoizing, so the outer resolution still completes.
		if (pinsInFlight.has(nodeId)) return derivePins(node, ctx);
		pinsInFlight.add(nodeId);
		const scope: PinScope = { item: scopeItemOf(nodeId), wiredIns: wiredInsOf(nodeId) };
		const pins = derivePins(node, ctx, scope);
		pinsInFlight.delete(nodeId);
		pinsMemo.set(nodeId, pins);
		scopeMemo.set(nodeId, scope);
		return pins;
	};

	const pins = new Map<NodeId, Pin[]>();
	const scopeItem = new Map<NodeId, TypeRef | undefined>();
	const scopes = new Map<NodeId, PinScope>();
	for (const node of graph.nodes) {
		pins.set(node.id, pinsOf(node.id));
		scopeItem.set(node.id, scopeItemOf(node.id));
		scopes.set(node.id, scopeMemo.get(node.id) ?? {});
	}
	return { pins, scopeItem, scopes };
};
