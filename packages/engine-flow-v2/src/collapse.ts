/**
 * Invisible Flow v2 — "Collapse to Function" (schema §5). A PURE, immutable transform: take a
 * SELECTION of nodes in a `FlowDoc.graph`, lift them out into a new `FunctionDef` (with an
 * implicit `functionEntry` + `functionResult` bridging the boundary), and replace them in the
 * main graph with a single `functionCall` node wired to the SAME external endpoints. The macro
 * behaviour is unchanged — it is Unreal's "Collapse to Function", authored once, reused anywhere.
 *
 * It clones everything and never mutates its inputs. On a structural error it returns `{ error }`
 * (empty selection, an id not in the graph, or a selection that swallows an entry point).
 *
 * The crossing contract (be precise):
 *  - Edges are partitioned by whether each endpoint is in the selection `S`:
 *      internal  (both ∈ S)      — moved into the body verbatim.
 *      crossIn   (to ∈ S, from ∉ S) — a value/exec flowing INTO the selection.
 *      crossOut  (from ∈ S, to ∉ S) — a value/exec flowing OUT of the selection.
 *      external  (neither ∈ S)   — untouched.
 *  - One function INPUT pin per distinct crossIn TARGET pin (exec-in/data-in fan-in is 1, so
 *    targets are already unique). One function OUTPUT pin per distinct crossOut SOURCE pin (a
 *    data-out may fan out to many external targets → still ONE output pin).
 *  - Body = selected nodes + internal edges + entry + result, with entry-out → each crossIn
 *    target, and each crossOut source → result-in.
 *  - Main = remove S + internal/crossIn/crossOut edges, ADD the functionCall (at S's centroid),
 *    and re-attach the EXTERNAL side of each crossing to the call's matching pin.
 */

import { derivePins, type PinContext } from './pins';
import type {
	DataEdge,
	DataSource,
	ExecEdge,
	FlowDoc,
	FunctionDef,
	FunctionId,
	FunctionLibraryDoc,
	Graph,
	GroupNode,
	GroupPin,
	Node,
	Pin,
	PinPath,
	TypeRef,
	VocabRequirement,
} from './types';

export interface CollapseParams {
	doc: FlowDoc;
	library: FunctionLibraryDoc;
	selection: string[];
	functionId: FunctionId;
	functionName: string;
}

export interface CollapseResult {
	doc: FlowDoc;
	library: FunctionLibraryDoc;
	functionId: FunctionId;
}

export type CollapseOutcome = CollapseResult | { error: string };

/** A deep structural clone that is safe for the plain-data graph/library/doc objects. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const samePin = (a: PinPath, b: PinPath): boolean => a.node === b.node && a.pin === b.pin;

/** The derived pin (with its type) at a `PinPath`, given the node + context. */
const pinAt = (path: PinPath, node: Node, ctx: PinContext): Pin | undefined =>
	derivePins(node, ctx).find((p) => p.id === path.pin);

