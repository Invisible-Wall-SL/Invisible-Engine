/**
 * Invisible Flow v2 — placed component INSTANCE nodes (schema §6.3, Rive plan §6.2, Phase 7).
 *
 * A `componentInstance` node names a placed instance (`container` + `instance`); its pins come from
 * that instance's pinned `ComponentDef` interface, projected into `PinContext.instances` by whoever
 * holds the LayoutDoc. This module is the ONE home of the pin-id forms, shared by the deriver
 * (surfacing the pins), the validator (judging the wires) and the runtime (firing them), so the
 * three can never drift. It is type-only over the schema: no engine-layout import (that package
 * depends on this one).
 *
 * Pin ids, all on the instance node:
 *  - `set`                    exec-in: apply the fed data-ins, continue.
 *  - `fire:<trigger>`         exec-in: apply the data-ins, fire the trigger, continue.
 *  - `in:<input>`             data-in per bool / number / text input (optional).
 *  - `exec`                   exec-out: the continuation of every exec-in.
 *  - `event:<event>`          exec-out per declared event — its own entry root.
 *  - `event:<event>:<field>`  data-out per payload field of that event.
 *  - `value:<layer>.state`    data-out per state-machine layer.
 *
 * The event form is deliberately not `containerEventDeclId`'s `<id>.on<Event>`: an event `confirm`
 * and a `pressAction: 'confirm'` press share an instance id, and must never share a pin.
 */

import type {
	FlowDoc,
	FlowInstanceDecl,
	FlowInstanceNode,
	Graph,
	InstanceInputKind,
	InstanceInterface,
	Node,
	Pin,
	TypeRef,
} from './types';

export const INSTANCE_SET_PIN = 'set';
const FIRE = 'fire:';
const IN = 'in:';
const EVENT = 'event:';
const VALUE = 'value:';

export const instanceTriggerPin = (trigger: string): string => `${FIRE}${trigger}`;
export const instanceInputPin = (input: string): string => `${IN}${input}`;
export const instanceEventPin = (event: string): string => `${EVENT}${event}`;
/** A payload data-out: the field is split off with `:`, which no event id carries (an event id
 *  may carry a `.`, and `event:a.b` must never be read as both event `a.b` and field `b` of `a`). A
 *  field name carrying `:` is refused by the def's validation and minted no pin. */
export const instanceEventFieldPin = (event: string, field: string): string =>
	`${EVENT}${event}:${field}`;
export const instanceValuePin = (valueId: string): string => `${VALUE}${valueId}`;

const after = (pin: string, prefix: string): string | undefined =>
	pin.startsWith(prefix) && pin.length > prefix.length ? pin.slice(prefix.length) : undefined;

/** The trigger an exec-in `fire:<trigger>` fires; `undefined` for any other pin. */
export const instanceTriggerOf = (pin: string): string | undefined => after(pin, FIRE);
/** The input a data-in `in:<input>` sets; `undefined` for any other pin. */
export const instanceInputOf = (pin: string): string | undefined => after(pin, IN);
/** The event an exec-out `event:<event>` is; `undefined` for any other pin, a payload data-out
 *  (`event:<event>:<field>`) included. */
export const instanceEventOf = (pin: string): string | undefined => {
	const tail = after(pin, EVENT);
	return tail !== undefined && !tail.includes(':') ? tail : undefined;
};
/** The value a data-out `value:<id>` reads; `undefined` for any other pin. */
export const instanceValueOf = (pin: string): string | undefined => after(pin, VALUE);
/** The event and field of a data-out `event:<event>:<field>` (split at the first `:` after the
 *  prefix, as an event id never carries one); `undefined` for any other pin. */
export const instanceEventFieldOf = (pin: string): { event: string; field: string } | undefined => {
	const tail = after(pin, EVENT);
	const colon = tail?.indexOf(':') ?? -1;
	if (tail === undefined || colon <= 0 || colon === tail.length - 1) return undefined;
	return { event: tail.slice(0, colon), field: tail.slice(colon + 1) };
};

