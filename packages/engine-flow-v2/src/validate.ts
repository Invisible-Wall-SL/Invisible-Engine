/**
 * Invisible Flow v2 — the FlowDoc validator (schema §1–§7). A PURE pass over the graph +
 * the template vocabulary + the function library, returning a typed, structured issue
 * list. It never mutates and never throws; the editor lists + focuses each issue.
 *
 * Each check has a stable `code` string (so the UI + tests can key off it):
 *  - `ref-unresolved`      — a node's `ref` (event/action/cue/container/function) is unknown.
 *  - `exec-in-fanin`       — an exec-in has >1 incoming exec edge (§2: at most one predecessor).
 *  - `data-in-fanin`       — a data-in has >1 incoming data edge (§2: at most one source).
 *  - `entry-has-exec-in`   — an `event` node has an incoming exec edge (§3: entry points have none).
 *  - `edge-endpoint`       — an edge names a node/pin that doesn't exist, or wrong kind/dir.
 *  - `type-mismatch`       — a data edge whose source type isn't `assignable` to the target (§1).
 *  - `unfilled-data-in`    — a data-in with neither an incoming edge nor a valid `DataSource`.
 *  - `data-in-shadowed`    — a data-in fed by BOTH an edge and a literal/accessor source. The edge
 *                            wins at runtime (`resolveDataIn` reads it first), so the stored source
 *                            is silently dead — a warning, not an error (the graph still runs).
 *  - `signal-cross-event`  — a `gameSignals` data-out wired into a node that never runs on THAT
 *                            event's exec chain. `resolveDataOut` reads a signal pin as
 *                            `scope.trigger[<field>]` — the FIRING event's payload, whatever pin the
 *                            wire was dragged from — so it resolves to `undefined` on every dispatch
 *                            that reaches the target. Only the graph knows which chain a node sits
 *                            on, so the runtime cannot catch this.
 *  - `literal-type`        — a `literal` DataSource whose value doesn't match the pin type.
 *  - `accessor-unresolved` — an `accessor` DataSource that doesn't resolve in scope.
 *  - `fn-requires`         — a `functionCall` whose target's `requires` isn't satisfied by the
 *                            doc's `templateId` vocabulary.
 *  - `entry-outside-body`  — a `functionEntry`/`functionResult` in the TOP-LEVEL `FlowDoc.graph`
 *                            (§5: those two kinds live ONLY inside a `FunctionDef.body`).
 *  - `fn-body-entry`       — a `FunctionDef.body` lacks exactly one `functionEntry` referencing it.
 *  - `fn-body-result`      — a `FunctionDef.body` lacks exactly one `functionResult` referencing it.
 *  - `duplicate-id`        — a node id is used more than once across the graph + its group bodies. A
 *                            group body keeps its ids and `flattenGroups` inlines them, so a collision
 *                            would make two nodes share an id after flatten (the runtime indexes BY id,
 *                            so they collapse and edges cross-wire). Flatten now re-namespaces it safely,
 *                            but the collision is a data smell the id minter should never produce.
 *  - `text-message-empty`  — a `textMessage` node whose `text` is blank: it renders nothing and
 *                            harvests no localization key (a warning — the graph still runs).
 *  - `cinematic-await-loop`  — a `playCinematic` that BOTH loops and awaits completion: it can
 *                            never resume, so the round hangs (an ERROR, not a warning).
 *  - `cinematic-missing-ref` — a `playCinematic` naming no cinematic (a warning — it is inert).
 *  - `text-message-unreachable` — a `textMessage` with NO state-gate (`visibleWhile` unset/`'none'`)
 *                            AND no incoming `show` exec edge: nothing can ever make it appear.
 *
 * The checks mirror the schema's rules; a flagged doc is still structurally a FlowDoc — the
 * issues are an authoring aid + the connect-time gate, not a runtime crash.
 */

import { flattenGroups } from './collapse';
import { dataSourceType, type PinContext } from './pins';
import { deriveGraphPins } from './scope';
import { assignable } from './types-check';
import type {
	ContainerEventDecl,
	DataEdge,
	DataSource,
	ExecEdge,
	FlowDoc,
	FunctionDef,
	FunctionLibraryDoc,
	Node,
	Pin,
	PinDir,
	PinKind,
	PinPath,
	TemplateVocabulary,
	TypeRef,
	VocabRequirement,
} from './types';

