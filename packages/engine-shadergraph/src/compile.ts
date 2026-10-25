/**
 * The COMPILER: a `ShaderGraphDoc` checked, typed and turned into the body of one Element FX
 * shader pass. The runtime hands the body to `ElementFxFilter`, whose header supplies `efxPx`,
 * `efxSample` and the rest and links in the `glslLibrary` building blocks it calls.
 *
 * Wiring rules, in the order a port's value is read:
 *  - a wired input takes its source's output: a float spreads over a vector (`vec3(x)`) and a
 *    longer vector feeds a shorter port by its leading parts (`v.xy`); a shorter vector cannot feed
 *    a longer one (Combine it), so nothing is guessed;
 *  - an unwired input takes the value the author set on the node, else the port's default, else
 *    its default expression (the pixel's UV, the play's progress, the element's colour there,
 *    read once as `pixel`);
 *  - an `any` port follows the node's widest input, so Add adds floats or vectors alike.
 *
 * The GLSL is assembled from the node library's templates, numeric literals and names this file
 * makes (`n3_out`, `uP0`): nothing an author types is copied into it.
 *
 * {@link compileShaderEffect} packs the result with the doc's passes and motion into a
 * `CustomElementFx`, which the runtime registers and plays as the kind `custom:<id>`.
 *
 * THE MOTION GRAPH (`doc.motionGraph`, step 8a) is checked by the same walk with every port a float
 * and compiled by {@link compileShaderMotion} to a motion program (`constants-shared/motionLibrary`)
 * the runtime interprets each frame; an effect whose motion graph is broken does not compile.
 * {@link compileShaderGraph}, {@link analyzeShaderGraph} and {@link validateShaderGraph} answer for
 * the pixel graph alone.
 */

import {
	CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT,
	CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX,
	CUSTOM_ELEMENT_FX_PADDING_MAX,
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_PHASES,
	customElementFxKind,
	customElementFxMotionIssues,
	customElementFxPassIssues,
	elementFxParamSpecIssues,
	elementFxParamUniform,
	isCustomElementFxKind,
	type CustomElementFx,
	type CustomElementFxMotionProgram,
	type CustomElementFxUniform,
	type ElementFxMotionOutput,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import {
	isMotionOpName,
	runMotionProgram,
	type MotionFrame,
	type MotionInput,
	type MotionOp,
	type MotionOpName,
} from 'constants-shared/motionLibrary';
import {
	DIMS,
	PARAM_TYPE,
	isMotionOnlyNode,
	motionNode,
	shaderNode,
	type DefaultExpr,
	type EmitContext,
	type MotionEmitContext,
	type NodeDef,
} from './nodes';
import {
	SUBGRAPH_IN,
	SUBGRAPH_OUT,
	flattenGraph,
	flattenShaderGraph,
	liftIssues,
	subgraphDefinitionIssues,
	subgraphInDef,
	subgraphOf,
	subgraphOutDef,
	type FlatShaderGraph,
} from './subgraph';
import {
	SHADER_GRAPH_VERSION,
	type GraphIssue,
	type GraphNode,
	type GraphWire,
	type PortType,
	type ShaderGraphDoc,
} from './types';

/** Above these a graph is flagged as heavy for a phone; it still compiles. */
export const COST_BUDGET = 400;
export const SAMPLE_BUDGET = 16;

export interface CompiledShader {
	/** Uniforms and `main`: the pass body `ElementFxFilter` takes. */
	body: string;
	uniforms: CustomElementFxUniform[];
	params: ElementFxParamSpec[];
	cost: number;
	samples: number;
	/** What is legal but worth knowing: unreachable nodes, a heavy graph. */
	warnings: GraphIssue[];
}

export type CompileResult =
	{ ok: true; shader: CompiledShader } | { ok: false; issues: GraphIssue[] };

export type ShaderEffectResult =
	| { ok: true; effect: CustomElementFx; warnings: GraphIssue[] }
	| { ok: false; issues: GraphIssue[] };

const TYPE_OF_DIMS: Record<number, PortType> = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'vec4' };

const DEFAULT_EXPR: Record<DefaultExpr, { glsl: string; type: PortType }> = {
	uv: { glsl: 'uv', type: 'vec2' },
	uvSquare: { glsl: 'uvSquare', type: 'vec2' },
	progress: { glsl: 'uFx.x', type: 'float' },
	seconds: { glsl: 'uFx.y', type: 'float' },
	sample: { glsl: 'pixel', type: 'vec4' },
};

/** `n` as a GLSL float literal; a negative one in parentheses, so `x - -1.0` never reads `--`. */
export const glslFloat = (n: number): string => {
	if (!Number.isFinite(n)) return '0.0';
	const text = /[.e]/i.test(String(n)) ? String(n) : `${n}.0`;
	return n < 0 ? `(${text})` : text;
};

const HEX = /^#[0-9a-f]{6}$/i;

const hexRgb = (hex: string): number[] =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);

const literal = (values: readonly number[], type: PortType): string => {
	const dims = DIMS[type];
	const parts = values.length === 1 ? Array<number>(dims).fill(values[0]) : values;
	return dims === 1 ? glslFloat(parts[0]) : `${type}(${parts.map(glslFloat).join(', ')})`;
};

/** `expr` of type `from` as type `to`, or undefined when a shorter vector would feed a longer port. */
const convert = (expr: string, from: PortType, to: PortType): string | undefined => {
	if (from === to) return expr;
	const [a, b] = [DIMS[from], DIMS[to]];
	if (a === 1) return `${to}(${expr})`;
	if (a > b) return b === 1 ? `(${expr}).x` : `(${expr}).${'xyzw'.slice(0, b)}`;
	return undefined;
};

const paramIssues = (params: unknown): GraphIssue[] =>
	Array.isArray(params)
		? elementFxParamSpecIssues(params).map((message) => ({
				level: 'error',
				code: 'param',
				message,
			}))
		: [{ level: 'error', code: 'doc', message: 'params is not a list' }];

