/**
 * How a twin's graph is written: as expressions. Each call adds one node of the library, wires the
 * inputs given as another node's output, sets those given as numbers, and hands back the node's
 * outputs to wire on. Its motion graph (`motion()`) is written the same way, ending in `out()`.
 * `doc()` lays the nodes out left to right by how deep they sit, so a twin opens in /shaders as a
 * readable graph.
 */

import {
	elementFxSpec,
	type CustomElementFxMotion,
	type CustomElementFxPass,
	type ElementFxKind,
	type ElementFxMotionOutput,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import { motionNode, shaderNode, type NodeDef } from '../nodes';
import {
	SHADER_GRAPH_VERSION,
	type GraphNode,
	type GraphWire,
	type ShaderGraphDoc,
} from '../types';

/** One output of a node in the graph. */
export interface Ref {
	node: string;
	port: string;
}

/** An input: another node's output, or a value for it unwired. */
export type In = Ref | number | readonly number[];

type Setting = string | number;

const isRef = (value: In): value is Ref => typeof value === 'object' && 'node' in value;

/** What a twin's doc takes beyond its kind's own spec. */
export interface TwinMeta {
	/** Unset: the kind's own. */
	description?: string;
	padding?: number;
	passes?: CustomElementFxPass[];
	motion?: CustomElementFxMotion;
}

const COLUMN = 300;
const ROW = 22;
const GAP = 48;

/**
 * The expressions over one graph of `kind`'s twin, its nodes found by `lookup`: the pixel graph's
 * library, or the motion graph's. `made` counts the nodes of both graphs, so no id names a node in
 * each (an issue or a gesture naming one is never read on the other).
 */
function expressions(
	kind: ElementFxKind,
	lookup: (type: string) => NodeDef | undefined,
	made: { count: number },
) {
	const spec = elementFxSpec(kind);
	const nodes: GraphNode[] = [];
	const wires: GraphWire[] = [];
	const shared = new Map<string, Record<string, Ref>>();

	const node = (
		type: string,
		inputs: Record<string, In> = {},
		settings: Record<string, Setting> = {},
	): Record<string, Ref> => {
		const def = lookup(type);
		if (!def) throw new Error(`twin ${kind}: no node "${type}"`);
		const id = `${type}${++made.count}`;
		const values: NonNullable<GraphNode['values']> = { ...settings };
		for (const [port, value] of Object.entries(inputs)) {
			if (!def.inputs.some((p) => p.id === port))
				throw new Error(`twin ${kind}: ${type} has no input "${port}"`);
			if (isRef(value)) wires.push({ from: value, to: { node: id, port } });
			else values[port] = typeof value === 'number' ? value : [...value];
		}
		nodes.push({ id, type, x: 0, y: 0, ...(Object.keys(values).length ? { values } : {}) });
		return Object.fromEntries(def.outputs.map((p) => [p.id, { node: id, port: p.id }]));
	};
	/** A node every caller shares (the time, the UV, the seed): made once. */
	const once = (type: string): Record<string, Ref> => {
		let made = shared.get(type);
		if (!made) {
			made = node(type);
			shared.set(type, made);
		}
		return made;
	};
	const out = (type: string, inputs: Record<string, In>, settings?: Record<string, Setting>) =>
		node(type, inputs, settings).out;
	const params = new Map<string, Ref>();

	return {
		nodes,
		wires,
		node,
		once,
		time: () => once('time'),
		/** The kind's param `id`, read once however often it is wired. */
		param(id: string): Ref {
			if (!spec.params.some((p) => p.id === id)) throw new Error(`twin ${kind}: no param "${id}"`);
			let ref = params.get(id);
			if (!ref) {
				ref = node('param', {}, { param: id }).out;
				params.set(id, ref);
			}
			return ref;
		},
		add: (a: In, b: In) => out('add', { a, b }),
		sub: (a: In, b: In) => out('subtract', { a, b }),
		mul: (a: In, b: In) => out('multiply', { a, b }),
		div: (a: In, b: In) => out('divide', { a, b }),
		min: (a: In, b: In) => out('min', { a, b }),
		max: (a: In, b: In) => out('max', { a, b }),
		mix: (a: In, b: In, t: In) => out('mix', { a, b, t }),
		clamp: (x: In, min: In, max: In) => out('clamp', { x, min, max }),
		smooth: (from: In, to: In, x: In) => out('smoothstep', { from, to, x }),
		step: (edge: In, x: In) => out('step', { edge, x }),
		pow: (x: In, power: In) => out('pow', { x, power }),
		oneMinus: (x: In) => out('oneMinus', { x }),
		abs: (x: In) => out('abs', { x }),
		floor: (x: In) => out('floor', { x }),
		fract: (x: In) => out('fract', { x }),
		sin: (x: In) => out('sin', { x }),
		cos: (x: In) => out('cos', { x }),
	};
}

/** A builder for built-in `kind`'s twin: its id, name, phase, length and params are the kind's. */
export function twinGraph(kind: ElementFxKind, meta: TwinMeta) {
	const spec = elementFxSpec(kind);
	const made = { count: 0 };
	const pixel = expressions(kind, shaderNode, made);
	const { nodes, wires, node, once } = pixel;
	const out = (type: string, inputs: Record<string, In>, settings?: Record<string, Setting>) =>
		node(type, inputs, settings).out;
	const moving = expressions(kind, motionNode, made);
	let motionGraph: ShaderGraphDoc['motionGraph'];

	return {
		...pixel,
		uv: () => once('uv').out,
		uvSquare: () => once('uvSquare').out,
		seed: () => once('seed').out,
		length: (v: In) => out('length', { v }),
		dot: (a: In, b: In) => out('dot', { a, b }),
		/** Numbers into a vec2 (`xy`), a vec3 (`xyz`) or a vec4 (`xyzw`). */
		combine: (x: In, y: In, z: In = 0, w: In = 1) => node('combine', { x, y, z, w }),
		split: (v: In) => node('split', { v }),
		/** 1 where `x` is above `edge`, 0 where it is not (`x > edge`). */
		above: (x: In, edge: In) => out('oneMinus', { x: out('step', { edge: x, x: edge }) }),
		noise: (p: In, scale: In = 1, seed: In = 0) => out('noise', { p, scale, seed }),
		hash: (p: In) => out('hash', { p }),
		/** The Output: `color` (unwired, the element as it is), Blend Add letting it outshine alpha. */
		output(color?: In, blend?: 'normal' | 'add'): void {
			node('output', color === undefined ? {} : { color }, blend ? { blend } : {});
		},
		/**
		 * The twin's motion graph, run on the CPU each frame: its time, the element's shape and the
		 * kind's params read as in the pixel graph, and `out` wiring what it drives into the Motion
		 * Output.
		 */
		motion: () => ({
			...moving,
			shape: () => moving.once('shape'),
			out(drives: Partial<Record<ElementFxMotionOutput, Ref>>): void {
				moving.node('motionOutput', drives);
				motionGraph = { nodes: moving.nodes, wires: moving.wires };
			},
		}),
		doc(): ShaderGraphDoc {
			layout(nodes, wires, shaderNode, 'output');
			if (motionGraph) layout(motionGraph.nodes, motionGraph.wires, motionNode, 'motionOutput');
			return {
				version: SHADER_GRAPH_VERSION,
				id: kind,
				name: spec.label,
				description: meta.description ?? spec.description,
				phase: spec.phase,
				durationMs: spec.durationMs,
				...(meta.padding ? { padding: meta.padding } : {}),
				params: JSON.parse(JSON.stringify(spec.params)) as ElementFxParamSpec[],
				nodes,
				wires,
				...(meta.passes ? { passes: meta.passes } : {}),
				...(meta.motion ? { motion: meta.motion } : {}),
				...(motionGraph ? { motionGraph } : {}),
			};
		},
	};
}

/**
 * Columns by depth (a node right of every node it reads, the graph's `last` node rightmost), stacked
 * in the order they were made.
 */
function layout(
	nodes: GraphNode[],
	wires: readonly GraphWire[],
	lookup: (type: string) => NodeDef | undefined,
	last: string,
): void {
	const depth = new Map<string, number>();
	const feeds = new Map<string, string[]>();
	for (const wire of wires)
		feeds.set(wire.to.node, [...(feeds.get(wire.to.node) ?? []), wire.from.node]);
	const depthOf = (id: string): number => {
		const known = depth.get(id);
		if (known !== undefined) return known;
		const d = Math.max(-1, ...(feeds.get(id) ?? []).map(depthOf)) + 1;
		depth.set(id, d);
		return d;
	};
	const deepest = Math.max(0, ...nodes.map((n) => depthOf(n.id)));
	const heights = new Map<number, number>();
	for (const n of nodes) {
		const column = n.type === last ? deepest : depthOf(n.id);
		const def = lookup(n.type);
		const rows = Math.max(def?.inputs.length ?? 0, def?.outputs.length ?? 0, 1);
		const y = heights.get(column) ?? 0;
		n.x = column * COLUMN;
		n.y = y;
		heights.set(column, y + 40 + rows * ROW + GAP);
	}
}