/** The stable issue codes. Exhaustive union so callers can switch on it safely. */
export type FlowIssueCode =
	| 'ref-unresolved'
	| 'exec-in-fanin'
	| 'data-in-fanin'
	| 'entry-has-exec-in'
	| 'edge-endpoint'
	| 'type-mismatch'
	| 'unfilled-data-in'
	| 'data-in-shadowed'
	| 'signal-cross-event'
	| 'literal-type'
	| 'accessor-unresolved'
	| 'fn-requires'
	| 'entry-outside-body'
	| 'fn-body-entry'
	| 'fn-body-result'
	| 'duplicate-id'
	| 'text-message-empty'
	| 'text-message-unreachable'
	| 'cinematic-await-loop'
	| 'cinematic-missing-ref';

export type FlowIssueSeverity = 'error' | 'warning';

/** Where an issue is located — a node, an edge, or a specific pin. */
export type FlowIssueAt =
	| { on: 'node'; node: string }
	| { on: 'pin'; node: string; pin: string }
	| { on: 'execEdge'; from: PinPath; to: PinPath }
	| { on: 'dataEdge'; from: PinPath; to: PinPath };

export interface FlowIssue {
	code: FlowIssueCode;
	severity: FlowIssueSeverity;
	message: string;
	at: FlowIssueAt;
}

// ---------------------------------------------------------------------------
// Small helpers over the graph.
// ---------------------------------------------------------------------------

/** Find a pin by id + direction + kind. `exec` is shared by the exec-in and exec-out of the
 *  same node (the schema convention), so a plain id lookup is ambiguous — the endpoint's
 *  direction/kind disambiguates which one an edge means. */
const pinOf = (pins: Pin[], id: string, dir?: PinDir, kind?: PinKind): Pin | undefined =>
	pins.find(
		(p) =>
			p.id === id &&
			(dir === undefined || p.dir === dir) &&
			(kind === undefined || p.kind === kind),
	);

/** Does a `literal` value match its declared pin type (best-effort JS-runtime check)? */
const literalMatches = (type: TypeRef, value: unknown): boolean => {
	switch (type.t) {
		case 'int':
		case 'ms':
			return typeof value === 'number' && Number.isInteger(value);
		case 'float':
			return typeof value === 'number';
		case 'bool':
			return typeof value === 'boolean';
		case 'string':
			return typeof value === 'string';
		case 'enum':
			return typeof value === 'string';
		case 'struct':
			return typeof value === 'object' && value !== null;
		case 'list':
			return Array.isArray(value);
	}
};

/** Is every requirement in `requires` present in the template vocabulary? */
const requirementSatisfied = (req: VocabRequirement, vocab: TemplateVocabulary): boolean => {
	const has = (names: string[] | undefined, pool: Set<string>) =>
		(names ?? []).every((n) => pool.has(n));
	return (
		has(req.events, new Set(vocab.events.map((e) => e.name))) &&
		has(req.actions, new Set(vocab.actions.map((a) => a.name))) &&
		has(req.cues, new Set(vocab.cues.map((c) => c.name))) &&
		has(req.structs, new Set(vocab.structs.map((s) => s.name))) &&
		has(req.enums, new Set(vocab.enums.map((e) => e.name))) &&
		has(req.collections, new Set(vocab.collections.map((c) => c.name)))
	);
};

/** Which of a node's data-ins are fed by an incoming data edge (so need no DataSource). */
const wiredDataIns = (nodeId: string, edges: DataEdge[]): Set<string> =>
	new Set(edges.filter((e) => e.to.node === nodeId).map((e) => e.to.pin));

/** Resolve a node's `ref`, if it has one, against the vocab/library. */
const refResolves = (node: Node, ctx: PinContext): boolean => {
	switch (node.kind) {
		case 'event':
			return ctx.vocab.events.some((e) => e.name === node.ref);
		case 'action':
			return ctx.vocab.actions.some((a) => a.name === node.ref);
		case 'fireCue':
			return ctx.vocab.cues.some((c) => c.name === node.ref);
		case 'functionCall':
			return ctx.library.functions.some((f) => f.id === node.ref);
		default:
			return true; // container refs are validated against the doc's own `containers` below.
	}
};

/** Count every node id in a graph INCLUDING those nested inside group bodies (recursively). */
const collectIdCounts = (
	graph: FlowDoc['graph'],
	counts: Map<string, number> = new Map(),
): Map<string, number> => {
	for (const n of graph.nodes) {
		counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
		if (n.kind === 'group') collectIdCounts(n.body, counts);
	}
	return counts;
};

