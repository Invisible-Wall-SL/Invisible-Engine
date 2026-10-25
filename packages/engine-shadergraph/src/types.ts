/**
 * INVISIBLE SHADER GRAPH — the saved document: a node graph that compiles to one Element FX shader
 * pass (`docs/design/invisible-shader-graph.md`). Dependency-free, so the launcher, the game and
 * the headless checks read it alike.
 *
 * A graph is wired from typed ports. What it compiles to plays as an Element FX kind: the doc's
 * `phase` and `durationMs` mean what a built-in kind's do, and its `params` are the rows the
 * Scene Editor, `/symbols` and the Flow show for it.
 */

import type {
	CustomElementFxMotion,
	CustomElementFxPass,
	ElementFxParamSpec,
	ElementFxPhase,
} from 'constants-shared/elementFx';

export const SHADER_GRAPH_VERSION = 1;

/** A port's value: a number, or a vector of 2–4. A colour is a `vec3` (or `vec4` with alpha). */
export type PortType = 'float' | 'vec2' | 'vec3' | 'vec4';

export interface ShaderGraphDoc {
	version: typeof SHADER_GRAPH_VERSION;
	/** A slug: the effect plays as the Element FX kind `custom:<id>`. */
	id: string;
	name: string;
	/** What the effect does, for the pickers. */
	description?: string;
	phase: ElementFxPhase;
	/** One play's length when an entry leaves `durationMs` unset. */
	durationMs: number;
	/**
	 * Room the graph draws outside the element's box (a glow, a pushed-out ring), as a share of the
	 * element's larger side.
	 */
	padding?: number;
	/** The rows an author sets where the effect is placed; a `param` node reads one. */
	params: ElementFxParamSpec[];
	nodes: GraphNode[];
	wires: GraphWire[];
	/** Built-in passes drawn after the graph (a glow, an outline, a blur), in order. */
	passes?: CustomElementFxPass[];
	/** The element's own motion over the play: a curve per channel. */
	motion?: CustomElementFxMotion;
	/**
	 * The motion graph: float nodes evaluated on the CPU each frame into one Motion Output, whose
	 * wired inputs drive the element's transform channels (each overriding its curve) and the
	 * padding. Absent or empty: the effect has none.
	 */
	motionGraph?: ShaderMotionGraph;
	/**
	 * Reusable groups of nodes, defined once and called by a `subgraph` node as often as the effect
	 * likes (in its graph or in another subgraph's body). The compiler inlines every call.
	 */
	subgraphs?: ShaderSubgraph[];
}

/** A doc's motion graph: nodes and wires as the pixel graph's, its ports all floats. */
export interface ShaderMotionGraph {
	nodes: GraphNode[];
	wires: GraphWire[];
}

/** One of a subgraph's inputs or outputs: a port on every node that calls it. */
export interface SubgraphPort {
	/** Stable: wires and a call's values name it. A word, and never `subgraph`. */
	id: string;
	label: string;
	type: PortType;
	/** What an input left unwired on a call reads (an output left unwired inside, likewise); else 0. */
	default?: number | number[];
}

/**
 * A group of nodes with typed inputs and outputs. Its body holds one `subgraphIn` node (an output
 * per input) and one `subgraphOut` node (an input per output) besides its own nodes; a Param node
 * inside reads the effect's params. A node `{ type: 'subgraph', values: { subgraph: id } }` calls
 * it, its ports being the subgraph's.
 */
export interface ShaderSubgraph {
	id: string;
	name: string;
	inputs: SubgraphPort[];
	outputs: SubgraphPort[];
	nodes: GraphNode[];
	wires: GraphWire[];
}

export interface GraphNode {
	id: string;
	type: string;
	x: number;
	y: number;
	/**
	 * Values the author set on the node: a literal for an input left unwired (number or vector,
	 * by the port's type), and the node's settings (a choice, a param id, a colour).
	 */
	values?: Record<string, number | number[] | string>;
	/** A Custom GLSL node's (`customGlsl`) definition: its body and its declared ports. */
	glsl?: CustomGlslDefinition;
}

/**
 * What a Custom GLSL node runs: `code`, the body of a GLSL ES 1.00 function that reads its inputs
 * and writes its outputs by their ids. Ports follow the subgraph ports' rules; an input and an output
 * of one id are one value, passed in and changed in place. At least one output.
 */
export interface CustomGlslDefinition {
	code: string;
	inputs: SubgraphPort[];
	outputs: SubgraphPort[];
}

export interface GraphWire {
	from: { node: string; port: string };
	to: { node: string; port: string };
}

export type GraphIssueLevel = 'error' | 'warning';

export interface GraphIssue {
	level: GraphIssueLevel;
	code: GraphIssueCode;
	message: string;
	node?: string;
	port?: string;
	/** Set on an issue in the motion graph: its `node` is one of the motion graph's. */
	graph?: 'motion';
	/** For an issue in a Custom GLSL node's code, the line of the code it is on (from 1). */
	line?: number;
}

export type GraphIssueCode =
	| 'version'
	| 'doc'
	| 'param'
	| 'unknown-node'
	| 'duplicate-node'
	| 'output'
	| 'wire'
	| 'wired-twice'
	| 'type'
	| 'cycle'
	| 'value'
	| 'setting'
	| 'unreachable'
	| 'cost'
	| 'pass'
	| 'motion'
	| 'subgraph'
	| 'break'
	| 'glsl';
