/**
 * THE BREAK OUTPUT (step 8b): a pixel-graph node that chooses one of the six built-in breaks and sets
 * it. Breaks stay coded (`pixi-svelte`'s `breakApart.ts`): the node only picks one, says where in the
 * play it begins, and sets its params, each tied to one of the effect's params or a constant.
 *
 * Its ports are the chosen kind's catalog params, by id: a number param a float port, a colour a vec3,
 * a switch a float (0 / 1), a choice a float (its option's index, as the Param node reads a choice).
 * The break is set once per play, so only a Param (the tie), a Number or a Colour feeds one; a port
 * left unwired reads the node's own value for it, else the kind's default. The node stores, by param
 * id: a number; a colour as `#rrggbb` (what the Colour node stores); a switch as 1 / 0; a choice as
 * its option (an index is read too).
 *
 * It reaches no GLSL: it compiles to the effect's `break` (`CustomElementFxBreak`), which the runtime
 * plays after the graph. In the per-pixel cost it counts nothing, nor do the nodes feeding only it:
 * a break is CPU geometry and one extra draw of the element (each frame of an `assemble`'s window),
 * outside the phone's per-pixel budget.
 */

import {
	ELEMENT_FX_BREAK_KINDS,
	elementFxParamUniform,
	elementFxSpec,
	isReversedElementFxBreak,
	type CustomElementFxBreak,
	type CustomElementFxMotionProgram,
	type CustomElementFxPassValue,
	type ElementFxBreakKind,
	type ElementFxCurve,
	type ElementFxParamSpec,
	type ElementFxParamValue,
} from 'constants-shared/elementFx';
import type { MotionOp } from 'constants-shared/motionLibrary';
import { PARAM_TYPE, type NodeDef } from './nodes';
import type { GraphIssue, GraphNode, GraphWire } from './types';

export const BREAK_OUTPUT = 'breakOutput';
export type BreakKind = ElementFxBreakKind;
/** The six break kinds, in catalog order. */
export const BREAK_KINDS: readonly BreakKind[] = ELEMENT_FX_BREAK_KINDS;
export const BREAK_KIND_DEFAULT: BreakKind = 'shatter';
/**
 * Where the break begins, as a share of the play: 0 breaks at once, as the built-in does. Mirrored
 * for `assemble`: the pieces fly in over [0, 1 − at] and the graph has the last `at` alone.
 */
export const BREAK_AT_DEFAULT = 0;

/** The nodes that may feed a Break Output's port: the break is set once per play, not per pixel. */
const FEEDERS: ReadonlySet<string> = new Set(['param', 'number', 'color']);

const HEX = /^#[0-9a-f]{6}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** `value` quoted for a message, cut short: a stored doc's values can be any length. */
const quoted = (value: unknown): string => {
	const text = String(value);
	return JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text);
};

export const isBreakKind = (value: unknown): value is BreakKind =>
	typeof value === 'string' && (BREAK_KINDS as readonly string[]).includes(value);

/** The break a Break Output names: its own, else the default; undefined for one that is no break. */
export const breakKindOf = (node: GraphNode | undefined): BreakKind | undefined => {
	const kind = isRecord(node?.values) ? node.values.kind : undefined;
	if (kind === undefined) return BREAK_KIND_DEFAULT;
	return isBreakKind(kind) ? kind : undefined;
};

/** Where a Break Output's break begins: its own `at`, else the default; undefined past 0…1. */
export const breakAtOf = (node: GraphNode | undefined): number | undefined => {
	const at = isRecord(node?.values) ? node.values.at : undefined;
	if (at === undefined) return BREAK_AT_DEFAULT;
	return typeof at === 'number' && at >= 0 && at <= 1 ? at : undefined;
};

/** A break kind's params: a Break Output's ports when it names that kind. */
export const breakKindParams = (kind: BreakKind): readonly ElementFxParamSpec[] =>
	elementFxSpec(kind).params;

const WORD: Record<ElementFxParamSpec['kind'], string> = {
	number: 'number',
	color: 'colour',
	bool: 'switch',
	choice: 'choice',
};

/**
 * A value a Break Output holds for `spec`'s port, as the break reads it: a number in its range, a
 * `#rrggbb` colour (lower case), a switch's 1 / 0, a choice's option or its index. Undefined for any
 * other value (unset included).
 */