/** Errors that leave no graph to order and type: an unknown or duplicated node, no single Output. */
const UNWALKABLE = new Set<GraphIssue['code']>(['unknown-node', 'duplicate-node', 'output']);

interface Analysis {
	issues: GraphIssue[];
	/** Each node's def: a library node's, or one a flattening made (a call's port, a stub). */
	defOf: (node: GraphNode) => NodeDef | undefined;
	/** Reachable nodes, every node after the nodes it reads. */
	order: GraphNode[];
	/** Every node, reachable first, each after the nodes it reads. */
	sequence: GraphNode[];
	/** Whether a reachable input reads the element's own colour at this pixel (`pixel`). */
	readsPixel: boolean;
	/** node id → port id → resolved type (outputs and inputs). */
	outputs: Map<string, Record<string, PortType>>;
	inputs: Map<string, Record<string, PortType>>;
	generic: Map<string, PortType>;
	/** node id → input port → the wire feeding it. */
	feeds: Map<string, Map<string, { node: string; port: string }>>;
	/** node id → its output ports something reachable reads. */
	used: Map<string, Set<string>>;
	cost: number;
	samples: number;
}

/** Check a doc: every error and warning, nothing compiled. */
export function validateShaderGraph(doc: ShaderGraphDoc): GraphIssue[] {
	return analyzeShaderGraph(doc).issues;
}

/**
 * Whether an output of type `from` can feed an input of type `to`: a float spreads over a vector
 * and a vector narrows, but a shorter vector never widens.
 */
export const canFeed = (from: PortType, to: PortType): boolean =>
	convert('x', from, to) !== undefined;

/** What an editor shows of a doc as it is being built. */
export interface ShaderGraphAnalysis {
	issues: GraphIssue[];
	/** Node id → port id → its resolved type. A check that stopped early (no Output, a cycle)
	 *  resolved none, and an editor falls back to the ports' declared types. */
	inputs: Record<string, Record<string, PortType>>;
	outputs: Record<string, Record<string, PortType>>;
	/** Work and reads of the element per pixel, against `COST_BUDGET` and `SAMPLE_BUDGET`. */
	cost: number;
	samples: number;
}

/**
 * A doc's issues, port types and cost, nothing compiled. Never throws. A call to a subgraph is
 * answered for as one node: what is wrong inside it is said about the call, its ports have the
 * subgraph's types and its cost is its body's.
 */
export function analyzeShaderGraph(doc: ShaderGraphDoc): ShaderGraphAnalysis {
	const flat = flattenShaderGraph(doc);
	const a = analyze(doc, flat);
	return {
		issues: liftIssues(flat, a.issues),
		...liftTypes(flat, a),
		cost: a.cost,
		samples: a.samples,
	};
}

/**
 * Subgraph `id`'s body on its own, as an editor shows it opened: its nodes' issues and port types
 * (its Input's and Output's as the subgraph declares them), and the cost of one call. A call inside
 * it is answered for as one node, as in {@link analyzeShaderGraph}.
 */
export function analyzeShaderSubgraph(doc: ShaderGraphDoc, id: string): ShaderGraphAnalysis {
	const result = newAnalysis();
	const sub = subgraphOf(doc, id);
	if (!sub) {
		pushError(result.issues, 'subgraph', `the effect has no subgraph "${id}"`);
		return { issues: result.issues, inputs: {}, outputs: {}, cost: 0, samples: 0 };
	}
	for (const issue of subgraphDefinitionIssues(sub, true))
		pushError(result.issues, 'subgraph', issue.message, issue.node);
	if (!Array.isArray(sub.nodes) || !Array.isArray(sub.wires))
		return { issues: result.issues, inputs: {}, outputs: {}, cost: 0, samples: 0 };
	const flat = flattenGraph(doc, sub.nodes, sub.wires, [sub], 1);
	const own = { [SUBGRAPH_IN]: subgraphInDef(sub), [SUBGRAPH_OUT]: subgraphOutDef(sub) };
	walk(result, paramsOf(doc), {
		nodes: flat.nodes,
		wires: flat.wires,
		defOf: (node) =>
			flat.defs.get(node.id) ??
			(node.type === SUBGRAPH_IN || node.type === SUBGRAPH_OUT
				? own[node.type]
				: shaderNode(node.type)),
		root: {
			type: SUBGRAPH_OUT,
			none: 'the subgraph has no Output node',
			several: 'a subgraph has one Output node, this one has several',
		},
	});
	const inputNodes = new Set(sub.nodes.filter((n) => n?.type === SUBGRAPH_IN).map((n) => n.id));
	return {
		// Inputs nothing inside reads are no fault of the Input.
		issues: liftIssues(flat, result.issues).filter(
			(i) => !(i.code === 'unreachable' && i.node && inputNodes.has(i.node)),
		),
		...liftTypes(flat, result),
		cost: result.cost,
		samples: result.samples,
	};
}

/** The port types of a flattened graph's analysis, for the graph's own nodes: a call's are its ports'. */
function liftTypes(
	flat: FlatShaderGraph,
	a: Analysis,
): Pick<ShaderGraphAnalysis, 'inputs' | 'outputs'> {
	if (!flat.origin.size)
		return { inputs: Object.fromEntries(a.inputs), outputs: Object.fromEntries(a.outputs) };
	const own = (types: Analysis['inputs']): Record<string, Record<string, PortType>> =>
		Object.fromEntries([...types].filter(([id]) => !flat.origin.has(id)));
	const inputs = own(a.inputs);
	const outputs = own(a.outputs);
	const through = (
		ports: Map<string, string>,
		types: Analysis['inputs'],
		port: 'in' | 'out',
	): Record<string, PortType> =>
		Object.fromEntries(
			[...ports].flatMap(([id, pass]) => {
				const type = types.get(pass)?.[port];
				return type ? [[id, type]] : [];
			}),
		);
	for (const [id, call] of flat.calls) {
		inputs[id] = through(call.inputs, a.inputs, 'in');
		outputs[id] = through(call.outputs, a.outputs, 'out');
	}
	return { inputs, outputs };
}

