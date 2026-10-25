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

import { DIMS, shaderNode, type NodeDef, type PortDef } from './nodes';
import type {
	GraphIssue,
	GraphNode,
	GraphWire,
	PortType,
	ShaderGraphDoc,
	ShaderSubgraph,
	SubgraphPort,
} from './types';

/** A call: `values.subgraph` names the subgraph, its other values are its unwired inputs'. */
export const SUBGRAPH_CALL = 'subgraph';
/** A body's Input (an output per input of the subgraph) and Output (an input per output). */
export const SUBGRAPH_IN = 'subgraphIn';
export const SUBGRAPH_OUT = 'subgraphOut';
/** A call's port once inlined: one value through, at the port's type. Never in a saved doc. */
const SUBGRAPH_PORT = 'subgraphPort';

/** How deep calls nest: the effect calls one (1), whose body calls another (2), and so on. */
export const SUBGRAPH_DEPTH_MAX = 4;
/** Past this many nodes inlined in all, a call is refused: calls nested in calls multiply. */
export const SUBGRAPH_FLAT_NODES_MAX = 2000;

export const SUBGRAPH_PORT_TYPES: readonly PortType[] = ['float', 'vec2', 'vec3', 'vec4'];
const PORT_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

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

const isPort = (port: unknown): port is SubgraphPort =>
	isRecord(port) &&
	typeof port.id === 'string' &&
	PORT_ID.test(port.id) &&
	port.id !== SUBGRAPH_CALL &&
	(SUBGRAPH_PORT_TYPES as readonly unknown[]).includes(port.type);

/** A subgraph's well-formed ports on one side: those a call can show. */
const portsOf = (ports: unknown): SubgraphPort[] => {
	if (!Array.isArray(ports)) return [];
	const seen = new Set<string>();
	return ports.filter((p): p is SubgraphPort => {
		if (!isPort(p) || seen.has(p.id)) return false;
		seen.add(p.id);
		return true;
	});
};

/** Whether `value` is a number, or `type`'s width of them. */
const fits = (value: unknown, type: PortType): value is number | number[] =>
	(typeof value === 'number' && Number.isFinite(value)) ||
	(Array.isArray(value) &&
		value.length === DIMS[type] &&
		value.every((v) => typeof v === 'number' && Number.isFinite(v)));

/** What a port reads unwired: its default, else 0. */
const portDefault = (port: SubgraphPort): number | readonly number[] =>
	fits(port.default, port.type) ? port.default : 0;

const portLabel = (port: SubgraphPort): string =>
	typeof port.label === 'string' && port.label.trim() ? port.label : port.id;

const portDef = (port: SubgraphPort, unwired: boolean): PortDef => ({
	id: port.id,
	label: portLabel(port),
	type: port.type,
	...(unwired ? { default: portDefault(port) } : {}),
});

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
 * ports), or, inside subgraph `scope`'s body, that body's Input or Output. Undefined for a node no
 * def answers (an unknown type, a call to no subgraph, an Input outside a body).
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
	return shaderNode(node.type);
}

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
	for (const [side, ports] of [
		['input', sub.inputs],
		['output', sub.outputs],
	] as const) {
		if (!Array.isArray(ports)) {
			issues.push({ message: `its ${side}s are not a list` });
			continue;
		}
		const seen = new Set<string>();
		for (const port of ports) {
			const id = isRecord(port) && typeof port.id === 'string' ? port.id : '';
			if (!isRecord(port) || !PORT_ID.test(id) || id === SUBGRAPH_CALL) {
				issues.push({ message: `an ${side} is not named with a word (not "${SUBGRAPH_CALL}")` });
				continue;
			}
			if (seen.has(id)) issues.push({ message: `two ${side}s are "${id}"` });
			seen.add(id);
			if (!(SUBGRAPH_PORT_TYPES as readonly unknown[]).includes(port.type))
				issues.push({
					message: `${side} "${id}" is a ${String(port.type)}, not one of ${SUBGRAPH_PORT_TYPES.join(', ')}`,
				});
			else if (port.default !== undefined && !fits(port.default, port.type as PortType))
				issues.push({
					message: `${side} "${id}"'s default is not ${DIMS[port.type as PortType] === 1 ? 'a number' : `1 or ${DIMS[port.type as PortType]} numbers`}`,
				});
		}
	}
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
	for (const node of sub.nodes)
		if (isRecord(node) && node.type === 'output')
			issues.push({
				message:
					'the effect’s Output does not belong in a subgraph: wire into the subgraph’s Output',
				node: node.id,
			});
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
	/** Body nodes inlined so far, every level's: what {@link SUBGRAPH_FLAT_NODES_MAX} counts. */
	inlined: { nodes: number };
}

interface End {
	node: string;
	port: string;
}

/** A call's ports, as wires on its level reach them. */
interface CallEnds {
	def: NodeDef;
	inputs: Map<string, End>;
	outputs: Map<string, End>;
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
	inline(doc, flat, nodes, wires, { prefix: '', path: [], stack, depth, inlined: { nodes: 0 } });
	return flat;
}