export function readBreakValue(
	spec: ElementFxParamSpec,
	value: unknown,
): ElementFxParamValue | undefined {
	switch (spec.kind) {
		case 'number':
			return typeof value === 'number' && value >= spec.min && value <= spec.max
				? value
				: undefined;
		case 'color':
			return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : undefined;
		case 'bool':
			return value === 1 ? true : value === 0 ? false : undefined;
		case 'choice':
			if (typeof value === 'string') return spec.options.includes(value) ? value : undefined;
			return Number.isInteger(value) && (value as number) >= 0
				? spec.options[value as number]
				: undefined;
	}
}

/** A Number node's value on `spec`'s port: a switch on from 0.5, a choice's option by its index. */
const fromNumber = (spec: ElementFxParamSpec, n: number): ElementFxParamValue | undefined => {
	switch (spec.kind) {
		case 'number':
			return n >= spec.min && n <= spec.max ? n : undefined;
		case 'bool':
			return n >= 0.5;
		case 'choice':
			return spec.options[Math.min(spec.options.length - 1, Math.max(0, Math.round(n)))];
		case 'color':
			return undefined;
	}
};

/** What a Number and a Colour node give: their setting, else its default. */
const numberOf = (node: GraphNode): number =>
	typeof node.values?.value === 'number' ? node.values.value : 1;
const colorOf = (node: GraphNode): string =>
	typeof node.values?.value === 'string' && HEX.test(node.values.value)
		? node.values.value.toLowerCase()
		: '#ffffff';

/** What a port reads when nothing is set: the kind's default, as a Param node would read it. */
const portDefault = (spec: ElementFxParamSpec): number | readonly number[] => {
	const value = elementFxParamUniform(spec, spec.default);
	return value.length === 1 ? value[0] : value;
};

/** One def per break kind (and one for a kind that is no break): the same however many ask. */
const DEFS = new Map<BreakKind | undefined, NodeDef>();

/**
 * A Break Output's def: its ports the params of the break it names (none for a kind that is no
 * break), its settings the break and where it begins.
 */
export function breakOutputDef(node?: GraphNode): NodeDef {
	const kind = breakKindOf(node);
	let def = DEFS.get(kind);
	if (!def) {
		def = defOf(kind);
		DEFS.set(kind, def);
	}
	return def;
}

const defOf = (kind: BreakKind | undefined): NodeDef => ({
	type: BREAK_OUTPUT,
	label: 'Break Output',
	category: 'output',
	description:
		'Breaks the element with one of the built-in breaks, cut from the element as the graph draws it. The graph plays alone until Starts at, then the element breaks for the rest of the play (Assemble, mirrored: its pieces fly in, then the graph has the last of the play). Each setting takes a Param (the effect’s own), a Number or a Colour: the break is set once per play. The effect’s phase must be the break’s: exit, or enter for Assemble.',
	inputs: (kind ? breakKindParams(kind) : []).map((spec) => ({
		id: spec.id,
		label: spec.label,
		type: PARAM_TYPE[spec.kind],
		default: portDefault(spec),
	})),
	outputs: [],
	settings: [
		{
			id: 'kind',
			label: 'Break',
			kind: 'choice',
			options: BREAK_KINDS,
			default: BREAK_KIND_DEFAULT,
		},
		{ id: 'at', label: 'Starts at', kind: 'number', default: BREAK_AT_DEFAULT },
	],
	cost: 0,
	emit: () => ({}),
});

/** The graph's Break Outputs (well-formed nodes), in order. */
const breakNodes = (nodes: readonly GraphNode[]): GraphNode[] =>
	nodes.filter(
		(n) => isRecord(n) && n.type === BREAK_OUTPUT && typeof n.id === 'string' && n.id !== '',
	);

/** Each port of `node` and the node its first wire comes from, for the ports that are wired. */
function feedsOf(
	node: GraphNode,
	nodes: readonly GraphNode[],
	wires: readonly GraphWire[],
): Map<string, GraphNode | undefined> {
	const byId = new Map<string, GraphNode>();
	for (const n of nodes) if (isRecord(n) && typeof n.id === 'string') byId.set(n.id, n);
	const feeds = new Map<string, GraphNode | undefined>();
	for (const w of wires) {
		if (!isRecord(w) || !isRecord(w.to) || !isRecord(w.from) || w.to.node !== node.id) continue;
		const port = String(w.to.port);
		if (!feeds.has(port)) feeds.set(port, byId.get(String(w.from.node)));
	}
	return feeds;
}