export const collapseToFunction = (params: CollapseParams, ctx: PinContext): CollapseOutcome => {
	const { doc, library, selection, functionId, functionName } = params;
	const graph = doc.graph;
	const nodeById = new Map<string, Node>(graph.nodes.map((n) => [n.id, n]));

	// --- guard the selection ---
	if (selection.length === 0) return { error: 'selection is empty' };
	const S = new Set(selection);
	if (S.size !== selection.length) return { error: 'selection contains duplicate ids' };
	for (const id of selection) {
		const node = nodeById.get(id);
		if (!node) return { error: `selection id '${id}' is not a node in the graph` };
		if (node.kind === 'event') {
			return { error: `cannot collapse the entry point 'event' node '${id}'` };
		}
		if (node.kind === 'functionEntry' || node.kind === 'functionResult') {
			return { error: `cannot collapse a function boundary node '${id}'` };
		}
	}

	// --- partition every edge by its endpoints' membership in S ---
	const inSel = (p: PinPath) => S.has(p.node);
	type Bucket<E> = { internal: E[]; crossIn: E[]; crossOut: E[]; external: E[] };
	const partition = <E extends { from: PinPath; to: PinPath }>(edges: E[]): Bucket<E> => {
		const b: Bucket<E> = { internal: [], crossIn: [], crossOut: [], external: [] };
		for (const e of edges) {
			const fromIn = inSel(e.from);
			const toIn = inSel(e.to);
			if (fromIn && toIn) b.internal.push(e);
			else if (!fromIn && toIn) b.crossIn.push(e);
			else if (fromIn && !toIn) b.crossOut.push(e);
			else b.external.push(e);
		}
		return b;
	};
	const execB = partition(graph.exec);
	const dataB = partition(graph.data);

	// --- function INPUT pins: one per distinct crossIn TARGET pin (already unique per fan-in) ---
	interface BoundaryPin {
		pinId: string; // the FunctionDef pin id (in_<i> / out_<i>).
		endpoint: PinPath; // the ORIGINAL selected-side pin (target for in, source for out).
		kind: 'exec' | 'data';
		dataType?: TypeRef;
	}

	const inputs: BoundaryPin[] = [];
	const dedupeEndpoint = (list: BoundaryPin[], p: PinPath) =>
		list.find((bp) => samePin(bp.endpoint, p));

	/**
	 * Register a boundary pin keyed by its SELECTED-side endpoint. `typeFrom` is the pin on the
	 * WELL-TYPED side of the crossing (the data-out): a data-in target may be untyped (e.g. a
	 * forEach `in` fed by `wire`), so the input pin's type must come from the source data-out.
	 */
	const addBoundaryPin = (
		list: BoundaryPin[],
		endpoint: PinPath,
		typeFrom: PinPath,
		prefix: 'in' | 'out',
	): BoundaryPin | { error: string } => {
		const existing = dedupeEndpoint(list, endpoint);
		if (existing) return existing;
		const endNode = nodeById.get(endpoint.node)!;
		const endPin = pinAt(endpoint, endNode, ctx);
		if (!endPin) {
			return { error: `crossing endpoint ${endpoint.node}.${endpoint.pin} has no derivable pin` };
		}
		let dataType = endPin.dataType;
		if (endPin.kind === 'data') {
			const typeNode = nodeById.get(typeFrom.node)!;
			dataType = pinAt(typeFrom, typeNode, ctx)?.dataType ?? dataType;
		}
		const bp: BoundaryPin = {
			pinId: `${prefix}_${list.length}`,
			endpoint,
			kind: endPin.kind,
			dataType,
		};
		list.push(bp);
		return bp;
	};

	// crossIn: the SELECTED-side endpoint is `to`; the type comes from the external `from` data-out.
	for (const e of [...execB.crossIn, ...dataB.crossIn]) {
		const res = addBoundaryPin(inputs, e.to, e.from, 'in');
		if ('error' in res) return res;
	}

	const outputs: BoundaryPin[] = [];
	// crossOut: the SELECTED-side endpoint is `from` (a data-out) — already the well-typed side.
	for (const e of [...execB.crossOut, ...dataB.crossOut]) {
		const res = addBoundaryPin(outputs, e.from, e.from, 'out');
		if ('error' in res) return res;
	}

	// --- build the FunctionDef's declared pins (exec first, then data, §5) ---
	const toDefPin = (bp: BoundaryPin, dir: 'in' | 'out'): Pin =>
		bp.kind === 'exec'
			? { id: bp.pinId, dir, kind: 'exec' }
			: { id: bp.pinId, dir, kind: 'data', dataType: bp.dataType };

	// The call node / entry / result all use a canonical `exec` pin for control-flow; the exec
	// crossings collapse onto that single exec pin rather than one numbered pin each.
	const inputExecPins = inputs.filter((bp) => bp.kind === 'exec');
	const inputDataPins = inputs.filter((bp) => bp.kind === 'data');
	const outputExecPins = outputs.filter((bp) => bp.kind === 'exec');
	const outputDataPins = outputs.filter((bp) => bp.kind === 'data');

	const defInputs: Pin[] = [
		{ id: 'exec', dir: 'in', kind: 'exec' },
		...inputDataPins.map((bp) => toDefPin(bp, 'in')),
	];
	const defOutputs: Pin[] = [
		{ id: 'exec', dir: 'out', kind: 'exec' },
		...outputDataPins.map((bp) => toDefPin(bp, 'out')),
	];

	// --- centroid of the selection (call-node position) ---
	const centroid = { x: 0, y: 0 };
	for (const id of selection) {
		const n = nodeById.get(id)!;
		centroid.x += n.pos.x;
		centroid.y += n.pos.y;
	}
	centroid.x = Math.round(centroid.x / selection.length);
	centroid.y = Math.round(centroid.y / selection.length);

	// --- BODY graph: selected nodes (cloned, ids kept) + internal edges + entry + result ---
	const entryId = uniqueId('__entry', S, nodeById);
	const resultId = uniqueId('__result', S, nodeById);

	const bodyNodes: Node[] = selection.map((id) => clone(nodeById.get(id)!));
	bodyNodes.unshift({
		id: entryId,
		kind: 'functionEntry',
		pos: { x: centroid.x - 240, y: centroid.y },
		ref: functionId,
	});
	bodyNodes.push({
		id: resultId,
		kind: 'functionResult',
		pos: { x: centroid.x + 240, y: centroid.y },
		ref: functionId,
	});

	const bodyExec: ExecEdge[] = execB.internal.map(clone);
	const bodyData: DataEdge[] = dataB.internal.map(clone);

	// entry exec-out → each crossIn EXEC target; entry data-out(pinId) → each crossIn DATA target.
	for (const bp of inputExecPins) {
		bodyExec.push({ from: { node: entryId, pin: 'exec' }, to: clone(bp.endpoint) });
	}
	for (const bp of inputDataPins) {
		bodyData.push({ from: { node: entryId, pin: bp.pinId }, to: clone(bp.endpoint) });
	}
	// each crossOut EXEC source → result exec-in; each crossOut DATA source → result data-in(pinId).
	for (const bp of outputExecPins) {
		bodyExec.push({ from: clone(bp.endpoint), to: { node: resultId, pin: 'exec' } });
	}
	for (const bp of outputDataPins) {
		bodyData.push({ from: clone(bp.endpoint), to: { node: resultId, pin: bp.pinId } });
	}

	const body: Graph = { nodes: bodyNodes, exec: bodyExec, data: bodyData };

	// --- requires: scan the body for the template vocabulary it touches (incl. boundary types) ---
	const requires = scanRequires(bodyNodes, ctx, [
		...defInputs.map((p) => p.dataType),
		...defOutputs.map((p) => p.dataType),
	]);

	const fnDef: FunctionDef = {
		id: functionId,
		name: functionName,
		inputs: defInputs,
		outputs: defOutputs,
		body,
		requires,
	};

	// --- NEW MAIN GRAPH: drop S + internal/crossIn/crossOut edges; add the call node; re-attach ---
	const callId = uniqueId('call', new Set<string>(), nodeById);
	const callNode: Node = {
		id: callId,
		kind: 'functionCall',
		pos: { x: centroid.x, y: centroid.y },
		ref: functionId,
	};

	const mainNodes: Node[] = graph.nodes.filter((n) => !S.has(n.id)).map(clone);
	mainNodes.push(callNode);

	const mainExec: ExecEdge[] = execB.external.map(clone);
	const mainData: DataEdge[] = dataB.external.map(clone);

	// crossIn: external `from` → the call's matching INPUT pin.
	for (const e of execB.crossIn) {
		const bp = dedupeEndpoint(inputs, e.to)!;
		mainExec.push({
			from: clone(e.from),
			to: { node: callId, pin: bp.kind === 'exec' ? 'exec' : bp.pinId },
		});
	}
	for (const e of dataB.crossIn) {
		const bp = dedupeEndpoint(inputs, e.to)!;
		mainData.push({ from: clone(e.from), to: { node: callId, pin: bp.pinId } });
	}
	// crossOut: the call's matching OUTPUT pin → the original external target.
	for (const e of execB.crossOut) {
		const bp = dedupeEndpoint(outputs, e.from)!;
		mainExec.push({
			from: { node: callId, pin: bp.kind === 'exec' ? 'exec' : bp.pinId },
			to: clone(e.to),
		});
	}
	for (const e of dataB.crossOut) {
		const bp = dedupeEndpoint(outputs, e.from)!;
		mainData.push({ from: { node: callId, pin: bp.pinId }, to: clone(e.to) });
	}

	const newDoc: FlowDoc = {
		...clone(doc),
		graph: { nodes: mainNodes, exec: mainExec, data: mainData },
	};

	const newLibrary: FunctionLibraryDoc = {
		...clone(library),
		functions: [...library.functions.map(clone), fnDef],
	};

	return { doc: newDoc, library: newLibrary, functionId };
};