/**
 * A `showContainer`'s FUSED container-event exec-out (§6.1, pin id `<componentId>.on<Event>`) — as
 * opposed to its plain `exec` continuation. These are their OWN entry roots, not part of the chain
 * that mounted the container: `runContainerEvent` starts a FRESH run at the edge's target and seeds
 * `trigger` with the COMPONENT EVENT's payload, not the event that led to the `showContainer`.
 */
const isContainerEventPin = (node: Node | undefined, pin: string): boolean =>
	node?.kind === 'showContainer' && pin !== 'exec';

/**
 * Which dispatches can reach each node — its exec-chain owner set.
 *
 * `runEvent` seeds exactly ONE `scope.trigger` per dispatch (the firing event's payload), and the
 * `gameSignals` node surfaces EVERY event's pins at once. So a signal's data-out is only meaningful
 * on the chain of the event it belongs to: `resolveDataOut` reads it as `scope.trigger[<field>]`
 * regardless of which pin it was dragged from. That fact is a property of the GRAPH (which entry
 * reaches this node), not of any single node — hence this pass.
 *
 * Walks the exec edges from every entry, each carrying its own trigger identity:
 *  - an `event` node → its `ref`;
 *  - a wired `gameSignals` exec-out → the pin id (which IS the event name);
 *  - a wired `showContainer` CONTAINER-EVENT pin → that pin's decl id (`<componentId>.on<Event>`),
 *    deliberately NOT a vocab event name: its payload is the component event's, which the template
 *    vocabulary does not declare, so `$trigger.<member>` on such a chain stays unjudged (never
 *    guess) while a cross-event `gameSignals` WIRE into it is still correctly caught.
 *
 * Keyed by (node × trigger) so a cyclic graph is bounded. A node no entry reaches (an orphan chain)
 * is ABSENT from the map — NEVER GUESS: callers leave it unchecked, matching how the scope pass
 * treats an unresolvable scope. KNOWN under-reports, both deliberate and conservative: a node
 * reachable from two chains is accepted if EITHER matches (it still resolves `undefined` on the
 * other), and `runEvent` prefers a dedicated `event` node over a same-named `gameSignals` chain, so
 * a shadowed signal chain is attributed an owner it never actually runs under.
 */
const eventOwners = (graph: FlowDoc['graph']): Map<string, Set<string>> => {
	const owners = new Map<string, Set<string>>();
	const seen = new Set<string>();
	const nodeById = new Map<string, Node>(graph.nodes.map((n) => [n.id, n]));

	const walk = (nodeId: string, trigger: string): void => {
		const stackKey = `${nodeId}|${trigger}`;
		if (seen.has(stackKey)) return;
		seen.add(stackKey);
		let set = owners.get(nodeId);
		if (!set) owners.set(nodeId, (set = new Set<string>()));
		set.add(trigger);
		for (const e of graph.exec) {
			if (e.from.node !== nodeId) continue;
			// A container-event pin re-roots below under its OWN trigger — it does not continue this one.
			if (isContainerEventPin(nodeById.get(nodeId), e.from.pin)) continue;
			walk(e.to.node, trigger);
		}
	};

	for (const node of graph.nodes) {
		for (const e of graph.exec) {
			if (e.from.node !== node.id) continue;
			if (node.kind === 'event') walk(e.to.node, node.ref);
			else if (node.kind === 'gameSignals') walk(e.to.node, e.from.pin);
			else if (isContainerEventPin(node, e.from.pin)) walk(e.to.node, e.from.pin);
		}
	}
	return owners;
};

/**
 * `duplicate-id` check on the RAW (pre-flatten) graph: any node id used more than once across the
 * graph + its group bodies. `flattenGroups` inlines a group's body (which keeps its ids), so a
 * collision makes two nodes share an id after flatten — and the runtime indexes/resolves edges BY id,
 * so they collapse and edges cross-wire. Flatten now re-namespaces the collision so it is no longer a
 * runtime break, hence a WARNING; but it is a data smell (a fixed id minter never produces one).
 */
const duplicateIdIssues = (graph: FlowDoc['graph']): FlowIssue[] => {
	const issues: FlowIssue[] = [];
	for (const [id, count] of collectIdCounts(graph)) {
		if (count > 1) {
			issues.push({
				code: 'duplicate-id',
				severity: 'warning',
				message: `node id '${id}' is used ${count} times (across the graph + its group bodies); flatten re-namespaces the collision, but the id minter should keep ids unique`,
				at: { on: 'node', node: id },
			});
		}
	}
	return issues;
};

// ---------------------------------------------------------------------------
// The validator.
// ---------------------------------------------------------------------------

