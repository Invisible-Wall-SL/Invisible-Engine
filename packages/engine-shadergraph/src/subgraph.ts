/**
 * SUBGRAPHS: groups of nodes an effect defines once (`ShaderGraphDoc.subgraphs`) and calls as often
 * as it likes, from its graph or from another subgraph's body. Nothing past the compiler sees one:
 * {@link flattenShaderGraph} inlines every call before a graph is checked or compiled, so the
 * shipped effect is one flat pass, and a doc without calls is checked and compiled exactly as
 * before.
 *
 * Inlining a call:
 *  - each node of the body joins the graph as `<call id>/<node id>`, a call inside it the same way
 *    again;
 *  - the body's Input becomes one pass-through node per input, typed as the input is declared: the
 *    wire into the call's port feeds it (converted as any wire is), else the call's value for the
 *    port, else the port's default, else 0. The body's Output likewise, one per output, read by the
 *    wires from the call's port. So a body reads its inputs at their declared types wherever it is
 *    called, as it does seen on its own;
 *  - a call that cannot be inlined (no such subgraph, one calling itself, calls nested deeper than
 *    {@link SUBGRAPH_DEPTH_MAX}, a body without its one Input and Output, ports that are not well
 *    formed) stays a stub with the call's ports, and the error is named on the call.
 *
 * What the analysis then says about an inlined node is said about the call it came from
 * ({@link liftIssues}); a body is checked on its own, with its Input and Output, by
 * `analyzeShaderSubgraph`.
 */

import { BREAK_OUTPUT, breakOutputDef } from './break';
import { CUSTOM_GLSL, customGlslDef } from './customGlsl';
import { shaderNode, type NodeDef } from './nodes';
import {
	SUBGRAPH_CALL,
	isRecord,
	portDef,
	portDefault,
	portLabel,
	portSideIssues,
	portsOf,
	quoted,
} from './ports';
import type {
	GraphIssue,
	GraphNode,
	GraphWire,
	ShaderGraphDoc,
	ShaderSubgraph,
	SubgraphPort,
} from './types';

/**
 * A call is `SUBGRAPH_CALL`: `values.subgraph` names the subgraph, its other values are its unwired
 * inputs'. The ports' rules (`SUBGRAPH_PORTS_MAX` a side, `SUBGRAPH_PORT_TYPES`) are `ports.ts`'s.
 */
export { SUBGRAPH_CALL, SUBGRAPH_PORTS_MAX, SUBGRAPH_PORT_TYPES } from './ports';
/** A body's Input (an output per input of the subgraph) and Output (an input per output). */
export const SUBGRAPH_IN = 'subgraphIn';
export const SUBGRAPH_OUT = 'subgraphOut';
/** A call's port once inlined: one value through, at the port's type. Never in a saved doc. */
const SUBGRAPH_PORT = 'subgraphPort';

/** How deep calls nest: the effect calls one (1), whose body calls another (2), and so on. */
export const SUBGRAPH_DEPTH_MAX = 4;
/**
 * Past this much inlined in all (each call's body nodes, wires and ports), a call is refused:
 * calls nested in calls multiply, and a stored doc must not stall whatever compiles it.
 */
export const SUBGRAPH_INLINED_MAX = 4000;
/** An effect has at most this many subgraphs. */
export const SUBGRAPH_COUNT_MAX = 64;

/** The subgraph a call node names, if it names one. */
export const calledSubgraph = (node: GraphNode): string | undefined =>
	typeof node.values?.subgraph === 'string' ? node.values.subgraph : undefined;

/** Subgraph `id` of `doc` (the first, should two share it). */
export const subgraphOf = (doc: ShaderGraphDoc, id: unknown): ShaderSubgraph | undefined =>
	typeof id === 'string' && Array.isArray(doc.subgraphs)
		? doc.subgraphs.find((s) => isRecord(s) && s.id === id)
		: undefined;

export const subgraphName = (sub: ShaderSubgraph): string =>
	typeof sub.name === 'string' && sub.name.trim() ? sub.name.trim() : String(sub.id);

/** A call of `sub`: its inputs and outputs as ports. Its cost is its body's, once inlined. */
export function subgraphCallDef(sub: ShaderSubgraph): NodeDef {
	return {
		type: SUBGRAPH_CALL,
		label: subgraphName(sub),
		category: 'subgraph',
		description: `The subgraph “${subgraphName(sub)}”: its nodes, as if wired in here. Open it to edit them, for every call.`,
		inputs: portsOf(sub.inputs).map((p) => portDef(p, true)),
		outputs: portsOf(sub.outputs).map((p) => portDef(p, false)),
		cost: 0,
		emit: () => ({}),
	};
}