const newAnalysis = (): Analysis => ({
	issues: [],
	defOf: (node) => shaderNode(node.type),
	order: [],
	sequence: [],
	readsPixel: false,
	outputs: new Map(),
	inputs: new Map(),
	generic: new Map(),
	feeds: new Map(),
	used: new Map(),
	cost: 0,
	samples: 0,
});

function pushError(
	issues: GraphIssue[],
	code: GraphIssue['code'],
	message: string,
	node?: string,
	port?: string,
): void {
	issues.push({
		level: 'error',
		code,
		message,
		...(node ? { node } : {}),
		...(port ? { port } : {}),
	});
}

const paramsOf = (doc: ShaderGraphDoc): Map<string, ElementFxParamSpec> =>
	new Map(
		(Array.isArray(doc.params) ? doc.params : [])
			.filter((p) => p && typeof p.id === 'string')
			.map((p) => [p.id, p]),
	);

/**
 * A graph to check: its nodes and wires, how a node's def is found (and what to say of a type it
 * does not know), and the node it flows into. An `optional` root may be missing: then nothing is
 * reached and nothing is said of it.
 */
interface GraphWalk {
	nodes: GraphNode[];
	wires: GraphWire[];
	defOf: (node: GraphNode) => NodeDef | undefined;
	unknown?: (type: string) => string | undefined;
	root: { type: string; none: string; several: string; optional?: boolean; reach?: string };
}

/** `doc` checked; its graph as `flat` has it (every call inlined) when given. */
function analyze(doc: ShaderGraphDoc, flat?: FlatShaderGraph): Analysis {
	const result = newAnalysis();
	const issues = result.issues;
	const error = (code: GraphIssue['code'], message: string): void =>
		pushError(issues, code, message);
	if (!doc || typeof doc !== 'object') {
		error('doc', 'not a shader graph');
		return result;
	}
	if (doc.version !== SHADER_GRAPH_VERSION)
		error('version', `version ${JSON.stringify(doc.version)} is not ${SHADER_GRAPH_VERSION}`);
	if (typeof doc.id !== 'string' || !isCustomElementFxKind(customElementFxKind(doc.id)))
		error('doc', 'id must be a slug: letters, digits, - and _, up to 64');
	if (typeof doc.name !== 'string' || !doc.name.trim()) error('doc', 'the effect needs a name');
	if (doc.description !== undefined && typeof doc.description !== 'string')
		error('doc', 'description must be text');
	if (!(ELEMENT_FX_PHASES as readonly string[]).includes(doc.phase))
		error('doc', `phase "${String(doc.phase)}" is not one of ${ELEMENT_FX_PHASES.join(', ')}`);
	const { min: shortest, max: longest } = ELEMENT_FX_LIMITS.durationMs;
	if (!(
		typeof doc.durationMs === 'number' &&
		doc.durationMs >= shortest &&
		doc.durationMs <= longest
	))
		error('doc', `durationMs must be ${shortest}…${longest}`);
	if (
		doc.padding !== undefined &&
		!(
			typeof doc.padding === 'number' &&
			doc.padding >= 0 &&
			doc.padding <= CUSTOM_ELEMENT_FX_PADDING_MAX
		)
	)
		error('doc', `padding must be 0…${CUSTOM_ELEMENT_FX_PADDING_MAX}`);
	issues.push(...paramIssues(doc.params));
	if (!Array.isArray(doc.nodes) || !Array.isArray(doc.wires)) {
		error('doc', 'nodes and wires must be lists');
		return result;
	}
	const params = paramsOf(doc);
	for (const message of customElementFxPassIssues(doc.passes, params)) error('pass', message);
	for (const message of customElementFxMotionIssues(doc.motion)) error('motion', message);

	const walked = walk(result, params, {
		nodes: flat?.nodes ?? doc.nodes,
		wires: flat?.wires ?? doc.wires,
		defOf: (node) => flat?.defs.get(node.id) ?? shaderNode(node.type),
		unknown: (type) =>
			isMotionOnlyNode(type) ? `${motionNode(type)?.label} belongs in the motion graph` : undefined,
		root: {
			type: 'output',
			none: 'the graph has no Output',
			several: 'a graph has one Output, this one has several',
		},
	});
	if (!walked) return result;
	if (result.cost > COST_BUDGET)
		issues.push({
			level: 'warning',
			code: 'cost',
			message: `about ${result.cost} units of work a pixel, over the ${COST_BUDGET} a phone affords`,
		});
	if (result.samples > SAMPLE_BUDGET)
		issues.push({
			level: 'warning',
			code: 'cost',
			message: `${result.samples} reads of the element a pixel, over the ${SAMPLE_BUDGET} a phone affords`,
		});
	return result;
}

/**
 * Check a graph's nodes and wires, order what reaches its root and type every port, into `result`.
 * False when it stopped early: a graph that cannot be walked, or a loop.
 */
