/**
 * Invisible Flow v2 — what `$trigger` holds on a node. `runEvent` seeds exactly ONE `scope.trigger`
 * per dispatch (the firing entry's payload), so what a `$trigger.<field>` read or a `gameSignals`
 * data-out carries depends on WHICH entry's exec chain the node sits on. That is a property of the
 * GRAPH, not of any single node, so it is resolved here once: the validator (`signal-cross-event`,
 * the `$trigger` data-in checks, `guard-type-mismatch`) and the editor's guard-literal seeding read
 * the same owners. A data-in's `$trigger` field is type-checked from a single owner only (an ERROR
 * there would block Publish); a guard operand is typed whenever every owner agrees.
 */

import { instanceEventOf } from './instanceNodes';
import { assignable } from './types-check';
import type {
	Compare,
	DataSource,
	Graph,
	Node,
	NodeId,
	TemplateVocabulary,
	TypeRef,
} from './types';

/**
 * A `showContainer`'s FUSED container-event exec-out (§6.1, pin id `<componentId>.on<Event>`) — as
 * opposed to its plain `exec` continuation. These are their OWN entry roots, not part of the chain
 * that mounted the container: `runContainerEvent` starts a FRESH run at the edge's target and seeds
 * `trigger` with the COMPONENT EVENT's payload, not the event that led to the `showContainer`.
 */
const isContainerEventPin = (node: Node | undefined, pin: string): boolean =>
	node?.kind === 'showContainer' && pin !== 'exec';

/** A `componentInstance`'s `event:<event>` exec-out (§6.3) — like a container-event pin, its own
 *  entry root: `runInstanceEvent` starts a fresh run at the wire's target with the raised event's
 *  payload as `trigger`, never continuing the chain that set the node's inputs. */
const isInstanceEventPin = (node: Node | undefined, pin: string): boolean =>
	node?.kind === 'componentInstance' && instanceEventOf(pin) !== undefined;

/** The owner key an instance-event chain runs under: the node and its pin, since two placements
 *  of one component raise the same event ids. */
export const instanceEventOwner = (nodeId: string, pin: string): string => `${nodeId}.${pin}`;

/**
 * Which dispatches can reach each node — its exec-chain owner set.
 *
 * `runEvent` seeds exactly ONE `scope.trigger` per dispatch (the firing event's payload), and the
 * `gameSignals` node surfaces EVERY event's pins at once. So a signal's data-out is only meaningful
 * on the chain of the event it belongs to: `resolveDataOut` reads it as `scope.trigger[<field>]`
 * regardless of which pin it was dragged from.
 *
 * Walks the exec edges from every entry, each carrying its own trigger identity:
 *  - an `event` node → its `ref`;
 *  - a wired `gameSignals` exec-out → the pin id (which IS the event name);
 *  - a wired `showContainer` CONTAINER-EVENT pin → that pin's decl id (`<componentId>.on<Event>`),
 *    deliberately NOT a vocab event name: its payload is the component event's, which the template
 *    vocabulary does not declare, so `$trigger.<member>` on such a chain stays unjudged (never
 *    guess) while a cross-event `gameSignals` WIRE into it is still correctly caught.
 *
 * Keyed by (node × trigger) so a cyclic graph is bounded. A node no entry reaches (an orphan chain,
 * a function body) is ABSENT from the map — NEVER GUESS: callers leave it unchecked, matching how
 * the scope pass treats an unresolvable scope. KNOWN under-reports, both deliberate and
 * conservative: a node reachable from two chains is accepted if EITHER matches (it still resolves
 * `undefined` on the other), and `runEvent` prefers a dedicated `event` node over a same-named
 * `gameSignals` chain, so a shadowed signal chain is attributed an owner it never actually runs
 * under. Pass a FLATTENED graph (`flattenGroups`): a group's boundary pins are not exec edges here.
 */
export const triggerOwners = (graph: Graph): Map<NodeId, Set<string>> => {
	const owners = new Map<NodeId, Set<string>>();
	const seen = new Set<string>();
	const nodeById = new Map<NodeId, Node>(graph.nodes.map((n) => [n.id, n]));

	const walk = (nodeId: NodeId, trigger: string): void => {
		const stackKey = `${nodeId}|${trigger}`;
		if (seen.has(stackKey)) return;
		seen.add(stackKey);
		let set = owners.get(nodeId);
		if (!set) owners.set(nodeId, (set = new Set<string>()));
		set.add(trigger);
		for (const e of graph.exec) {
			if (e.from.node !== nodeId) continue;
			// A container-event pin re-roots below under its OWN trigger — it does not continue this one.
			const from = nodeById.get(nodeId);
			if (isContainerEventPin(from, e.from.pin) || isInstanceEventPin(from, e.from.pin)) continue;
			walk(e.to.node, trigger);
		}
	};

	for (const node of graph.nodes) {
		for (const e of graph.exec) {
			if (e.from.node !== node.id) continue;
			if (node.kind === 'event') walk(e.to.node, node.ref);
			else if (node.kind === 'gameSignals') walk(e.to.node, e.from.pin);
			// A mode entry seeds its own trigger (the transition), which is no vocab event — so a
			// gameSignals wire into its chain is a cross-event read, caught like any other.
			else if (node.kind === 'modeTrigger')
				walk(e.to.node, `mode:${node.modeId}:${node.on ?? 'enter'}`);
			else if (node.kind === 'allModesFinished') walk(e.to.node, 'mode:allFinished');
			else if (isContainerEventPin(node, e.from.pin)) walk(e.to.node, e.from.pin);
			else if (isInstanceEventPin(node, e.from.pin))
				walk(e.to.node, instanceEventOwner(node.id, e.from.pin));
		}
	}
	return owners;
};