/** The Input of `sub`'s body: what each call is wired or set to. */
export function subgraphInDef(sub: ShaderSubgraph): NodeDef {
	return {
		type: SUBGRAPH_IN,
		label: 'Input',
		category: 'subgraph',
		description:
			'The subgraph’s inputs: what each call is wired to, else the value set on the call, else the input’s default.',
		inputs: [],
		outputs: portsOf(sub.inputs).map((p) => portDef(p, false)),
		cost: 0,
		emit: () => ({}),
	};
}

/** The Output of `sub`'s body: what each call gives out. */
export function subgraphOutDef(sub: ShaderSubgraph): NodeDef {
	return {
		type: SUBGRAPH_OUT,
		label: 'Output',
		category: 'subgraph',
		description:
			'The subgraph’s outputs: what every call gives out. An output left unwired gives its default.',
		inputs: portsOf(sub.outputs).map((p) => portDef(p, true)),
		outputs: [],
		cost: 0,
		emit: () => ({}),
	};
}

/**
 * Node `node`'s def as the graph it sits in sees it: a library node's, a call's (its subgraph's
 * ports), the effect's Break Output (the ports of the break it names), or, inside subgraph `scope`'s
 * body, that body's Input or Output. Undefined for a node no def answers (an unknown type, a call to
 * no subgraph, an Input outside a body, a Break Output inside one).
 */
export function graphNodeDef(
	doc: ShaderGraphDoc,
	node: GraphNode,
	scope?: string | null,
): NodeDef | undefined {
	if (node.type === SUBGRAPH_CALL) {
		const sub = subgraphOf(doc, calledSubgraph(node));
		return sub && subgraphCallDef(sub);
	}
	if (node.type === SUBGRAPH_IN || node.type === SUBGRAPH_OUT) {
		const sub = scope ? subgraphOf(doc, scope) : undefined;
		if (!sub) return undefined;
		return node.type === SUBGRAPH_IN ? subgraphInDef(sub) : subgraphOutDef(sub);
	}
	if (node.type === BREAK_OUTPUT) return scope ? undefined : breakOutputDef(node);
	if (node.type === CUSTOM_GLSL) return customGlslDef(node);
	return shaderNode(node.type);
}

/** Why a Break Output is refused in a subgraph's body. */
export const BREAK_IN_SUBGRAPH =
	'the Break Output belongs in the effect’s own graph, not in a subgraph';

/**
 * What is wrong with `sub` as a definition: its name, its ports, and its body's one Input and one
 * Output (`body`: seen on its own, where the analysis counts the Output). A node it names is the
 * body's.
 */
export function subgraphDefinitionIssues(
	sub: ShaderSubgraph,
	body = false,
): { message: string; node?: string }[] {
	const issues: { message: string; node?: string }[] = [];
	if (!isRecord(sub)) return [{ message: 'not a subgraph' }];
	if (typeof sub.id !== 'string' || !sub.id) issues.push({ message: 'it has no id' });
	if (typeof sub.name !== 'string' || !sub.name.trim()) issues.push({ message: 'it needs a name' });
	for (const message of portSideIssues('input', sub.inputs)) issues.push({ message });
	for (const message of portSideIssues('output', sub.outputs)) issues.push({ message });
	if (!Array.isArray(sub.nodes) || !Array.isArray(sub.wires)) {
		issues.push({ message: 'its nodes and wires must be lists' });
		return issues;
	}
	if (sub.nodes.some((n) => !isRecord(n) || typeof n.id !== 'string' || !n.id))
		issues.push({ message: 'a node in it has no id' });
	const count = (type: string, label: string, check: boolean): void => {
		const found = sub.nodes.filter((n) => isRecord(n) && n.type === type);
		if (!check) return;
		if (!found.length) issues.push({ message: `the subgraph has no ${label} node` });
		for (const extra of found.slice(1))
			issues.push({
				message: `a subgraph has one ${label} node, this one has several`,
				node: extra.id,
			});
	};
	count(SUBGRAPH_IN, 'Input', true);
	count(SUBGRAPH_OUT, 'Output', !body);
	for (const node of sub.nodes) {
		if (isRecord(node) && node.type === 'output')
			issues.push({
				message:
					'the effect’s Output does not belong in a subgraph: wire into the subgraph’s Output',
				node: node.id,
			});
		// Seen on its own, the body's analysis says so of the node.
		if (!body && isRecord(node) && node.type === BREAK_OUTPUT)
			issues.push({ message: BREAK_IN_SUBGRAPH, node: node.id });
	}
	return issues;
}