/**
 * What is wrong with the graph's Break Output: a second one; a kind that is no break; a start past
 * 0…1; an effect whose phase is not the break's; and per port, a wire from anything but a Param, a
 * Number or a Colour, a Param of another kind (a choice: other options), a constant the port cannot
 * take, or a value of its own it cannot read. Each is a `break` error on the node, never thrown.
 * A Param with no param picked is the Param's own error, not one here.
 */
export function breakOutputIssues(
	nodes: readonly GraphNode[],
	wires: readonly GraphWire[],
	params: ReadonlyMap<string, ElementFxParamSpec>,
	phase: unknown,
): GraphIssue[] {
	const breaks = breakNodes(nodes);
	if (!breaks.length) return [];
	const issues: GraphIssue[] = [];
	const error = (message: string, node: string, port?: string): void => {
		issues.push({ level: 'error', code: 'break', message, node, ...(port ? { port } : {}) });
	};
	for (const extra of breaks.slice(1))
		error('an effect has one Break Output, this one has several', extra.id);
	const node = breaks[0];
	const kind = breakKindOf(node);
	if (!kind) {
		error(
			`${quoted(node.values?.kind)} is not a break: one of ${BREAK_KINDS.join(', ')}`,
			node.id,
			'kind',
		);
	}
	if (breakAtOf(node) === undefined)
		error('Starts at is a share of the play: a number 0…1', node.id, 'at');
	if (!kind) return issues;
	const spec = elementFxSpec(kind);
	if (phase !== spec.phase)
		error(
			`${spec.label} is an ${spec.phase} break: set the effect’s phase to ${spec.phase}`,
			node.id,
			'kind',
		);
	const feeds = feedsOf(node, nodes, wires);
	for (const param of spec.params) {
		const word = WORD[param.kind];
		if (feeds.has(param.id)) {
			const source = feeds.get(param.id);
			if (!source) continue;
			if (!FEEDERS.has(source.type)) {
				error(
					`${param.label}: a break setting takes a param or a constant: the break is set once per play, not per pixel`,
					node.id,
					param.id,
				);
			} else if (source.type === 'param') {
				const tied = params.get(String(source.values?.param));
				if (!tied) continue;
				if (tied.kind !== param.kind) {
					error(
						`${param.label} is a ${word}: tie it to a ${word} param, not ${quoted(tied.label)} (a ${WORD[tied.kind]})`,
						node.id,
						param.id,
					);
				} else if (
					tied.kind === 'choice' &&
					param.kind === 'choice' &&
					!(
						Array.isArray(tied.options) &&
						tied.options.length === param.options.length &&
						param.options.every((o) => tied.options.includes(o))
					)
				) {
					error(
						`${param.label} is a choice of ${param.options.join(', ')}: tie it to a choice param with those options`,
						node.id,
						param.id,
					);
				}
			} else if (source.type === 'color') {
				if (param.kind !== 'color')
					error(`${param.label} is a ${word}: wire a Number or a ${word} param`, node.id, param.id);
			} else if (param.kind === 'color') {
				error(`${param.label} is a colour: wire a Colour or a colour param`, node.id, param.id);
			} else if (param.kind === 'number' && fromNumber(param, numberOf(source)) === undefined) {
				error(
					`${param.label} takes ${param.min}…${param.max}, not ${numberOf(source)}`,
					node.id,
					param.id,
				);
			}
			continue;
		}
		const value = isRecord(node.values) ? node.values[param.id] : undefined;
		if (value === undefined || readBreakValue(param, value) !== undefined) continue;
		error(
			param.kind === 'number'
				? `${param.label} takes a number ${param.min}…${param.max}`
				: param.kind === 'color'
					? `${param.label} takes a #rrggbb colour`
					: param.kind === 'bool'
						? `${param.label} takes 1 (on) or 0 (off)`
						: `${param.label} takes one of ${param.options.join(', ')}`,
			node.id,
			param.id,
		);
	}
	return issues;
}

/**
 * The break the graph's Break Output sets, as the effect carries it: its kind, where it begins, and
 * every param of the kind (tied, a constant, the node's own value, else the default). Undefined
 * without one. Read it only from a graph {@link breakOutputIssues} finds nothing wrong with.
 */