// ---------------------------------------------------------------------------
// §5.2 — "Collapse to Group": an INLINE, non-reusable fold. Mirrors collapseToFunction's edge
// partition, but every boundary crossing becomes its OWN pin (no exec-in fan-in), and the body
// lives ON the node (`GroupNode.body`) rather than in the shared function library. Collapse +
// `expandGroup` are exact inverses; `flattenGroups` expands ALL groups back before runtime/validate.
// ---------------------------------------------------------------------------

export interface CollapseToGroupParams {
	doc: FlowDoc;
	selection: string[];
	label: string;
}

export type CollapseToGroupOutcome = { doc: FlowDoc } | { error: string };

/** A descriptive label for a boundary pin, drawn from the internal endpoint's node (§5.2). */
const groupPinLabel = (node: Node): string => {
	if ('ref' in node && typeof node.ref === 'string' && node.ref.length > 0) return node.ref;
	if (node.kind === 'group') return node.label;
	return node.kind;
};

export const collapseToGroup = (
	params: CollapseToGroupParams,
	ctx: PinContext,
): CollapseToGroupOutcome => {
	const { doc, selection, label } = params;
	const graph = doc.graph;
	const nodeById = new Map<string, Node>(graph.nodes.map((n) => [n.id, n]));

	// --- guard the selection (mirrors collapseToFunction) ---
	if (selection.length === 0) return { error: 'selection is empty' };
	const S = new Set(selection);
	if (S.size !== selection.length) return { error: 'selection contains duplicate ids' };
	for (const id of selection) {
		const node = nodeById.get(id);
		if (!node) return { error: `selection id '${id}' is not a node in the graph` };
		if (node.kind === 'event' || node.kind === 'gameSignals') {
			return { error: `cannot group the entry point '${node.kind}' node '${id}'` };
		}
		if (node.kind === 'functionEntry' || node.kind === 'functionResult') {
			return { error: `cannot group a function boundary node '${id}'` };
		}
	}

	// --- partition every edge by its endpoints' membership in S ---
	const inSel = (p: PinPath) => S.has(p.node);
	type Bucket<E> = { internal: E[]; crossIn: E[]; crossOut: E[]; external: E[] };
	const partition = <E extends { from: PinPath; to: PinPath }>(edges: E[]): Bucket<E> => {
		const b: Bucket<E> = { internal: [], crossIn: [], crossOut: [], external: [] };
		for (const e of edges) {
			const fromIn = inSel(e.from);
			const toIn = inSel(e.to);
			if (fromIn && toIn) b.internal.push(e);
			else if (!fromIn && toIn) b.crossIn.push(e);
			else if (fromIn && !toIn) b.crossOut.push(e);
			else b.external.push(e);
		}
		return b;
	};
	const execB = partition(graph.exec);
	const dataB = partition(graph.data);

	// --- INPUT pins: one PER crossIn crossing (NO merge — the whole point vs collapseToFunction). Each
	// crossIn edge → one input pin keyed by its internal TARGET endpoint (`e.to`). An exec crossing is
	// ALWAYS distinct (fan-in of 1 means each internal target is already unique, so per-crossing =
	// per-target here). A data-in target is also unique per fan-in, so this is safe. ---
	const inputs: GroupPin[] = [];
	for (const e of [...execB.crossIn, ...dataB.crossIn]) {
		const endpoint = e.to;
		const endNode = nodeById.get(endpoint.node)!;
		const endPin = pinAt(endpoint, endNode, ctx);
		if (!endPin) {
			return { error: `crossing endpoint ${endpoint.node}.${endpoint.pin} has no derivable pin` };
		}
		// A data-in target may be untyped (a `wire`-fed forEach.in); take the type from the well-typed
		// source data-out (`e.from`).
		let dataType = endPin.dataType;
		if (endPin.kind === 'data') {
			const srcNode = nodeById.get(e.from.node)!;
			dataType = pinAt(e.from, srcNode, ctx)?.dataType ?? dataType;
		}
		inputs.push({
			id: `in_${inputs.length}`,
			dir: 'in',
			kind: endPin.kind,
			dataType: endPin.kind === 'data' ? dataType : undefined,
			label: groupPinLabel(endNode),
			inner: clone(endpoint),
		});
	}

	// --- OUTPUT pins: one per crossOut EXEC crossing (distinct), but data-outs DEDUPE by inner source
	// (a data-out fanning to several external targets is still ONE output pin). ---
	const outputs: GroupPin[] = [];
	for (const e of execB.crossOut) {
		const endpoint = e.from;
		const endNode = nodeById.get(endpoint.node)!;
		outputs.push({
			id: `out_${outputs.length}`,
			dir: 'out',
			kind: 'exec',
			label: groupPinLabel(endNode),
			inner: clone(endpoint),
		});
	}
	for (const e of dataB.crossOut) {
		const endpoint = e.from;
		if (outputs.some((p) => p.kind === 'data' && samePin(p.inner, endpoint))) continue; // dedupe.
		const endNode = nodeById.get(endpoint.node)!;
		const endPin = pinAt(endpoint, endNode, ctx);
		if (!endPin) {
			return { error: `crossing endpoint ${endpoint.node}.${endpoint.pin} has no derivable pin` };
		}
		outputs.push({
			id: `out_${outputs.length}`,
			dir: 'out',
			kind: 'data',
			dataType: endPin.dataType,
			label: groupPinLabel(endNode),
			inner: clone(endpoint),
		});
	}

	// --- centroid of the selection (group-node position) ---
	const centroid = { x: 0, y: 0 };
	for (const id of selection) {
		const n = nodeById.get(id)!;
		centroid.x += n.pos.x;
		centroid.y += n.pos.y;
	}
	centroid.x = Math.round(centroid.x / selection.length);
	centroid.y = Math.round(centroid.y / selection.length);

	// --- BODY graph: the selected nodes (ids kept) + INTERNAL edges only ---
	const body: Graph = {
		nodes: selection.map((id) => clone(nodeById.get(id)!)),
		exec: execB.internal.map(clone),
		data: dataB.internal.map(clone),
	};

	// --- the group node ---
	const groupId = uniqueId('group', new Set<string>(), nodeById);
	const groupNode: GroupNode = {
		id: groupId,
		kind: 'group',
		pos: { x: centroid.x, y: centroid.y },
		label,
		body,
		boundary: [...inputs, ...outputs],
	};

	// --- NEW MAIN GRAPH: drop S + internal/crossIn/crossOut edges; add the group; re-attach externals ---
	const mainNodes: Node[] = graph.nodes.filter((n) => !S.has(n.id)).map(clone);
	mainNodes.push(groupNode);

	const mainExec: ExecEdge[] = execB.external.map(clone);
	const mainData: DataEdge[] = dataB.external.map(clone);

	// Each crossIn edge maps 1:1 (by INDEX order) to the input pin appended for it above.
	const crossInEdges = [...execB.crossIn, ...dataB.crossIn];
	crossInEdges.forEach((e, i) => {
		const pin = inputs[i];
		const attach = { from: clone(e.from), to: { node: groupId, pin: pin.id } };
		if (pin.kind === 'exec') mainExec.push(attach);
		else mainData.push(attach);
	});
	// crossOut: the group's matching OUTPUT pin → the original external target.
	for (const e of execB.crossOut) {
		const pin = outputs.find((p) => p.kind === 'exec' && samePin(p.inner, e.from))!;
		mainExec.push({ from: { node: groupId, pin: pin.id }, to: clone(e.to) });
	}
	for (const e of dataB.crossOut) {
		const pin = outputs.find((p) => p.kind === 'data' && samePin(p.inner, e.from))!;
		mainData.push({ from: { node: groupId, pin: pin.id }, to: clone(e.to) });
	}

	const newDoc: FlowDoc = {
		...clone(doc),
		graph: { nodes: mainNodes, exec: mainExec, data: mainData },
	};
	return { doc: newDoc };
};