/** Where a node of a flattened graph came from. */
export interface FlatOrigin {
	/** The node of the graph flattened it stands for: the call it was inlined from. */
	node: string;
	/** For a call's own pass-through, the call's port it carries. */
	port?: string;
	/** The subgraphs it sits in, outermost first, by name: its messages say so. */
	path: string[];
}

/** One of the graph's own calls, inlined: each port's pass-through node, by port id. */
export interface FlatCall {
	sub: ShaderSubgraph;
	inputs: Map<string, string>;
	outputs: Map<string, string>;
}

export interface FlatShaderGraph {
	nodes: GraphNode[];
	wires: GraphWire[];
	/** The def of every node the flattening made: the calls' pass-throughs, and the stubs. */
	defs: Map<string, NodeDef>;
	/** Every node inlined from a call (not the graph's own), by its id here. */
	origin: Map<string, FlatOrigin>;
	/** The graph's own calls that were inlined, by node id. */
	calls: Map<string, FlatCall>;
	/** Why a call could not be inlined, or a wire to a port it lacks: named on the call. */
	issues: GraphIssue[];
}

/** What every level of one flattening shares. */
interface Context {
	doc: ShaderGraphDoc;
	flat: FlatShaderGraph;
	/** The doc's subgraphs by id (two under one id are refused), and how many it has. */
	byId: Map<string, ShaderSubgraph[]>;
	count: number;
	/** Inlined so far, every level's: what {@link SUBGRAPH_INLINED_MAX} counts. */
	inlined: number;
	/** Per subgraph, worked out once however often it is called: why its definition is refused. */
	broken: Map<ShaderSubgraph, string | undefined>;
	/** Per subgraph, a call's def and the ids of its ports. */
	calls: Map<ShaderSubgraph, CallDef>;
}

interface CallDef {
	def: NodeDef;
	inputs: Set<string>;
	outputs: Set<string>;
}

interface Level {
	/** `''` for the graph flattened; `<call id>/` (and so on down) for a body inlined into it. */
	prefix: string;
	path: string[];
	/** The graph's own call this level was inlined from: what its errors are named on. */
	owner?: string;
	/** The subgraphs being inlined, outermost first: one called again calls itself. */
	stack: readonly ShaderSubgraph[];
	/** How deep this level's calls are, less one. */
	depth: number;
	/** This level is a body: its Input's and Output's ports are these pass-throughs. */
	body?: { in: string; out: string; inputs: Map<string, string>; outputs: Map<string, string> };
}

interface End {
	node: string;
	port: string;
}

/** A call's ports, as wires on its level reach them. */
interface CallEnds {
	def: NodeDef;
	input(port: string): End | undefined;
	output(port: string): End | undefined;
}

/** `doc`'s graph with every call inlined. A graph without calls comes back as it is. */
export function flattenShaderGraph(doc: ShaderGraphDoc): FlatShaderGraph {
	return isRecord(doc)
		? flattenGraph(doc, doc.nodes, doc.wires, [], 0)
		: { nodes: [], wires: [], defs: new Map(), origin: new Map(), calls: new Map(), issues: [] };
}

/**
 * `nodes` and `wires` with every call inlined: the effect's graph, or a subgraph's body seen on its
 * own (`stack` holding it, `depth` 1), whose Input and Output stay as they are.
 */
export function flattenGraph(
	doc: ShaderGraphDoc,
	nodes: GraphNode[],
	wires: GraphWire[],
	stack: readonly ShaderSubgraph[],
	depth: number,
): FlatShaderGraph {
	const flat: FlatShaderGraph = {
		nodes,
		wires,
		defs: new Map(),
		origin: new Map(),
		calls: new Map(),
		issues: [],
	};
	if (
		!Array.isArray(nodes) ||
		!Array.isArray(wires) ||
		!nodes.some((n) => isRecord(n) && n.type === SUBGRAPH_CALL)
	)
		return flat;
	flat.nodes = [];
	flat.wires = [];
	const byId = new Map<string, ShaderSubgraph[]>();
	const subgraphs = Array.isArray(doc.subgraphs) ? doc.subgraphs : [];
	for (const sub of subgraphs)
		if (isRecord(sub) && typeof sub.id === 'string')
			byId.set(sub.id, [...(byId.get(sub.id) ?? []), sub]);
	const ctx: Context = {
		doc,
		flat,
		byId,
		count: subgraphs.length,
		inlined: 0,
		broken: new Map(),
		calls: new Map(),
	};
	inline(ctx, nodes, wires, { prefix: '', path: [], stack, depth });
	return flat;
}