export const validateFlowDoc = (
	doc: FlowDoc,
	vocab: TemplateVocabulary,
	library: FunctionLibraryDoc,
	// §6.1: the container-event surface (ContainerId → aggregated component-event decls). When supplied,
	// each `showContainer` node FUSES the matching container's configured component events as exec-out
	// pins (`derivePins`), so an edge from `spinButton.onSpin` resolves as a real endpoint. Optional so
	// every existing caller still compiles.
	containerEvents?: Record<string, ContainerEventDecl[]>,
): FlowIssue[] => {
	const ctx: PinContext = { vocab, library, containerEvents };
	const containerIds = new Set(doc.containers.map((c) => c.id));
	// The `duplicate-id` scan runs on the RAW graph (before flatten collapses group bodies in) — that
	// is where a body-vs-main id collision is visible. §5.2: the structural checks then run on the
	// FLATTENED graph so exec/data rules apply to the real semantics — a `group` is a pure fold, so its
	// boundary pins would otherwise look like unfilled/dangling endpoints.
	return [
		...duplicateIdIssues(doc.graph),
		...validateGraph(flattenGroups(doc.graph), ctx, {
			mode: 'flow',
			containerIds,
			templateId: doc.templateId,
		}),
	];
};

/**
 * Validate a `FunctionDef.body` as its own graph (§5). Runs the same structural/type checks as
 * `validateFlowDoc` — minus `entry-outside-body` (entry/result are LEGAL here) — and adds the
 * body-shape checks: exactly one `functionEntry` and one `functionResult`, both referencing this
 * function. A body has no containers, so container refs (if any) are reported as unresolved.
 */
export const validateFunctionDef = (
	fn: FunctionDef,
	vocab: TemplateVocabulary,
	library: FunctionLibraryDoc,
): FlowIssue[] => {
	const ctx: PinContext = { vocab, library };
	// §5.2: a function body may itself contain groups — flatten before the structural checks, but scan
	// the RAW body for duplicate ids first (a body's own group bodies can collide with it).
	const body = flattenGroups(fn.body);
	const issues = [
		...duplicateIdIssues(fn.body),
		...validateGraph(body, ctx, {
			mode: 'body',
			containerIds: new Set<string>(),
			templateId: fn.id,
		}),
	];

	const entries = body.nodes.filter((n) => n.kind === 'functionEntry' && n.ref === fn.id);
	const results = body.nodes.filter((n) => n.kind === 'functionResult' && n.ref === fn.id);
	if (entries.length !== 1) {
		issues.push({
			code: 'fn-body-entry',
			severity: 'error',
			message: `function '${fn.name}' body must contain exactly one functionEntry referencing it (found ${entries.length})`,
			at: { on: 'node', node: entries[0]?.id ?? fn.id },
		});
	}
	if (results.length !== 1) {
		issues.push({
			code: 'fn-body-result',
			severity: 'error',
			message: `function '${fn.name}' body must contain exactly one functionResult referencing it (found ${results.length})`,
			at: { on: 'node', node: results[0]?.id ?? fn.id },
		});
	}
	return issues;
};

interface GraphCheckOptions {
	mode: 'flow' | 'body';
	containerIds: Set<string>;
	templateId: string;
}

