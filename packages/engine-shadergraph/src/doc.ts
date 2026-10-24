/**
 * The saved doc's shape, as storage keeps it. A graph is saved while it is still being built, so
 * this keeps whatever the author wrote that has the doc's shape, broken wiring and bad values
 * included (the validator reports those), and drops anything that is not part of the doc.
 */

import { SHADER_GRAPH_VERSION, type GraphNode, type GraphWire, type ShaderGraphDoc } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
		params: Array.isArray(src.params) ? plain(src.params.filter(isRecord)) : [],
		nodes: Array.isArray(src.nodes) ? src.nodes.filter(isRecord).map(readNode) : [],
		wires: Array.isArray(src.wires)
			? src.wires.map(readWire).filter((w): w is GraphWire => !!w)
			: [],
	} as ShaderGraphDoc;
	if (typeof src.description === 'string') doc.description = src.description;
	if (typeof src.padding === 'number' && Number.isFinite(src.padding)) doc.padding = src.padding;
	if (Array.isArray(src.passes))
		doc.passes = plain(src.passes.filter(isRecord)) as ShaderGraphDoc['passes'];
	if (isRecord(src.motion)) doc.motion = plain(src.motion) as ShaderGraphDoc['motion'];
	return doc;
}