function walk(
	result: Analysis,
	params: Map<string, ElementFxParamSpec>,
	graph: GraphWalk,
): boolean {
	const issues = result.issues;
	const error = (code: GraphIssue['code'], message: string, node?: string, port?: string): void =>
		pushError(issues, code, message, node, port);
	result.defOf = graph.defOf;
	const nodes = new Map<string, GraphNode>();
	const defs = new Map<string, NodeDef>();
	for (const node of graph.nodes) {
		if (!node || typeof node.id !== 'string' || !node.id) {
			error('doc', 'a node has no id');
			continue;
		}
		if (nodes.has(node.id)) error('duplicate-node', `two nodes are "${node.id}"`, node.id);
		nodes.set(node.id, node);
		const def = graph.defOf(node);
		if (!def)
			error(
				'unknown-node',
				graph.unknown?.(String(node.type)) ?? `"${String(node.type)}" is not a node`,
				node.id,
			);
		else defs.set(node.id, def);
	}
	const outputs = [...defs].filter(([, def]) => def.type === graph.root.type).map(([id]) => id);
	if (outputs.length > 1 || (!outputs.length && !graph.root.optional))
		error('output', outputs.length ? graph.root.several : graph.root.none);

	// Settings: a choice among its options, a param the doc has, a number, a colour.
	for (const [id, def] of defs) {
		for (const setting of def.settings ?? []) {
			const value = nodes.get(id)?.values?.[setting.id];
			if (setting.kind === 'param') {
				if (value === undefined || value === '')
					error('setting', `${def.label} needs one of the effect's params picked`, id, setting.id);
				else if (typeof value !== 'string' || !params.has(value))
					error('setting', `"${String(value)}" is not one of the effect's params`, id, setting.id);
			} else if (value === undefined) {
				continue;
			} else if (setting.kind === 'choice') {
				if (typeof value !== 'string' || !setting.options.includes(value))
					error(
						'setting',
						`"${String(value)}" is not one of ${setting.options.join(', ')}`,
						id,
						setting.id,
					);
			} else if (setting.kind === 'number') {
				if (typeof value !== 'number' || !Number.isFinite(value))
					error('setting', 'not a number', id, setting.id);
			} else if (typeof value !== 'string' || !HEX.test(value)) {
				error('setting', 'not a #rrggbb colour', id, setting.id);
			}
		}
	}

	// Wires: real ports at both ends, each input fed once.
	for (const wire of graph.wires) {
		const from = defs.get(wire?.from?.node);
		const to = defs.get(wire?.to?.node);
		if (!from || !to) {
			error(
				'wire',
				'a wire ends at a node the graph does not have',
				wire?.to?.node ?? wire?.from?.node,
			);
			continue;
		}
		if (!from.outputs.some((p) => p.id === wire.from.port)) {
			error(
				'wire',
				`${from.label} has no output "${wire.from.port}"`,
				wire.from.node,
				wire.from.port,
			);
			continue;
		}
		if (!to.inputs.some((p) => p.id === wire.to.port)) {
			error('wire', `${to.label} has no input "${wire.to.port}"`, wire.to.node, wire.to.port);
			continue;
		}
		const feeds = result.feeds.get(wire.to.node) ?? new Map();
		if (feeds.has(wire.to.port))
			error(
				'wired-twice',
				`${to.label}'s ${wire.to.port} is wired twice`,
				wire.to.node,
				wire.to.port,
			);
		feeds.set(wire.to.port, wire.from);
		result.feeds.set(wire.to.node, feeds);
	}
	// Only a graph that cannot be walked stops here: an editor still gets the port types, the cost
	// and the reach of a graph whose name, settings or one wire is wrong.
	if (issues.some((i) => i.level === 'error' && UNWALKABLE.has(i.code))) return false;

	// Order: what the Output reads, each node after what it reads; a loop cannot be ordered. Nodes
	// that reach nothing follow, so they are checked like the rest but left out of the GLSL.
	const sequence: GraphNode[] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (id: string): boolean => {
		if (state.get(id) === 'done') return true;
		if (state.get(id) === 'visiting') {
			error('cycle', `${defs.get(id)?.label ?? id} feeds itself through a loop of wires`, id);
			return false;
		}
		state.set(id, 'visiting');
		for (const from of result.feeds.get(id)?.values() ?? []) if (!visit(from.node)) return false;
		state.set(id, 'done');
		sequence.push(nodes.get(id) as GraphNode);
		return true;
	};
	if (outputs.length && !visit(outputs[0])) return false;
	const reachable = sequence.length;
	for (const id of outputs.length ? nodes.keys() : []) {
		if (!state.has(id))
			issues.push({
				level: 'warning',
				code: 'unreachable',
				message: `${defs.get(id)?.label ?? id} does not reach ${graph.root.reach ?? 'the Output'} and is left out`,
				node: id,
			});
	}
	for (const id of nodes.keys()) if (!visit(id)) return false;
	result.order = sequence.slice(0, reachable);
	result.sequence = sequence;

	// Types, in order.
	for (const [index, node] of sequence.entries()) {
		const def = defs.get(node.id) as NodeDef;
		const feeds = result.feeds.get(node.id);
		const sourceType = (port: string): PortType | undefined => {
			const from = feeds?.get(port);
			return from ? result.outputs.get(from.node)?.[from.port] : undefined;
		};
		const valueOf = (port: string): unknown => node.values?.[port];
		let dims = 1;
		for (const input of def.inputs) {
			if (input.type !== 'any') continue;
			const wired = sourceType(input.id);
			const value = valueOf(input.id) ?? input.default;
			dims = Math.max(dims, wired ? DIMS[wired] : Array.isArray(value) ? value.length : 1);
		}
		const generic = TYPE_OF_DIMS[Math.min(4, dims)];
		result.generic.set(node.id, generic);
		const inTypes: Record<string, PortType> = {};
		for (const input of def.inputs) {
			const type = input.type === 'any' ? generic : input.type;
			inTypes[input.id] = type;
			const wired = sourceType(input.id);
			if (wired) {
				if (convert('x', wired, type) === undefined) {
					error(
						'type',
						`${def.label}'s ${input.label} takes a ${type}, not a ${wired}: ${type === 'vec4' && wired === 'vec3' ? 'Join colour gives it an alpha' : 'Combine or Split it'}`,
						node.id,
						input.id,
					);
				}
				continue;
			}
			const value = valueOf(input.id);
			if (value !== undefined) {
				const values = Array.isArray(value) ? value : [value];
				const fits = values.length === 1 || values.length === DIMS[type];
				if (!fits || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
					error(
						'value',
						`${def.label}'s ${input.label} takes ${DIMS[type] === 1 ? 'a number' : `${DIMS[type]} numbers`}`,
						node.id,
						input.id,
					);
				}
			} else if (input.default === undefined && input.defaultExpr) {
				const expr = DEFAULT_EXPR[input.defaultExpr];
				if (convert('x', expr.type, type) === undefined) {
					error(
						'type',
						`${def.label}'s ${input.label} takes a ${type}: wire one in`,
						node.id,
						input.id,
					);
				} else if (index < reachable && input.defaultExpr === 'sample') {
					result.readsPixel = true;
				}
			}
		}
		result.inputs.set(node.id, inTypes);
		const param = def.settings?.some((s) => s.kind === 'param')
			? params.get(String(node.values?.param))
			: undefined;
		const fixed = def.outputTypes?.(param) ?? {};
		const outTypes: Record<string, PortType> = {};
		for (const output of def.outputs) {
			outTypes[output.id] = fixed[output.id] ?? (output.type === 'any' ? generic : output.type);
		}
		result.outputs.set(node.id, outTypes);
		if (index >= reachable) continue;
		for (const from of feeds?.values() ?? []) {
			const used = result.used.get(from.node) ?? new Set<string>();
			used.add(from.port);
			result.used.set(from.node, used);
		}
		result.cost += def.cost;
		result.samples += def.samples ?? 0;
	}
	if (result.readsPixel) result.samples += 1;
	return true;
}