/**
 * The declared type of `$trigger.<field>` on a node whose chain owners are `owners`
 * (`triggerOwners(graph).get(nodeId)`) — read off the same payload decls that give an `event` node
 * its typed data-outs. NEVER GUESS: typed only when every owner is a declared vocab event (a
 * container-event, instance-event, mode or `complete:<screen>` chain's payload is not in the
 * vocabulary), every one of them declares `field`, and they all agree on its type.
 */
export const triggerFieldType = (
	vocab: TemplateVocabulary,
	owners: ReadonlySet<string> | undefined,
	field: string,
): TypeRef | undefined => {
	if (!owners?.size) return undefined;
	let type: TypeRef | undefined;
	for (const owner of owners) {
		const decl = vocab.events.find((e) => e.name === owner)?.payload.find((p) => p.name === field);
		if (!decl || (type && !assignable(decl.type, type))) return undefined;
		type ??= decl.type;
	}
	return type;
};

/**
 * The type a branch-guard operand is KNOWN to carry: a literal states its own; `$engine.<value>` its
 * declared one; `$trigger.<field>` the one the chain's event declares (`triggerFieldType`, with the
 * branch's `owners`). A wire, `$item`, `$context`, a collection or an unresolvable chain is
 * `undefined` — unknown, never guessed.
 */
export const guardOperandType = (
	vocab: TemplateVocabulary,
	src: DataSource,
	owners: ReadonlySet<string> | undefined,
): TypeRef | undefined => {
	if (src.kind === 'literal') return src.type;
	if (src.kind !== 'accessor') return undefined;
	const acc = src.path;
	if (acc.on === 'engine') return vocab.values.find((v) => v.name === acc.key)?.type;
	if (acc.on === 'trigger' && acc.member !== undefined) {
		return triggerFieldType(vocab, owners, acc.member);
	}
	return undefined;
};

/** The `typeof` a value of a non-numeric scalar type has at runtime; numbers, lists and structs are
 *  left unjudged (`undefined`). */
const exactKind = (t: TypeRef): 'boolean' | 'string' | undefined =>
	t.t === 'bool' ? 'boolean' : t.t === 'string' || t.t === 'enum' ? 'string' : undefined;

/** A guard operand whose type is knowable: an `$engine` value or a `$trigger` field. */
export type TypedRead = { on: 'engine'; key: string } | { on: 'trigger'; member: string };

/** A guard row whose literal can never `===` the read it is tested against. */
export interface GuardLiteralMismatch {
	/** The side holding the literal. */
	literal: 'left' | 'right';
	/** The literal's stored value. */
	value: unknown;
	/** The read on the other side. */
	read: TypedRead;
	/** The read's known type — what the literal should be. */
	type: TypeRef;
}

/**
 * `eq`/`ne` are strict `===` at runtime (`compare`), so a known `bool` read tested against the
 * number box's `1` is `true === 1`: `eq` never holds, `ne` always does, and nothing at runtime says
 * so. A row is flagged only when one side is a read of KNOWN non-numeric type (`guardOperandType`)
 * and the other a literal whose stored VALUE is another kind — a number-vs-number row (the
 * inspector's default) is never flagged, and neither is an ordering op (it compares as numbers).
 */
export const guardLiteralMismatch = (
	vocab: TemplateVocabulary,
	row: Compare,
	owners: ReadonlySet<string> | undefined,
): GuardLiteralMismatch | undefined => {
	if (row.op !== 'eq' && row.op !== 'ne') return undefined;
	const sides = [
		[row.left, row.right, 'right'],
		[row.right, row.left, 'left'],
	] as const;
	for (const [src, lit, literal] of sides) {
		if (src.kind !== 'accessor' || lit.kind !== 'literal') continue;
		const acc = src.path;
		let read: TypedRead;
		if (acc.on === 'engine') read = acc;
		else if (acc.on === 'trigger' && acc.member !== undefined) {
			read = { on: 'trigger', member: acc.member };
		} else continue;
		const type = guardOperandType(vocab, src, owners);
		const kind = type && exactKind(type);
		if (type && kind && typeof lit.value !== kind) return { literal, value: lit.value, read, type };
	}
	return undefined;
};
