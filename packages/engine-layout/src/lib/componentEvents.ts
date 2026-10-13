import { componentEvents, componentInputs } from './componentInterface';
import { getFlowPress } from './registerFlowPress';
import type { FiredTransition } from './stateMachine';
import {
	EVENT_CUE_PREFIX,
	type CinematicDoc,
	type ComponentDef,
	type ComponentEvent,
	type ComponentInputKind,
	type EventPayloadValue,
	type LayoutNode,
	type ListenerAction,
	type NodeListener,
	type NodeListenerEvent,
	type RaiseEventAction,
} from './types';

/**
 * Component LISTENERS and EVENTS at runtime (Rive plan §5–6.1, Phase 6). Pure and Pixi-free, like
 * the state machine interpreter: `ComponentInstance.svelte` hands a {@link ComponentEventDispatcher}
 * its pointer events, its state machine's entered states and its timelines' cues, and the editor's
 * preview drives the same class.
 *
 * A raised event leaves the instance on the road a button's `action` press takes: the Flow press
 * resolver (`registerFlowPress`), called with the instance's node id and the event id, so Phase 7
 * only has to project the pins. Nobody listening ⇒ the resolver returns nothing ⇒ a no-op.
 */

/** What raised an event: a node listener, a state being entered, or a timeline cue. */
export type ComponentEventOrigin = 'listener' | 'state' | 'cue';

/** A raised event: numbers, bools and localization keys only (plan §8). */
export interface RaisedComponentEvent {
	/** The placed instance's node id — the same tag a press carries. */
	instanceId: string;
	componentId: string;
	event: string;
	payload: Record<string, number | boolean | string>;
	origin: ComponentEventOrigin;
}

const observers = new Set<(raised: RaisedComponentEvent) => void>();

/** Watch every raised event (the editor's events log, the gates). Returns the unsubscribe. */
export function observeComponentEvents(
	observer: (raised: RaisedComponentEvent) => void,
): () => void {
	observers.add(observer);
	return () => observers.delete(observer);
}

/** Send a raised event down the press road. */
export function raiseComponentEvent(raised: RaisedComponentEvent): void {
	for (const observer of [...observers]) observer(raised);
	const payload = Object.keys(raised.payload).length ? raised.payload : undefined;
	getFlowPress()?.(raised.instanceId, raised.event, payload, 'event')?.();
}

/**
 * The shape a payload's localization key must have: no spaces, so a sentence cannot pass as a key
 * (plan §8). The normalizer drops a raise whose key fails it; the runtime never sends one.
 */
export const PAYLOAD_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export const isPayloadKey = (key: unknown): key is string =>
	typeof key === 'string' && PAYLOAD_KEY_PATTERN.test(key);

/** The event id an `event:<id>` cue raises; `undefined` for any other cue. */
export function eventCueId(cue: string): string | undefined {
	if (!cue.startsWith(EVENT_CUE_PREFIX)) return undefined;
	return cue.slice(EVENT_CUE_PREFIX.length) || undefined;
}

/** Does any node of the def's tree carry a listener? */
export function hasNodeListeners(def: Pick<ComponentDef, 'root'> | null | undefined): boolean {
	const walk = (n: LayoutNode): boolean =>
		!!n.on?.length || (n.kind === 'container' && n.children.some(walk));
	return def?.root ? walk(def.root) : false;
}

/**
 * What a dispatcher acts on: the instance's own bus and state machine. `fireTrigger` fires a trigger
 * input as the signal of that name on the instance's bus (plan §12 #4), so the state machine, a
 * `playOn` timeline and a `hiddenUntilSignal` gate all hear it.
 */
export interface ComponentEventHost {
	instanceId: string;
	fireTrigger(id: string): void;
	/** Read and set a bool or number input (the instance's state machine runner). */
	input?(id: string): number | boolean | undefined;
	setInput?(id: string, value: number | boolean): void;
	/** Where a raise goes; absent ⇒ {@link raiseComponentEvent}. */
	raise?(raised: RaisedComponentEvent): void;
}

/** One instance's listeners and raises. Unknown inputs, wrong kinds and undeclared events are
 *  ignored here (validation reports them). */
export class ComponentEventDispatcher {
	private readonly componentId: string;
	private readonly host: ComponentEventHost;
	private readonly kinds = new Map<string, ComponentInputKind>();
	private readonly defaults = new Map<string, number | boolean>();
	private readonly events = new Map<string, ComponentEvent>();
	private readonly onEnter = new Map<string, RaiseEventAction[]>();