/**
 * Compile a doc to a pass body, or say why not. Deterministic: the same doc, the same GLSL. Every
 * call to a subgraph is inlined first, so the pass is one flat body.
 */
export function compileShaderGraph(doc: ShaderGraphDoc): CompileResult {
	const flat = flattenShaderGraph(doc);
	const a = analyze(doc, flat);
	const issues = liftIssues(flat, a.issues);
	if (issues.some((i) => i.level === 'error')) return { ok: false, issues };

	const paramIndex = new Map(doc.params.map((p, i) => [p.id, i]));
	const usedParams = new Set<string>();
	const lines: string[] = [];
	const names = new Map<string, Record<string, string>>();
	let finalColor = '';
	let addsLight = false;

	a.order.forEach((node, k) => {
		const def = a.defOf(node) as NodeDef;
		const inTypes = a.inputs.get(node.id) ?? {};
		const feeds = a.feeds.get(node.id);
		const generic = a.generic.get(node.id) ?? 'float';
		const inputs: Record<string, string> = {};
		for (const input of def.inputs) {
			const type = inTypes[input.id];
			const from = feeds?.get(input.id);
			if (from) {
				const sourceType = a.outputs.get(from.node)?.[from.port] as PortType;
				inputs[input.id] = convert(
					names.get(from.node)?.[from.port] as string,
					sourceType,
					type,
				) as string;
				continue;
			}
			const value = node.values?.[input.id] ?? input.default;
			if (value !== undefined) {
				inputs[input.id] = literal(
					Array.isArray(value) ? (value as number[]) : [value as number],
					type,
				);
			} else if (input.defaultExpr) {
				const expr = DEFAULT_EXPR[input.defaultExpr];
				inputs[input.id] = convert(expr.glsl, expr.type, type) as string;
			}
		}
		let locals = 0;
		const ctx: EmitContext = {
			in: inputs,
			type: generic,
			splat: (expr) => (generic === 'float' ? expr : `${generic}(${expr})`),
			setting: (id) => {
				const setting = def.settings?.find((s) => s.id === id);
				const value = node.values?.[id];
				if (!setting) return '0.0';
				if (setting.kind === 'param') {
					usedParams.add(String(value));
					return `uP${paramIndex.get(String(value))}`;
				}
				if (setting.kind === 'choice') {
					const at = setting.options.indexOf(typeof value === 'string' ? value : setting.default);
					return glslFloat(Math.max(0, at));
				}
				if (setting.kind === 'number')
					return glslFloat(typeof value === 'number' ? value : setting.default);
				return literal(
					hexRgb(typeof value === 'string' && HEX.test(value) ? value : setting.default),
					'vec3',
				);
			},
			local: (type, expr) => {
				const name = `n${k}_l${locals++}`;
				lines.push(`    ${type} ${name} = ${expr};`);
				return name;
			},
		};
		const emitted = def.emit(ctx);
		if (def.type === 'output') {
			finalColor = inputs.color;
			addsLight = node.values?.blend === 'add';
			return;
		}
		const outTypes = a.outputs.get(node.id) ?? {};
		const nodeNames: Record<string, string> = {};
		for (const output of def.outputs) {
			if (!a.used.get(node.id)?.has(output.id)) continue;
			const name = `n${k}_${output.id}`;
			lines.push(`    ${outTypes[output.id]} ${name} = ${emitted[output.id]};`);
			nodeNames[output.id] = name;
		}
		names.set(node.id, nodeNames);
	});

	const uniforms: CustomElementFxUniform[] = [
		{ name: 'uFx', type: 'vec4', source: { kind: 'time' } },
	];
	if (a.order.some((node) => node.type === 'seed'))
		uniforms.push({ name: 'uSeed', type: 'float', source: { kind: 'seed' } });
	for (const param of doc.params) {
		if (!usedParams.has(param.id)) continue;
		uniforms.push({
			name: `uP${paramIndex.get(param.id)}`,
			type: PARAM_TYPE[param.kind],
			source: { kind: 'param', id: param.id },
		});
	}
	const body = [
		...uniforms.map((u) => `uniform ${u.type} ${u.name};`),
		'',
		'void main(void)',
		'{',
		'    vec2 px = efxPx();',
		'    vec2 uv = efxToUnit(px);',
		'    vec2 uvSquare = uv * efxSize() / max(efxSize().x, efxSize().y);',
		...(a.readsPixel ? ['    vec4 pixel = efxSample(px);'] : []),
		...lines,
		...(addsLight
			? [`    finalColor = clamp(${finalColor}, 0.0, 1.0);`]
			: [
					`    vec4 outColor = clamp(${finalColor}, 0.0, 1.0);`,
					'    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);',
				]),
		'}',
		'',
	].join('\n');
	return {
		ok: true,
		shader: {
			body,
			uniforms,
			params: doc.params,
			cost: a.cost,
			samples: a.samples,
			warnings: issues.filter((i) => i.level === 'warning'),
		},
	};
}

