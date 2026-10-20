import {
	SM_ANY_STATE,
	SM_EXIT_STATE,
	componentInputs,
	type ComponentDef,
	type ComponentInput,
	type ComponentInputKind,
	type ComponentStateMachine,
	type SmCondition,
	type SmLayer,
	type SmPoint,
	type SmState,
	type SmTransition,
} from 'engine-layout';

import { renameInputReads } from './listenerEdit';

/**
 * The State Machine panel's EDITS (Rive plan Phase 5b), as pure functions over the draft
 * `ComponentDef` so the gate can prove them: ids, layers, states, transitions, the inputs list
 * (where a declared `signals` entry still reads as a trigger — plan §12 #4) and the graph the
 * panel draws. Every function mutates the def it is given (the editor's draft) and returns what
 * the panel needs to say about it.
 */

/** The ids of the Entry, Any and Exit nodes in the graph. */
export const ENTRY_NODE = '__entry';
export const ANY_NODE = SM_ANY_STATE;
export const EXIT_NODE = SM_EXIT_STATE;
/** The synthetic edge from Entry to the layer's entry state. */
export const ENTRY_EDGE = '__entry_edge';

const slug = (name: string): string =>
	name
		.trim()
		.replace(/[^a-zA-Z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/^(\d)/, '_$1') || 'item';

/** An id made from `name` that none of `taken` uses (`_2`, `_3`… appended). */
export function uniqueId(name: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const base = slug(name);
	if (!used.has(base) && base !== SM_ANY_STATE && base !== SM_EXIT_STATE) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}_${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

/** The def's state machine, created empty on first use. */
export function ensureStateMachine(def: ComponentDef): ComponentStateMachine {
	if (!def.stateMachine) def.stateMachine = { layers: [] };
	return def.stateMachine;
}

/**
 * Every layer, state and transition id a def's machine uses — what a new item must avoid. A new
 * item never takes the id of one deleted since the last save (`reserved`: the saved def's ids),
 * because the save grafts unknown fields by id and the newcomer would inherit the old item's.
 */
export function stateMachineIds(
	def: Pick<ComponentDef, 'stateMachine'> | null | undefined,
): Set<string> {
	const out = new Set<string>();
	for (const layer of def?.stateMachine?.layers ?? []) {
		out.add(layer.id);
		for (const st of layer.states) out.add(st.id);
		for (const t of layer.transitions) out.add(t.id);
	}
	return out;
}

/** Add a layer named `name` (default "Layer N"); its entry is set by the first state added. */
export function addLayer(
	def: ComponentDef,
	name?: string,
	reserved: Iterable<string> = [],
): SmLayer {
	const machine = ensureStateMachine(def);
	const label = name?.trim() || `Layer ${machine.layers.length + 1}`;
	const layer: SmLayer = {
		id: uniqueId(label, [...machine.layers.map((l) => l.id), ...reserved]),
		name: label,
		entry: '',
		states: [],
		transitions: [],
	};
	machine.layers.push(layer);
	return layer;
}

/** Remove a layer; an empty machine is dropped from the def altogether. */
export function removeLayer(def: ComponentDef, layerId: string): void {
	const machine = def.stateMachine;
	if (!machine) return;
	machine.layers = machine.layers.filter((l) => l.id !== layerId);
	if (!machine.layers.length) delete def.stateMachine;
}

/**
 * Copy a layer next to it (Phase 9c): the same states, transitions and positions under a new layer
 * id and the name "<name> copy". State and transition ids are per layer, so they are kept, and the
 * copy's conditions, entry and actions read exactly as the original's.
 */
export function duplicateLayer(
	def: ComponentDef,
	layerId: string,
	reserved: Iterable<string> = [],
): SmLayer | undefined {
	const machine = def.stateMachine;
	const at = machine?.layers.findIndex((l) => l.id === layerId) ?? -1;
	if (!machine || at < 0) return undefined;
	// JSON, not structuredClone: the draft is a Svelte state proxy, which cannot be cloned.
	const copy = JSON.parse(JSON.stringify(machine.layers[at])) as SmLayer;
	copy.name = `${machine.layers[at].name || machine.layers[at].id} copy`;
	copy.id = uniqueId(copy.name, [...machine.layers.map((l) => l.id), ...reserved]);
	machine.layers.splice(at + 1, 0, copy);
	return copy;
}

/** Move a layer one place earlier (`-1`) or later (`1`). Layers run in order and a later one wins
 *  a node property both key, so order is meaningful. False when it cannot move. */
export function moveLayer(def: ComponentDef, layerId: string, delta: -1 | 1): boolean {
	const layers = def.stateMachine?.layers;
	const at = layers?.findIndex((l) => l.id === layerId) ?? -1;
	if (!layers || at < 0 || at + delta < 0 || at + delta >= layers.length) return false;
	const [layer] = layers.splice(at, 1);
	layers.splice(at + delta, 0, layer);
	return true;
}

/** Switch a layer off (it sits in `exit` and drives nothing) or back on. */
export function setLayerDisabled(layer: SmLayer, disabled: boolean): void {
	if (disabled) layer.disabled = true;
	else delete layer.disabled;
}

/** The default card position for the n-th state of a layer. */
export function defaultStatePos(index: number): SmPoint {
	return { x: 260 + (index % 4) * 220, y: 40 + Math.floor(index / 4) * 120 };
}

/**
 * Add a state playing `timeline` (named after it unless `name` is given). The first state of a
 * layer becomes its entry.
 */
export function addState(
	layer: SmLayer,
	timeline: { id: string; name: string },
	opts: { name?: string; pos?: SmPoint; reserved?: Iterable<string> } = {},
): SmState {
	const name = opts.name?.trim() || timeline.name || timeline.id;
	const state: SmState = {
		id: uniqueId(name, [...layer.states.map((s) => s.id), ...(opts.reserved ?? [])]),
		timeline: timeline.id,
		pos: opts.pos ?? defaultStatePos(layer.states.length),
	};
	if (name !== timeline.name) state.name = name;
	layer.states.push(state);
	if (!layer.entry) layer.entry = state.id;
	return state;
}

/** Remove a state and every transition touching it; a removed entry falls to the first state. */
export function removeState(layer: SmLayer, stateId: string): void {
	layer.states = layer.states.filter((s) => s.id !== stateId);
	layer.transitions = layer.transitions.filter((t) => t.from !== stateId && t.to !== stateId);
	if (layer.entry === stateId) layer.entry = layer.states[0]?.id ?? '';
}

/** Add a transition `from` → `to` (state ids, `any`, `exit`); none from Exit or into Any. */
export function addTransition(
	layer: SmLayer,
	from: string,
	to: string,
	reserved: Iterable<string> = [],
): SmTransition | undefined {
	if (from === SM_EXIT_STATE || to === SM_ANY_STATE) return undefined;
	const known = (id: string): boolean =>
		id === SM_ANY_STATE || id === SM_EXIT_STATE || layer.states.some((s) => s.id === id);
	if (!known(from) || !known(to)) return undefined;
	const transition: SmTransition = {
		id: uniqueId(`t_${from}_${to}`, [...layer.transitions.map((t) => t.id), ...reserved]),
		from,
		to,
	};
	layer.transitions.push(transition);
	return transition;
}

/**
 * Set a transition's blend in ms (0 or less clears it). Its interpolation, *Pause source* and
 * *Allow exit* mean nothing without a blend, so clearing the blend clears them too (the save would
 * drop them anyway).
 */
export function setBlend(transition: SmTransition, ms: number): void {
	if (Number.isFinite(ms) && ms > 0) {
		transition.blend = ms;
		return;
	}
	delete transition.blend;
	delete transition.ease;
	delete transition.pauseSource;
	delete transition.allowExit;
}

/** The blend's interpolation: a cubic, or `null` for linear (the default, so nothing is stored). */
export function setBlendEase(
	transition: SmTransition,
	ease: [number, number, number, number] | null,
): void {
	if (ease) transition.ease = [ease[0], ease[1], ease[2], ease[3]];
	else delete transition.ease;
}

/** *Pause source when exiting* (on by default) and *Allow exit during transition* (on by default):
 *  only the non-default `false` is stored. */
export function setBlendFlag(
	transition: SmTransition,
	flag: 'pauseSource' | 'allowExit',
	on: boolean,
): void {
	if (on) delete transition[flag];
	else transition[flag] = false;
}

/** Switch a transition off (it never fires; the graph keeps it, greyed) or back on. */
export function setTransitionDisabled(transition: SmTransition, disabled: boolean): void {
	if (disabled) transition.disabled = true;
	else delete transition.disabled;
}

export function removeTransition(layer: SmLayer, transitionId: string): void {
	layer.transitions = layer.transitions.filter((t) => t.id !== transitionId);
}

/** A condition on `input` with the first op its kind takes. */
export function newCondition(input: ComponentInput): SmCondition {
	return input.kind === 'trigger'
		? { input: input.id, op: 'fired' }
		: input.kind === 'bool'
			? { input: input.id, op: '==', value: true }
			: { input: input.id, op: '>', value: 0 };
}

/** Add a condition on `input` to a transition. */
export function addCondition(transition: SmTransition, input: ComponentInput): SmCondition {
	const condition = newCondition(input);
	transition.conditions = [...(transition.conditions ?? []), condition];
	return condition;
}

export function removeCondition(transition: SmTransition, index: number): void {
	const next = (transition.conditions ?? []).filter((_, i) => i !== index);
	if (next.length) transition.conditions = next;
	else delete transition.conditions;
}

// ---- inputs -------------------------------------------------------------------------------------

/** Add an input; a trigger that `signals` already declares adds nothing. */
export function addInput(
	def: ComponentDef,
	id: string,
	kind: ComponentInputKind,
): ComponentInput | undefined {
	const clean = id.trim();
	if (!clean || componentInputs(def).some((i) => i.id === clean)) return undefined;
	const input: ComponentInput = { id: clean, kind };
	if (kind === 'bool') input.default = false;
	if (kind === 'number') input.default = 0;
	def.inputs = [...(def.inputs ?? []), input];
	return input;
}

/** Every transition whose conditions read `inputId`, as `<layer id>/<transition id>`. */
export function inputUsage(def: ComponentDef, inputId: string): string[] {
	const out: string[] = [];
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const t of layer.transitions) {
			if ((t.conditions ?? []).some((c) => c.input === inputId)) out.push(`${layer.id}/${t.id}`);
		}
	}
	return out;
}