const validateGraph = (
	graph: FlowDoc['graph'],
	ctx: PinContext,
	opts: GraphCheckOptions,
): FlowIssue[] => {
	const { vocab, library } = ctx;
	const issues: FlowIssue[] = [];
	const { nodes, exec, data } = graph;
	const { containerIds } = opts;

	const nodeById = new Map<string, Node>(nodes.map((n) => [n.id, n]));
	// Pins come from the GRAPH pass, not from bare `derivePins`: a node alone cannot tell which
	// forEach body it sits in (so what `$item` is) nor what an incoming data edge carries (so what a
	// `forEach.in` fed by wire iterates). Both are what the two checks below need.
	const { pins: pinsById, scopeItem } = deriveGraphPins(graph, ctx);
	// Which event chain(s) reach each node — what makes a `gameSignals` wire / a `$trigger` accessor
	// judgeable. Empty for a function body (no event/gameSignals entries there) ⇒ both checks skip.
	const owners = eventOwners(graph);

	// --- (a) every node `ref` resolves; container refs resolve against the doc's containers ---
	for (const node of nodes) {
		// A screen-lifecycle `complete:<container>` event is valid when `<container>` is a real
		// container — the game dispatches it when that screen finishes (§A2, `dispatchFlowV2Complete`).
		// These are dynamic per-screen, so the template vocabulary can't enumerate them.
		const eventCompleteOk =
			node.kind === 'event' &&
			node.ref.startsWith('complete:') &&
			containerIds.has(node.ref.slice('complete:'.length));
		if (!refResolves(node, ctx) && !eventCompleteOk) {
			issues.push({
				code: 'ref-unresolved',
				// EVENTS are the OPEN input boundary: the game dispatches whatever name it likes (book
				// events, lifecycle/signals, a translated `complete:<screen>`), so an event ref outside
				// the vocab is a WARNING (fewer derived data-out pins), not an error. Actions/cues/
				// containers/functions are CLOSED (the game must implement them) → an error.
				severity: node.kind === 'event' ? 'warning' : 'error',
				message: `${node.kind} node '${node.id}' references unknown '${
					'ref' in node ? node.ref : ''
				}'`,
				at: { on: 'node', node: node.id },
			});
		}
		if (
			(node.kind === 'showContainer' || node.kind === 'hideContainer') &&
			!containerIds.has(node.ref)
		) {
			issues.push({
				code: 'ref-unresolved',
				severity: 'error',
				message: `${node.kind} node '${node.id}' references unknown container '${node.ref}'`,
				at: { on: 'node', node: node.id },
			});
		}
		// (§5) function entry/result nodes belong ONLY inside a `FunctionDef.body`.
		if (opts.mode === 'flow' && (node.kind === 'functionEntry' || node.kind === 'functionResult')) {
			issues.push({
				code: 'entry-outside-body',
				severity: 'error',
				message: `${node.kind} node '${node.id}' cannot appear in the top-level flow graph (it lives only inside a function body)`,
				at: { on: 'node', node: node.id },
			});
		}
	}

	// --- (b + c) edge endpoints + fan-in + entry-has-no-exec-in ---
	const execInCount = new Map<string, number>(); // key = `${node}${pin}`.
	const key = (p: PinPath) => `${p.node}${p.pin}`;

	const endpointOk = (p: PinPath, wantKind: PinKind, wantDir: PinDir): boolean => {
		const pins = pinsById.get(p.node);
		if (!pins) return false;
		return !!pinOf(pins, p.pin, wantDir, wantKind);
	};

	for (const edge of exec) {
		if (!endpointOk(edge.from, 'exec', 'out') || !endpointOk(edge.to, 'exec', 'in')) {
			issues.push({
				code: 'edge-endpoint',
				severity: 'error',
				message: `exec edge ${edge.from.node}.${edge.from.pin} → ${edge.to.node}.${edge.to.pin} has an invalid endpoint`,
				at: { on: 'execEdge', from: edge.from, to: edge.to },
			});
			continue;
		}
		execInCount.set(key(edge.to), (execInCount.get(key(edge.to)) ?? 0) + 1);
		// (c) an `event` (entry) node must have no incoming exec edge.
		const target = nodeById.get(edge.to.node);
		if (target?.kind === 'event') {
			issues.push({
				code: 'entry-has-exec-in',
				severity: 'error',
				message: `event node '${target.id}' is an entry point and cannot have an incoming exec edge`,
				at: { on: 'execEdge', from: edge.from, to: edge.to },
			});
		}
	}
	for (const [k, count] of execInCount) {
		if (count > 1) {
			const [node, pin] = k.split('');
			issues.push({
				code: 'exec-in-fanin',
				severity: 'error',
				message: `exec-in ${node}.${pin} has ${count} incoming exec edges (at most one predecessor allowed)`,
				at: { on: 'pin', node, pin },
			});
		}
	}

	// --- (b + d) data edges: endpoints, fan-in, and the type check ---
	const dataInCount = new Map<string, number>();
	for (const edge of data) {
		if (!endpointOk(edge.from, 'data', 'out') || !endpointOk(edge.to, 'data', 'in')) {
			issues.push({
				code: 'edge-endpoint',
				severity: 'error',
				message: `data edge ${edge.from.node}.${edge.from.pin} → ${edge.to.node}.${edge.to.pin} has an invalid endpoint`,
				at: { on: 'dataEdge', from: edge.from, to: edge.to },
			});
			continue;
		}
		dataInCount.set(key(edge.to), (dataInCount.get(key(edge.to)) ?? 0) + 1);

		// (d) type check: source data-out type must be assignable to the target data-in type.
		const fromPin = pinOf(pinsById.get(edge.from.node)!, edge.from.pin, 'out', 'data')!;
		const toPin = pinOf(pinsById.get(edge.to.node)!, edge.to.pin, 'in', 'data')!;
		if (fromPin.dataType && toPin.dataType && !assignable(fromPin.dataType, toPin.dataType)) {
			issues.push({
				code: 'type-mismatch',
				severity: 'error',
				message: `data edge ${edge.from.node}.${edge.from.pin} → ${edge.to.node}.${edge.to.pin}: ${typeName(
					fromPin.dataType,
				)} is not assignable to ${typeName(toPin.dataType)}`,
				at: { on: 'dataEdge', from: edge.from, to: edge.to },
			});
		}
	}
	for (const [k, count] of dataInCount) {
		if (count > 1) {
			const [node, pin] = k.split('');
			issues.push({
				code: 'data-in-fanin',
				severity: 'error',
				message: `data-in ${node}.${pin} has ${count} incoming data edges (at most one source allowed)`,
				at: { on: 'pin', node, pin },
			});
		}
	}

	// --- (d2) a `gameSignals` data-out only resolves on ITS OWN event's exec chain ---
	// The signals node shows every event's pins at once, so a wire across chains LOOKS authored but
	// reads `scope.trigger[<field>]` off the firing event's payload — i.e. `undefined`, which then
	// becomes `NaN` inside any effect that does arithmetic on it. Silent at runtime by design (the
	// interpreter never throws on an unresolved pin), so this is where it must be caught.
	for (const edge of data) {
		if (nodeById.get(edge.from.node)?.kind !== 'gameSignals') continue;
		const dot = edge.from.pin.indexOf('.');
		if (dot === -1) continue;
		const event = edge.from.pin.slice(0, dot);
		const reached = owners.get(edge.to.node);
		// Absent ⇒ no entry reaches the target (an orphan chain) ⇒ never guess.
		if (!reached || reached.has(event)) continue;
		// Sorted so the message is deterministic. An owner may be a container-event chain rather than a
		// vocab event, so the fix is phrased without naming a pin to re-source from (there may be none).
		const on = [...reached]
			.sort()
			.map((e) => `'${e}'`)
			.join(', ');
		issues.push({
			code: 'signal-cross-event',
			severity: 'error',
			message: `data edge ${edge.from.node}.${edge.from.pin} → ${edge.to.node}.${edge.to.pin}: this pin carries the '${event}' payload, but ${edge.to.node} runs on ${on} — it resolves to undefined every dispatch. Move the node onto the '${event}' chain, or feed this pin from the event whose chain it is already on.`,
			at: { on: 'dataEdge', from: edge.from, to: edge.to },
		});
	}

	// --- (e) every non-wired data-in has a valid DataSource (literal type / accessor scope) ---
	for (const node of nodes) {
		const pins = pinsById.get(node.id)!;
		const wired = wiredDataIns(node.id, data);
		for (const pin of pins) {
			if (pin.dir !== 'in' || pin.kind !== 'data') continue;
			if (wired.has(pin.id)) {
				// The edge WINS at runtime (`resolveDataIn` reads it before the node's own `inputs`), so a
				// literal/accessor left on the same pin is dead — and silently so, which reads as "my
				// accessor is being ignored". A `wire` source is the sanctioned "use the edge" marker.
				const shadowed = node.inputs?.[pin.id];
				if (shadowed && shadowed.kind !== 'wire') {
					issues.push({
						code: 'data-in-shadowed',
						severity: 'warning',
						message: `data-in ${node.id}.${pin.id} is fed by BOTH an incoming data edge and a stored ${shadowed.kind} source — the edge wins at runtime, so the ${shadowed.kind} is ignored`,
						at: { on: 'pin', node: node.id, pin: pin.id },
					});
				}
				continue;
			}
			const src = node.inputs?.[pin.id];
			if (!src) {
				// An OPTIONAL param (`ParamDecl.optional`) is meant to be leavable — the effect behind it
				// defaults the absent field. Erroring on it would flag the author for doing exactly what
				// the param's own help invites ("unset ⇒ the kind's default").
				if (pin.optional) continue;
				issues.push({
					code: 'unfilled-data-in',
					severity: 'error',
					message: `data-in ${node.id}.${pin.id} has no incoming edge and no literal/accessor source`,
					at: { on: 'pin', node: node.id, pin: pin.id },
				});
				continue;
			}
			validateDataSource(node, pin, src, ctx, scopeItem.get(node.id), owners.get(node.id), issues);
		}
	}

	// --- (f) each functionCall's target `requires` is satisfied by the template vocabulary ---
	for (const node of nodes) {
		if (node.kind !== 'functionCall') continue;
		const fn: FunctionDef | undefined = library.functions.find((f) => f.id === node.ref);
		if (!fn) continue; // already reported by (a) `ref-unresolved`.
		if (!requirementSatisfied(fn.requires, vocab)) {
			issues.push({
				code: 'fn-requires',
				severity: 'error',
				message: `functionCall '${node.id}' → '${fn.name}': template '${opts.templateId}' does not satisfy its vocabulary requirements`,
				at: { on: 'node', node: node.id },
			});
		}
	}

	// --- (h) playCinematic: awaiting a LOOPING cinematic can never resume. This is the one
	// combination that hangs a round forever rather than merely looking wrong, so it is an ERROR,
	// not a warning — the same failure mode as `showContainer{awaitComplete}` with no release.
	// A cinematic with no id is inert; that one is a warning (the graph still runs).
	for (const node of nodes) {
		if (node.kind !== 'playCinematic') continue;
		if (node.awaitComplete && node.loop) {
			issues.push({
				code: 'cinematic-await-loop',
				severity: 'error',
				message: `cinematic '${node.id}' loops AND awaits completion — a looping cinematic never completes, so the flow would hang here forever`,
				at: { on: 'node', node: node.id },
			});
		}
		if (!node.ref) {
			issues.push({
				code: 'cinematic-missing-ref',
				severity: 'warning',
				message: `cinematic '${node.id}' names no cinematic — it plays nothing`,
				at: { on: 'node', node: node.id },
			});
		}
	}

	// --- (g) textMessage authoring aids: blank text renders nothing; a message with neither a
	// state-gate nor an incoming `show` edge can never appear. Both are warnings (the graph still runs).
	for (const node of nodes) {
		if (node.kind !== 'textMessage') continue;
		if (!node.text.trim()) {
			issues.push({
				code: 'text-message-empty',
				severity: 'warning',
				message: `text message '${node.id}' has no text — it renders nothing and adds no localization key`,
				at: { on: 'node', node: node.id },
			});
		}
		const gated = node.visibleWhile !== undefined && node.visibleWhile !== 'none';
		const hasShowEdge = exec.some((e) => e.to.node === node.id && e.to.pin === 'show');
		if (!gated && !hasShowEdge) {
			issues.push({
				code: 'text-message-unreachable',
				severity: 'warning',
				message: `text message '${node.id}' has no "visible while" gate and no incoming Show edge — nothing can make it appear`,
				at: { on: 'node', node: node.id },
			});
		}
	}

	return issues;
};