/**
 * Compile a doc into a custom Element FX: its graph's pass body and uniforms, its passes and motion,
 * and the spec the pickers and the reader use. Register it with `setCustomElementFx` and it plays as
 * `custom:<id>`. Deterministic, and a plain value: it can be stored as JSON and shipped.
 */
export function compileShaderEffect(doc: ShaderGraphDoc): ShaderEffectResult {
	const compiled = compileShaderGraph(doc);
	const moving = compileShaderMotion(doc);
	if (!moving.ok)
		return { ok: false, issues: [...(compiled.ok ? [] : compiled.issues), ...moving.issues] };
	if (!compiled.ok) return compiled;
	const { shader } = compiled;
	const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
	const curves = doc.motion ? plain(doc.motion) : undefined;
	// The doc's motion is curves and a pivot; only its motion graph makes a program.
	if (curves && 'program' in curves) delete curves.program;
	const motion = moving.program
		? { ...(curves ?? { channels: {} }), program: moving.program }
		: curves;
	return {
		ok: true,
		effect: {
			spec: {
				kind: customElementFxKind(doc.id),
				label: doc.name.trim(),
				category: 'custom',
				phase: doc.phase,
				durationMs: doc.durationMs,
				description: doc.description ?? '',
				params: plain(doc.params),
			},
			shader: { body: shader.body, uniforms: shader.uniforms },
			padding: doc.padding ?? 0,
			passes: plain(doc.passes ?? []),
			...(motion ? { motion } : {}),
		},
		warnings: moving.warnings.length ? [...shader.warnings, ...moving.warnings] : shader.warnings,
	};
}

// -------------------------------------------------------------------------------------------------
// THE MOTION GRAPH: float nodes evaluated on the CPU each frame into one Motion Output. It is checked
// by the walk above, every node seen through `motionNode` (every port a float), and compiled to a
// motion program: a flat list of library ops on registers, each register written once, so the
// runtime interprets it in one pass and evaluates no code.
// -------------------------------------------------------------------------------------------------

export const MOTION_OUTPUT = 'motionOutput';
/** A motion graph has at most this many nodes and wires: a stored doc must not stall its compile. */
export const MOTION_GRAPH_NODE_LIMIT = 256;
export const MOTION_GRAPH_WIRE_LIMIT = 1024;

/** What an editor shows of a doc's motion graph as it is being built. */
export interface ShaderMotionAnalysis {
	/** Each names a node of the motion graph and carries `graph: 'motion'`. */
	issues: GraphIssue[];
	/** Node id → port id → its type (a float, but for a colour param, which is an error there). */
	types: {
		inputs: Record<string, Record<string, PortType>>;
		outputs: Record<string, Record<string, PortType>>;
	};
	/** The reachable nodes' cost, in the units the pixel graph's nodes count. */
	cost: number;
	/** The compiled program's ops, against `CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT`; 0 without one. */
	ops: number;
}

export type ShaderMotionResult =
	| { ok: true; program?: CustomElementFxMotionProgram; warnings: GraphIssue[] }
	| { ok: false; issues: GraphIssue[] };

/** A motion graph's walk, and what it compiled to. */
interface MotionRun {
	analysis: Analysis;
	/** Walked to the end: ordered and typed (no node it cannot place, no loop). */
	walked: boolean;
	program?: CustomElementFxMotionProgram;
}

const MOTION_ROOT = {
	type: MOTION_OUTPUT,
	none: 'the motion graph has no Motion Output, so it moves nothing',
	several: 'a motion graph has one Motion Output, this one has several',
	optional: true,
	reach: 'the Motion Output',
};

const motionUnknown = (type: string): string => {
	if (type === 'subgraph') return 'a subgraph cannot be called from the motion graph';
	const pixel = shaderNode(type);
	if (!pixel) return `"${type.length > 40 ? `${type.slice(0, 40)}…` : type}" is not a node`;
	return pixel.category === 'output'
		? `${pixel.label} belongs in the pixel graph`
		: `${pixel.label} works per pixel: the motion graph cannot run it`;
};

const motionGraphOf = (doc: ShaderGraphDoc): ShaderGraphDoc['motionGraph'] =>
	doc && typeof doc === 'object' ? doc.motionGraph : undefined;

/** The motion graph's ops so far, its constants, frame reads and params each made once. */
class MotionWriter {
	readonly ops: MotionOp[] = [];
	private readonly made = new Map<string, number>();

	private once(key: string, op: MotionOp): number {
		const at = this.made.get(key);
		if (at !== undefined) return at;
		this.ops.push(op);
		this.made.set(key, this.ops.length - 1);
		return this.ops.length - 1;
	}

	constant(value: number): number {
		const v = Number.isFinite(value) ? value || 0 : 0;
		return this.once(`c${v}`, ['const', v]);
	}

	read(input: MotionInput): number {
		return this.once(`r${input}`, [input]);
	}

	param(id: string): number {
		return this.once(`p${id}`, ['param', id]);
	}

	op(name: MotionOpName, args: number[]): number {
		this.ops.push([name, ...args]);
		return this.ops.length - 1;
	}
}