	constructor(
		def: Pick<ComponentDef, 'id' | 'inputs' | 'signals' | 'events' | 'stateMachine'>,
		host: ComponentEventHost,
	) {
		this.componentId = def.id;
		this.host = host;
		for (const input of componentInputs(def)) {
			this.kinds.set(input.id, input.kind);
			if (input.kind === 'bool') this.defaults.set(input.id, input.default === true);
			else if (input.kind === 'number')
				this.defaults.set(input.id, typeof input.default === 'number' ? input.default : 0);
		}
		for (const event of componentEvents(def)) this.events.set(event.id, event);
		for (const layer of def.stateMachine?.layers ?? []) {
			for (const state of layer.states ?? []) {
				if (state.onEnter?.length) this.onEnter.set(stateKey(layer.id, state.id), state.onEnter);
			}
		}
	}

	/** A pointer event on a node: every listener of that event runs, in authored order. */
	pointer(listeners: readonly NodeListener[] | undefined, event: NodeListenerEvent): void {
		for (const listener of listeners ?? []) {
			if (listener.event === event) this.run(listener.action, 'listener');
		}
	}

	/** Run one action. */
	run(action: ListenerAction, origin: ComponentEventOrigin): void {
		switch (action.kind) {
			case 'fire':
				if (this.kinds.get(action.input) === 'trigger') this.host.fireTrigger(action.input);
				return;
			case 'set': {
				const kind = this.kinds.get(action.input);
				if (kind === 'bool' && typeof action.value === 'boolean')
					this.host.setInput?.(action.input, action.value);
				else if (kind === 'number' && typeof action.value === 'number')
					this.host.setInput?.(action.input, action.value);
				return;
			}
			case 'toggle':
				if (this.kinds.get(action.input) === 'bool')
					this.host.setInput?.(action.input, this.inputValue(action.input) !== true);
				return;
			case 'raise':
				this.raise(action, origin);
				return;
		}
	}

	/** The machine started: every layer's entry state was entered. */
	started(plays: readonly { layer: string; state: string }[]): void {
		for (const play of plays) this.entered(play.layer, play.state);
	}

	/** The transitions one advance took: each target state was entered, in order. */
	transitions(fired: readonly FiredTransition[]): void {
		for (const t of fired) this.entered(t.layer, t.to);
	}

	/** A cue a component timeline crossed. True when it is an `event:` cue (handled, raised or not). */
	cue(cue: string): boolean {
		const id = eventCueId(cue);
		if (id === undefined) return cue.startsWith(EVENT_CUE_PREFIX);
		this.raise({ kind: 'raise', event: id }, 'cue');
		return true;
	}

	private entered(layer: string, state: string): void {
		for (const action of this.onEnter.get(stateKey(layer, state)) ?? [])
			this.raise(action, 'state');
	}

	private inputValue(id: string): number | boolean | undefined {
		return this.host.input?.(id) ?? this.defaults.get(id);
	}

	private raise(action: RaiseEventAction, origin: ComponentEventOrigin): void {
		const event = this.events.get(action.event);
		if (!event) return;
		// Only the fields the event declares, each with a value its type takes (validation reports
		// the rest): Flow never receives a field it has no pin for.
		const payload: Record<string, number | boolean | string> = {};
		for (const field of event.payload ?? []) {
			const value = action.payload?.[field.name];
			if (value === undefined || !fits(field.type?.t, valueType(value, this.kinds))) continue;
			const resolved = this.payloadValue(value);
			if (resolved !== undefined) payload[field.name] = resolved;
		}
		(this.host.raise ?? raiseComponentEvent)({
			instanceId: this.host.instanceId,
			componentId: this.componentId,
			event: action.event,
			payload,
			origin,
		});
	}

	private payloadValue(value: EventPayloadValue): number | boolean | string | undefined {
		if (typeof value === 'number' || typeof value === 'boolean') return value;
		if ('input' in value) {
			const kind = this.kinds.get(value.input);
			return kind === 'bool' || kind === 'number' ? this.inputValue(value.input) : undefined;
		}
		return isPayloadKey(value.key) ? value.key : undefined;
	}
}

const stateKey = (layer: string, state: string): string => `${layer}\u0000${state}`;

// ---- validation ---------------------------------------------------------------------------------