export function compileBreak(
	nodes: readonly GraphNode[],
	wires: readonly GraphWire[],
): CustomElementFxBreak | undefined {
	const [node] = breakNodes(nodes);
	const kind = node && breakKindOf(node);
	const at = node && breakAtOf(node);
	if (!node || !kind || at === undefined) return undefined;
	const feeds = feedsOf(node, nodes, wires);
	const params: Record<string, CustomElementFxPassValue> = {};
	for (const param of breakKindParams(kind)) {
		const source = feeds.get(param.id);
		const value =
			source?.type === 'param'
				? { param: String(source.values?.param) }
				: source?.type === 'number'
					? fromNumber(param, numberOf(source))
					: source?.type === 'color'
						? colorOf(source)
						: readBreakValue(param, isRecord(node.values) ? node.values[param.id] : undefined);
		params[param.id] = value ?? param.default;
	}
	return { kind, at, params };
}

// -------------------------------------------------------------------------------------------------
// THE FADE FOR OLDER RUNTIMES. A runtime from before breaks ignores an effect's `break`, so an exit
// effect would stay on screen there. Its compiled motion carries a fade over the break's window
// instead: alpha held at 1 until the break is a share `BREAK_FADE_FROM` through its window, then
// eased (smooth) to 0 at the end, as a break that cannot cut fades on a runtime with breaks
// (`breakFallbackMotion`). A runtime with breaks never shows it: while the break plays it hides the
// element, and the effect's motion is held where the graph meets the break, before the fade begins.
// An `assemble` (an entrance) carries none: there, the element simply shows and the graph plays.
// -------------------------------------------------------------------------------------------------

/** How far through the break's window the older runtimes' fade begins: `breakFallbackMotion`'s. */
export const BREAK_FADE_FROM = 0.15;

/**
 * Where the older runtimes' fade begins in the play, for the graph's Break Output: undefined without
 * one, for an `assemble`, or for one that does not compile.
 */
export function breakFadeStart(nodes: readonly GraphNode[]): number | undefined {
	const [node] = breakNodes(nodes);
	const kind = node && breakKindOf(node);
	const at = node && breakAtOf(node);
	if (!kind || at === undefined || isReversedElementFxBreak(kind)) return undefined;
	return at + BREAK_FADE_FROM * (1 - at);
}

/**
 * An alpha curve with the older runtimes' fade from `start`: the curve as it is up to its first key
 * at or after `start` (none: its last value, held to `start`), that key easing smoothly to 0 at the
 * end. Before that key, it is the curve exactly; the keys after it are dropped (a runtime with
 * breaks never reads past the break's start).
 */
export function breakFadeCurve(curve: ElementFxCurve | undefined, start: number): ElementFxCurve {
	if (!curve?.length)
		return [
			{ t: start, v: 1, ease: 'smooth' },
			{ t: 1, v: 0 },
		];
	const from = curve.findIndex((key) => key.t >= start);
	if (from < 0) {
		const last = curve[curve.length - 1];
		return [...curve, { t: start, v: last.v, ease: 'smooth' }, { t: 1, v: 0 }];
	}
	return [...curve.slice(0, from), { ...curve[from], ease: 'smooth' }, { t: 1, v: 0 }];
}

/**
 * A motion program whose driven alpha takes the older runtimes' fade from `start`: × (1 − smoothstep
 * from `start` to the end of the play), exactly 1 before `start`. A program driving no alpha is
 * returned as it is.
 */
export function breakFadeProgram(
	program: CustomElementFxMotionProgram,
	start: number,
): CustomElementFxMotionProgram {
	const alpha = program.outputs.alpha;
	if (alpha === undefined) return program;
	const ops: MotionOp[] = [...program.ops];
	const push = (op: MotionOp): number => ops.push(op) - 1;
	const read = ops.findIndex((op) => op.length === 1 && op[0] === 'progress');
	const progress = read >= 0 ? read : push(['progress']);
	const gone =
		start < 1
			? push(['smoothstep', push(['const', start]), push(['const', 1]), progress])
			: push(['step', push(['const', 1]), progress]);
	const kept = push(['oneMinus', gone]);
	return { ops, outputs: { ...program.outputs, alpha: push(['multiply', alpha, kept]) } };
}