/**
 * Remove an input: from `inputs` and from `signals` (a declared signal IS a trigger input). The
 * conditions that read it are LEFT IN PLACE — they fail closed in game (`holds()` is false) and
 * validation flags them `condition-input-unknown`, so the author sees ⚠ and fixes them; dropping
 * them would widen a guarded transition into one that always fires. Returns those transitions.
 */
export function removeInput(def: ComponentDef, inputId: string): string[] {
	const used = inputUsage(def, inputId);
	if (def.inputs) {
		def.inputs = def.inputs.filter((i) => i.id !== inputId);
		if (!def.inputs.length) delete def.inputs;
	}
	if (def.signals) {
		def.signals = def.signals.filter((s) => s.key !== inputId);
		if (!def.signals.length) delete def.signals;
	}
	return used;
}

/**
 * Rename an input everywhere it is read: `inputs`, `signals`, every condition, and every listener
 * and raise payload that names it (Phase 6). Refused (false) when the new id is empty or already
 * taken.
 */
export function renameInput(def: ComponentDef, from: string, to: string): boolean {
	const next = to.trim();
	if (!next || next === from) return false;
	if (componentInputs(def).some((i) => i.id === next)) return false;
	for (const input of def.inputs ?? []) if (input.id === from) input.id = next;
	for (const signal of def.signals ?? []) if (signal.key === from) signal.key = next;
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const t of layer.transitions) {
			for (const c of t.conditions ?? []) if (c.input === from) c.input = next;
		}
	}
	renameInputReads(def, from, next);
	return true;
}