export type ComponentEventIssueCode =
	| 'event-duplicate'
	| 'event-input-collision'
	| 'event-payload-duplicate'
	| 'event-payload-type'
	| 'listener-duplicate'
	| 'listener-input-unknown'
	| 'listener-input-kind'
	| 'listener-value-kind'
	| 'raise-event-unknown'
	| 'raise-payload-unknown'
	| 'raise-payload-type'
	| 'raise-payload-input'
	| 'raise-payload-key'
	| 'raise-payload-missing';

export interface ComponentEventIssue {
	code: ComponentEventIssueCode;
	/** `error` should be fixed (the runtime ignores the row); `warning` is advisory. */
	level: 'error' | 'warning';
	message: string;
	event?: string;
	input?: string;
	/** The node and listener a listener issue is on. */
	node?: string;
	listener?: string;
	/** The state an `onEnter` raise is on. */
	layer?: string;
	state?: string;
	/** The timeline an `event:` cue is on. */
	timeline?: string;
}

/** The payload field types a value can fill: a number, a bool or a localization key. */
const PAYLOAD_TYPES = new Set(['int', 'float', 'ms', 'bool', 'string']);

const valueType = (
	value: EventPayloadValue,
	kinds: ReadonlyMap<string, ComponentInputKind>,
): 'number' | 'bool' | 'string' | undefined => {
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'bool';
	if ('input' in value) {
		const kind = kinds.get(value.input);
		return kind === 'number' ? 'number' : kind === 'bool' ? 'bool' : undefined;
	}
	return 'string';
};

const fits = (
	type: string | undefined,
	value: 'number' | 'bool' | 'string' | undefined,
): boolean =>
	value === undefined
		? false
		: value === 'number'
			? type === 'int' || type === 'float' || type === 'ms'
			: type === value;

/**
 * Everything the editor shows and the gate asserts about a def's events and listeners: a duplicate
 * event id, a payload field Flow cannot carry, a listener on an unknown input or one of the wrong
 * kind, a raise of an undeclared event or with a payload that does not fit it, and — as warnings —
 * an event sharing an input's id and a raise that leaves a required payload field empty.
 * `timelines` are the def's own (an `event:` cue in one names an event too).
 *
 * An event MAY share an input's id: an input comes in and an event goes out, so Flow keys them
 * apart (Phase 7: an exec-in `▸ win`, an exec-out `onWin`), and a declared signal is already both
 * (a trigger, and a container event the confirm dialog presses). It is flagged so it is deliberate.
 */
