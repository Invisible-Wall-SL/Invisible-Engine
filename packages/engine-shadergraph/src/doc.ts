/**
 * The saved doc's shape, as storage keeps it. A graph is saved while it is still being built, so
 * this keeps whatever the author wrote that has the doc's shape, broken wiring and bad values
 * included (the validator reports those), and drops anything that is not part of the doc. The
 * motion graph is kept as the pixel graph is; an empty one is dropped. A Custom GLSL node keeps its
 * definition (`glsl`): its code as text, its ports as a subgraph's are kept. `madeFor` is kept only
 * as `'particles'`.
 */

import { CUSTOM_GLSL } from './customGlsl';
import {
	SHADER_GRAPH_VERSION,
	SHADER_MADE_FOR_PARTICLES,
	type GraphNode,
	type GraphWire,
	type ShaderGraphDoc,
	type ShaderSubgraph,
	type SubgraphPort,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** A JSON copy of what the author wrote; the validator, not this, checks it is a `T`. */
const copyAs = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

const finite = (value: unknown, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const readNode = (raw: Record<string, unknown>): GraphNode => {
	const node: GraphNode = {
		id: typeof raw.id === 'string' ? raw.id : '',
		type: typeof raw.type === 'string' ? raw.type : '',
		x: finite(raw.x, 0),
		y: finite(raw.y, 0),
	};
	if (isRecord(raw.values)) {
		const values: NonNullable<GraphNode['values']> = {};
		for (const [key, value] of Object.entries(raw.values)) {
			// An own `__proto__` key (JSON makes one) would set the object's prototype on assignment.
			if (key === '__proto__') continue;
			if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
				values[key] = value;
			else if (
				Array.isArray(value) &&
				value.every((v) => typeof v === 'number' && Number.isFinite(v))
			)
				values[key] = [...(value as number[])];
		}
		node.values = values;
	}
	if (node.type === CUSTOM_GLSL && isRecord(raw.glsl))
		node.glsl = {
			code: typeof raw.glsl.code === 'string' ? raw.glsl.code : '',
			inputs: readList(raw.glsl.inputs, readPort),
			outputs: readList(raw.glsl.outputs, readPort),
		};
	return node;
};

const readEnd = (raw: unknown): GraphWire['from'] | undefined =>
	isRecord(raw) && typeof raw.node === 'string' && typeof raw.port === 'string'
		? { node: raw.node, port: raw.port }
		: undefined;

const readWire = (raw: unknown): GraphWire | undefined => {
	if (!isRecord(raw)) return undefined;
	const from = readEnd(raw.from);
	const to = readEnd(raw.to);
	return from && to ? { from, to } : undefined;
};

const readPort = (raw: unknown): SubgraphPort | undefined => {
	if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string')
		return undefined;
	const port: SubgraphPort = {
		id: raw.id,
		label: typeof raw.label === 'string' ? raw.label : raw.id,
		type: raw.type as SubgraphPort['type'],
	};
	if (typeof raw.default === 'number' && Number.isFinite(raw.default)) port.default = raw.default;
	else if (
		Array.isArray(raw.default) &&
		raw.default.every((v) => typeof v === 'number' && Number.isFinite(v))
	)
		port.default = [...(raw.default as number[])];
	return port;
};

const readList = <T>(raw: unknown, read: (item: unknown) => T | undefined): T[] =>
	Array.isArray(raw) ? raw.map(read).filter((item): item is T => item !== undefined) : [];

const readSubgraph = (raw: unknown): ShaderSubgraph | undefined =>
	isRecord(raw) && typeof raw.id === 'string'
		? {
				id: raw.id,
				name: typeof raw.name === 'string' ? raw.name : raw.id,
				inputs: readList(raw.inputs, readPort),
				outputs: readList(raw.outputs, readPort),
				nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(isRecord).map(readNode) : [],
				wires: readList(raw.wires, readWire),
			}
		: undefined;

/**
 * `raw` as a {@link ShaderGraphDoc} under `id`: the doc's own fields, copied. Nothing here
 * validates the graph; `validateShaderGraph` and the compiler do, and an unreadable `raw` comes
 * back as an empty doc.
 */
export function normalizeShaderGraphDoc(raw: unknown, id: string): ShaderGraphDoc {
	const src = isRecord(raw) ? raw : {};
	const doc: ShaderGraphDoc = {
		version: SHADER_GRAPH_VERSION,
		id,
		name: typeof src.name === 'string' ? src.name : id,
		phase: (typeof src.phase === 'string' ? src.phase : 'loop') as ShaderGraphDoc['phase'],
		durationMs: finite(src.durationMs, 1000),
		params: Array.isArray(src.params) ? copyAs(src.params.filter(isRecord)) : [],
		nodes: Array.isArray(src.nodes) ? src.nodes.filter(isRecord).map(readNode) : [],
		wires: Array.isArray(src.wires)
			? src.wires.map(readWire).filter((w): w is GraphWire => !!w)
			: [],
	};
	if (typeof src.description === 'string') doc.description = src.description;
	if (typeof src.padding === 'number' && Number.isFinite(src.padding)) doc.padding = src.padding;
	if (Array.isArray(src.passes)) doc.passes = copyAs(src.passes.filter(isRecord));
	if (isRecord(src.motion)) doc.motion = copyAs(src.motion);
	const subgraphs = readList(src.subgraphs, readSubgraph);
	if (subgraphs.length) doc.subgraphs = subgraphs;
	if (isRecord(src.motionGraph)) {
		const { nodes, wires } = src.motionGraph;
		const motionGraph = {
			nodes: Array.isArray(nodes) ? nodes.filter(isRecord).map(readNode) : [],
			wires: readList(wires, readWire),
		};
		if (motionGraph.nodes.length || motionGraph.wires.length) doc.motionGraph = motionGraph;
	}
	if (src.madeFor === SHADER_MADE_FOR_PARTICLES) doc.madeFor = SHADER_MADE_FOR_PARTICLES;
	return doc;
}
