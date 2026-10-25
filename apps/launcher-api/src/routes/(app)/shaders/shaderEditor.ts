/**
 * Invisible Shader Graph's editing model (`/shaders`): every gesture is a pure `ShaderGraphDoc →
 * ShaderGraphDoc`, so the page swaps its `$state` doc and lets the analysis and the compile follow.
 * Nothing here validates a graph — `analyzeShaderGraph` and `analyzeShaderMotion` do, and the doc
 * may be broken while it is being built. A gesture works on whichever graph the canvas shows (its
 * {@link GraphScope}): the effect's pixel graph, a subgraph's body, or the motion graph.
 */

import {
	ELEMENT_FX_CATEGORIES,
	ELEMENT_FX_LIMITS,
	ELEMENT_FX_MOTION_RANGES,
	ELEMENT_FX_PASS_KINDS,
	type CustomElementFxMotion,
	type CustomElementFxPass,
	type ElementFxCurve,
	type ElementFxMotionChannel,
	type ElementFxParamSpec,
	type ElementFxPhase,
	customElementFxBreakWindow,
	elementFxSpec,
	isReversedElementFxBreak,
} from 'constants-shared/elementFx';
import {
	BREAK_IN_SUBGRAPH,
	BREAK_KINDS,
	BREAK_OUTPUT,
	BUILTIN_TWINS,
	COST_BUDGET,
	SAMPLE_BUDGET,
	DIMS,
	SHADER_GRAPH_VERSION,
	SHADER_NODES,
	SUBGRAPH_CALL,
	SUBGRAPH_COUNT_MAX,
	SUBGRAPH_IN,
	SUBGRAPH_OUT,
	SUBGRAPH_PORTS_MAX,
	analyzeShaderGraph,
	analyzeShaderMotion,
	analyzeShaderSubgraph,
	breakKindOf,
	breakKindParams,
	breakOutputIssues,
	calledSubgraph,
	canFeed,
	flattenGraph,
	flattenShaderGraph,
	graphNodeDef,
	isBreakKind,
	isMotionNode,
	MOTION_NODES,
	MOTION_OUTPUT,
	motionNode,
	motionGraphSeries,
	readBreakValue,
	shaderNode,
	subgraphName,
	subgraphOf,
	type BreakKind,
	type BuiltinTwin,
	type GraphNode,
	type GraphWire,
	type NodeCategory,
	type NodeDef,
	type PortType,
	type ShaderGraphAnalysis,
	type ShaderGraphDoc,
	type ShaderMotionAnalysis,
	type ShaderSubgraph,
	type SubgraphPort,
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
	{ id: 'subgraph', label: 'Subgraphs', color: '#14b8a6' },
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

/** A new graph started from built-in `twin`: its nodes, params, passes and motion, as `id` / `name`. */
export function docFromTwin(twin: BuiltinTwin, id: string, name: string): ShaderGraphDoc {
	return { ...clone(twin.doc), id, name };
}

export interface TwinGroup {
	id: string;
	label: string;
	twins: { kind: string; label: string; description: string }[];
}

/** "Start from a built-in": the twins by the catalog's families, in the catalog's order. */
export function twinGroups(twins: readonly BuiltinTwin[] = BUILTIN_TWINS): TwinGroup[] {
	return ELEMENT_FX_CATEGORIES.map((category) => ({
		id: category.id,
		label: category.label,
		twins: twins
			.map((t) => elementFxSpec(t.kind))
			.filter((spec) => spec.category === category.id)
			.map((spec) => ({ kind: spec.kind, label: spec.label, description: spec.description })),
	})).filter((g) => g.twins.length > 0);
}

/**
 * `view` (the graph `scope` shows of `doc`) with the other top-level graph's nodes beside it: the
 * effect's graph and its motion graph never share a node id, so an issue or a gesture naming one is
 * never read on the other. A subgraph's body is its own namespace.
 */
const withOtherGraph = (
	doc: ShaderGraphDoc,
	scope: GraphScope,
	view: ShaderGraphDoc,
): ShaderGraphDoc => {
	const other = isMotionScope(scope) ? doc.nodes : !scope ? (doc.motionGraph?.nodes ?? []) : [];
	return other.length ? { ...view, nodes: [...view.nodes, ...other] } : view;
};

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
	def: NodeDef | undefined,
	side: 'inputs' | 'outputs',
	port: string,
): PortType | 'any' | undefined {
	if (!node) return undefined;
	const resolved = analysis?.[side][node.id]?.[port];
	if (resolved) return resolved;
	return def?.[side].find((p) => p.id === port)?.type;
}

const errorsOf = (a: ShaderGraphAnalysis, code: 'type' | 'cycle'): number =>
	a.issues.filter((i) => i.level === 'error' && i.code === code).length;

/**
 * Whether `from`'s output can feed `to`'s input: never a node into itself, the types must convert
 * (an input that follows its node's type takes anything; the node then follows it), and the graph
 * the wire makes has no loop or type error the graph had not, so the canvas takes only a wire the
 * compiler takes. The motion graph carries floats alone: a wire there joins two of them. A Break
 * Output's port takes what the engine lets set a break ({@link breakFeedRefusal}).
 */
