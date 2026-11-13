import { TEMPLATE_VOCABULARIES } from 'engine-flow-v2';

/**
 * WHICH FLOW NODES PLAY WHICH SOUND — the one home of that fact. The usage index and the publish
 * gate (`soundUsage.ts`) read the names; what the export ships (`soundReachability.ts`) reads
 * whether any name only exists at run time.
 *
 * A flow keeps nodes in more than one place: the flow's own `graph`, each mode's
 * `modes[id].graph`, a group's `body` (groups nest), and a shared library function's `body`. The
 * walk is structural — any `{ nodes, data }` pair is a graph — so a placement added later is
 * walked without touching this file. The usage index once read `flow.nodes`, which no FlowDoc has,
 * and listed no flow cue at all.
 *
 * A data-in carries a sound when its node's declaration types it as one (a cue's or an action's
 * param, over every template's vocabulary) or when it holds a literal of a sound enum (a function
 * call or a node kind added later that takes a sound).
 */

/** Sound-typed enums a flow literal or a vocabulary param may carry. */
const SOUND_ENUMS: ReadonlySet<string> = new Set(['SoundName', 'SoundEffectName', 'MusicName']);

type FlowRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is FlowRecord =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export interface FlowSoundCue {
	/** The sound the node plays, or `null` when a wire, an accessor or a data edge names it at run
	 *  time — a name no walk of the data can resolve. */
	name: string | null;
	nodeId: string;
	/** The node's vocabulary or function ref (`soundOnce`), or its kind when it has none. */
	ref: string;
	/** The data-in that carries the name. */
	pin: string;
	/** Where the node's graph sits, outermost first (`holdAndWin mode`, `group Coins`,
	 *  `function StaggerStop`). Empty for the flow's own graph. */
	scope: string[];
}

let declaredPins: Map<string, Set<string>> | undefined;

/** Node `ref` → its data-ins a vocabulary types as a sound. Built on first use, so a page that
 *  only imports a neighbour of this module pays nothing for the vocabularies. */
function declaredSoundPins(ref: string): ReadonlySet<string> | undefined {
	if (!declaredPins) {
		declaredPins = new Map();
		for (const vocab of Object.values(TEMPLATE_VOCABULARIES)) {
			const decls = [
				...vocab.cues.map((c) => ({ name: c.name, params: c.payload })),
				...vocab.actions.map((a) => ({ name: a.name, params: a.params })),
			];
			for (const { name, params } of decls) {
				for (const param of params) {
					if (param.type.t !== 'enum' || !SOUND_ENUMS.has(param.type.name)) continue;
					const pins = declaredPins.get(name) ?? new Set<string>();
					pins.add(param.name);
					declaredPins.set(name, pins);
				}
			}
		}
	}
	return declaredPins.get(ref);
}

const isSoundLiteral = (source: unknown): boolean =>
	isRecord(source) &&
	source.kind === 'literal' &&
	isRecord(source.type) &&
	source.type.t === 'enum' &&
	SOUND_ENUMS.has(String(source.type.name));

/**
 * Every node of every graph inside `value`, with the scope its graph sits in. Walks a FlowDoc, a
 * function library, or any value holding either.
 */
function forEachFlowNode(
	value: unknown,
	visit: (node: FlowRecord, graph: FlowRecord, scope: readonly string[]) => void,
): void {
	const walk = (v: unknown, scope: readonly string[]): void => {
		if (Array.isArray(v)) {
			for (const item of v) walk(item, scope);
			return;
		}
		if (!isRecord(v)) return;
		if (Array.isArray(v.nodes)) {
			for (const node of v.nodes) if (isRecord(node)) visit(node, v, scope);
		}
		for (const [key, child] of Object.entries(v)) {
			if (key === 'modes' && isRecord(child)) {
				for (const [mode, section] of Object.entries(child)) {
					walk(section, [...scope, `${mode} mode`]);
				}
			} else if (key === 'functions' && Array.isArray(child)) {
				for (const fn of child) {
					const label = isRecord(fn) ? `function ${String(fn.name ?? fn.id ?? '?')}` : undefined;
					walk(fn, label ? [...scope, label] : scope);
				}
			} else if (key === 'body' && v.kind === 'group') {
				walk(child, [...scope, `group ${String(v.label ?? v.id ?? '?')}`]);
			} else {
				walk(child, scope);
			}
		}
	};
	walk(value, []);
}

/** Every sound-carrying data-in of every node in `value` (a FlowDoc or a function library). */
export function flowSoundCues(value: unknown): FlowSoundCue[] {
	const out: FlowSoundCue[] = [];
	forEachFlowNode(value, (node, graph, scope) => {
		const inputs = isRecord(node.inputs) ? node.inputs : {};
		const ref = typeof node.ref === 'string' ? node.ref : String(node.kind ?? 'node');
		const pins = new Set(typeof node.ref === 'string' ? declaredSoundPins(node.ref) : undefined);
		for (const [pin, source] of Object.entries(inputs)) if (isSoundLiteral(source)) pins.add(pin);
		if (!pins.size) return;

		const nodeId = String(node.id ?? '?');
		const fed = new Set<string>();
		for (const edge of Array.isArray(graph.data) ? graph.data : []) {
			const to = isRecord(edge) && isRecord(edge.to) ? edge.to : undefined;
			if (to && String(to.node) === nodeId) fed.add(String(to.pin));
		}
		for (const pin of pins) {
			const source = inputs[pin];
			if (fed.has(pin) || (isRecord(source) && source.kind !== 'literal')) {
				out.push({ name: null, nodeId, ref, pin, scope: [...scope] });
			} else if (isRecord(source) && typeof source.value === 'string' && source.value) {
				out.push({ name: source.value, nodeId, ref, pin, scope: [...scope] });
			}
		}
	});
	return out;
}

/**
 * The shared library functions `flow` can run: those it calls, and those they call. A library
 * function no flow node reaches plays nothing for this project, so the usage index leaves it out.
 */
function calledLibraryFunctions(flow: unknown, library: unknown): FlowRecord[] {
	const functions = isRecord(library) && Array.isArray(library.functions) ? library.functions : [];
	const byId = new Map<string, FlowRecord>();
	for (const fn of functions) if (isRecord(fn)) byId.set(String(fn.id), fn);
	const reached = new Map<string, FlowRecord>();
	const pending: unknown[] = [flow];
	while (pending.length) {
		forEachFlowNode(pending.pop(), (node) => {
			if (node.kind !== 'functionCall') return;
			const id = String(node.ref);
			const fn = byId.get(id);
			if (!fn || reached.has(id)) return;
			reached.set(id, fn);
			pending.push(fn);
		});
	}
	return [...reached.values()];
}

/** The sound cues a project's flow plays: its own graphs and the library functions it reaches. */
export function projectFlowSoundCues(flow: unknown, library?: unknown): FlowSoundCue[] {
	return [
		...flowSoundCues(flow),
		...flowSoundCues({ functions: calledLibraryFunctions(flow, library) }),
	];
}

/** The row label: the node, then where its graph sits. */
export const flowSoundCueLabel = (cue: FlowSoundCue): string =>
	`${cue.ref} · ${cue.nodeId}${cue.scope.length ? ` (${cue.scope.join(' › ')})` : ''}`;
