import {
	SM_ANY_STATE,
	SM_EXIT_STATE,
	type ComponentDef,
	type ComponentEvent,
	type ComponentInput,
} from './types';

/**
 * The component INTERFACE (Rive plan §6.1): the one typed view of a `ComponentDef` that the state
 * machine reads, the editor shows and Flow wires to. Derived, never stored.
 *
 * Signals fold into trigger inputs (plan §12 #4, owner 2026-10-13): a declared `signals` entry IS
 * a trigger input, and firing a trigger IS firing that signal on the instance's bus, with the same
 * scoping. Nothing is migrated — a def written before inputs existed keeps its `signals`, and this
 * is where every reader turns them into the one concept. Explicit `inputs` come first; a signal
 * whose key an input already uses adds nothing.
 */

/** A def's inputs: its explicit `inputs`, then each declared signal as a trigger, deduped by id. */
export function componentInputs(
	def: Pick<ComponentDef, 'inputs' | 'signals'> | null | undefined,
): ComponentInput[] {
	const out: ComponentInput[] = [];
	const seen = new Set<string>();
	for (const input of def?.inputs ?? []) {
		if (!input?.id || seen.has(input.id)) continue;
		seen.add(input.id);
		out.push(input);
	}
	for (const signal of def?.signals ?? []) {
		if (!signal?.key || seen.has(signal.key)) continue;
		seen.add(signal.key);
		out.push(
			signal.note
				? { id: signal.key, kind: 'trigger', note: signal.note }
				: { id: signal.key, kind: 'trigger' },
		);
	}
	return out;
}

/** The ids of a def's trigger inputs — the signals it declares, in {@link componentInputs} order. */
export function componentTriggers(
	def: Pick<ComponentDef, 'inputs' | 'signals'> | null | undefined,
): string[] {
	return componentInputs(def)
		.filter((input) => input.kind === 'trigger')
		.map((input) => input.id);
}

/** A value the component REPORTS (plan §6.1): today, the current state of each layer. */
export interface ComponentValue {
	/** `<layerId>.state`. */
	id: string;
	kind: 'state';
	layer: string;
	/** The states it can read as, `exit` last. */
	states: string[];
}

export interface ComponentInterface {
	inputs: ComponentInput[];
	/** What the component TELLS Flow (Phase 6), deduped by id. */
	events: ComponentEvent[];
	values: ComponentValue[];
}

/** A def's declared events, the first of each id. */
export function componentEvents(
	def: Pick<ComponentDef, 'events'> | null | undefined,
): ComponentEvent[] {
	const seen = new Set<string>();
	return (def?.events ?? []).filter((event) => {
		if (!event?.id || seen.has(event.id)) return false;
		seen.add(event.id);
		return true;
	});
}

/** The derived interface of a def: its inputs (signals folded in), its events and the values it
 *  reports. */
export function componentInterface(
	def: Pick<ComponentDef, 'inputs' | 'signals' | 'stateMachine' | 'events'> | null | undefined,
): ComponentInterface {
	const values: ComponentValue[] = [];
	for (const layer of def?.stateMachine?.layers ?? []) {
		if (!layer?.id) continue;
		values.push({
			id: `${layer.id}.state`,
			kind: 'state',
			layer: layer.id,
			states: [
				...(layer.states ?? []).map((s) => s.id).filter((id) => id && id !== SM_ANY_STATE),
				SM_EXIT_STATE,
			],
		});
	}
	return { inputs: componentInputs(def), events: componentEvents(def), values };
}