function inline(
	ctx: Context,
	nodes: readonly GraphNode[],
	wires: readonly GraphWire[],
	level: Level,
): void {
	const { flat } = ctx;
	const where = level.path.length ? `${level.path.join(' › ')} › ` : '';
	/** `located`: the message names where it is itself, so the path does not lead it. */
	const fail = (call: string, message: string, port?: string, located = false): void => {
		flat.issues.push({
			level: 'error',
			code: 'subgraph',
			message: located ? message : `${where}${message}`,
			node: level.owner ?? call,
			...(port && !level.owner ? { port } : {}),
		});
	};
	const local = (id: string): string => {
		const here = level.prefix + id;
		if (level.owner && !flat.origin.has(here))
			flat.origin.set(here, { node: level.owner, path: level.path });
		return here;
	};
	/** Node id → the ports wires on this level name on it, worked out once and only if needed. */
	let named: Map<string, { to: Set<string>; from: Set<string> }> | undefined;
	const wiredPorts = (node: string): { to: Set<string>; from: Set<string> } => {
		if (!named) {
			named = new Map();
			const of = (id: string) => {
				const ports = named?.get(id) ?? { to: new Set<string>(), from: new Set<string>() };
				named?.set(id, ports);
				return ports;
			};
			for (const w of wires) {
				if (!isRecord(w) || !isRecord(w.from) || !isRecord(w.to)) continue;
				of(String(w.to.node)).to.add(String(w.to.port));
				of(String(w.from.node)).from.add(String(w.from.port));
			}
		}
		return named.get(node) ?? { to: new Set(), from: new Set() };
	};

	const calls = new Map<string, CallEnds>();
	/** Pass-throughs a wire already feeds: a call's input, or a body's output, takes one. */
	const fed = new Set<string>();
	for (const node of nodes) {
		if (!isRecord(node) || typeof node.id !== 'string') {
			if (!level.prefix) flat.nodes.push(node);
			continue;
		}
		// A body's Input and Output: their pass-throughs are already in.
		if (level.body && (node.type === SUBGRAPH_IN || node.type === SUBGRAPH_OUT)) continue;
		if (node.type === SUBGRAPH_CALL) {
			calls.set(node.id, inlineCall(ctx, node, level, wiredPorts, fail));
			continue;
		}
		flat.nodes.push(level.prefix ? { ...node, id: local(node.id) } : node);
	}

	for (const wire of wires) {
		if (!isRecord(wire) || !isRecord(wire.from) || !isRecord(wire.to)) {
			if (!level.prefix) flat.wires.push(wire);
			continue;
		}
		const from = wire.from as End;
		const to = wire.to as End;
		const call = calls.get(from.node);
		const callee = calls.get(to.node);
		let source: End | undefined;
		let target: End | undefined;
		if (call) {
			source = call.output(from.port);
			if (!source)
				fail(from.node, `${call.def.label} has no output ${quoted(from.port)}`, from.port);
		} else if (level.body && from.node === level.body.in) {
			const pass = level.body.inputs.get(from.port);
			source = pass ? { node: pass, port: 'out' } : undefined;
			if (!pass) fail(from.node, `its Input has no ${quoted(from.port)}`);
		} else source = { node: local(from.node), port: from.port };
		if (callee) {
			target = callee.input(to.port);
			if (!target) fail(to.node, `${callee.def.label} has no input ${quoted(to.port)}`, to.port);
		} else if (level.body && to.node === level.body.out) {
			const pass = level.body.outputs.get(to.port);
			target = pass ? { node: pass, port: 'in' } : undefined;
			if (!pass) fail(to.node, `its Output has no ${quoted(to.port)}`);
		} else target = { node: local(to.node), port: to.port };
		const pass = target && flat.defs.get(target.node);
		if (target && pass?.type === SUBGRAPH_PORT) {
			if (fed.has(target.node)) {
				fail(to.node, `${pass.label}'s ${pass.inputs[0].label} is wired twice`, to.port);
				continue;
			}
			fed.add(target.node);
		}
		if (source && target) flat.wires.push({ from: source, to: target });
	}
}

