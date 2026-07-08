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
 *  - `literal-type`        — a `literal` DataSource whose value doesn't match the pin type.
 *  - `accessor-unresolved` — an `accessor` DataSource that doesn't resolve in scope.
 *  - `fn-requires`         — a `functionCall` whose target's `requires` isn't satisfied by the
 *                            doc's `templateId` vocabulary.
 *  - `entry-outside-body`  — a `functionEntry`/`functionResult` in the TOP-LEVEL `FlowDoc.graph`
 *                            (§5: those two kinds live ONLY inside a `FunctionDef.body`).
 *  - `fn-body-entry`       — a `FunctionDef.body` lacks exactly one `functionEntry` referencing it.
 *  - `fn-body-result`      — a `FunctionDef.body` lacks exactly one `functionResult` referencing it.
 *
 * The checks mirror the schema's rules; a flagged doc is still structurally a FlowDoc — the
 * issues are an authoring aid + the connect-time gate, not a runtime crash.
 */

import { flattenGroups } from './collapse';
import { derivePins, type PinContext } from './pins';
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
	| 'literal-type'
	| 'accessor-unresolved'
	| 'fn-requires'
	| 'entry-outside-body'
	| 'fn-body-entry'
	| 'fn-body-result';

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
	// §5.2: validate the FLATTENED graph so exec/data rules apply to the real semantics — a `group` is
	// a pure fold, so its boundary pins would otherwise look like unfilled/dangling endpoints.
	return validateGraph(flattenGroups(doc.graph), ctx, {
		mode: 'flow',
		containerIds,
		templateId: doc.templateId,
	});
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
	// §5.2: a function body may itself contain groups — flatten before the structural checks.
	const body = flattenGroups(fn.body);
	const issues = validateGraph(body, ctx, {
		mode: 'body',
		containerIds: new Set<string>(),
		templateId: fn.id,
	});

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
	const pinsById = new Map<string, Pin[]>(nodes.map((n) => [n.id, derivePins(n, ctx)]));

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

	// --- (e) every non-wired data-in has a valid DataSource (literal type / accessor scope) ---
	for (const node of nodes) {
		const pins = pinsById.get(node.id)!;
		const wired = wiredDataIns(node.id, data);
		for (const pin of pins) {
			if (pin.dir !== 'in' || pin.kind !== 'data') continue;
			if (wired.has(pin.id)) continue; // fed by an edge — fine.
			const src = node.inputs?.[pin.id];
			if (!src) {
				issues.push({
					code: 'unfilled-data-in',
					severity: 'error',
					message: `data-in ${node.id}.${pin.id} has no incoming edge and no literal/accessor source`,
					at: { on: 'pin', node: node.id, pin: pin.id },
				});
				continue;
			}
			validateDataSource(node, pin, src, ctx, issues);
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
	// accessor — must resolve against the vocab/scope. `$engine.<key>` must be a known
	// collection; `$item`/`$index`/`$input` are only meaningful inside a loop/function body,
	// which the top-level pass can't confirm, so it accepts them structurally.
	const acc = src.path;
	if (acc.on === 'engine' && !ctx.vocab.collections.some((c) => c.name === acc.key)) {
		issues.push({
			code: 'accessor-unresolved',
			severity: 'error',
			message: `accessor $engine.${acc.key} on ${node.id}.${pin.id} is not a known collection`,
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