/**
 * The exact inverse of `collapseToGroup` (§5.2): re-insert the group's `body` into the main graph and
 * reconnect each external edge that touched a boundary pin to that pin's `inner` endpoint. Returns
 * `{ doc }` or `{ error }` (unknown id / not a group). Round-trips to graph-semantic identity.
 */
export const expandGroup = (doc: FlowDoc, groupNodeId: string): { doc: FlowDoc } | { error: string } => {
	const graph = doc.graph;
	const group = graph.nodes.find((n) => n.id === groupNodeId);
	if (!group) return { error: `group id '${groupNodeId}' is not a node in the graph` };
	if (group.kind !== 'group') return { error: `node '${groupNodeId}' is not a group node` };

	const pinById = new Map<string, GroupPin>(group.boundary.map((p) => [p.id, p]));

	// Nodes: everything except the group node, plus the body's nodes.
	const nodes: Node[] = graph.nodes.filter((n) => n.id !== groupNodeId).map(clone);
	for (const n of group.body.nodes) nodes.push(clone(n));

	// Edges: the body's internal edges, plus every main-graph edge re-routed away from the group node.
	const exec: ExecEdge[] = group.body.exec.map(clone);
	const data: DataEdge[] = group.body.data.map(clone);

	const reroute = <E extends { from: PinPath; to: PinPath }>(e: E): E | undefined => {
		const fromGroup = e.from.node === groupNodeId;
		const toGroup = e.to.node === groupNodeId;
		if (!fromGroup && !toGroup) return clone(e);
		// An INPUT boundary pin was `external source → group.pin`: reconnect to `→ inner`.
		if (toGroup) {
			const pin = pinById.get(e.to.pin);
			if (!pin) return undefined; // dangling — drop it (shouldn't happen for a well-formed group).
			return { ...clone(e), to: clone(pin.inner) };
		}
		// An OUTPUT boundary pin was `group.pin → external target`: reconnect to `inner →`.
		const pin = pinById.get(e.from.pin);
		if (!pin) return undefined;
		return { ...clone(e), from: clone(pin.inner) };
	};

	for (const e of graph.exec) {
		const r = reroute(e);
		if (r) exec.push(r);
	}
	for (const e of graph.data) {
		const r = reroute(e);
		if (r) data.push(r);
	}

	const newDoc: FlowDoc = { ...clone(doc), graph: { nodes, exec, data } };
	return { doc: newDoc };
};