/**
 * Append `nodes` (in order, each after what feeds it) to `writer`: node id → output port → register.
 * A node in `broken`, or fed by one, is left out (and joins it). The Motion Output's wired inputs
 * become `outputs`.
 */
function writeMotion(
	run: MotionRun,
	nodes: readonly GraphNode[],
	broken: Set<string>,
	writer: MotionWriter,
): {
	regs: Map<string, Record<string, number>>;
	outputs: Partial<Record<ElementFxMotionOutput, number>>;
} {
	const a = run.analysis;
	const regs = new Map<string, Record<string, number>>();
	const outputs: Partial<Record<ElementFxMotionOutput, number>> = {};
	for (const node of nodes) {
		if (broken.has(node.id)) continue;
		const def = a.defOf(node) as NodeDef;
		const feeds = a.feeds.get(node.id);
		const inputs: Record<string, number> = {};
		let fed = true;
		for (const input of def.inputs) {
			const from = feeds?.get(input.id);
			if (from) {
				const reg = regs.get(from.node)?.[from.port];
				if (reg === undefined) fed = false;
				else inputs[input.id] = reg;
				continue;
			}
			const value = node.values?.[input.id] ?? input.default;
			if (value !== undefined) {
				inputs[input.id] = writer.constant(Array.isArray(value) ? value[0] : (value as number));
			} else if (input.defaultExpr === 'progress' || input.defaultExpr === 'seconds') {
				inputs[input.id] = writer.read(input.defaultExpr);
			}
		}
		if (!fed) {
			broken.add(node.id);
			continue;
		}
		if (def.type === MOTION_OUTPUT) {
			for (const input of def.inputs) {
				if (feeds?.has(input.id))
					outputs[input.id as ElementFxMotionOutput] = inputs[input.id] as number;
			}
			continue;
		}
		const ctx: MotionEmitContext = {
			in: inputs,
			args: def.inputs.map((input) => inputs[input.id] as number),
			setting: (id) => {
				const setting = def.settings?.find((s) => s.id === id);
				const value = node.values?.[id];
				if (setting?.kind === 'param') return writer.param(String(value));
				if (setting?.kind === 'number')
					return writer.constant(typeof value === 'number' ? value : setting.default);
				return writer.constant(0);
			},
			op: (name, ...args) => writer.op(name, args),
			read: (input) => writer.read(input),
		};
		regs.set(node.id, def.motion?.emit(ctx) ?? {});
	}
	return { regs, outputs };
}

/** `ops` with only what `roots` read, renumbered; `at` maps an old register to its new one. */
function pruneMotion(ops: readonly MotionOp[], roots: readonly number[]) {
	const live = new Uint8Array(ops.length);
	for (const r of roots) live[r] = 1;
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];
		if (!live[i] || !isMotionOpName(op[0])) continue;
		for (let k = 1; k < op.length; k++) live[op[k] as number] = 1;
	}
	const at = new Int32Array(ops.length).fill(-1);
	const kept: MotionOp[] = [];
	ops.forEach((op, i) => {
		if (!live[i]) return;
		at[i] = kept.length;
		kept.push(
			isMotionOpName(op[0])
				? [op[0], ...(op.slice(1) as number[]).map((r) => at[r])]
				: (op.slice() as unknown as MotionOp),
		);
	});
	return { ops: kept, at };
}

/** Check `doc`'s motion graph and, when it is sound and drives something, compile its program. */
function runMotion(doc: ShaderGraphDoc): MotionRun {
	const run: MotionRun = { analysis: newAnalysis(), walked: false };
	const issues = run.analysis.issues;
	const graph = motionGraphOf(doc);
	if (graph === undefined) return run;
	if (
		!graph ||
		typeof graph !== 'object' ||
		!Array.isArray(graph.nodes) ||
		!Array.isArray(graph.wires)
	) {
		pushError(issues, 'doc', 'the motion graph needs a nodes list and a wires list');
		return run;
	}
	if (!graph.nodes.length && !graph.wires.length) return run;
	if (
		graph.nodes.length > MOTION_GRAPH_NODE_LIMIT ||
		graph.wires.length > MOTION_GRAPH_WIRE_LIMIT
	) {
		pushError(
			issues,
			'motion',
			`the motion graph has ${graph.nodes.length} nodes and ${graph.wires.length} wires: at most ${MOTION_GRAPH_NODE_LIMIT} and ${MOTION_GRAPH_WIRE_LIMIT}`,
		);
		return run;
	}
	const params = paramsOf(doc);
	run.walked = walk(run.analysis, params, {
		nodes: graph.nodes,
		wires: graph.wires,
		defOf: (node) => motionNode(node.type),
		unknown: motionUnknown,
		root: MOTION_ROOT,
	});
	for (const node of graph.nodes) {
		const spec = node?.type === 'param' ? params.get(String(node.values?.param)) : undefined;
		if (spec?.kind === 'color')
			pushError(
				issues,
				'setting',
				`"${spec.label}" is a colour: the motion graph reads number, switch and choice params`,
				node.id,
				'param',
			);
	}
	const root = graph.nodes.some((n) => n?.type === MOTION_OUTPUT);
	if (run.walked && !root)
		issues.push({ level: 'warning', code: 'output', message: MOTION_ROOT.none });
	if (!run.walked || !root || issues.some((i) => i.level === 'error')) return run;

	const writer = new MotionWriter();
	const { outputs } = writeMotion(run, run.analysis.order, new Set(), writer);
	const driven = Object.entries(outputs) as [ElementFxMotionOutput, number][];
	if (!driven.length) return run;
	const pruned = pruneMotion(
		writer.ops,
		driven.map(([, r]) => r),
	);
	if (pruned.ops.length > CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT) {
		pushError(
			issues,
			'cost',
			`the motion graph compiles to ${pruned.ops.length} steps, more than the ${CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT} a game runs`,
		);
		return run;
	}
	run.program = {
		ops: pruned.ops,
		outputs: Object.fromEntries(driven.map(([key, r]) => [key, pruned.at[r]])),
	};
	if (run.program.outputs.padding !== undefined) {
		const frame = seriesFrame(doc);
		const registers = new Float64Array(run.program.ops.length);
		let most = 0;
		for (let i = 0; i <= 32; i++) {
			frame.t = i / 32;
			frame.seconds = frame.t * playSecondsOf(doc);
			most = Math.max(most, runMotionProgram(run.program, frame, registers).padding ?? 0);
		}
		if (most > CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX)
			issues.push({
				level: 'warning',
				code: 'motion',
				message: `the padding reaches ${Math.round(most * 100) / 100} of the element's larger side at the params' defaults, past the ${CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX} a game makes room for: it is held there`,
				node: graph.nodes.find((n) => n?.type === MOTION_OUTPUT)?.id,
				port: 'padding',
			});
	}
	return run;
}