function inline(
	doc: ShaderGraphDoc,
	flat: FlatShaderGraph,
	nodes: readonly GraphNode[],
	wires: readonly GraphWire[],
	level: Level,
): void {
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
			calls.set(node.id, inlineCall(doc, flat, node, level, wires, fail));
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
			source = call.outputs.get(from.port);
			if (!source) fail(from.node, `${call.def.label} has no output "${from.port}"`, from.port);
		} else if (level.body && from.node === level.body.in) {
			const pass = level.body.inputs.get(from.port);
			source = pass ? { node: pass, port: 'out' } : undefined;
			if (!pass) fail(from.node, `its Input has no "${from.port}"`);
		} else source = { node: local(from.node), port: from.port };
		if (callee) {
			target = callee.inputs.get(to.port);
			if (!target) fail(to.node, `${callee.def.label} has no input "${to.port}"`, to.port);
		} else if (level.body && to.node === level.body.out) {
			const pass = level.body.outputs.get(to.port);
			target = pass ? { node: pass, port: 'in' } : undefined;
			if (!pass) fail(to.node, `its Output has no "${to.port}"`);
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

/**
 * Why `call` cannot be inlined on `level`, or undefined when it can; `located` when the message
 * names the chain of subgraphs itself.
 */
function refusal(
	doc: ShaderGraphDoc,
	call: GraphNode,
	level: Level,
): { message: string; located?: boolean } | undefined {
	const id = calledSubgraph(call);
	if (!id) return { message: 'this call names no subgraph' };
	const all = (Array.isArray(doc.subgraphs) ? doc.subgraphs : []).filter(
		(s) => isRecord(s) && s.id === id,
	);
	const sub = all[0];
	if (!sub) return { message: `the effect has no subgraph "${id}"` };
	if (all.length > 1) return { message: `two subgraphs are "${id}"` };
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
	const broken = subgraphDefinitionIssues(sub);
	if (broken.length) return { message: broken.map((i) => `${name}: ${i.message}`).join('; ') };
	if (level.inlined.nodes + sub.nodes.length > SUBGRAPH_FLAT_NODES_MAX)
		return { message: `inlined, the effect passes ${SUBGRAPH_FLAT_NODES_MAX} nodes` };
	return undefined;
}

function inlineCall(
	doc: ShaderGraphDoc,
	flat: FlatShaderGraph,
	call: GraphNode,
	level: Level,
	wires: readonly GraphWire[],
	fail: (call: string, message: string, port?: string, located?: boolean) => void,
): CallEnds {
	const id = level.prefix + call.id;
	const owner = level.owner ?? call.id;
	const sub = subgraphOf(doc, calledSubgraph(call));
	const refused = refusal(doc, call, level);
	if (refused) {
		fail(call.id, refused.message, undefined, refused.located);
		// A stub: the subgraph's ports if it has any, else those the wires name, so the rest of the
		// graph still types.
		const wired = (side: 'from' | 'to'): string[] => [
			...new Set(
				wires
					.filter((w) => isRecord(w) && isRecord(w[side]) && w[side].node === call.id)
					.map((w) => w[side].port),
			),
		];
		const def: NodeDef = sub
			? { ...subgraphCallDef(sub), description: '' }
			: {
					type: SUBGRAPH_CALL,
					label: calledSubgraph(call) ?? 'Subgraph',
					category: 'subgraph',
					description: '',
					inputs: wired('to').map((p) => ({ id: p, label: p, type: 'any', default: 0 })),
					outputs: wired('from').map((p) => ({ id: p, label: p, type: 'float' })),
					cost: 0,
					emit: () => ({}),
				};
		flat.nodes.push(level.prefix ? { ...call, id } : call);
		flat.defs.set(id, def);
		if (level.owner) flat.origin.set(id, { node: owner, path: level.path });
		const ends = (ports: readonly PortDef[]): Map<string, End> =>
			new Map(ports.map((p) => [p.id, { node: id, port: p.id }]));
		return { def, inputs: ends(def.inputs), outputs: ends(def.outputs) };
	}

	const body = sub as ShaderSubgraph;
	level.inlined.nodes += body.nodes.length;
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
			const value = values?.[port.id];
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
	inline(doc, flat, body.nodes, body.wires, {
		prefix,
		path: [...level.path, subgraphName(body)],
		owner,
		stack: [...level.stack, body],
		depth: level.depth + 1,
		body: { in: inNode.id, out: outNode.id, inputs, outputs },
		inlined: level.inlined,
	});
	const ends = (made: Map<string, string>, port: 'in' | 'out'): Map<string, End> =>
		new Map([...made].map(([p, node]) => [p, { node, port }]));
	return { def: subgraphCallDef(body), inputs: ends(inputs, 'in'), outputs: ends(outputs, 'out') };
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