/** May this id be an event's, or a payload field's, in a pin? The `:` is the pin's own separator. */
export const isInstancePinSafeId = (id: string): boolean => id.length > 0 && !id.includes(':');

/** The data type a bool / number / text input's pin carries; a trigger has no data pin. */
export const instanceInputType = (kind: InstanceInputKind): TypeRef | undefined => {
	switch (kind) {
		case 'bool':
			return { t: 'bool' };
		case 'number':
			return { t: 'float' };
		case 'text':
			return { t: 'string' };
		case 'trigger':
			return undefined;
	}
};

/**
 * A localization KEY (plan §8): the stack is source-as-key, so a key is its source text, and the
 * harvest's rule is a string with at least one letter. The twin of engine-layout's
 * `isLocalizationKey` (an event payload `{ key }`); kept apart so that package never imports this
 * barrel at runtime. `check:flow-instance-nodes` holds the two together.
 */
export const isLocalizationKey = (key: unknown): key is string =>
	typeof key === 'string' && /\p{L}/u.test(key);

const EXEC_OUT: Pin = { id: 'exec', dir: 'out', kind: 'exec' };
const SET_IN: Pin = {
	id: INSTANCE_SET_PIN,
	dir: 'in',
	kind: 'exec',
	label: 'Set',
	doc: 'Apply the fed inputs to the instance, then continue.',
};

/**
 * The pins of a `componentInstance` node for `decl` (its projected interface). No decl, or one
 * whose def is missing ⇒ the base `[set, exec]` only, so every wire to an interface pin reads as
 * missing — never guessed.
 */
export const deriveInstancePins = (decl: FlowInstanceDecl | undefined): Pin[] => {
	const pins: Pin[] = [SET_IN];
	if (!decl || decl.missing) return [...pins, EXEC_OUT];
	const { inputs, events, values } = decl.interface;
	for (const input of inputs) {
		if (input.kind === 'trigger') {
			pins.push({
				id: instanceTriggerPin(input.id),
				dir: 'in',
				kind: 'exec',
				label: `▸ ${input.id}`,
				doc: input.note ?? `Fire the trigger "${input.id}" on this instance.`,
			});
		}
	}
	for (const input of inputs) {
		const dataType = instanceInputType(input.kind);
		if (!dataType) continue;
		pins.push({
			id: instanceInputPin(input.id),
			dir: 'in',
			kind: 'data',
			dataType,
			label: input.id,
			doc:
				input.note ??
				(input.kind === 'text'
					? `A localization key for the "${input.id}" text input.`
					: `Set the ${input.kind} input "${input.id}".`),
			optional: true,
		});
	}
	pins.push(EXEC_OUT);
	for (const event of events) {
		if (!isInstancePinSafeId(event.id)) continue;
		pins.push({
			id: instanceEventPin(event.id),
			dir: 'out',
			kind: 'exec',
			label: `on${capitalize(event.id)}`,
			doc: event.note ?? `Fires when the component raises "${event.id}".`,
		});
		for (const field of event.payload ?? []) {
			if (!isInstancePinSafeId(field.name)) continue;
			pins.push({
				id: instanceEventFieldPin(event.id, field.name),
				dir: 'out',
				kind: 'data',
				dataType: field.type,
				label: field.name,
				doc: field.description,
			});
		}
	}
	for (const value of values) {
		pins.push({
			id: instanceValuePin(value.id),
			dir: 'out',
			kind: 'data',
			dataType: { t: 'string' },
			label: value.id,
			doc: `The current state of layer "${value.layer}" (${value.states.join(', ')}).`,
		});
	}
	return pins;
};

const capitalize = (s: string): string =>
	s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The palette REF a `componentInstance` / `waitForState` node is dropped with — one string the
 * editor's node factory parses back into `{ container, instance }`.
 */
export const instanceNodeRef = (container: string, instance: string): string =>
	`${container}/${instance}`;