/** How much inlining `sub` once adds: its nodes, wires and ports. */
const inlinedSize = (sub: ShaderSubgraph): number =>
	sub.nodes.length + sub.wires.length + sub.inputs.length + sub.outputs.length;

/**
 * Why `call` cannot be inlined on `level`, or undefined when it can; `located` when the message
 * names the chain of subgraphs itself.
 */
function refusal(
	ctx: Context,
	call: GraphNode,
	level: Level,
): { message: string; located?: boolean } | undefined {
	const id = calledSubgraph(call);
	if (!id) return { message: 'this call names no subgraph' };
	if (ctx.count > SUBGRAPH_COUNT_MAX)
		return { message: `the effect has ${ctx.count} subgraphs, more than ${SUBGRAPH_COUNT_MAX}` };
	const all = ctx.byId.get(id) ?? [];
	const sub = all[0];
	if (!sub) return { message: `the effect has no subgraph ${quoted(id)}` };
	if (all.length > 1) return { message: `two subgraphs are ${quoted(id)}` };
	const name = subgraphName(sub);
	const at = level.stack.findIndex((s) => s.id === sub.id);
	if (at >= 0) {
		const through = level.stack.slice(at + 1).map(subgraphName);
		return {
			message: `${name} calls itself${through.length ? ` through ${through.join(' › ')}` : ''}`,
			located: true,
		};
	}
	if (level.depth + 1 > SUBGRAPH_DEPTH_MAX)
		return {
			message: `subgraphs nest deeper than ${SUBGRAPH_DEPTH_MAX} here (${[...level.stack.map(subgraphName), name].join(' › ')})`,
			located: true,
		};
	if (!ctx.broken.has(sub)) {
		const issues = subgraphDefinitionIssues(sub);
		const shown = issues.slice(0, 3).map((i) => `${name}: ${i.message}`);
		if (issues.length > 3) shown.push(`and ${issues.length - 3} more`);
		ctx.broken.set(sub, shown.length ? shown.join('; ') : undefined);
	}
	const broken = ctx.broken.get(sub);
	if (broken) return { message: broken };
	if (ctx.inlined + inlinedSize(sub) > SUBGRAPH_INLINED_MAX)
		return {
			message: `inlined, the effect passes ${SUBGRAPH_INLINED_MAX} nodes, wires and ports of subgraphs`,
		};
	return undefined;
}

/** A call of `sub`: its def and its ports' ids, made once per subgraph. */
function callDef(ctx: Context, sub: ShaderSubgraph): CallDef {
	let made = ctx.calls.get(sub);
	if (!made) {
		const def = subgraphCallDef(sub);
		made = {
			def,
			inputs: new Set(def.inputs.map((p) => p.id)),
			outputs: new Set(def.outputs.map((p) => p.id)),
		};
		ctx.calls.set(sub, made);
	}
	return made;
}