/** Set a bool/number input's default (a trigger has none). */
export function setInputDefault(def: ComponentDef, id: string, value: boolean | number): void {
	const input = (def.inputs ?? []).find((i) => i.id === id);
	if (!input || input.kind === 'trigger') return;
	input.default = input.kind === 'bool' ? value === true : Number(value) || 0;
}

/** Name (or with '', clear) the engine value source a number input follows. */
export function setInputSource(def: ComponentDef, id: string, source: string): void {
	const input = (def.inputs ?? []).find((i) => i.id === id);
	if (!input || input.kind !== 'number') return;
	if (source.trim()) input.source = source.trim();
	else delete input.source;
}

// ---- the graph ----------------------------------------------------------------------------------

export interface GraphNode {
	id: string;
	kind: 'entry' | 'any' | 'exit' | 'state';
	label: string;
	pos: SmPoint;
	state?: SmState;
}

export interface GraphEdge {
	id: string;
	from: string;
	to: string;
	label: string;
	transition?: SmTransition;
}

const conditionLabel = (c: SmCondition): string =>
	c.op === 'fired'
		? `${c.input} ▸`
		: `${c.input} ${c.op} ${c.param ? `{${c.param}}` : String(c.value ?? '')}`;

/** What a transition's arrow says: its conditions, else its exit time, else "always" — after
 *  "off ·" when it is disabled. */