export function validateComponentEvents(
	def: Pick<ComponentDef, 'root' | 'inputs' | 'signals' | 'events' | 'stateMachine'>,
	timelines: readonly CinematicDoc[] = [],
): ComponentEventIssue[] {
	const issues: ComponentEventIssue[] = [];
	const kinds = new Map(componentInputs(def).map((input) => [input.id, input.kind]));
	const events = new Map<string, ComponentEvent>();
	for (const event of def.events ?? []) {
		if (events.has(event.id)) {
			issues.push({
				code: 'event-duplicate',
				level: 'error',
				event: event.id,
				message: `Event "${event.id}" is declared twice.`,
			});
			continue;
		}
		events.set(event.id, event);
		if (kinds.has(event.id)) {
			issues.push({
				code: 'event-input-collision',
				level: 'warning',
				event: event.id,
				input: event.id,
				message: `Event "${event.id}" has the same id as an input. Flow keeps them apart (one goes in, one comes out); rename one if that is not intended.`,
			});
		}
		const fields = new Set<string>();
		for (const field of event.payload ?? []) {
			if (fields.has(field.name)) {
				issues.push({
					code: 'event-payload-duplicate',
					level: 'error',
					event: event.id,
					message: `Event "${event.id}": payload field "${field.name}" is declared twice.`,
				});
			}
			fields.add(field.name);
			if (!PAYLOAD_TYPES.has(field.type?.t)) {
				issues.push({
					code: 'event-payload-type',
					level: 'error',
					event: event.id,
					message: `Event "${event.id}": payload field "${field.name}" is a ${String(field.type?.t)}; a payload carries only numbers (int, float, ms), bools and localization keys (string).`,
				});
			}
		}
	}

	const where = (at: Partial<ComponentEventIssue>): string =>
		at.node
			? `Node "${at.node}"`
			: at.timeline
				? `Timeline "${at.timeline}"`
				: `State "${at.state}" (layer "${at.layer}")`;
	const checkRaise = (action: RaiseEventAction, at: Partial<ComponentEventIssue>): void => {
		const event = events.get(action.event);
		if (!event) {
			issues.push({
				...at,
				code: 'raise-event-unknown',
				level: 'error',
				event: action.event,
				message: `${where(at)} raises event "${action.event}", which is not declared.`,
			});
			return;
		}
		const declared = new Map((event.payload ?? []).map((f) => [f.name, f]));
		for (const [name, value] of Object.entries(action.payload ?? {})) {
			const field = declared.get(name);
			if (!field) {
				issues.push({
					...at,
					code: 'raise-payload-unknown',
					level: 'error',
					event: action.event,
					message: `${where(at)} fills payload field "${name}", which event "${action.event}" does not declare.`,
				});
				continue;
			}
			if (typeof value === 'object' && 'input' in value && !valueType(value, kinds)) {
				issues.push({
					...at,
					code: 'raise-payload-input',
					level: 'error',
					event: action.event,
					input: value.input,
					message: `${where(at)} fills "${name}" from input "${value.input}", which is not a bool or number input.`,
				});
				continue;
			}
			if (typeof value === 'object' && 'key' in value && !isPayloadKey(value.key)) {
				issues.push({
					...at,
					code: 'raise-payload-key',
					level: 'error',
					event: action.event,
					message: `${where(at)} fills "${name}" with ${JSON.stringify(value.key)}, which is not a localization key (letters, digits, _ . : - and no spaces).`,
				});
				continue;
			}
			const type = valueType(value, kinds);
			if (type && !fits(field.type?.t, type)) {
				issues.push({
					...at,
					code: 'raise-payload-type',
					level: 'error',
					event: action.event,
					message: `${where(at)} fills "${name}" (${String(field.type?.t)}) with a ${type}.`,
				});
			}
		}
		for (const field of event.payload ?? []) {
			if (field.optional || (action.payload && field.name in action.payload)) continue;
			issues.push({
				...at,
				code: 'raise-payload-missing',
				level: 'warning',
				event: action.event,
				message: `${where(at)} raises "${action.event}" without its payload field "${field.name}"; it arrives empty.`,
			});
		}
	};

	const walk = (n: LayoutNode): void => {
		const ids = new Set<string>();
		const at = { node: n.label || n.id };
		for (const listener of n.on ?? []) {
			if (ids.has(listener.id)) {
				issues.push({
					...at,
					code: 'listener-duplicate',
					level: 'error',
					listener: listener.id,
					message: `Node "${at.node}": listener "${listener.id}" is declared twice.`,
				});
			}
			ids.add(listener.id);
			const action = listener.action;
			const here = { ...at, listener: listener.id };
			if (action.kind === 'raise') {
				checkRaise(action, here);
				continue;
			}
			const kind = kinds.get(action.input);
			if (!kind) {
				issues.push({
					...here,
					code: 'listener-input-unknown',
					level: 'error',
					input: action.input,
					message: `Node "${at.node}": a listener acts on input "${action.input}", which is not declared.`,
				});
				continue;
			}
			const wants =
				action.kind === 'fire'
					? ['trigger']
					: action.kind === 'toggle'
						? ['bool']
						: ['bool', 'number'];
			if (!wants.includes(kind)) {
				issues.push({
					...here,
					code: 'listener-input-kind',
					level: 'error',
					input: action.input,
					message: `Node "${at.node}": a listener cannot ${action.kind} the ${kind} input "${action.input}".`,
				});
				continue;
			}
			if (
				action.kind === 'set' &&
				typeof action.value !== (kind === 'bool' ? 'boolean' : 'number')
			) {
				issues.push({
					...here,
					code: 'listener-value-kind',
					level: 'error',
					input: action.input,
					message: `Node "${at.node}": a listener sets the ${kind} input "${action.input}" to ${JSON.stringify(action.value)}.`,
				});
			}
		}
		if (n.kind === 'container') for (const child of n.children) walk(child);
	};
	if (def.root) walk(def.root);

	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states ?? []) {
			for (const action of state.onEnter ?? [])
				checkRaise(action, { layer: layer.name || layer.id, state: state.name || state.id });
		}
	}
	for (const doc of timelines) {
		for (const track of doc.tracks ?? []) {
			if (track.kind !== 'cue' || !Array.isArray(track.keys)) continue;
			for (const key of track.keys as { cue?: unknown }[]) {
				const id = typeof key?.cue === 'string' ? eventCueId(key.cue) : undefined;
				if (id !== undefined)
					checkRaise({ kind: 'raise', event: id }, { timeline: doc.name || doc.id });
			}
		}
	}
	return issues;
}