/**
 * Recursively expand ALL `group` nodes in `graph` into their bodies (a body may itself contain a
 * group). Pure — returns a new `Graph` with no `group` node. This is the flatten pre-pass the runtime
 * + validator run so they never see a `group` (§5.2).
 */
export const flattenGroups = (graph: Graph): Graph => {
	let current = graph;
	// Iterate until no group remains (each pass expands the top-level groups; a nested group surfaces
	// on the next pass once its parent is flattened).
	while (current.nodes.some((n) => n.kind === 'group')) {
		const doc: FlowDoc = { version: 2, templateId: '', graph: current, containers: [] };
		const groupId = current.nodes.find((n) => n.kind === 'group')!.id;
		const out = expandGroup(doc, groupId);
		if ('error' in out) break; // defensive — a malformed group is left as-is rather than throwing.
		current = out.doc.graph;
	}
	return current;
};

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** A body/graph-unique node id built from `base` (suffixing until free). */
const uniqueId = (base: string, taken: Set<string>, nodeById: Map<string, Node>): string => {
	let id = base;
	let i = 0;
	while (taken.has(id) || nodeById.has(id)) id = `${base}_${++i}`;
	return id;
};

/**
 * Scan the selected body nodes for the template vocabulary they reference (§5 `requires`): the
 * event/action/cue names, any `$engine.<collection>` accessors, and the struct/enum type names
 * they touch (via derived pin types, forEach element types, literal/accessor operands, and the
 * function's own boundary-pin types passed in `boundaryTypes`).
 */