// ---------------------------------------------------------------------------
// Per-data-in DataSource validation (check e's inner half).
// ---------------------------------------------------------------------------

const validateDataSource = (
	node: Node,
	pin: Pin,
	src: DataSource,
	ctx: PinContext,
	/** The enclosing forEach's element type (`deriveGraphPins`), when derivable. */
	scopeItem: TypeRef | undefined,
	/** The event chain(s) that reach this node (`eventOwners`) — what types `$trigger`. */
	triggerEvents: Set<string> | undefined,
	issues: FlowIssue[],
): void => {
	if (src.kind === 'wire') {
		// Declared `wire` but no incoming edge reached here (caller already excluded wired pins).
		issues.push({
			code: 'unfilled-data-in',
			severity: 'error',
			message: `data-in ${node.id}.${pin.id} is set to 'wire' but has no incoming data edge`,
			at: { on: 'pin', node: node.id, pin: pin.id },
		});
		return;
	}
	if (src.kind === 'literal') {
		if (pin.dataType && !assignable(src.type, pin.dataType)) {
			issues.push({
				code: 'literal-type',
				severity: 'error',
				message: `literal on ${node.id}.${pin.id} is ${typeName(src.type)} but the pin is ${typeName(
					pin.dataType,
				)}`,
				at: { on: 'pin', node: node.id, pin: pin.id },
			});
		} else if (pin.dataType && !literalMatches(pin.dataType, src.value)) {
			issues.push({
				code: 'literal-type',
				severity: 'error',
				message: `literal value on ${node.id}.${pin.id} does not match ${typeName(pin.dataType)}`,
				at: { on: 'pin', node: node.id, pin: pin.id },
			});
		}
		return;
	}
	// accessor — must resolve against the vocab/scope. `$engine.<key>` must be a known collection;
	// `$item.<member>` must be a real field of the loop's element struct; `$trigger.<member>` must be
	// a field of the event whose chain the node is on. The rule for scope-dependent accessors is
	// NEVER GUESS: they are only checked where the graph pass actually resolved the enclosing scope
	// (an unresolved `$input`/orphan-chain scope is accepted structurally).
	const acc = src.path;
	// `$trigger.<member>` is the accessor twin of the `signal-cross-event` wire check: both read the
	// FIRING event's payload, so a member the owning event doesn't declare is `undefined` at runtime.
	// (`accessorType` cannot type a `$trigger` read — it sees one node, not which chain it is on — so
	// the general type check at the bottom is dead for it; the single-owner case is typed here.)
	if (acc.on === 'trigger' && acc.member !== undefined && triggerEvents?.size) {
		const decls = [...triggerEvents]
			.map((name) => ctx.vocab.events.find((e) => e.name === name))
			.filter((e) => e !== undefined);
		// Judge ONLY when every owning trigger is a declared vocab event — a container-event chain
		// (`<componentId>.on<Event>`) or a `complete:<screen>` entry has no declared payload to check.
		if (decls.length === triggerEvents.size) {
			const field = decls.flatMap((e) => e.payload).find((p) => p.name === acc.member);
			if (!field) {
				const fields = decls.flatMap((e) => e.payload.map((p) => p.name));
				issues.push({
					code: 'accessor-unresolved',
					severity: 'error',
					message: `accessor $trigger.${acc.member} on ${node.id}.${pin.id} is not a field of ${decls
						.map((e) => `'${e.name}'`)
						.join('/')} (${fields.length ? fields.join(', ') : 'no payload fields'})`,
					at: { on: 'pin', node: node.id, pin: pin.id },
				});
				return;
			}
			// It resolves — now type it, but only from an UNAMBIGUOUS single owner: two owning events
			// could declare the same field name at different types, and we never guess.
			if (decls.length === 1 && pin.dataType && !assignable(field.type, pin.dataType)) {
				issues.push({
					code: 'type-mismatch',
					severity: 'error',
					message: `accessor $trigger.${acc.member} on ${node.id}.${pin.id} is ${typeName(
						field.type,
					)} but the pin is ${typeName(pin.dataType)}`,
					at: { on: 'pin', node: node.id, pin: pin.id },
				});
				return;
			}
		}
	}
	if (acc.on === 'engine' && !ctx.vocab.collections.some((c) => c.name === acc.key)) {
		issues.push({
			code: 'accessor-unresolved',
			severity: 'error',
			message: `accessor $engine.${acc.key} on ${node.id}.${pin.id} is not a known collection`,
			at: { on: 'pin', node: node.id, pin: pin.id },
		});
		return;
	}
	if (acc.on === 'item' && acc.member !== undefined && scopeItem) {
		if (scopeItem.t !== 'struct') {
			issues.push({
				code: 'accessor-unresolved',
				severity: 'error',
				message: `accessor $item.${acc.member} on ${node.id}.${pin.id} reads a member of ${typeName(
					scopeItem,
				)}, which has no members`,
				at: { on: 'pin', node: node.id, pin: pin.id },
			});
			return;
		}
		// An undeclared struct is a vocabulary gap, not an authoring error — don't guess its fields.
		const struct = ctx.vocab.structs.find((s) => s.name === scopeItem.name);
		if (struct && !struct.fields.some((f) => f.name === acc.member)) {
			issues.push({
				code: 'accessor-unresolved',
				severity: 'error',
				message: `accessor $item.${acc.member} on ${node.id}.${pin.id} is not a field of struct ${
					scopeItem.name
				} (${struct.fields.map((f) => f.name).join(', ')})`,
				at: { on: 'pin', node: node.id, pin: pin.id },
			});
			return;
		}
	}
	// The accessor RESOLVES — now check it carries the pin's type (the accessor twin of the data-edge
	// type check). Only fires when BOTH types are known.
	const accType = dataSourceType(ctx, src, scopeItem);
	if (accType && pin.dataType && !assignable(accType, pin.dataType)) {
		issues.push({
			code: 'type-mismatch',
			severity: 'error',
			message: `accessor on ${node.id}.${pin.id} is ${typeName(accType)} but the pin is ${typeName(
				pin.dataType,
			)}`,
			at: { on: 'pin', node: node.id, pin: pin.id },
		});
	}
};

/** A short human name for a `TypeRef`, for issue messages. */
const typeName = (t: TypeRef): string => {
	switch (t.t) {
		case 'enum':
			return `enum ${t.name}`;
		case 'struct':
			return `struct ${t.name}`;
		case 'list':
			return `list<${typeName(t.of)}>`;
		default:
			return t.t;
	}
};
