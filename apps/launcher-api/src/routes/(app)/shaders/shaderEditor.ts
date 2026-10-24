/**
 * Invisible Shader Graph's editing model (`/shaders`): every gesture is a pure `ShaderGraphDoc →
 * ShaderGraphDoc`, so the page swaps its `$state` doc and lets the analysis and the compile follow.
 * Nothing here validates a graph — `analyzeShaderGraph` does, and the doc may be broken while it
 * is being built.
 */

import {
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_MOTION_RANGES,
	ELEMENT_FX_PASS_KINDS,
	type CustomElementFxMotion,
	type CustomElementFxPass,
	type ElementFxCurve,
	type ElementFxMotionChannel,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import {
	SHADER_GRAPH_VERSION,
	SHADER_NODES,
	canFeed,
	shaderNode,
	type GraphNode,
	type GraphWire,
	type NodeCategory,
	type NodeDef,
	type PortType,
	type ShaderGraphAnalysis,
	type ShaderGraphDoc,
} from 'engine-shadergraph';

export const SHADER_DROP_MIME = 'application/shader-graph-node';

/** The library's families, in the order it lists them, with each header's colour. */
export const NODE_CATEGORIES: readonly { id: NodeCategory; label: string; color: string }[] = [
	{ id: 'input', label: 'Input', color: '#22c55e' },
	{ id: 'time', label: 'Time', color: '#0ea5e9' },
	{ id: 'math', label: 'Math', color: '#94a3b8' },
	{ id: 'procedural', label: 'Procedural', color: '#a855f7' },
	{ id: 'mask', label: 'Mask', color: '#f59e0b' },
	{ id: 'uv', label: 'UV', color: '#ec4899' },
	{ id: 'color', label: 'Colour', color: '#f43f5e' },
	{ id: 'output', label: 'Output', color: '#e2e8f0' },
];

/** A port's colour by type: one per width, as the wires read. */
export const PORT_COLORS: Record<PortType | 'any', string> = {
	float: '#94a3b8',
	vec2: '#34d399',
	vec3: '#60a5fa',
	vec4: '#f472b6',
	any: '#e2e8f0',
};

/** A graph's starting point: the Output alone, which draws the element as it is. */
export function newShaderDoc(id: string, name: string): ShaderGraphDoc {
	return {
		version: SHADER_GRAPH_VERSION,
		id,
		name,
		description: '',
		phase: 'loop',
		durationMs: 1200,
		params: [],
		nodes: [{ id: 'out', type: 'output', x: 360, y: 0 }],
		wires: [],
	};
}

const clone = (doc: ShaderGraphDoc): ShaderGraphDoc =>
	JSON.parse(JSON.stringify(doc)) as ShaderGraphDoc;

/** A node id of `type` no node of `doc` has. */
export function freshNodeId(doc: ShaderGraphDoc, type: string): string {
	const taken = new Set(doc.nodes.map((n) => n.id));
	const stem = type.replace(/[^A-Za-z0-9]/g, '') || 'node';
	let n = 1;
	while (taken.has(`${stem}${n}`)) n++;
	return `${stem}${n}`;
}

/** `doc` with a `type` node at `pos`, and the new node's id. */
export function addNode(
	doc: ShaderGraphDoc,
	type: string,
	pos: { x: number; y: number },
): { doc: ShaderGraphDoc; id: string } {
	const next = clone(doc);
	const id = freshNodeId(doc, type);
	next.nodes.push({ id, type, x: Math.round(pos.x), y: Math.round(pos.y) });
	return { doc: next, id };
}

/** A port's type as the analysis resolved it, else as its node declares it (`any` ⇒ float). */
function portType(
	analysis: ShaderGraphAnalysis | undefined,
	node: GraphNode | undefined,
	side: 'inputs' | 'outputs',
	port: string,
): PortType | 'any' | undefined {
	if (!node) return undefined;
	const resolved = analysis?.[side][node.id]?.[port];
	if (resolved) return resolved;
	return shaderNode(node.type)?.[side].find((p) => p.id === port)?.type;
}

/**
 * Whether `from`'s output can feed `to`'s input: never a node into itself, and the types must
 * convert (an input that follows its node's type takes anything; the node then follows it).
 */
export function canConnect(
	doc: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
	from: GraphWire['from'],
	to: GraphWire['to'],
): boolean {
	if (from.node === to.node) return false;
	const source = doc.nodes.find((n) => n.id === from.node);
	const target = doc.nodes.find((n) => n.id === to.node);
	const out = portType(analysis, source, 'outputs', from.port);
	const declared = shaderNode(target?.type ?? '')?.inputs.find((p) => p.id === to.port)?.type;
	if (!out || !declared) return false;
	if (declared === 'any') return true;
	return canFeed(out === 'any' ? 'float' : out, declared);
}

/** `doc` with `from` wired into `to`, replacing what fed `to` before: an input takes one wire. */
export function connect(
	doc: ShaderGraphDoc,
	from: GraphWire['from'],
	to: GraphWire['to'],
): ShaderGraphDoc {
	const next = clone(doc);
	next.wires = next.wires.filter((w) => !(w.to.node === to.node && w.to.port === to.port));
	next.wires.push({ from: { ...from }, to: { ...to } });
	return next;
}

export const wireId = (w: GraphWire): string =>
	`${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`;

/** `doc` without the nodes `ids` (and every wire touching them) and the wires `wireIds`. */
export function remove(
	doc: ShaderGraphDoc,
	ids: readonly string[],
	wireIds: readonly string[] = [],
): ShaderGraphDoc {
	const gone = new Set(ids);
	const cut = new Set(wireIds);
	const next = clone(doc);
	next.nodes = next.nodes.filter((n) => !gone.has(n.id));
	next.wires = next.wires.filter(
		(w) => !gone.has(w.from.node) && !gone.has(w.to.node) && !cut.has(wireId(w)),
	);
	return next;
}

export function moveNode(doc: ShaderGraphDoc, id: string, x: number, y: number): ShaderGraphDoc {
	const next = clone(doc);
	const node = next.nodes.find((n) => n.id === id);
	if (node) Object.assign(node, { x: Math.round(x), y: Math.round(y) });
	return next;
}

/** `doc` with node `id`'s value `key` set, or cleared (its port's default, its setting's). */
export function setNodeValue(
	doc: ShaderGraphDoc,
	id: string,
	key: string,
	value: number | number[] | string | undefined,
): ShaderGraphDoc {
	const next = clone(doc);
	const node = next.nodes.find((n) => n.id === id);
	if (!node) return doc;
	const values = { ...(node.values ?? {}) };
	if (value === undefined) delete values[key];
	else values[key] = value;
	if (Object.keys(values).length) node.values = values;
	else delete node.values;
	return next;
}

/** The library: every node but the Output, by family, as the page lists them. */
export function libraryGroups(): {
	id: NodeCategory;
	label: string;
	color: string;
	nodes: NodeDef[];
}[] {
	return NODE_CATEGORIES.map((c) => ({
		...c,
		nodes: SHADER_NODES.filter((d) => d.category === c.id && d.type !== 'output'),
	})).filter((g) => g.nodes.length);
}

export const categoryColor = (category: NodeCategory): string =>
	NODE_CATEGORIES.find((c) => c.id === category)?.color ?? '#94a3b8';

// ── Params ──────────────────────────────────────────────────────────────────────────────────────

const PARAM_DEFAULTS: Record<ElementFxParamSpec['kind'], (id: string) => ElementFxParamSpec> = {
	number: (id) => ({ id, label: 'Amount', kind: 'number', default: 1, min: 0, max: 2, step: 0.01 }),
	color: (id) => ({ id, label: 'Colour', kind: 'color', default: '#ffcc33' }),
	bool: (id) => ({ id, label: 'On', kind: 'bool', default: true }),
	choice: (id) => ({ id, label: 'Mode', kind: 'choice', default: 'a', options: ['a', 'b'] }),
};

/** `doc` with a new param of `kind`, its id one no param has. */
export function addParam(doc: ShaderGraphDoc, kind: ElementFxParamSpec['kind']): ShaderGraphDoc {
	const taken = new Set(doc.params.map((p) => p.id));
	let n = 1;
	while (taken.has(`${kind}${n}`)) n++;
	const next = clone(doc);
	next.params.push(PARAM_DEFAULTS[kind](`${kind}${n}`));
	return next;
}

/** `doc` with param `index` replaced by `spec`. */
export function setParam(
	doc: ShaderGraphDoc,
	index: number,
	spec: ElementFxParamSpec,
): ShaderGraphDoc {
	const next = clone(doc);
	if (index < 0 || index >= next.params.length) return doc;
	next.params[index] = JSON.parse(JSON.stringify(spec)) as ElementFxParamSpec;
	return next;
}

export function removeParam(doc: ShaderGraphDoc, index: number): ShaderGraphDoc {
	const next = clone(doc);
	next.params.splice(index, 1);
	return next;
}

// ── Passes ──────────────────────────────────────────────────────────────────────────────────────

export function addPass(doc: ShaderGraphDoc): ShaderGraphDoc {
	const next = clone(doc);
	next.passes = [...(next.passes ?? []), { kind: ELEMENT_FX_PASS_KINDS[0] }];
	return next;
}

export function setPass(
	doc: ShaderGraphDoc,
	index: number,
	pass: CustomElementFxPass,
): ShaderGraphDoc {
	const next = clone(doc);
	const passes = [...(next.passes ?? [])];
	if (index < 0 || index >= passes.length) return doc;
	passes[index] = JSON.parse(JSON.stringify(pass)) as CustomElementFxPass;
	next.passes = passes;
	return next;
}

export function removePass(doc: ShaderGraphDoc, index: number): ShaderGraphDoc {
	const next = clone(doc);
	const passes = (next.passes ?? []).filter((_, i) => i !== index);
	if (passes.length) next.passes = passes;
	else delete next.passes;
	return next;
}

// ── Motion ──────────────────────────────────────────────────────────────────────────────────────

/** A channel's rest: where a new curve starts and ends, so adding one moves nothing yet. */
const REST: Record<ElementFxMotionChannel, number> = {
	x: 0,
	y: 0,
	scale: 1,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	alpha: 1,
};

/** `doc` with `curve` on `channel`, or the channel cleared; no channels drops the motion. */
export function setMotionChannel(
	doc: ShaderGraphDoc,
	channel: ElementFxMotionChannel,
	curve: ElementFxCurve | undefined,
): ShaderGraphDoc {
	const next = clone(doc);
	const channels = { ...(next.motion?.channels ?? {}) };
	if (curve) channels[channel] = JSON.parse(JSON.stringify(curve)) as ElementFxCurve;
	else delete channels[channel];
	if (Object.keys(channels).length) {
		const motion: CustomElementFxMotion = { channels };
		if (next.motion?.pivot) motion.pivot = next.motion.pivot;
		next.motion = motion;
	} else delete next.motion;
	return next;
}

/** A new channel's curve: at rest at both ends, a key in the middle to pull. */
export function restCurve(channel: ElementFxMotionChannel): ElementFxCurve {
	const v = REST[channel];
	return [
		{ t: 0, v },
		{ t: 0.5, v, ease: 'smooth' },
		{ t: 1, v, ease: 'smooth' },
	];
}

export function setPivot(
	doc: ShaderGraphDoc,
	pivot: { x: number; y: number } | undefined,
): ShaderGraphDoc {
	const next = clone(doc);
	if (!next.motion) return doc;
	if (pivot) next.motion.pivot = { ...pivot };
	else delete next.motion.pivot;
	return next;
}

export const MOTION_LIMITS = ELEMENT_FX_MOTION_RANGES;
export const DURATION_LIMITS = ELEMENT_FX_LIMITS.durationMs;

// ── The canvas ──────────────────────────────────────────────────────────────────────────────────

/** What one node shows: its def, the types its ports resolved to and what the compiler said. */
export type ShaderNodeView = {
	node: GraphNode;
	def: NodeDef | undefined;
	inTypes: Record<string, PortType>;
	outTypes: Record<string, PortType>;
	/** The node's error messages; warnings mute the node instead. */
	errors: string[];
	warnings: string[];
	/** Inputs a wire feeds: an unwired one shows the value it reads. */
	wired: string[];
	/** What a setting reads as on the header (a choice, a param's label). */
	summary: string;
};

/** The canvas's nodes and wires for `doc`, as xyflow takes them. */
export function canvasGraph(
	doc: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
	selectedId: string | null,
): {
	nodes: {
		id: string;
		type: 'shader';
		position: { x: number; y: number };
		selected: boolean;
		data: ShaderNodeView;
	}[];
	edges: {
		id: string;
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle: string;
		style: string;
	}[];
} {
	const byNode = new Map<string, { errors: string[]; warnings: string[] }>();
	for (const issue of analysis?.issues ?? []) {
		if (!issue.node) continue;
		const entry = byNode.get(issue.node) ?? { errors: [], warnings: [] };
		(issue.level === 'error' ? entry.errors : entry.warnings).push(issue.message);
		byNode.set(issue.node, entry);
	}
	const params = new Map(doc.params.map((p) => [p.id, p]));
	const nodes = doc.nodes.map((node) => {
		const def = shaderNode(node.type);
		const summary = (def?.settings ?? [])
			.map((s) => {
				const value = node.values?.[s.id];
				if (s.kind === 'param')
					return value ? (params.get(String(value))?.label ?? String(value)) : '';
				if (s.kind === 'choice') return String(value ?? s.default);
				return '';
			})
			.filter(Boolean)
			.join(' · ');
		return {
			id: node.id,
			type: 'shader' as const,
			position: { x: node.x, y: node.y },
			selected: node.id === selectedId,
			data: {
				node,
				def,
				inTypes: analysis?.inputs[node.id] ?? {},
				outTypes: analysis?.outputs[node.id] ?? {},
				errors: byNode.get(node.id)?.errors ?? [],
				warnings: byNode.get(node.id)?.warnings ?? [],
				wired: doc.wires.filter((w) => w.to.node === node.id).map((w) => w.to.port),
				summary,
			},
		};
	});
	const edges = doc.wires.map((w) => {
		const type = analysis?.outputs[w.from.node]?.[w.from.port] ?? 'any';
		return {
			id: wireId(w),
			source: w.from.node,
			sourceHandle: w.from.port,
			target: w.to.node,
			targetHandle: w.to.port,
			style: `stroke:${PORT_COLORS[type]};stroke-width:2`,
		};
	});
	return { nodes, edges };
}

/** The doc-level errors: those no node on the canvas carries (none, or one the graph lacks). */
export function docIssues(
	doc: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
): string[] {
	const ids = new Set(doc.nodes.map((n) => n.id));
	return (analysis?.issues ?? [])
		.filter((i) => i.level === 'error' && (!i.node || !ids.has(i.node)))
		.map((i) => i.message);
}

/** An id as the store will key it (`shaderSlug` on the server): the doc keeps it, so the client
 *  and the store agree before the first save answers. */
export function slugOf(name: string): string {
	const r2 =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '_')
			.slice(0, 60) || 'default';
	return r2.replace(/^_+/, '') || 'shader';
}