function inlineCall(
	ctx: Context,
	call: GraphNode,
	level: Level,
	wiredPorts: (node: string) => { to: Set<string>; from: Set<string> },
	fail: (call: string, message: string, port?: string, located?: boolean) => void,
): CallEnds {
	const { flat } = ctx;
	const id = level.prefix + call.id;
	const owner = level.owner ?? call.id;
	const named = calledSubgraph(call);
	const sub = named === undefined ? undefined : ctx.byId.get(named)?.[0];
	const refused = refusal(ctx, call, level);
	if (refused) {
		fail(call.id, refused.message, undefined, refused.located);
		// A stub: the subgraph's ports if it has any, else those the wires name, so the rest of the
		// graph still types.
		let stub: CallDef;
		if (sub) stub = callDef(ctx, sub);
		else {
			const { to, from } = wiredPorts(call.id);
			stub = {
				def: {
					type: SUBGRAPH_CALL,
					label: named === undefined ? 'Subgraph' : quoted(named),
					category: 'subgraph',
					description: '',
					inputs: [...to].map((p) => ({ id: p, label: p, type: 'any', default: 0 })),
					outputs: [...from].map((p) => ({ id: p, label: p, type: 'float' })),
					cost: 0,
					emit: () => ({}),
				},
				inputs: to,
				outputs: from,
			};
		}
		flat.nodes.push(level.prefix ? { ...call, id } : call);
		flat.defs.set(id, stub.def);
		if (level.owner) flat.origin.set(id, { node: owner, path: level.path });
		return {
			def: stub.def,
			input: (port) => (stub.inputs.has(port) ? { node: id, port } : undefined),
			output: (port) => (stub.outputs.has(port) ? { node: id, port } : undefined),
		};
	}

	const body = sub as ShaderSubgraph;
	ctx.inlined += inlinedSize(body);
	const inNode = body.nodes.find((n) => n.type === SUBGRAPH_IN) as GraphNode;
	const outNode = body.nodes.find((n) => n.type === SUBGRAPH_OUT) as GraphNode;
	const prefix = `${id}/`;
	const passes = (
		ports: SubgraphPort[],
		node: GraphNode,
		values: GraphNode['values'],
	): Map<string, string> => {
		const made = new Map<string, string>();
		for (const port of ports) {
			const here = `${prefix}${node.id}.${port.id}`;
			const value = values && Object.hasOwn(values, port.id) ? values[port.id] : undefined;
			flat.nodes.push({
				id: here,
				type: SUBGRAPH_PORT,
				x: call.x,
				y: call.y,
				...(value !== undefined ? { values: { in: value } } : {}),
			});
			flat.defs.set(here, {
				type: SUBGRAPH_PORT,
				label: subgraphName(body),
				category: 'subgraph',
				description: '',
				inputs: [{ id: 'in', label: portLabel(port), type: port.type, default: portDefault(port) }],
				outputs: [{ id: 'out', label: portLabel(port), type: port.type }],
				cost: 0,
				emit: (c) => ({ out: c.in.in }),
			});
			flat.origin.set(here, {
				node: owner,
				path: level.path,
				...(level.owner ? {} : { port: port.id }),
			});
			made.set(port.id, here);
		}
		return made;
	};
	const inputs = passes(body.inputs, inNode, call.values);
	const outputs = passes(body.outputs, outNode, outNode.values);
	if (!level.owner) flat.calls.set(call.id, { sub: body, inputs, outputs });
	inline(ctx, body.nodes, body.wires, {
		prefix,
		path: [...level.path, subgraphName(body)],
		owner,
		stack: [...level.stack, body],
		depth: level.depth + 1,
		body: { in: inNode.id, out: outNode.id, inputs, outputs },
	});
	const end =
		(made: Map<string, string>, port: 'in' | 'out') =>
		(id: string): End | undefined => {
			const node = made.get(id);
			return node ? { node, port } : undefined;
		};
	return { def: callDef(ctx, body).def, input: end(inputs, 'in'), output: end(outputs, 'out') };
}

/**
 * The analysis' issues about a flattened graph, said about the graph's own nodes: an inlined node's
 * about its call (its message led by the subgraphs it sits in), a pass-through's about the call's
 * port. Inside a call nothing counts as unreachable; a call none of whose outputs is read does.
 */
export function liftIssues(flat: FlatShaderGraph, issues: readonly GraphIssue[]): GraphIssue[] {
	if (!flat.origin.size && !flat.issues.length) return [...issues];
	const lifted: GraphIssue[] = [];
	const seen = new Set<string>();
	const push = (issue: GraphIssue): void => {
		const key = JSON.stringify([issue.level, issue.node, issue.port, issue.message]);
		if (seen.has(key)) return;
		seen.add(key);
		lifted.push(issue);
	};
	const unreachable = new Set(
		issues.filter((i) => i.code === 'unreachable' && i.node).map((i) => i.node),
	);
	for (const issue of flat.issues) push(issue);
	for (const issue of issues) {
		const from = issue.node ? flat.origin.get(issue.node) : undefined;
		if (!from) {
			push(issue);
			continue;
		}
		if (issue.code === 'unreachable') continue;
		push({
			level: issue.level,
			code: issue.code,
			message: from.path.length ? `${from.path.join(' › ')} › ${issue.message}` : issue.message,
			node: from.node,
			...(from.port ? { port: from.port } : {}),
			...(issue.line ? { line: issue.line } : {}),
		});
	}
	for (const [id, call] of flat.calls) {
		if ([...call.outputs.values()].every((pass) => unreachable.has(pass)))
			push({
				level: 'warning',
				code: 'unreachable',
				message: `${subgraphName(call.sub)} does not reach the Output and is left out`,
				node: id,
			});
	}
	return lifted;
}
