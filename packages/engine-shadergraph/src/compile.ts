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
 */

import {
	CUSTOM_ELEMENT_FX_PADDING_MAX,
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_PHASES,
	customElementFxKind,
	customElementFxMotionIssues,
	customElementFxPassIssues,
	elementFxParamSpecIssues,
	isCustomElementFxKind,
	type CustomElementFx,
	type CustomElementFxUniform,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import {
	DIMS,
	PARAM_TYPE,
	shaderNode,
	type DefaultExpr,
	type EmitContext,
	type NodeDef,
} from './nodes';
import {
	SHADER_GRAPH_VERSION,
	type GraphIssue,
	type GraphNode,
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
	/** Reachable nodes, every node after the nodes it reads. */
	order: GraphNode[];
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
	return analyze(doc).issues;
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

/** A doc's issues, port types and cost, nothing compiled. Never throws. */
export function analyzeShaderGraph(doc: ShaderGraphDoc): ShaderGraphAnalysis {
	const a = analyze(doc);
	return {
		issues: a.issues,
		inputs: Object.fromEntries(a.inputs),
		outputs: Object.fromEntries(a.outputs),
		cost: a.cost,
		samples: a.samples,
	};
}

function analyze(doc: ShaderGraphDoc): Analysis {
	const result: Analysis = {
		issues: [],
		order: [],
		readsPixel: false,
		outputs: new Map(),
		inputs: new Map(),
		generic: new Map(),
		feeds: new Map(),
		used: new Map(),
		cost: 0,
		samples: 0,
	};
	const issues = result.issues;
	const error = (code: GraphIssue['code'], message: string, node?: string, port?: string): void => {
		issues.push({
			level: 'error',
			code,
			message,
			...(node ? { node } : {}),
			...(port ? { port } : {}),
		});
	};
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
	const params = new Map(
		(Array.isArray(doc.params) ? doc.params : [])
			.filter((p) => p && typeof p.id === 'string')
			.map((p) => [p.id, p]),
	);
	for (const message of customElementFxPassIssues(doc.passes, params)) error('pass', message);
	for (const message of customElementFxMotionIssues(doc.motion)) error('motion', message);

	const nodes = new Map<string, GraphNode>();
	const defs = new Map<string, NodeDef>();
	for (const node of doc.nodes) {
		if (!node || typeof node.id !== 'string' || !node.id) {
			error('doc', 'a node has no id');
			continue;
		}
		if (nodes.has(node.id)) error('duplicate-node', `two nodes are "${node.id}"`, node.id);
		nodes.set(node.id, node);
		const def = shaderNode(node.type);
		if (!def) error('unknown-node', `"${String(node.type)}" is not a node`, node.id);
		else defs.set(node.id, def);
	}
	const outputs = [...defs].filter(([, def]) => def.type === 'output').map(([id]) => id);
	if (outputs.length !== 1)
		error(
			'output',
			outputs.length ? 'a graph has one Output, this one has several' : 'the graph has no Output',
		);

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
	for (const wire of doc.wires) {
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
	if (issues.some((i) => i.level === 'error' && UNWALKABLE.has(i.code))) return result;

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
	if (!visit(outputs[0])) return result;
	const reachable = sequence.length;
	for (const id of nodes.keys()) {
		if (!state.has(id))
			issues.push({
				level: 'warning',
				code: 'unreachable',
				message: `${defs.get(id)?.label ?? id} does not reach the Output and is left out`,
				node: id,
			});
	}
	for (const id of nodes.keys()) if (!visit(id)) return result;
	result.order = sequence.slice(0, reachable);

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

/** Compile a doc to a pass body, or say why not. Deterministic: the same doc, the same GLSL. */
export function compileShaderGraph(doc: ShaderGraphDoc): CompileResult {
	const a = analyze(doc);
	if (a.issues.some((i) => i.level === 'error')) return { ok: false, issues: a.issues };

	const paramIndex = new Map(doc.params.map((p, i) => [p.id, i]));
	const usedParams = new Set<string>();
	const lines: string[] = [];
	const names = new Map<string, Record<string, string>>();
	let finalColor = '';

	a.order.forEach((node, k) => {
		const def = shaderNode(node.type) as NodeDef;
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
		`    vec4 outColor = clamp(${finalColor}, 0.0, 1.0);`,
		'    finalColor = vec4(min(outColor.rgb, vec3(outColor.a)), outColor.a);',
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
			warnings: a.issues.filter((i) => i.level === 'warning'),
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
	if (!compiled.ok) return compiled;
	const { shader } = compiled;
	const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
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
			...(doc.motion ? { motion: plain(doc.motion) } : {}),
		},
		warnings: shader.warnings,
	};
}