const tagged = (issues: GraphIssue[]): GraphIssue[] =>
	issues.map((issue) => ({ ...issue, graph: 'motion' }));

/**
 * A doc's motion graph: its issues (each on a motion-graph node, tagged `graph: 'motion'`), port
 * types, cost and program size, as an editor shows it. Never throws; a doc without one has none.
 */
export function analyzeShaderMotion(doc: ShaderGraphDoc): ShaderMotionAnalysis {
	const run = runMotion(doc);
	const a = run.analysis;
	return {
		issues: tagged(a.issues),
		types: { inputs: Object.fromEntries(a.inputs), outputs: Object.fromEntries(a.outputs) },
		cost: a.cost,
		ops: run.program?.ops.length ?? 0,
	};
}

/**
 * Compile a doc's motion graph to the program its effect carries (`CustomElementFxMotion.program`),
 * or say why not. No program when it has no motion graph or drives nothing (no Motion Output, or
 * none of its inputs wired). Deterministic.
 */
export function compileShaderMotion(doc: ShaderGraphDoc): ShaderMotionResult {
	const run = runMotion(doc);
	const issues = tagged(run.analysis.issues);
	if (issues.some((i) => i.level === 'error')) return { ok: false, issues };
	return { ok: true, ...(run.program ? { program: run.program } : {}), warnings: issues };
}

/** The seed a motion series reads unless told otherwise: the node thumbnails' (`/shaders`). */
const SERIES_SEED = 41;

export interface MotionSeriesOptions {
	/** The output to plot; on the Motion Output, the input (the channel it drives). Unset: the first. */
	port?: string;
	/**
	 * The frame but its time: unset, strength 1, looping when the effect is a loop, the params at
	 * their defaults, seed 41 and a 100 × 100 element.
	 */
	frame?: Partial<Omit<MotionFrame, 't' | 'seconds'>>;
}

/**
 * Motion-graph node `nodeId`'s value at `samples` moments over one play, t = 0 … 1 (its seconds as
 * the play's), for an editor to draw as a curve; built on the same program the game runs. Undefined
 * when it cannot be worked out: no such node or port, an unwired Motion Output input, a node that is
 * broken or fed by a broken one, or a graph that cannot be walked (a loop). A node that reaches
 * nothing is plotted all the same.
 */
export function motionNodeSeries(
	doc: ShaderGraphDoc,
	nodeId: string,
	samples: number,
	options: MotionSeriesOptions = {},
): number[] | undefined {
	const run = runMotion(doc);
	const a = run.analysis;
	const node = a.sequence.find((n) => n.id === nodeId);
	if (!run.walked || !node) return undefined;
	const broken = new Set(a.issues.flatMap((i) => (i.level === 'error' && i.node ? [i.node] : [])));
	const writer = new MotionWriter();
	const { regs } = writeMotion(run, a.sequence, broken, writer);
	let reg: number | undefined;
	if (node.type === MOTION_OUTPUT) {
		const channel =
			options.port ??
			motionNode(MOTION_OUTPUT)?.inputs.find((p) => a.feeds.get(nodeId)?.has(p.id))?.id;
		const from = channel ? a.feeds.get(nodeId)?.get(channel) : undefined;
		reg = from ? regs.get(from.node)?.[from.port] : undefined;
	} else {
		const port = options.port ?? a.defOf(node)?.outputs[0]?.id;
		reg = port ? regs.get(nodeId)?.[port] : undefined;
	}
	if (reg === undefined) return undefined;
	const pruned = pruneMotion(writer.ops, [reg]);
	const program = { ops: pruned.ops, outputs: { value: pruned.at[reg] } };
	const frame = seriesFrame(doc, options.frame);
	const registers = new Float64Array(program.ops.length);
	const count = Math.max(2, Math.min(4096, Math.floor(samples)));
	return Array.from({ length: count }, (_, i) => {
		frame.t = i / (count - 1);
		frame.seconds = frame.t * playSecondsOf(doc);
		return runMotionProgram(program, frame, registers).value as number;
	});
}

const playSecondsOf = (doc: ShaderGraphDoc): number =>
	(Number.isFinite(doc.durationMs) ? doc.durationMs : 1000) / 1000;

/** A frame of `doc` as a series reads it (see {@link MotionSeriesOptions}), at t = 0. */
function seriesFrame(doc: ShaderGraphDoc, given: MotionSeriesOptions['frame'] = {}): MotionFrame {
	const params = Array.isArray(doc.params) ? doc.params : [];
	return {
		t: 0,
		seconds: 0,
		intensity: given.intensity ?? 1,
		looping: given.looping ?? doc.phase === 'loop',
		params:
			given.params ??
			Object.fromEntries(
				params.flatMap((p) =>
					p && p.kind !== 'color' ? [[p.id, elementFxParamUniform(p, p.default)[0]]] : [],
				),
			),
		seed: given.seed ?? SERIES_SEED,
		width: given.width ?? 100,
		height: given.height ?? 100,
	};
}