const scanRequires = (
	nodes: Node[],
	ctx: PinContext,
	boundaryTypes: (TypeRef | undefined)[] = [],
): VocabRequirement => {
	const events = new Set<string>();
	const actions = new Set<string>();
	const cues = new Set<string>();
	const structs = new Set<string>();
	const enums = new Set<string>();
	const collections = new Set<string>();

	const noteType = (t: TypeRef | undefined): void => {
		if (!t) return;
		if (t.t === 'struct') structs.add(t.name);
		else if (t.t === 'enum') enums.add(t.name);
		else if (t.t === 'list') noteType(t.of);
	};
	const noteSource = (src: DataSource | undefined): void => {
		if (!src) return;
		if (src.kind === 'literal') noteType(src.type);
		else if (src.kind === 'accessor' && src.path.on === 'engine') collections.add(src.path.key);
	};

	for (const node of nodes) {
		switch (node.kind) {
			case 'event':
				events.add(node.ref);
				break;
			case 'action':
				actions.add(node.ref);
				break;
			case 'fireCue':
				cues.add(node.ref);
				break;
			default:
				break;
		}
		// pin types the node exposes (covers action params, forEach element struct, etc.).
		for (const pin of derivePins(node, ctx)) noteType(pin.dataType);
		// literal/accessor sources on its data-ins.
		for (const src of Object.values(node.inputs ?? {})) noteSource(src);
		// compute operands may read $engine / carry typed literals too.
		if (node.kind === 'compute') {
			const op = node.compute;
			if (op.op === 'member') noteSource(op.on);
			else {
				noteSource(op.a);
				noteSource(op.b);
			}
		}
	}

	for (const t of boundaryTypes) noteType(t);

	const req: VocabRequirement = {};
	if (events.size) req.events = [...events];
	if (actions.size) req.actions = [...actions];
	if (cues.size) req.cues = [...cues];
	if (structs.size) req.structs = [...structs];
	if (enums.size) req.enums = [...enums];
	if (collections.size) req.collections = [...collections];
	return req;
};