export function canConnect(
	doc: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
	from: GraphWire['from'],
	to: GraphWire['to'],
	scope: GraphScope = null,
): boolean {
	if (from.node === to.node || breakFeedRefusal(doc, from, to, scope)) return false;
	const view = viewOf(doc, scope);
	const source = view.nodes.find((n) => n.id === from.node);
	const target = view.nodes.find((n) => n.id === to.node);
	const out = portType(
		analysis,
		source,
		source && nodeDefIn(doc, source, scope),
		'outputs',
		from.port,
	);
	const declared = (target && nodeDefIn(doc, target, scope))?.inputs.find(
		(p) => p.id === to.port,
	)?.type;
	if (!out || !declared) return false;
	const float = (type: PortType | 'any'): boolean => type === 'float' || type === 'any';
	if (isMotionScope(scope) && !(float(out) && float(declared))) return false;
	if (declared !== 'any' && !canFeed(out === 'any' ? 'float' : out, declared)) return false;
	const before = analysis ?? analyzeScope(doc, scope);
	const after = analyzeScope(
		inScope(doc, scope, (d) => connect(d, from, to)),
		scope,
	);
	return (
		errorsOf(after, 'cycle') <= errorsOf(before, 'cycle') &&
		errorsOf(after, 'type') <= errorsOf(before, 'type')
	);
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

/** Node types no gesture deletes: the effect's Output, and a body's Input and Output. */
const PINNED: ReadonlySet<string> = new Set(['output', SUBGRAPH_IN, SUBGRAPH_OUT]);

/**
 * The nodes of `view` (the graph `scope` shows) no gesture deletes: those of a {@link PINNED} type,
 * and in the motion graph its Output while any other node is left (alone, it goes with the graph).
 */
function pinnedOf(view: ShaderGraphDoc, scope: GraphScope): Set<string> {
	const motion = isMotionScope(scope);
	const others = motion && view.nodes.some((n) => n.type !== MOTION_OUTPUT);
	return new Set(
		view.nodes
			.filter((n) => (motion ? others && n.type === MOTION_OUTPUT : PINNED.has(n.type)))
			.map((n) => n.id),
	);
}

/**
 * `doc` (the graph `scope` shows) without the nodes `ids` (and every wire touching them) and the
 * wires `wireIds`. The pinned nodes stay.
 */
export function remove(
	doc: ShaderGraphDoc,
	ids: readonly string[],
	wireIds: readonly string[] = [],
	scope: GraphScope = null,
): ShaderGraphDoc {
	const kept = pinnedOf(doc, scope);
	const gone = new Set(ids.filter((id) => !kept.has(id)));
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

export interface LibraryGroup {
	id: NodeCategory;
	label: string;
	color: string;
	nodes: NodeDef[];
}

/**
 * The library, by family, as the page lists them: every pixel node but the Output, or (`motion`)
 * every node the motion graph takes but its Output.
 */
export function libraryGroups(motion = false): LibraryGroup[] {
	const offered = motion ? MOTION_NODES : SHADER_NODES;
	return NODE_CATEGORIES.map((c) => ({
		...c,
		nodes: offered.filter((d) => d.category === c.id && d.category !== 'output'),
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

/**
 * `doc` with param `index` replaced by `spec`; a new id is followed by the Param nodes (of either
 * graph and every subgraph) and pass ties reading it.
 */
export function setParam(
	doc: ShaderGraphDoc,
	index: number,
	spec: ElementFxParamSpec,
): ShaderGraphDoc {
	const next = clone(doc);
	if (index < 0 || index >= next.params.length) return doc;
	const was = next.params[index].id;
	next.params[index] = JSON.parse(JSON.stringify(spec)) as ElementFxParamSpec;
	if (spec.id === was) return next;
	const readers = [
		...next.nodes,
		...(next.subgraphs ?? []).flatMap((s) => s.nodes),
		...(next.motionGraph?.nodes ?? []),
	];
	for (const node of readers) {
		for (const setting of (shaderNode(node.type) ?? motionNode(node.type))?.settings ?? []) {
			if (setting.kind === 'param' && node.values?.[setting.id] === was)
				node.values[setting.id] = spec.id;
		}
	}
	next.passes = next.passes?.map((pass) => ({
		...pass,
		...(pass.params && {
			params: Object.fromEntries(
				Object.entries(pass.params).map(([k, v]) => [
					k,
					typeof v === 'object' && v.param === was ? { param: spec.id } : v,
				]),
			),
		}),
	}));
	if (!next.passes) delete next.passes;
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
	/** It shows a thumbnail of its output (`probeDoc`). */
	thumb: boolean;
	/** A motion node showing its value over the play as a curve (`motionCurves`). */
	curve: boolean;
	/** What it adds to the work per pixel; none while it does not reach the Output. */
	cost: NodeCost | undefined;
	/** The Motion Output's: what each channel it leaves unwired plays instead (`undrivenChannels`). */
	undriven?: Record<string, string>;
	/** A Break Output's: what each port reads unwired, in words (`breakPortValues`). */
	breakValues?: Record<string, BreakPortValue>;
	/** A Break Output's: per port, why each node that cannot feed it cannot (`breakFeedRefusal`). */
	refusals?: Record<string, Record<string, string>>;
};

/**
 * The canvas's nodes and wires for `doc`, as xyflow takes them. Read-only (another editor holds the
 * graph), nothing moves, wires or deletes; the Output never deletes, as the library cannot add one
 * (the Motion Output while other motion nodes are left).
 */
export function canvasGraph(
	effect: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
	selected: ReadonlySet<string>,
	readOnly = false,
	scope: GraphScope = null,
): {
	nodes: {
		id: string;
		type: 'shader';
		position: { x: number; y: number };
		selected: boolean;
		draggable: boolean;
		connectable: boolean;
		deletable: boolean;
		data: ShaderNodeView;
	}[];
	edges: {
		id: string;
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle: string;
		deletable: boolean;
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
	const doc = viewOf(effect, scope);
	const params = new Map(doc.params.map((p) => [p.id, p]));
	const costs = nodeCosts(doc, analysis, scope);
	const pinned = pinnedOf(doc, scope);
	const nodes = doc.nodes.map((node) => {
		const def = nodeDefIn(doc, node, scope);
		const isBreak = node.type === BREAK_OUTPUT && !scope;
		const summary =
			node.type === SUBGRAPH_CALL
				? 'subgraph'
				: isBreak
					? breakSummary(node)
					: (def?.settings ?? [])
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
			selected: selected.has(node.id),
			draggable: !readOnly,
			connectable: !readOnly,
			deletable: !readOnly && !pinned.has(node.id),
			data: {
				node,
				def,
				inTypes: analysis?.inputs[node.id] ?? {},
				outTypes: analysis?.outputs[node.id] ?? {},
				errors: byNode.get(node.id)?.errors ?? [],
				warnings: byNode.get(node.id)?.warnings ?? [],
				wired: doc.wires.filter((w) => w.to.node === node.id).map((w) => w.to.port),
				summary,
				thumb: hasThumbnail(node, analysis, doc, scope),
				curve: isMotionScope(scope) && hasMotionCurve(node),
				cost: costs.get(node.id),
				...(isMotionScope(scope) &&
					node.type === MOTION_OUTPUT && { undriven: undrivenChannels(effect) }),
				...(isBreak && {
					breakValues: breakPortValues(node),
					refusals: readOnly ? {} : breakRefusals(effect, node, scope),
				}),
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
			deletable: !readOnly,
			style: `stroke:${PORT_COLORS[type]};stroke-width:2`,
		};
	});
	return { nodes, edges };
}

/** The doc-level errors: those no node on the canvas carries (none, or one the graph lacks). */
export function docIssues(
	doc: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
	scope: GraphScope = null,
): string[] {
	const ids = new Set(viewOf(doc, scope).nodes.map((n) => n.id));
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

// ── Node thumbnails ─────────────────────────────────────────────────────────────────────────────

/**
 * Nodes whose output is one value over the whole element (a number, a param, the time, the seed,
 * the element's size): a thumbnail would be a flat swatch, so they have none. The Output has none
 * either: what it draws is the preview's.
 */
export const FLAT_NODES: ReadonlySet<string> = new Set([
	'number',
	'param',
	'color',
	'seed',
	'time',
	'size',
]);

/** The ids of `id` and every node it reads from, however far up. */
function upstreamOf(doc: ShaderGraphDoc, id: string): Set<string> {
	const present = new Set(doc.nodes.map((n) => n.id));
	const found = new Set([id]);
	const queue = [id];
	while (queue.length) {
		const at = queue.pop() as string;
		for (const w of doc.wires) {
			if (w.to.node !== at || found.has(w.from.node) || !present.has(w.from.node)) continue;
			found.add(w.from.node);
			queue.push(w.from.node);
		}
	}
	return found;
}

/** The output ports of `node`, as the analysis resolved them, else as its def declares them. */
function outputsOf(
	node: GraphNode,
	analysis: ShaderGraphAnalysis | undefined,
	doc: ShaderGraphDoc | undefined,
	scope: GraphScope,
): { id: string; type: PortType | undefined }[] {
	const resolved = analysis?.outputs[node.id];
	if (resolved && Object.keys(resolved).length)
		return Object.entries(resolved).map(([id, type]) => ({ id, type }));
	const def = doc ? nodeDefIn(doc, node, scope) : shaderNode(node.type);
	return (def?.outputs ?? []).map((p) => ({
		id: p.id,
		type: p.type === 'any' ? undefined : p.type,
	}));
}

/**
 * Whether `node` shows a thumbnail: it has an output, and that output varies over the element. A
 * body's Input has none: it is the call's values, one each over the element. Nor does any motion
 * node: its value is one number for the whole element (it shows a curve instead).
 */
export const hasThumbnail = (
	node: GraphNode,
	analysis?: ShaderGraphAnalysis,
	doc?: ShaderGraphDoc,
	scope: GraphScope = null,
): boolean =>
	!isMotionScope(scope) &&
	node.type !== 'output' &&
	node.type !== SUBGRAPH_IN &&
	!FLAT_NODES.has(node.type) &&
	outputsOf(node, analysis, doc, scope).length > 0;

/**
 * The graph `scope` shows, for a probe to compile: the effect's own, or a body's, its Input stood
 * in for by a call reading each input as an unwired call does (its default, else 0).
 */
function probeView(doc: ShaderGraphDoc, scope: GraphScope): ShaderGraphDoc {
	const view = clone(viewOf(doc, scope));
	const sub = scope ? subgraphOf(doc, scope) : undefined;
	if (!sub || !view.nodes.some((n) => n.type === SUBGRAPH_IN)) return view;
	const taken = new Set((doc.subgraphs ?? []).map((s) => s.id));
	let id = 'probe_inputs';
	for (let n = 2; taken.has(id); n++) id = `probe_inputs${n}`;
	const ports = JSON.parse(JSON.stringify(sub.inputs ?? [])) as SubgraphPort[];
	view.subgraphs = [
		...(view.subgraphs ?? []),
		{
			id,
			name: 'Inputs',
			inputs: ports,
			outputs: ports,
			nodes: [
				{ id: 'in', type: SUBGRAPH_IN, x: 0, y: 0 },
				{ id: 'out', type: SUBGRAPH_OUT, x: 0, y: 0 },
			],
			wires: ports.map((p) => ({
				from: { node: 'in', port: p.id },
				to: { node: 'out', port: p.id },
			})),
		},
	];
	view.nodes = view.nodes.map((n) =>
		n.type === SUBGRAPH_IN
			? { id: n.id, type: SUBGRAPH_CALL, x: n.x, y: n.y, values: { subgraph: id } }
			: n,
	);
	return view;
}

/** What a node's thumbnail draws: a graph of its own whose Output shows one of the node's outputs. */
export interface ShaderProbe {
	doc: ShaderGraphDoc;
	/** The output shown: the first one a wire takes onward, else the node's first. */
	port: string;
	type: PortType;
}

/**
 * The graph node `id`'s thumbnail draws: the node and everything it reads, nothing else, with an
 * Output fed from the node's output made visible, through library nodes only. A float shows as
 * grey, a vec2 as (x, y, 0), a vec3 as an opaque colour, a vec4 as the premultiplied colour it is.
 * The effect's passes and motion are left out, and its name, phase and length are a probe's, so
 * only the node's own upstream can keep it from compiling. Undefined for a node with no thumbnail.
 */
export function probeDoc(
	effect: ShaderGraphDoc,
	id: string,
	analysis?: ShaderGraphAnalysis,
	scope: GraphScope = null,
): ShaderProbe | undefined {
	const node = viewOf(effect, scope).nodes.find((n) => n.id === id);
	if (!node || !hasThumbnail(node, analysis, effect, scope)) return undefined;
	const doc = probeView(effect, scope);
	const kept = upstreamOf(doc, id);
	const base: ShaderGraphDoc = {
		...doc,
		id: 'probe',
		name: 'Probe',
		phase: 'loop',
		durationMs: 1000,
		nodes: doc.nodes.filter((n) => kept.has(n.id)),
		wires: doc.wires.filter((w) => kept.has(w.from.node) && kept.has(w.to.node)),
	};
	delete base.passes;
	delete base.motion;
	delete base.motionGraph;
	delete base.padding;
	const out = { id: freshNodeId(base, 'output'), type: 'output', x: node.x + 260, y: node.y };
	base.nodes.push(out);

	let ports = outputsOf(node, analysis, effect, scope);
	if (!ports.some((p) => p.type)) ports = outputsOf(node, analyzeShaderGraph(base), base, null);
	const onward = new Set(doc.wires.filter((w) => w.from.node === id).map((w) => w.from.port));
	const shown = ports.find((p) => onward.has(p.id) && p.type) ?? ports.find((p) => p.type);
	if (!shown?.type) return undefined;

	const at = (type: string, dx: number): GraphNode => {
		const added = { id: freshNodeId(base, type), type, x: node.x + dx, y: node.y };
		base.nodes.push(added);
		return added;
	};
	const wire = (from: GraphNode, fromPort: string, to: GraphNode, toPort: string): void => {
		base.wires.push({ from: { node: from.id, port: fromPort }, to: { node: to.id, port: toPort } });
	};
	if (shown.type === 'vec4') {
		wire(node, shown.id, out, 'color');
	} else if (shown.type === 'vec2') {
		const split = at('split', 80);
		const combine = at('combine', 160);
		wire(node, shown.id, split, 'v');
		wire(split, 'x', combine, 'x');
		wire(split, 'y', combine, 'y');
		wire(combine, 'xyzw', out, 'color');
	} else {
		const join = at('premultiply', 120);
		wire(node, shown.id, join, 'rgb');
		wire(join, 'out', out, 'color');
	}
	return { doc: base, port: shown.id, type: shown.type };
}

/** `text` hashed to 53 bits (cyrb53), in base 36. */
function hashOf(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A key per node of the graph `scope` shows that changes when, and only when, its
 * {@link probeDoc} does: the node, its values and what feeds it however far up, what a call calls
 * (its subgraph, and those that calls), the params any node may read, a body's inputs, and which
 * outputs a wire takes onward. An edit changes the keys of the node it touches and of what reads
 * it, so a thumbnail of anything else is neither compiled nor drawn again.
 */
export function probeKeys(doc: ShaderGraphDoc, scope: GraphScope = null): Map<string, string> {
	const view = viewOf(doc, scope);
	const sub = subgraphScope(scope);
	const salt = hashOf(
		JSON.stringify([doc.params, sub, sub ? (subgraphOf(doc, sub)?.inputs ?? null) : null]),
	);
	const called = new Map<string, string>();
	const calledKey = (id: string | undefined, seen: ReadonlySet<string> = new Set()): string => {
		if (!id) return '-';
		const known = called.get(id);
		if (known) return known;
		if (seen.has(id)) return 'loop';
		const sub = subgraphOf(doc, id);
		const inner = (sub?.nodes ?? [])
			.filter((n) => n.type === SUBGRAPH_CALL)
			.map((n) => calledKey(calledSubgraph(n), new Set([...seen, id])));
		const key = hashOf(JSON.stringify([sub ?? null, inner]));
		called.set(id, key);
		return key;
	};
	const byId = new Map(view.nodes.map((n) => [n.id, n]));
	const feeds = new Map<string, GraphWire[]>();
	const onward = new Map<string, Set<string>>();
	for (const w of view.wires) {
		feeds.set(w.to.node, [...(feeds.get(w.to.node) ?? []), w]);
		onward.set(w.from.node, (onward.get(w.from.node) ?? new Set()).add(w.from.port));
	}
	const up = new Map<string, string>();
	const visiting = new Set<string>();
	const upKey = (id: string): string => {
		const known = up.get(id);
		if (known) return known;
		if (visiting.has(id)) return 'loop';
		visiting.add(id);
		const inputs = (feeds.get(id) ?? [])
			.map((w) => `${w.to.port}<${byId.has(w.from.node) ? upKey(w.from.node) : '-'}.${w.from.port}`)
			.sort();
		visiting.delete(id);
		const node = byId.get(id);
		const calls = node?.type === SUBGRAPH_CALL ? calledKey(calledSubgraph(node)) : '';
		const key = hashOf(JSON.stringify([node?.type, node?.values ?? null, inputs, calls]));
		up.set(id, key);
		return key;
	};
	return new Map(
		view.nodes.map((n) => [
			n.id,
			hashOf(`${salt}|${upKey(n.id)}|${[...(onward.get(n.id) ?? [])].sort().join(',')}`),
		]),
	);
}

/** At most this many thumbnails draw live; the rest keep their last picture. */
export const THUMB_LIVE_CAP = 40;

/** Where a node's thumbnail is on screen, and whether any of it shows. */
export interface ThumbSpot {
	id: string;
	x: number;
	y: number;
	visible: boolean;
}

/**
 * The thumbnails kept live: of those on screen, the selected nodes', then the ones nearest the
 * view's `centre`, `cap` at most, nearest first.
 */
export function liveThumbs(
	spots: readonly ThumbSpot[],
	centre: { x: number; y: number },
	selected: ReadonlySet<string>,
	cap = THUMB_LIVE_CAP,
): string[] {
	const distance = (s: ThumbSpot): number =>
		selected.has(s.id) ? -1 : Math.hypot(s.x - centre.x, s.y - centre.y);
	return spots
		.filter((s) => s.visible)
		.map((s) => ({ id: s.id, d: distance(s) }))
		.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
		.slice(0, Math.max(0, cap))
		.map((s) => s.id);
}

// ── Cost ────────────────────────────────────────────────────────────────────────────────────────

/** A node's cost as a share of the phone budget past which it reads as medium, then heavy. */
export const COST_WEIGHTS = { medium: 0.025, heavy: 0.1 } as const;

export type CostWeight = 'light' | 'medium' | 'heavy';

/** What one node adds to the graph's work per pixel, against the phone budget. */
export interface NodeCost {
	cost: number;
	/** Its own reads of the element. */
	samples: number;
	/** It reads the element's colour at this pixel, read once for the whole graph (`pixel`). */
	readsPixel: boolean;
	/** The larger of its cost's and its reads' share of the budget. */
	share: number;
	weight: CostWeight;
}

export const costWeight = (share: number): CostWeight =>
	share >= COST_WEIGHTS.heavy ? 'heavy' : share >= COST_WEIGHTS.medium ? 'medium' : 'light';

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

/** A node's cost in words, against the phone budget, for its chip's tooltip. */
export function costText(c: NodeCost): string {
	return [
		`About ${c.cost} units of work a pixel: ${percent(c.cost / COST_BUDGET)} of the ${COST_BUDGET} a phone affords.`,
		...(c.samples
			? [
					`${c.samples} read${c.samples === 1 ? '' : 's'} of the element a pixel: ${percent(c.samples / SAMPLE_BUDGET)} of ${SAMPLE_BUDGET}.`,
				]
			: []),
		...(c.readsPixel
			? ['It reads the element’s colour at the pixel, read once for the whole graph.']
			: []),
	].join('\n');
}

/** What stops the analysis before it adds up the cost: nothing then reaches the Output. */
const UNWALKED = new Set(['unknown-node', 'duplicate-node', 'output', 'cycle']);

/**
 * The cost of each node of the graph `scope` shows that reaches its Output, as the analysis counts
 * it: a call's is what its body adds once inlined. The nodes' costs sum to the analysis' `cost`, and
 * their reads, plus one for the pixel when any node reads it, to its `samples`. A node that reaches
 * nothing is left out of the GLSL and costs nothing, so it has no entry; nor does any node while the
 * graph cannot be walked (no Output, a loop, an unknown node). The motion graph draws no pixel, so
 * its nodes have none.
 */
export function nodeCosts(
	doc: ShaderGraphDoc,
	analysis: ShaderGraphAnalysis | undefined,
	scope: GraphScope = null,
): Map<string, NodeCost> {
	const costs = new Map<string, NodeCost>();
	if (
		isMotionScope(scope) ||
		!analysis ||
		analysis.issues.some((i) => i.level === 'error' && UNWALKED.has(i.code))
	)
		return costs;
	const unreached = new Set(
		analysis.issues.filter((i) => i.code === 'unreachable' && i.node).map((i) => i.node),
	);
	// Every call inlined as the analysis inlines it (an opened body one call deep, so no deeper and
	// no self-call more than the analysis allows), each inlined node counted for its call.
	const sub = scope ? subgraphOf(doc, scope) : undefined;
	const flat = sub
		? flattenGraph(doc, sub.nodes, sub.wires, [sub], 1)
		: flattenShaderGraph(viewOf(doc, scope));
	const byId = new Map(flat.nodes.map((n) => [n.id, n]));
	const feeds = new Map<string, string[]>();
	for (const w of flat.wires) feeds.set(w.to.node, [...(feeds.get(w.to.node) ?? []), w.from.node]);
	const root = scope ? SUBGRAPH_OUT : 'output';
	const reached = new Set<string>();
	const stack = flat.nodes.filter((n) => n.type === root).map((n) => n.id);
	while (stack.length) {
		const id = stack.pop() as string;
		if (reached.has(id) || !byId.has(id)) continue;
		reached.add(id);
		stack.push(...(feeds.get(id) ?? []));
	}
	const wired = new Set(flat.wires.map((w) => `${w.to.node}.${w.to.port}`));
	const totals = new Map<string, { cost: number; samples: number; readsPixel: boolean }>();
	for (const node of flat.nodes) {
		const def = flat.defs.get(node.id) ?? shaderNode(node.type);
		if (!def || !reached.has(node.id)) continue;
		const owner = flat.origin.get(node.id)?.node ?? node.id;
		const total = totals.get(owner) ?? { cost: 0, samples: 0, readsPixel: false };
		total.cost += def.cost;
		total.samples += def.samples ?? 0;
		total.readsPixel ||= def.inputs.some(
			(p) =>
				p.defaultExpr === 'sample' &&
				p.default === undefined &&
				node.values?.[p.id] === undefined &&
				!wired.has(`${node.id}.${p.id}`),
		);
		totals.set(owner, total);
	}
	for (const [id, total] of totals) {
		if (unreached.has(id)) continue;
		const share = Math.max(total.cost / COST_BUDGET, total.samples / SAMPLE_BUDGET);
		costs.set(id, { ...total, share, weight: costWeight(share) });
	}
	return costs;
}

// ── Subgraphs ───────────────────────────────────────────────────────────────────────────────────

/** The motion graph's scope (`doc.motionGraph`): a symbol, so no subgraph id can be it. */
export const MOTION_SCOPE: unique symbol = Symbol('motion');

/**
 * Which graph the canvas shows: the effect's pixel graph (`null`), subgraph `id`'s body, or the
 * motion graph ({@link MOTION_SCOPE}). Every gesture above works in any of them through
 * {@link inScope}: it is given {@link viewOf} the scope, a doc whose nodes and wires are that
 * graph's.
 */
export type GraphScope = string | null | typeof MOTION_SCOPE;

export const isMotionScope = (scope: GraphScope): scope is typeof MOTION_SCOPE =>
	scope === MOTION_SCOPE;

/** The subgraph `scope` opens, else null (the pixel graph, or the motion graph). */
export const subgraphScope = (scope: GraphScope): string | null =>
	typeof scope === 'string' ? scope : null;

/**
 * `doc` as a gesture in `scope` sees it: the body's nodes and wires (or the motion graph's, none
 * while it has none) in place of the effect's.
 */
export function viewOf(doc: ShaderGraphDoc, scope: GraphScope): ShaderGraphDoc {
	if (!scope) return doc;
	if (isMotionScope(scope))
		return { ...doc, nodes: doc.motionGraph?.nodes ?? [], wires: doc.motionGraph?.wires ?? [] };
	const sub = subgraphOf(doc, scope);
	return { ...doc, nodes: sub?.nodes ?? [], wires: sub?.wires ?? [] };
}

/**
 * `doc` with `gesture` applied to the graph `scope` shows: what it does to the view's nodes and
 * wires lands in the body (or the motion graph, which goes once it has no node), anything else it
 * changes (a subgraph it adds) in the doc.
 */
export function inScope(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	gesture: (view: ShaderGraphDoc) => ShaderGraphDoc,
): ShaderGraphDoc {
	if (!scope) return gesture(doc);
	const view = viewOf(doc, scope);
	const next = gesture(view);
	if (next === view) return doc;
	if (isMotionScope(scope)) {
		const out = clone({ ...next, nodes: doc.nodes, wires: doc.wires });
		const graph = clone(next);
		if (graph.nodes.length) out.motionGraph = { nodes: graph.nodes, wires: graph.wires };
		else delete out.motionGraph;
		return out;
	}
	if (!subgraphOf(doc, scope)) return doc;
	return clone({
		...next,
		nodes: doc.nodes,
		wires: doc.wires,
		subgraphs: (next.subgraphs ?? []).map((s) =>
			s.id === scope ? { ...s, nodes: next.nodes, wires: next.wires } : s,
		),
	});
}

/** The analysis of the graph `scope` shows: the effect's, the body's on its own, or the motion
 *  graph's (as {@link motionAnalysis} reads it). */
export const analyzeScope = (doc: ShaderGraphDoc, scope: GraphScope): ShaderGraphAnalysis =>
	isMotionScope(scope)
		? motionAnalysis(doc)
		: scope
			? analyzeShaderSubgraph(doc, scope)
			: analyzeShaderGraph(doc);

/** The graphs of `doc`: the effect's (scope `null`) and each subgraph's body. */
const graphsOf = (doc: ShaderGraphDoc): { scope: GraphScope; nodes: GraphNode[] }[] => [
	{ scope: null, nodes: doc.nodes },
	...(doc.subgraphs ?? []).map((s) => ({ scope: s.id, nodes: s.nodes })),
];

/** Every call of subgraph `id`: the graph it sits in, and its node. */
export function subgraphCalls(
	doc: ShaderGraphDoc,
	id: string,
): { scope: GraphScope; node: string }[] {
	return graphsOf(doc).flatMap((g) =>
		g.nodes
			.filter((n) => n.type === SUBGRAPH_CALL && calledSubgraph(n) === id)
			.map((n) => ({ scope: g.scope, node: n.id })),
	);
}

/** Whether subgraph `from`'s body calls subgraph `to`, itself or through others. */
function reaches(doc: ShaderGraphDoc, from: string, to: string, seen = new Set<string>()): boolean {
	if (seen.has(from)) return false;
	seen.add(from);
	const called = (subgraphOf(doc, from)?.nodes ?? [])
		.filter((n) => n.type === SUBGRAPH_CALL)
		.map(calledSubgraph);
	return called.some((id) => !!id && (id === to || reaches(doc, id, to, seen)));
}

export interface SubgraphRow {
	id: string;
	name: string;
	/** How many nodes call it, in the effect and in other subgraphs. */
	calls: number;
	/** Why a call of it cannot go in the graph shown (it would call itself), else ''. */
	blocked: string;
}

/** Why no subgraph gesture works in the motion graph. */
export const SUBGRAPHS_PIXEL_ONLY =
	'Subgraphs are for the pixel graph: the motion graph has none yet. Switch to Pixel to group, open or ungroup.';

/** The palette's subgraphs for the graph `scope` shows, by name. */
export function subgraphRows(doc: ShaderGraphDoc, scope: GraphScope): SubgraphRow[] {
	return (doc.subgraphs ?? [])
		.map((s) => ({
			id: s.id,
			name: subgraphName(s),
			calls: subgraphCalls(doc, s.id).length,
			blocked: isMotionScope(scope)
				? SUBGRAPHS_PIXEL_ONLY
				: !scope
					? ''
					: s.id === scope
						? 'A subgraph cannot call itself'
						: reaches(doc, s.id, scope)
							? `${subgraphName(s)} calls this subgraph: it would call itself`
							: '',
		}))
		.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The boundary node the graph `scope` shows lacks, for the palette to put back: a body's Input or
 * Output, or the Motion Output of a motion graph that has nodes but lost it.
 */
export function missingBoundary(doc: ShaderGraphDoc, scope: GraphScope): string[] {
	if (!scope) return [];
	const nodes = viewOf(doc, scope).nodes;
	if (isMotionScope(scope))
		return nodes.length && !nodes.some((n) => n.type === MOTION_OUTPUT) ? [MOTION_OUTPUT] : [];
	return [SUBGRAPH_IN, SUBGRAPH_OUT].filter((type) => !nodes.some((n) => n.type === type));
}

/** Whether a node of `type` can be placed in the graph `scope` shows: a Break Output only in the
 *  effect's own graph, while it has none ({@link breakPlacement}). */
export const canPlace = (doc: ShaderGraphDoc, scope: GraphScope, type: string): boolean =>
	type === BREAK_OUTPUT
		? !breakPlacement(doc, scope)
		: missingBoundary(doc, scope).includes(type) ||
			(isMotionScope(scope)
				? isMotionNode(type) && type !== MOTION_OUTPUT
				: !!shaderNode(type) && type !== 'output');

/** `doc` with a call of subgraph `id` at `pos` in the graph `scope` shows, and the call's id. */
export function addCall(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	id: string,
	pos: { x: number; y: number },
): { doc: ShaderGraphDoc; id: string } {
	const callId = freshNodeId(withOtherGraph(doc, scope, viewOf(doc, scope)), SUBGRAPH_CALL);
	const next = inScope(doc, scope, (view) => {
		const added = clone(view);
		added.nodes.push({
			id: callId,
			type: SUBGRAPH_CALL,
			x: Math.round(pos.x),
			y: Math.round(pos.y),
			values: { subgraph: id },
		});
		return added;
	});
	return { doc: next, id: callId };
}

/** A subgraph id `doc` lacks, made from `name`. */
function freshSubgraphId(doc: ShaderGraphDoc, name: string): string {
	const taken = new Set((doc.subgraphs ?? []).map((s) => s.id));
	const stem =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40) || 'group';
	if (!taken.has(stem)) return stem;
	let n = 2;
	while (taken.has(`${stem}_${n}`)) n++;
	return `${stem}_${n}`;
}

/** A name no subgraph of `doc` has: Group 1, Group 2… */
export function freshSubgraphName(doc: ShaderGraphDoc): string {
	const taken = new Set((doc.subgraphs ?? []).map((s) => subgraphName(s)));
	let n = 1;
	while (taken.has(`Group ${n}`)) n++;
	return `Group ${n}`;
}

/**
 * Nodes of the graph `scope` shows that a group can take: any but the Output, Input and Output;
 * none of the motion graph's.
 */
export const groupable = (
	doc: ShaderGraphDoc,
	scope: GraphScope,
	ids: Iterable<string>,
): string[] => {
	if (isMotionScope(scope)) return [];
	const wanted = new Set(ids);
	return viewOf(doc, scope)
		.nodes.filter((n) => wanted.has(n.id) && !PINNED.has(n.type))
		.map((n) => n.id);
};

/** `label`, or `label 2`, `label 3`… whichever `taken` lacks; it is then taken. */
function uniqueLabel(label: string, taken: Set<string>): string {
	let name = label;
	for (let n = 2; taken.has(name); n++) name = `${label} ${n}`;
	taken.add(name);
	return name;
}

const crossing = (end: GraphWire['from']): string => `${end.node}\u0000${end.port}`;

/**
 * Why nodes `ids` of the graph `scope` shows cannot be grouped, or undefined when they can (or
 * nothing would be grouped): they are the motion graph's, they hold the Break Output or a node
 * wired into it, the effect holds its most subgraphs, or the group would need more inputs or
 * outputs than a subgraph takes.
 */
export function groupRefusal(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	ids: Iterable<string>,
): string | undefined {
	if (isMotionScope(scope)) return [...ids].length ? SUBGRAPHS_PIXEL_ONLY : undefined;
	const picked = new Set(groupable(doc, scope, ids));
	if (!picked.size) return undefined;
	const broken = breakGroupRefusal(viewOf(doc, scope), picked);
	if (broken) return broken;
	if ((doc.subgraphs?.length ?? 0) >= SUBGRAPH_COUNT_MAX)
		return `An effect holds at most ${SUBGRAPH_COUNT_MAX} subgraphs: delete one to group these nodes.`;
	const inputs = new Set<string>();
	const outputs = new Set<string>();
	for (const w of viewOf(doc, scope).wires) {
		const fromInside = picked.has(w.from.node);
		if (picked.has(w.to.node) !== fromInside) (fromInside ? outputs : inputs).add(crossing(w.from));
	}
	if (inputs.size <= SUBGRAPH_PORTS_MAX && outputs.size <= SUBGRAPH_PORTS_MAX) return undefined;
	return `A subgraph takes at most ${SUBGRAPH_PORTS_MAX} inputs and ${SUBGRAPH_PORTS_MAX} outputs; these nodes would need ${inputs.size} and ${outputs.size}. Group fewer of them.`;
}

/**
 * Group nodes `ids` of the graph `scope` shows into a new subgraph named `name`, called where they
 * were. Each output outside the group that feeds it becomes an input of the subgraph (one per
 * output, however many nodes inside read it), each output inside read outside an output of it, both
 * typed as the analysis resolved the output. Wires keep their order, so ungrouping the call gives
 * back a graph that compiles to the same GLSL (not the same doc: nodes and wires change order).
 * Undefined when no node can be grouped, or {@link groupRefusal} says why not.
 */
export function groupNodes(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	ids: Iterable<string>,
	name: string,
	analysis?: ShaderGraphAnalysis,
): { doc: ShaderGraphDoc; subgraph: string; call: string } | undefined {
	const view = viewOf(doc, scope);
	const picked = new Set(groupable(doc, scope, ids));
	if (!picked.size || groupRefusal(doc, scope, picked)) return undefined;
	const a = analysis ?? analyzeScope(doc, scope);
	const byId = new Map(view.nodes.map((n) => [n.id, n]));
	const defOf = (id: string) => {
		const node = byId.get(id);
		return node && nodeDefIn(doc, node, scope);
	};
	const typeOf = (end: GraphWire['from']): PortType => {
		const resolved = a.outputs[end.node]?.[end.port];
		if (resolved) return resolved;
		const declared = defOf(end.node)?.outputs.find((p) => p.id === end.port)?.type;
		return declared && declared !== 'any' ? declared : 'float';
	};
	const key = crossing;

	const inputs: SubgraphPort[] = [];
	const outputs: SubgraphPort[] = [];
	const inPort = new Map<string, string>();
	const outPort = new Map<string, { port: string; from: GraphWire['from'] }>();
	const inLabels = new Set<string>();
	const outLabels = new Set<string>();
	for (const w of view.wires) {
		const fromInside = picked.has(w.from.node);
		const toInside = picked.has(w.to.node);
		if (toInside && !fromInside && !inPort.has(key(w.from))) {
			const id = `in${inputs.length + 1}`;
			const label = defOf(w.to.node)?.inputs.find((p) => p.id === w.to.port)?.label ?? w.to.port;
			inputs.push({ id, label: uniqueLabel(label, inLabels), type: typeOf(w.from) });
			inPort.set(key(w.from), id);
		}
		if (fromInside && !toInside && !outPort.has(key(w.from))) {
			const id = `out${outputs.length + 1}`;
			const def = defOf(w.from.node);
			const label =
				def && def.outputs.length > 1
					? (def.outputs.find((p) => p.id === w.from.port)?.label ?? w.from.port)
					: (def?.label ?? w.from.port);
			outputs.push({ id, label: uniqueLabel(label, outLabels), type: typeOf(w.from) });
			outPort.set(key(w.from), { port: id, from: w.from });
		}
	}

	const inside = view.nodes.filter((n) => picked.has(n.id));
	const xs = inside.map((n) => n.x);
	const ys = inside.map((n) => n.y);
	const middle = (v: number[]): number => Math.round(v.reduce((s, x) => s + x, 0) / v.length);
	const body: ShaderGraphDoc = { ...view, nodes: inside, wires: [] };
	const inId = freshNodeId(body, SUBGRAPH_IN);
	const outId = freshNodeId(body, SUBGRAPH_OUT);
	const subId = freshSubgraphId(doc, name);
	const callId = freshNodeId(withOtherGraph(doc, scope, view), SUBGRAPH_CALL);

	const bodyWires: GraphWire[] = [];
	const outerWires: GraphWire[] = [];
	const fed = new Set<string>();
	for (const w of view.wires) {
		const fromInside = picked.has(w.from.node);
		const toInside = picked.has(w.to.node);
		if (fromInside && toInside) bodyWires.push(w);
		else if (toInside) {
			const port = inPort.get(key(w.from)) as string;
			bodyWires.push({ from: { node: inId, port }, to: w.to });
			if (!fed.has(port)) outerWires.push({ from: w.from, to: { node: callId, port } });
			fed.add(port);
		} else if (fromInside) {
			const port = outPort.get(key(w.from))?.port as string;
			outerWires.push({ from: { node: callId, port }, to: w.to });
		} else outerWires.push(w);
	}
	for (const { port, from } of outPort.values())
		bodyWires.push({ from, to: { node: outId, port } });

	const sub: ShaderSubgraph = {
		id: subId,
		name: name.trim() || subId,
		inputs,
		outputs,
		nodes: [
			{ id: inId, type: SUBGRAPH_IN, x: Math.min(...xs) - 260, y: middle(ys) },
			...inside,
			{ id: outId, type: SUBGRAPH_OUT, x: Math.max(...xs) + 260, y: middle(ys) },
		],
		wires: bodyWires,
	};
	const call: GraphNode = {
		id: callId,
		type: SUBGRAPH_CALL,
		x: middle(xs),
		y: middle(ys),
		values: { subgraph: subId },
	};
	const next = inScope(doc, scope, (v) =>
		clone({
			...v,
			nodes: [...v.nodes.filter((n) => !picked.has(n.id)), call],
			wires: outerWires,
			subgraphs: [...(v.subgraphs ?? []), sub],
		}),
	);
	return { doc: next, subgraph: subId, call: callId };
}

const cloneNode = (node: GraphNode): GraphNode => JSON.parse(JSON.stringify(node)) as GraphNode;

const withoutSubgraph = (doc: ShaderGraphDoc, id: string): ShaderGraphDoc => {
	const next = clone(doc);
	next.subgraphs = (next.subgraphs ?? []).filter((s) => s.id !== id);
	if (!next.subgraphs.length) delete next.subgraphs;
	return next;
};

/** `value`, a port's, as an input of type `type` reads it: a longer vector by its leading parts. */
function valueFor(
	value: number | readonly number[],
	type: PortType | 'any' | undefined,
): number | number[] {
	if (typeof value === 'number' || type === undefined || type === 'any')
		return typeof value === 'number' ? value : [...value];
	const width = DIMS[type];
	if (value.length <= width) return width === 1 ? value[0] : [...value];
	return width === 1 ? value[0] : value.slice(0, width);
}

/**
 * Why call `callId` of the graph `scope` shows cannot be ungrouped, or undefined when it can. A
 * call's port converts what feeds it to the port's type (a float spread, a vector cut short), and
 * ungrouping wires the two ends straight together, so it would change what is drawn wherever a
 * port's type is not that of what feeds it: an input the body reads, fed a value of another type;
 * an output read outside, fed one inside. Retyping such a port to match lets it ungroup. A group
 * types its ports so, so a call nobody retyped always ungroups. Nothing ungroups in the motion graph.
 */
export function ungroupRefusal(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	callId: string,
): string | undefined {
	if (isMotionScope(scope)) return SUBGRAPHS_PIXEL_ONLY;
	const view = viewOf(doc, scope);
	const call = view.nodes.find((n) => n.id === callId && n.type === SUBGRAPH_CALL);
	const sub = call && subgraphOf(doc, calledSubgraph(call));
	if (!call || !sub) return undefined;
	const outside = analyzeScope(doc, scope);
	const inside = analyzeShaderSubgraph(doc, sub.id);
	const inNode = sub.nodes.find((n) => n.type === SUBGRAPH_IN);
	const outNode = sub.nodes.find((n) => n.type === SUBGRAPH_OUT);
	const label = (p: SubgraphPort): string => JSON.stringify(p.label || p.id);
	const problems: string[] = [];
	for (const p of sub.inputs) {
		const read = sub.wires.some((w) => w.from.node === inNode?.id && w.from.port === p.id);
		const feed = view.wires.find((w) => w.to.node === callId && w.to.port === p.id)?.from;
		const type = feed && outside.outputs[feed.node]?.[feed.port];
		if (read && type && type !== p.type)
			problems.push(`its input ${label(p)} is a ${p.type} fed a ${type}`);
	}
	for (const p of sub.outputs) {
		const read = view.wires.some((w) => w.from.node === callId && w.from.port === p.id);
		const feed = sub.wires.find((w) => w.to.node === outNode?.id && w.to.port === p.id)?.from;
		const type = feed && inside.outputs[feed.node]?.[feed.port];
		if (read && type && type !== p.type)
			problems.push(`its output ${label(p)} is a ${p.type} fed a ${type} inside`);
	}
	if (!problems.length) return undefined;
	return `Ungrouping would change what ${subgraphName(sub)} draws: ${problems.join('; ')}. Make each such port the type that feeds it, then ungroup.`;
}

/**
 * Call `callId` of the graph `scope` shows, replaced by its subgraph's nodes, wired as the call was:
 * what fed an input feeds what the body's Input fed, what an output fed reads what fed the body's
 * Output. An input left unwired becomes the value it read, set on the nodes that read it. When that
 * was the subgraph's last call, the subgraph goes too. Undefined when the call names no subgraph,
 * or {@link ungroupRefusal} says why not (always, in the motion graph).
 */
export function ungroupCall(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	callId: string,
): { doc: ShaderGraphDoc; ids: string[] } | undefined {
	const view = viewOf(doc, scope);
	const call = view.nodes.find((n) => n.id === callId && n.type === SUBGRAPH_CALL);
	const sub = call && subgraphOf(doc, calledSubgraph(call));
	if (!call || !sub || ungroupRefusal(doc, scope, callId)) return undefined;
	const inNode = sub.nodes.find((n) => n.type === SUBGRAPH_IN);
	const outNode = sub.nodes.find((n) => n.type === SUBGRAPH_OUT);
	const inner = sub.nodes.filter((n) => !PINNED.has(n.type));

	const taken = new Set(
		withOtherGraph(doc, scope, view)
			.nodes.filter((n) => n.id !== callId)
			.map((n) => n.id),
	);
	const rename = new Map<string, string>();
	for (const n of inner) {
		let id = n.id;
		if (taken.has(id)) {
			const stem = n.type.replace(/[^A-Za-z0-9]/g, '') || 'node';
			let k = 1;
			while (taken.has(`${stem}${k}`)) k++;
			id = `${stem}${k}`;
		}
		taken.add(id);
		rename.set(n.id, id);
	}
	const middle = (v: number[]): number =>
		v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0;
	const dx = call.x - middle(inner.map((n) => n.x));
	const dy = call.y - middle(inner.map((n) => n.y));

	const feeds = new Map<string, GraphWire['from']>();
	for (const w of view.wires)
		if (w.to.node === callId && !feeds.has(w.to.port)) feeds.set(w.to.port, w.from);
	const port = (side: 'inputs' | 'outputs', id: string) => sub[side].find((p) => p.id === id);
	const unwired = (
		side: 'inputs' | 'outputs',
		id: string,
		values: GraphNode['values'],
	): { value: number | number[]; type: PortType } | undefined => {
		const p = port(side, id);
		if (!p) return undefined;
		const set = values && Object.hasOwn(values, id) ? values[id] : undefined;
		const value = typeof set === 'number' || Array.isArray(set) ? set : (p.default ?? 0);
		return { value, type: p.type };
	};
	type Source = { wire: GraphWire['from'] } | { value: number | number[]; type: PortType };
	const source = (end: GraphWire['from']): Source | undefined => {
		if (inNode && end.node === inNode.id) {
			const from = feeds.get(end.port);
			return from ? { wire: from } : unwired('inputs', end.port, call.values);
		}
		const id = rename.get(end.node);
		return id ? { wire: { node: id, port: end.port } } : undefined;
	};
	const results = new Map<string, GraphWire['from']>();
	if (outNode)
		for (const w of sub.wires)
			if (w.to.node === outNode.id && !results.has(w.to.port)) results.set(w.to.port, w.from);

	const nodes: GraphNode[] = [
		...view.nodes.filter((n) => n.id !== callId).map(cloneNode),
		...inner.map((n) => ({
			...cloneNode(n),
			id: rename.get(n.id) as string,
			x: n.x + dx,
			y: n.y + dy,
		})),
	];
	const wires: GraphWire[] = [];
	const settled: { node: string; port: string; value: number | number[]; type: PortType }[] = [];
	const land = (s: Source | undefined, to: GraphWire['to']): void => {
		if (!s) return;
		if ('wire' in s) wires.push({ from: { ...s.wire }, to: { ...to } });
		else settled.push({ ...to, ...s });
	};
	for (const w of view.wires) {
		if (w.to.node === callId) continue;
		if (w.from.node === callId) {
			const from = results.get(w.from.port);
			land(from ? source(from) : unwired('outputs', w.from.port, outNode?.values), w.to);
		} else wires.push(w);
	}
	for (const w of sub.wires) {
		const to = rename.get(w.to.node);
		if (to) land(source(w.from), { node: to, port: w.to.port });
	}
	const placed = new Map(nodes.map((n) => [n.id, n]));
	for (const s of settled) {
		const node = placed.get(s.node);
		if (!node) continue;
		const type = nodeDefIn(doc, node, scope)?.inputs.find((p) => p.id === s.port)?.type;
		node.values = { ...(node.values ?? {}), [s.port]: valueFor(s.value, type) };
	}
	let next = inScope(doc, scope, (v) => clone({ ...v, nodes, wires }));
	if (!subgraphCalls(next, sub.id).length) next = withoutSubgraph(next, sub.id);
	return { doc: next, ids: inner.map((n) => rename.get(n.id) as string) };
}

/**
 * `doc` without subgraph `id`. A subgraph still called is kept (undefined) unless `withCalls`,
 * which deletes its calls too, with their wires.
 */
export function deleteSubgraph(
	doc: ShaderGraphDoc,
	id: string,
	withCalls = false,
): ShaderGraphDoc | undefined {
	const calls = subgraphCalls(doc, id);
	if (calls.length && !withCalls) return undefined;
	let next = doc;
	for (const scope of new Set(calls.map((c) => c.scope)))
		next = inScope(next, scope, (view) =>
			remove(
				view,
				calls.filter((c) => c.scope === scope).map((c) => c.node),
			),
		);
	return withoutSubgraph(next, id);
}

/** `doc` with subgraph `id` renamed; an empty name changes nothing. */
export function renameSubgraph(doc: ShaderGraphDoc, id: string, name: string): ShaderGraphDoc {
	if (!name.trim() || !subgraphOf(doc, id)) return doc;
	const next = clone(doc);
	(subgraphOf(next, id) as ShaderSubgraph).name = name.trim();
	return next;
}

export type PortSide = 'inputs' | 'outputs';

/**
 * `doc` with a new `type` input or output on subgraph `id`, its id one the side lacks; unchanged
 * when the side has its most ({@link SUBGRAPH_PORTS_MAX}).
 */
export function addSubgraphPort(
	doc: ShaderGraphDoc,
	id: string,
	side: PortSide,
	type: PortType = 'float',
): ShaderGraphDoc {
	const next = clone(doc);
	const sub = subgraphOf(next, id);
	if (!sub || sub[side].length >= SUBGRAPH_PORTS_MAX) return doc;
	const stem = side === 'inputs' ? 'in' : 'out';
	const taken = new Set(sub[side].map((p) => p.id));
	let n = 1;
	while (taken.has(`${stem}${n}`)) n++;
	sub[side].push({
		id: `${stem}${n}`,
		label: `${side === 'inputs' ? 'Input' : 'Output'} ${n}`,
		type,
	});
	return next;
}

/** Whether `value` is a value a port of `type` reads: a number, or `type`'s width of them. */
const fitsPort = (value: unknown, type: PortType): boolean =>
	typeof value === 'number' || (Array.isArray(value) && value.length === DIMS[type]);

/**
 * `doc` with port `portId` of subgraph `id` relabelled, retyped or given another default (its id
 * stays, so wires keep it). A default that does not fit its type is dropped; so are values set on
 * the calls (an input) or the body's Output (an output) that no longer fit.
 */
export function setSubgraphPort(
	doc: ShaderGraphDoc,
	id: string,
	side: PortSide,
	portId: string,
	patch: { label?: string; type?: PortType; default?: number | number[] | null },
): ShaderGraphDoc {
	const next = clone(doc);
	const sub = subgraphOf(next, id);
	const port = sub?.[side].find((p) => p.id === portId);
	if (!sub || !port) return doc;
	if (patch.label !== undefined) port.label = patch.label;
	if (patch.type) port.type = patch.type;
	if (patch.default === null) delete port.default;
	else if (patch.default !== undefined) port.default = patch.default;
	if (port.default !== undefined && !fitsPort(port.default, port.type)) delete port.default;
	const holders =
		side === 'inputs'
			? graphsOf(next).flatMap((g) =>
					g.nodes.filter((n) => n.type === SUBGRAPH_CALL && calledSubgraph(n) === id),
				)
			: sub.nodes.filter((n) => n.type === SUBGRAPH_OUT);
	for (const node of holders) {
		if (!node.values || !Object.hasOwn(node.values, portId)) continue;
		if (!fitsPort(node.values[portId], port.type)) delete node.values[portId];
	}
	return next;
}

/**
 * `doc` without port `portId` of subgraph `id`, and every wire to it: in the body (from its Input,
 * or into its Output) and at every call. Values set for it go too.
 */
export function removeSubgraphPort(
	doc: ShaderGraphDoc,
	id: string,
	side: PortSide,
	portId: string,
): ShaderGraphDoc {
	const next = clone(doc);
	const sub = subgraphOf(next, id);
	if (!sub?.[side].some((p) => p.id === portId)) return doc;
	sub[side] = sub[side].filter((p) => p.id !== portId);
	const boundary = new Set(
		sub.nodes
			.filter((n) => n.type === (side === 'inputs' ? SUBGRAPH_IN : SUBGRAPH_OUT))
			.map((n) => n.id),
	);
	sub.wires = sub.wires.filter((w) =>
		side === 'inputs'
			? !(boundary.has(w.from.node) && w.from.port === portId)
			: !(boundary.has(w.to.node) && w.to.port === portId),
	);
	for (const node of sub.nodes) if (boundary.has(node.id)) delete node.values?.[portId];
	const graphs: { nodes: GraphNode[]; wires: GraphWire[] }[] = [next, ...(next.subgraphs ?? [])];
	for (const g of graphs) {
		const calls = new Set(
			g.nodes.filter((n) => n.type === SUBGRAPH_CALL && calledSubgraph(n) === id).map((n) => n.id),
		);
		if (!calls.size) continue;
		g.wires = g.wires.filter((w) =>
			side === 'inputs'
				? !(calls.has(w.to.node) && w.to.port === portId)
				: !(calls.has(w.from.node) && w.from.port === portId),
		);
		for (const node of g.nodes) if (calls.has(node.id)) delete node.values?.[portId];
	}
	return next;
}

// ── The motion graph ────────────────────────────────────────────────────────────────────────────

/** Which graph the canvas shows: the pixel graph (and the subgraphs opened from it), or the motion
 *  graph. */
export type CanvasMode = 'pixel' | 'motion';

/**
 * Node `node`'s def in the graph `scope` shows: in the motion graph a motion node's (a node it does
 * not take keeps its pixel def, so it shows by name while the analysis says it does not belong),
 * elsewhere as {@link graphNodeDef} answers.
 */
export function nodeDefIn(
	doc: ShaderGraphDoc,
	node: GraphNode,
	scope: GraphScope,
): NodeDef | undefined {
	if (isMotionScope(scope)) return motionNode(node.type) ?? graphNodeDef(doc, node, null);
	return graphNodeDef(doc, node, scope);
}

/**
 * The motion graph's analysis (`motion`, when the page has it already) as the canvas reads a
 * graph's: its issues (naming motion nodes), the float each port resolved to; no pixel cost
 * (`analyzeShaderMotion` counts its ops instead).
 */
export function motionAnalysis(
	doc: ShaderGraphDoc,
	motion: ShaderMotionAnalysis = analyzeShaderMotion(doc),
): ShaderGraphAnalysis {
	return {
		issues: motion.issues,
		inputs: motion.types.inputs,
		outputs: motion.types.outputs,
		cost: 0,
		samples: 0,
	};
}

/**
 * `doc` with a `type` node at `pos` in the graph `scope` shows, and its id: one neither the
 * effect's graph nor the motion graph has, so an issue naming it is never read on the other. The
 * motion graph's first node brings its Output, to its right.
 */
export function addNodeIn(
	doc: ShaderGraphDoc,
	scope: GraphScope,
	type: string,
	pos: { x: number; y: number },
): { doc: ShaderGraphDoc; id: string } {
	const taken = (view: ShaderGraphDoc): ShaderGraphDoc => withOtherGraph(doc, scope, view);
	let id = '';
	const next = inScope(doc, scope, (view) => {
		const graph = clone(view);
		if (isMotionScope(scope) && !graph.nodes.length) {
			const at = { x: Math.round(pos.x) + 320, y: Math.round(pos.y) };
			graph.nodes.push({
				id: freshNodeId(taken(graph), MOTION_OUTPUT),
				type: MOTION_OUTPUT,
				...at,
			});
		}
		id = freshNodeId(taken(graph), type);
		graph.nodes.push({ id, type, x: Math.round(pos.x), y: Math.round(pos.y) });
		return graph;
	});
	return { doc: next, id };
}

/** `doc` without its motion graph: the curves in its settings move the element again. */
export function deleteMotionGraph(doc: ShaderGraphDoc): ShaderGraphDoc {
	if (!doc.motionGraph) return doc;
	const next = clone(doc);
	delete next.motionGraph;
	return next;
}

/** The channels the motion graph drives: its Output's inputs a wire feeds, in the Output's order. */
export function drivenChannels(doc: ShaderGraphDoc): string[] {
	const graph = doc.motionGraph;
	if (!graph) return [];
	const outs = new Set(graph.nodes.filter((n) => n.type === MOTION_OUTPUT).map((n) => n.id));
	const fed = new Set(graph.wires.filter((w) => outs.has(w.to.node)).map((w) => w.to.port));
	return (motionNode(MOTION_OUTPUT)?.inputs ?? []).map((p) => p.id).filter((port) => fed.has(port));
}

/**
 * What each channel of the Motion Output plays while unwired: padding the effect's own, a channel
 * its curve (`curve`) when the settings give it one, else nothing (`rest`).
 */
export function undrivenChannels(doc: ShaderGraphDoc): Record<string, string> {
	const curves = doc.motion?.channels ?? {};
	return Object.fromEntries(
		(motionNode(MOTION_OUTPUT)?.inputs ?? []).map((p) => [
			p.id,
			p.id === 'padding'
				? String(doc.padding ?? 0)
				: Object.hasOwn(curves, p.id)
					? 'curve'
					: 'rest',
		]),
	);
}

/** Motion nodes whose value is one number over the whole play: a curve would be a flat line. */
export const MOTION_FLAT_NODES: ReadonlySet<string> = new Set(['number', 'param', 'seed', 'shape']);

/** Whether motion node `node` shows its value over the play: it has an output, and it can vary. */
export const hasMotionCurve = (node: GraphNode): boolean =>
	!MOTION_FLAT_NODES.has(node.type) && (motionNode(node.type)?.outputs.length ?? 0) > 0;

/** Points a node's curve samples over one play, `t` 0…1. */
export const CURVE_SAMPLES = 65;

/** A motion node's value over one play: `values[i]` at `t = i / (values.length - 1)`. */
export interface MotionCurve {
	/** The output plotted: the first a wire takes onward, else the node's first. */
	port: string;
	values: number[];
	min: number;
	max: number;
}

/**
 * Every motion-graph node that shows a curve ({@link hasMotionCurve}), as its value over one play,
 * its params at their defaults, at full strength: null for one whose value cannot be worked out
 * (it or something it reads is broken, or the graph cannot be walked). One pass over the whole
 * graph (`motionGraphSeries`), so an edit anywhere is seen everywhere.
 */
export function motionCurves(
	doc: ShaderGraphDoc,
	samples = CURVE_SAMPLES,
): Map<string, MotionCurve | null> {
	const graph = viewOf(doc, MOTION_SCOPE);
	const series = motionGraphSeries(doc, samples);
	const curves = new Map<string, MotionCurve | null>();
	for (const node of graph.nodes) {
		if (!hasMotionCurve(node)) continue;
		const outputs = motionNode(node.type)?.outputs ?? [];
		const onward = new Set(
			graph.wires.filter((w) => w.from.node === node.id).map((w) => w.from.port),
		);
		const port = (outputs.find((p) => onward.has(p.id)) ?? outputs[0]).id;
		const values = series.get(node.id)?.[port];
		curves.set(
			node.id,
			values?.length && values.every((v) => Number.isFinite(v))
				? { port, values, min: Math.min(...values), max: Math.max(...values) }
				: null,
		);
	}
	return curves;
}

/**
 * Where `curve` is at progress `t`, as shares of its plot: `x` across (0…1), `y` up from its lowest
 * value to its highest (0.5 for a flat one), read between the samples either side.
 */
export function curvePoint(curve: MotionCurve, t: number): { x: number; y: number } {
	const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	const at = x * (curve.values.length - 1);
	const i = Math.min(curve.values.length - 2, Math.floor(at));
	const v =
		curve.values.length > 1
			? curve.values[i] + (curve.values[i + 1] - curve.values[i]) * (at - i)
			: curve.values[0];
	const span = curve.max - curve.min;
	return { x, y: span > 0 ? (v - curve.min) / span : 0.5 };
}

// ── The Break Output ────────────────────────────────────────────────────────────────────────────

/** One of the six breaks, as the Break select lists it. */
export interface BreakChoice {
	kind: BreakKind;
	label: string;
	description: string;
	/** What the effect must play as: exit for the five that take the element out, enter for
	 *  Assemble. */
	phase: ElementFxPhase;
	/** Assemble: its pieces fly in first, and the graph has the last of the play. */
	reversed: boolean;
}

/** The Break select: the six break kinds in the catalog's order, by its labels. */
export const BREAK_CHOICES: readonly BreakChoice[] = BREAK_KINDS.map((kind) => {
	const spec = elementFxSpec(kind);
	return {
		kind,
		label: spec.label,
		description: spec.description,
		phase: spec.phase,
		reversed: isReversedElementFxBreak(kind),
	};
});

/** The effect's Break Output: the first in its pixel graph (it takes one). */
export const breakOutputOf = (doc: ShaderGraphDoc): GraphNode | undefined =>
	doc.nodes.find((n) => n.type === BREAK_OUTPUT);

/** The ports of Break Output `node`: the params of the break it names (none for no break). */
export const breakParamsOf = (node: GraphNode): readonly ElementFxParamSpec[] => {
	const kind = breakKindOf(node);
	return kind ? breakKindParams(kind) : [];
};

/** A message fragment as a sentence. */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const BREAK_PIXEL_ONLY = 'A Break Output ends the pixel graph: switch to Pixel to add one.';
export const BREAK_NOT_IN_SUBGRAPH = `${sentence(BREAK_IN_SUBGRAPH)}: go back to Effect to add one.`;
export const BREAK_ONLY_ONE = 'The effect already ends in a Break Output: it takes one.';

/** Why a Break Output cannot go in the graph `scope` shows, else ''. */
export function breakPlacement(doc: ShaderGraphDoc, scope: GraphScope): string {
	if (isMotionScope(scope)) return BREAK_PIXEL_ONLY;
	if (scope) return BREAK_NOT_IN_SUBGRAPH;
	return breakOutputOf(doc) ? BREAK_ONLY_ONE : '';
}

/**
 * The palette's Break Output entry for the graph `scope` shows: listed in the pixel palette while
 * the effect has none, placeable in the effect's own graph (`refusal` ''), greyed out with the
 * reason inside a subgraph. Undefined where it is not listed: the motion palette, or once the
 * effect has one.
 */
export function breakPaletteEntry(
	doc: ShaderGraphDoc,
	scope: GraphScope,
): { refusal: string } | undefined {
	if (isMotionScope(scope) || breakOutputOf(doc)) return undefined;
	return { refusal: breakPlacement(doc, scope) };
}

/**
 * `doc` with Break Output `id` playing `kind`, and the labels of the ports whose wires went. Its
 * ports are the kind's params, so a wire into one the new kind lacks goes, and so does a value set
 * for one; a value the new kind's param of that id cannot take (a number past its range, an option
 * it lacks) goes too, and the port reads the kind's default. Where it starts stays. One gesture, so
 * one undo step brings the wires back.
 */
export function setBreakKind(
	doc: ShaderGraphDoc,
	id: string,
	kind: BreakKind,
): { doc: ShaderGraphDoc; dropped: string[] } {
	const node = doc.nodes.find((n) => n.id === id && n.type === BREAK_OUTPUT);
	if (!node || !isBreakKind(kind)) return { doc, dropped: [] };
	const was = breakParamsOf(node);
	const now = new Map(breakKindParams(kind).map((p) => [p.id, p]));
	const next = clone(doc);
	const values: NonNullable<GraphNode['values']> = { kind };
	for (const [key, value] of Object.entries(node.values ?? {})) {
		const spec = now.get(key);
		if (key === 'at' || (spec && readBreakValue(spec, value) !== undefined)) values[key] = value;
	}
	(next.nodes.find((n) => n.id === id) as GraphNode).values = values;
	const lost = next.wires.filter((w) => w.to.node === id && !now.has(w.to.port));
	next.wires = next.wires.filter((w) => !lost.includes(w));
	const dropped = [
		...new Set(lost.map((w) => was.find((p) => p.id === w.to.port)?.label ?? w.to.port)),
	];
	return { doc: next, dropped };
}

/** `doc` with Break Output `id` starting at `at` (kept 0…1), or at the default (`undefined`). */
export function setBreakAt(
	doc: ShaderGraphDoc,
	id: string,
	at: number | undefined,
): ShaderGraphDoc {
	if (at !== undefined && !Number.isFinite(at)) return doc;
	return setNodeValue(doc, id, 'at', at === undefined ? undefined : Math.min(1, Math.max(0, at)));
}

/**
 * `doc` with Break Output `id`'s port `port` reading `value` while unwired, stored as the break
 * reads it (`readBreakValue`): a number kept within the param's range, a colour as `#rrggbb`, a
 * switch as 1 or 0, a choice as its option. `undefined` clears it back to the kind's default; a
 * value the param cannot take changes nothing.
 */
export function setBreakValue(
	doc: ShaderGraphDoc,
	id: string,
	port: string,
	value: number | string | boolean | undefined,
): ShaderGraphDoc {
	const node = doc.nodes.find((n) => n.id === id && n.type === BREAK_OUTPUT);
	const spec = node && breakParamsOf(node).find((p) => p.id === port);
	if (!spec) return doc;
	if (value === undefined) return setNodeValue(doc, id, port, undefined);
	let stored: number | string | undefined;
	if (spec.kind === 'number') {
		const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
		if (Number.isFinite(n)) stored = Math.min(spec.max, Math.max(spec.min, n));
	} else if (spec.kind === 'bool') stored = value === true || value === 1 ? 1 : 0;
	else {
		const read = readBreakValue(spec, value);
		if (typeof read === 'string') stored = read;
	}
	return stored === undefined ? doc : setNodeValue(doc, id, port, stored);
}

/** What an unwired break port reads, in words, with its swatch for a colour. */
export interface BreakPortValue {
	text: string;
	swatch?: string;
	/** The node holds a value the break cannot read (its error says so): shown as it is. */
	bad?: boolean;
}

/**
 * What port `spec` of a Break Output reads while unwired: the value set on the node, else the
 * kind's default. A number as itself, a colour as its hex and swatch, a switch on or off, a choice
 * its option's name (stored as the option, or as its place in the list).
 */
export function breakPortValue(spec: ElementFxParamSpec, value: unknown): BreakPortValue {
	const read = readBreakValue(spec, value) ?? (value === undefined ? spec.default : undefined);
	if (read === undefined) return { text: String(value), bad: true };
	if (spec.kind === 'number') return { text: String(Number(Number(read).toFixed(3))) };
	if (spec.kind === 'bool') return { text: read ? 'on' : 'off' };
	if (spec.kind === 'color') return { text: String(read), swatch: String(read) };
	return { text: String(read) };
}

/** What a Break Output's header shows: the break it plays, by the catalog's label. */
const breakSummary = (node: GraphNode): string => {
	const kind = breakKindOf(node);
	return kind ? elementFxSpec(kind).label : `no break ${JSON.stringify(String(node.values?.kind))}`;
};

/** Each port of Break Output `node`, as its node shows it unwired ({@link breakPortValue}). */
export const breakPortValues = (node: GraphNode): Record<string, BreakPortValue> =>
	Object.fromEntries(
		breakParamsOf(node).map((spec) => [spec.id, breakPortValue(spec, node.values?.[spec.id])]),
	);

/**
 * Why `from` cannot feed Break Output port `to` of the graph `scope` shows, as the engine says it
 * (`breakOutputIssues` on the graph with the wire made), else undefined: also for an input that
 * is no Break Output's. A break is set once, as it starts, so a port takes a Param tied to a param
 * of its kind, a Number (a number, switch or choice) or a Colour. A Number's own value is not
 * judged here: past the port's range it is an error on the Break Output, mended on the Number.
 */
export function breakFeedRefusal(
	doc: ShaderGraphDoc,
	from: GraphWire['from'],
	to: GraphWire['to'],
	scope: GraphScope = null,
): string | undefined {
	const view = viewOf(doc, scope);
	const target = view.nodes.find((n) => n.id === to.node);
	if (target?.type !== BREAK_OUTPUT || isMotionScope(scope) || scope) return undefined;
	const spec = breakParamsOf(target).find((p) => p.id === to.port);
	const source = view.nodes.find((n) => n.id === from.node);
	if (!spec || !source) return undefined;
	const probe: GraphNode =
		source.type === 'number' && spec.kind === 'number'
			? { ...source, values: { ...source.values, value: spec.default } }
			: source;
	const issues = breakOutputIssues(
		view.nodes.map((n) => (n.id === source.id ? probe : n)),
		[...view.wires.filter((w) => !(w.to.node === to.node && w.to.port === to.port)), { from, to }],
		new Map(doc.params.map((p) => [p.id, p])),
		doc.phase,
	);
	const issue = issues.find((i) => i.node === to.node && i.port === to.port);
	return issue && `${sentence(issue.message)}.`;
}

/**
 * Per port of Break Output `node`, why each other node of the graph `scope` shows cannot feed it
 * (a node that can is absent), for the canvas to say while a wire hovers the port. Worked out once
 * per kind of source (a Param per param, a Number, a Colour, each other node type).
 */
function breakRefusals(
	doc: ShaderGraphDoc,
	node: GraphNode,
	scope: GraphScope,
): Record<string, Record<string, string>> {
	const view = viewOf(doc, scope);
	const out: Record<string, Record<string, string>> = {};
	for (const spec of breakParamsOf(node)) {
		const said = new Map<string, string | undefined>();
		const row: Record<string, string> = {};
		for (const source of view.nodes) {
			if (source.id === node.id) continue;
			const key = source.type === 'param' ? `param:${String(source.values?.param)}` : source.type;
			if (!said.has(key))
				said.set(
					key,
					breakFeedRefusal(
						doc,
						{ node: source.id, port: 'out' },
						{ node: node.id, port: spec.id },
						scope,
					),
				);
			const reason = said.get(key);
			if (reason) row[source.id] = reason;
		}
		out[spec.id] = row;
	}
	return out;
}

/** The phase the effect plays as, against the one its Break Output's kind needs. */
export interface BreakPhaseMismatch {
	kind: BreakKind;
	label: string;
	/** What the effect must play as. */
	phase: ElementFxPhase;
	message: string;
}

const PHASE_NAME: Record<ElementFxPhase, string> = {
	emphasis: 'Emphasis',
	loop: 'Loop',
	enter: 'Enter',
	exit: 'Exit',
};

export const phaseName = (phase: ElementFxPhase): string => PHASE_NAME[phase] ?? phase;

/** Whether the effect plays as a phase its Break Output's kind cannot; the fix is that phase. */
export function breakPhaseMismatch(doc: ShaderGraphDoc): BreakPhaseMismatch | undefined {
	const node = breakOutputOf(doc);
	const kind = node && breakKindOf(node);
	if (!kind) return undefined;
	const spec = elementFxSpec(kind);
	if (doc.phase === spec.phase) return undefined;
	const how = spec.phase === 'enter' ? 'brings the element in' : 'takes the element out';
	return {
		kind,
		label: spec.label,
		phase: spec.phase,
		message: `${spec.label} ${how}: the effect must play as ${phaseName(spec.phase)}, not ${phaseName(doc.phase)}.`,
	};
}

/** `doc` playing as `phase`. */
export const setPhase = (doc: ShaderGraphDoc, phase: ElementFxPhase): ShaderGraphDoc =>
	doc.phase === phase ? doc : { ...clone(doc), phase };

/** What feeds each wired port of Break Output `id`, in words (`Param · Amount`, `Number`). */
export function breakPortSources(doc: ShaderGraphDoc, id: string): Record<string, string> {
	const params = new Map(doc.params.map((p) => [p.id, p.label]));
	return Object.fromEntries(
		doc.wires
			.filter((w) => w.to.node === id)
			.map((w) => {
				const source = doc.nodes.find((n) => n.id === w.from.node);
				const label = (source && graphNodeDef(doc, source, null)?.label) ?? 'a node';
				const param = source?.type === 'param' ? params.get(String(source.values?.param)) : '';
				return [w.to.port, param ? `${label} · ${param}` : label];
			}),
	);
}

/** When the break meets the graph, in ms of a `durationMs` play: where an exit's begins, where an
 *  Assemble's pieces have flown in. */
export function breakEdgeMs(kind: BreakKind, at: number, durationMs: number): number {
	return Math.round(customElementFxBreakWindow({ kind, at }).edge * durationMs);
}

/**
 * Why nodes `ids` of the effect's graph cannot be grouped for the break: a group of the Break
 * Output, or of a node wired into one, would move it into a subgraph, which neither takes.
 */
function breakGroupRefusal(view: ShaderGraphDoc, picked: ReadonlySet<string>): string | undefined {
	const breaks = new Set(view.nodes.filter((n) => n.type === BREAK_OUTPUT).map((n) => n.id));
	if (!breaks.size) return undefined;
	const feeders = new Set(view.wires.filter((w) => breaks.has(w.to.node)).map((w) => w.from.node));
	const caught = view.nodes.filter(
		(n) => picked.has(n.id) && (breaks.has(n.id) || feeders.has(n.id)),
	);
	if (!caught.length) return undefined;
	const names = [
		...new Set(caught.map((n) => (n.type === BREAK_OUTPUT ? 'the Break Output' : n.id))),
	];
	return `The Break Output and the nodes wired into it stay in the effect’s own graph: a subgraph takes neither. Leave ${names.join(', ')} out of the group.`;
}
