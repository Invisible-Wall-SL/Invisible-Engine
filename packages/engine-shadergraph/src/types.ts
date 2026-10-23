/**
 * INVISIBLE SHADER GRAPH — the saved document: a node graph that compiles to one Element FX shader
 * pass (`docs/design/invisible-shader-graph.md`). Dependency-free, so the launcher, the game and
 * the headless checks read it alike.
 *
 * A graph is wired from typed ports. What it compiles to plays as an Element FX kind: the doc's
 * `phase` and `durationMs` mean what a built-in kind's do, and its `params` are the rows the
 * Scene Editor, `/symbols` and the Flow show for it.
 */

import type { ElementFxParamSpec, ElementFxPhase } from 'constants-shared/elementFx';

export const SHADER_GRAPH_VERSION = 1;

/** A port's value: a number, or a vector of 2–4. A colour is a `vec3` (or `vec4` with alpha). */
export type PortType = 'float' | 'vec2' | 'vec3' | 'vec4';

export interface ShaderGraphDoc {
	version: typeof SHADER_GRAPH_VERSION;
	id: string;
	name: string;
	phase: ElementFxPhase;
	/** One play's length when an entry leaves `durationMs` unset. */
	durationMs: number;
	/** Room the pass draws outside the element's box, in screen px (a glow, an arc). */
	padding?: number;
	/** The rows an author sets where the effect is placed; a `param` node reads one. */
	params: ElementFxParamSpec[];
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
	| 'unwired'
	| 'value'
	| 'setting'
	| 'unreachable'
	| 'cost';