export const parseInstanceNodeRef = (
	ref: string | undefined,
): { container: string; instance: string } => {
	const slash = ref?.lastIndexOf('/') ?? -1;
	if (!ref || slash <= 0) return { container: '', instance: ref ?? '' };
	return { container: ref.slice(0, slash), instance: ref.slice(slash + 1) };
};

/** Every `componentInstance` node of a graph, group bodies included. */
export const componentInstanceNodes = (graph: Graph): FlowInstanceNode[] => {
	const out: FlowInstanceNode[] = [];
	const scan = (nodes: Node[]): void => {
		for (const node of nodes) {
			if (node.kind === 'componentInstance') out.push(node);
			else if (node.kind === 'group' && node.body) scan(node.body.nodes);
		}
	};
	scan(graph.nodes);
	return out;
};

/** Every `componentInstance` node of a doc, in every section, group bodies included. */
export const docComponentInstanceNodes = (doc: FlowDoc): FlowInstanceNode[] => [
	...componentInstanceNodes(doc.graph),
	...Object.values(doc.modes ?? {}).flatMap((scope) =>
		scope?.graph ? componentInstanceNodes(scope.graph) : [],
	),
];

/** Does any section's graph, group bodies included, carry a node naming a placed instance — a
 *  `componentInstance` or a `waitForState`? The launcher resolves the placed, pinned interfaces
 *  only then (a flow naming none judges none, and makes no read for them). */
export const docNamesInstance = (doc: FlowDoc): boolean => {
	const scan = (nodes: Node[]): boolean =>
		nodes.some(
			(node) =>
				node.kind === 'componentInstance' ||
				node.kind === 'waitForState' ||
				(node.kind === 'group' && !!node.body && scan(node.body.nodes)),
		);
	return (
		scan(doc.graph.nodes) ||
		Object.values(doc.modes ?? {}).some((scope) => !!scope?.graph && scan(scope.graph.nodes))
	);
};

/** A node that feeds a component's inputs, those inputs, and what to call it in the harvest. */
export interface InstanceTextSource {
	node: Node;
	inputs: InstanceInterface['inputs'];
	name: string;
}

/**
 * The localization keys `sources` feed `text` inputs as LITERALS, for Invisible Localization's
 * harvest (plan §8: a Flow wire into a text input is harvested like a `textMessage`, so no text
 * bypasses translation). Source-as-key, exact and untrimmed, each key once; a literal that is not a
 * key (no letter) is skipped, as the validator flags it. A value arriving by WIRE is already a key
 * of its own source (an event payload's `{ key }`, harvested with its def).
 */
export const instanceTextKeys = (
	sources: readonly InstanceTextSource[],
): { key: string; source: string; label: string }[] => {
	const out: { key: string; source: string; label: string }[] = [];
	const seen = new Set<string>();
	for (const { node, inputs, name } of sources) {
		for (const input of inputs) {
			if (input.kind !== 'text') continue;
			const src = node.inputs?.[instanceInputPin(input.id)];
			if (src?.kind !== 'literal' || !isLocalizationKey(src.value) || seen.has(src.value)) continue;
			seen.add(src.value);
			out.push({ key: src.value, source: src.value, label: `${name} — ${input.id}` });
		}
	}
	return out;
};

/** The placed instances' `componentInstance` nodes of a doc, with their projected inputs. */
export const placedInstanceTextSources = (
	doc: FlowDoc | undefined,
	instances: Record<string, FlowInstanceDecl> | undefined,
): InstanceTextSource[] => {
	if (!doc || !instances) return [];
	return docComponentInstanceNodes(doc).flatMap((node) => {
		const decl = instances[node.instance];
		return decl && decl.container === node.container
			? [{ node, inputs: decl.interface.inputs, name: decl.name }]
			: [];
	});
};

/** Every literal key a doc feeds a placed instance's `text` input ({@link instanceTextKeys}). */
export const collectInstanceTextKeys = (
	doc: FlowDoc | undefined,
	instances: Record<string, FlowInstanceDecl> | undefined,
): { key: string; source: string; label: string }[] =>
	instanceTextKeys(placedInstanceTextSources(doc, instances));