export function transitionLabel(t: SmTransition): string {
	const parts = (t.conditions ?? []).map(conditionLabel);
	if (t.exitTime !== undefined) parts.push(`@ ${Math.round(t.exitTime * 100)}%`);
	const label = parts.length ? parts.join(' · ') : 'always';
	return t.disabled ? `off · ${label}` : label;
}

// ---- problems -----------------------------------------------------------------------------------

/** Where a Problems row jumps to: a layer, and in it a state or a transition, or an input. */
export interface ProblemTarget {
	layer?: string;
	state?: string;
	transition?: string;
	input?: string;
}

/**
 * The ids a problem names, for the Console's click-to-jump. A state-machine issue already carries
 * ids; an event issue names its layer and state by their DISPLAY names (`name || id`), which are
 * mapped back here (first match). A listener or cue issue lives outside the machine: it jumps to
 * nothing here (its node or timeline says where), unless it names an input.
 */
export function problemTarget(
	def: Pick<ComponentDef, 'stateMachine'>,
	issue: { layer?: string; state?: string; transition?: string; input?: string; node?: string },
): ProblemTarget {
	const layers = def.stateMachine?.layers ?? [];
	const out: ProblemTarget = {};
	if (issue.input) out.input = issue.input;
	if (!issue.layer || issue.node) return out;
	const layer =
		layers.find((l) => l.id === issue.layer) ??
		layers.find((l) => (l.name || l.id) === issue.layer);
	if (!layer) return out;
	out.layer = layer.id;
	if (issue.transition && layer.transitions.some((t) => t.id === issue.transition))
		out.transition = issue.transition;
	else if (issue.state) {
		const state =
			layer.states.find((s) => s.id === issue.state) ??
			layer.states.find((s) => (s.name || s.id) === issue.state);
		if (state) out.state = state.id;
	}
	return out;
}

/** A state card's title: its name, else its timeline's name, else the timeline id. */
export function stateLabel(state: SmState, timelineNames: ReadonlyMap<string, string>): string {
	return state.name || timelineNames.get(state.timeline) || state.timeline || state.id;
}

/** The nodes and edges of one layer, the Entry → entry-state edge included. */
export function layerGraph(
	layer: SmLayer,
	timelineNames: ReadonlyMap<string, string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const pseudo = layer.pseudoPos ?? {};
	const nodes: GraphNode[] = [
		{ id: ENTRY_NODE, kind: 'entry', label: 'Entry', pos: pseudo.entry ?? { x: 40, y: 40 } },
		{ id: ANY_NODE, kind: 'any', label: 'Any', pos: pseudo.any ?? { x: 40, y: 160 } },
		{ id: EXIT_NODE, kind: 'exit', label: 'Exit', pos: pseudo.exit ?? { x: 40, y: 280 } },
		...layer.states.map((state, i) => ({
			id: state.id,
			kind: 'state' as const,
			label: stateLabel(state, timelineNames),
			pos: state.pos ?? defaultStatePos(i),
			state,
		})),
	];
	const edges: GraphEdge[] = [];
	if (layer.entry && layer.states.some((s) => s.id === layer.entry)) {
		edges.push({ id: ENTRY_EDGE, from: ENTRY_NODE, to: layer.entry, label: '' });
	}
	for (const t of layer.transitions) {
		edges.push({ id: t.id, from: t.from, to: t.to, label: transitionLabel(t), transition: t });
	}
	return { nodes, edges };
}

/** Record where a node was dragged to. */
export function setNodePos(layer: SmLayer, nodeId: string, pos: SmPoint): void {
	const rounded = { x: Math.round(pos.x), y: Math.round(pos.y) };
	if (nodeId === ENTRY_NODE || nodeId === ANY_NODE || nodeId === EXIT_NODE) {
		const key = nodeId === ENTRY_NODE ? 'entry' : nodeId === ANY_NODE ? 'any' : 'exit';
		layer.pseudoPos = { ...(layer.pseudoPos ?? {}), [key]: rounded };
		return;
	}
	const state = layer.states.find((s) => s.id === nodeId);
	if (state) state.pos = rounded;
}

/** A wire drawn from `source` to `target` on the graph: Entry sets the layer's entry, anything
 *  else adds a transition. Returns the transition added, if one was. */
export function connect(
	layer: SmLayer,
	source: string,
	target: string,
	reserved: Iterable<string> = [],
): SmTransition | undefined {
	if (source === ENTRY_NODE) {
		if (layer.states.some((s) => s.id === target)) layer.entry = target;
		return undefined;
	}
	return addTransition(layer, source, target, reserved);
}
