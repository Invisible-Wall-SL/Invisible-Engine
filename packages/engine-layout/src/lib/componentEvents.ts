import { componentEvents, componentInputs } from './componentInterface';
import { swipeMatches, type PointerAt, type PointerPoint } from './componentPointer';
import { getFlowPress } from './registerFlowPress';
import type { FiredTransition } from './stateMachine';
import {
	EVENT_CUE_PREFIX,
	EVENT_PAYLOAD_TYPES,
	POINTER_PAYLOAD_FIELDS,
	SWIPE_DIRECTIONS,
	type AlignTargetAction,
	type CinematicDoc,
	type ComponentDef,
	type ComponentEvent,
	type ComponentInputKind,
	type EventPayloadValue,
	type LayoutNode,
	type ListenerAction,
	type NodeListenerEvent,
	type PointerPayloadField,
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

/** Send a raised event down the press road, as `kind: 'event'`: the resolver matches it against
 *  event pins only (Phase 7 adds them), never a press or `action` pin of the same name. */
export function raiseComponentEvent(raised: RaisedComponentEvent): void {
	for (const observer of [...observers]) observer(raised);
	const payload = Object.keys(raised.payload).length ? raised.payload : undefined;
	getFlowPress()?.(raised.instanceId, raised.event, payload, 'event')?.();
}

/**
 * A payload's localization key: the stack is source-as-key, so a key is its source text, and the
 * harvest's rule applies — a string with at least one letter (`localizationHarvest.ts`). The
 * harvest collects every `{ key }` a def raises, so none bypasses localization (plan §8). Its twin
 * in `engine-flow-v2` (`instanceNodes.ts`, for a `text` input's literal) is the same regex; it is
 * not imported from there so this package's runtime graph stays free of that barrel.
 * `check:flow-instance-nodes` holds the two together.
 */
export const isLocalizationKey = (key: unknown): key is string =>
	typeof key === 'string' && /\p{L}/u.test(key);

/** The event id an `event:<id>` cue raises; `undefined` for any other cue. */
export function eventCueId(cue: string): string | undefined {
	if (!cue.startsWith(EVENT_CUE_PREFIX)) return undefined;
	return cue.slice(EVENT_CUE_PREFIX.length) || undefined;
}

/**
 * Where a cue a COMPONENT timeline crosses goes. `event:` raises one of the def's events — only on
 * a def that declares some; on any other it keeps its old meaning (broadcast by its bare name), so
 * nothing that played before changes. `signal:` fires on the instance's own bus. `sfx:` / `music:`
 * are dropped (this package has no sound player). Anything else is broadcast by its bare name.
 */
export type ComponentCueRoute =
	| { kind: 'event'; cue: string }
	| { kind: 'signal'; name: string }
	| { kind: 'broadcast'; name: string }
	| { kind: 'drop' };

export function routeComponentCue(cue: string, declaresEvents: boolean): ComponentCueRoute {
	const sep = cue.indexOf(':');
	const ns = sep > 0 ? cue.slice(0, sep) : '';
	const name = sep > 0 ? cue.slice(sep + 1) : cue;
	if (ns === 'event' && declaresEvents) return { kind: 'event', cue };
	if (!name || ns === 'sfx' || ns === 'music') return { kind: 'drop' };
	return ns === 'signal' ? { kind: 'signal', name } : { kind: 'broadcast', name };
}

/**
 * The signal a SCREEN timeline's cue also fires on the component-signal bus, where every _On cue_
 * Element FX listens: routed as a component timeline's cue is ({@link routeComponentCue}), so
 * `signal:NAME` fires `NAME` and any other cue fires none (it keeps its game-bus broadcast).
 */
export function screenCueSignal(cue: string): string | undefined {
	const route = routeComponentCue(cue, false);
	return route.kind === 'signal' ? route.name : undefined;
}

/** Every localization key a def's raises carry — its listeners' and its states' `onEnter` and
 *  `onExit` — with
 *  the event that carries it, for the harvest, in tree then layer order, each key once. */
export function raisedPayloadKeys(
	def: Pick<ComponentDef, 'root' | 'stateMachine'> | null | undefined,
): { key: string; event: string }[] {
	const keys = new Map<string, string>();
	const collect = (action: ListenerAction): void => {
		if (action.kind !== 'raise') return;
		for (const value of Object.values(action.payload ?? {})) {
			if (typeof value !== 'object' || !('key' in value) || !isLocalizationKey(value.key)) continue;
			if (!keys.has(value.key)) keys.set(value.key, action.event);
		}
	};
	const walk = (n: LayoutNode): void => {
		for (const listener of n.on ?? []) collect(listener.action);
		if (n.kind === 'container') n.children.forEach(walk);
	};
	if (def?.root) walk(def.root);
	for (const layer of def?.stateMachine?.layers ?? []) {
		for (const state of layer.states ?? []) {
			state.onEnter?.forEach(collect);
			state.onExit?.forEach(collect);
		}
	}
	return [...keys].map(([key, event]) => ({ key, event }));
}

/** Does any node of the def's tree carry a listener? */
export function hasNodeListeners(def: Pick<ComponentDef, 'root'> | null | undefined): boolean {
	const walk = (n: LayoutNode): boolean =>
		!!n.on?.length || (n.kind === 'container' && n.children.some(walk));
	return def?.root ? walk(def.root) : false;
}

/** The nodes an Align Target listener of the def moves, each once. */
export function alignTargetIds(def: Pick<ComponentDef, 'root'> | null | undefined): string[] {
	const out = new Set<string>();
	const walk = (n: LayoutNode): void => {
		for (const listener of n.on ?? [])
			if (listener.action.kind === 'align') out.add(listener.action.target);
		if (n.kind === 'container') n.children.forEach(walk);
	};
	if (def?.root) walk(def.root);
	return [...out];
}

/**
 * What a dispatcher acts on: the instance's own bus and state machine. `fireTrigger` fires a trigger
 * input as the signal of that name on the instance's bus (plan §12 #4), so the state machine, a
 * `playOn` timeline, a rig cue and a `hiddenUntilSignal` gate all hear it.
 */
export interface ComponentEventHost {
	instanceId: string;
	fireTrigger(id: string): void;
	/** Read and set a bool or number input (the instance's state machine runner). */
	input?(id: string): number | boolean | undefined;
	setInput?(id: string, value: number | boolean): void;
	/** Where a raise goes; absent ⇒ {@link raiseComponentEvent}. */
	raise?(raised: RaisedComponentEvent): void;
	/** Node `id` of the def as an Align Target moves it; absent (or `undefined`) ⇒ the action does
	 *  nothing. */
	alignTarget?(id: string): AlignSpace | undefined;
	/**
	 * Run `drain` once the current work is done (the game: `queueMicrotask`). A state's `onEnter` and
	 * a cue are raised from inside a tick — or the mount, when the machine starts on it — and a Flow
	 * chain must not show or hide screens from there. Absent ⇒ drained at once.
	 */
	schedule?(drain: () => void): void;
}

/** What an Align Target needs of its target node: the stage→parent mapping, where it is now, and
 *  how to place it (an axis left out stays where it is). */
export interface AlignSpace {
	toLocal(global: PointerPoint): PointerPoint;
	position(): PointerPoint;
	place(at: Partial<PointerPoint>): void;
}

/**
 * One instance's listeners and raises. Every raise goes through ONE queue, drained in order: what a
 * tick raised (its cues, then the states it entered) leaves before a later pointer event's raise,
 * and nothing leaves once the instance is {@link destroy}ed. Unknown inputs, wrong kinds and
 * undeclared events are ignored here (validation reports them).
 */
export class ComponentEventDispatcher {
	private readonly componentId: string;
	private readonly host: ComponentEventHost;
	private readonly kinds = new Map<string, ComponentInputKind>();
	private readonly defaults = new Map<string, number | boolean>();
	private readonly events = new Map<string, ComponentEvent>();
	private readonly onEnter = new Map<string, RaiseEventAction[]>();
	private readonly onExit = new Map<string, RaiseEventAction[]>();
	private readonly owned = new Set<string>();
	private queue: RaisedComponentEvent[] = [];
	/** The pointer of the listener running now, read by a raise's `{ pointer }` values. */
	private at: PointerAt | undefined;
	/** Each Align Target's offset from the pointer, and the press it was taken in: it is taken
	 *  again the first time the action runs in another press. */
	private readonly alignOffsets = new WeakMap<
		AlignTargetAction,
		{ press: number; offset: PointerPoint }
	>();
	private scheduled = false;
	private destroyed = false;

	constructor(
		def: Pick<ComponentDef, 'id' | 'root' | 'inputs' | 'signals' | 'events' | 'stateMachine'>,
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
				if (state.onExit?.length) this.onExit.set(stateKey(layer.id, state.id), state.onExit);
			}
		}
		const walk = (n: LayoutNode): void => {
			this.owned.add(n.id);
			if (n.kind === 'container') for (const child of n.children) walk(child);
		};
		if (def.root) walk(def.root);
	}

	/** Is `nodeId` a node of this def? A layout tree a coded part renders inside the instance is not
	 *  its to answer. */
	owns(nodeId: string): boolean {
		return this.owned.has(nodeId);
	}

	/**
	 * A pointer event on one of the def's nodes: every listener of that event runs, in authored
	 * order, after anything already queued. `at` is where the pointer is (`componentPointer.ts`); a
	 * `swipe` listener runs only when the release answers its filter.
	 */
	pointer(node: Pick<LayoutNode, 'id' | 'on'>, event: NodeListenerEvent, at?: PointerAt): void {
		if (this.destroyed || !this.owns(node.id)) return;
		this.at = at;
		try {
			for (const listener of node.on ?? []) {
				if (listener.event !== event) continue;
				if (event === 'swipe' && !(at && swipeMatches(listener.swipe, at))) continue;
				if (listener.action.kind === 'align') this.align(listener.action);
				else this.run(listener.action, 'listener');
			}
		} finally {
			this.at = undefined;
		}
		this.drain();
	}

	/** Run one action. A raise is queued; call {@link drain} (or let a pointer event) to send it. An
	 *  Align Target runs only from a pointer event. */
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
			case 'align':
				return;
		}
	}

	/** Place an Align Target's node on the pointer; its offset is taken the first time it runs in a
	 *  press (`PointerAt.press`), so every press keeps its own. */
	private align(action: AlignTargetAction): void {
		const at = this.at;
		const space = at ? this.host.alignTarget?.(action.target) : undefined;
		if (!at || !space) return;
		const p = space.toLocal(at.global);
		let offset = this.alignOffsets.get(action);
		if (!offset || offset.press !== at.press) {
			const now = space.position();
			offset = {
				press: at.press,
				offset: action.preserveOffset ? { x: now.x - p.x, y: now.y - p.y } : { x: 0, y: 0 },
			};
			this.alignOffsets.set(action, offset);
		}
		const x = p.x + offset.offset.x;
		const y = p.y + offset.offset.y;
		space.place(action.axis === 'x' ? { x } : action.axis === 'y' ? { y } : { x, y });
	}

	/** The machine started: every layer's entry state was entered. */
	started(plays: readonly { layer: string; state: string }[]): void {
		for (const play of plays) this.entered(play.layer, play.state);
		this.later();
	}

	/** The transitions one advance took, in order: each left its state, then entered the target. */
	transitions(fired: readonly FiredTransition[]): void {
		for (const t of fired) {
			for (const action of this.onExit.get(stateKey(t.layer, t.from)) ?? [])
				this.raise(action, 'state');
			this.entered(t.layer, t.to);
		}
		this.later();
	}

	/** An `event:` cue a component timeline crossed (see {@link routeComponentCue}). */
	cue(cue: string): void {
		const id = eventCueId(cue);
		if (id !== undefined) this.raise({ kind: 'raise', event: id }, 'cue');
		this.later();
	}

	/** Send everything queued, in order, one at a time: a raise a handler causes joins the end of the
	 *  queue (never ahead of what was already waiting), and a destroy mid-drain stops the rest. */
	drain(): void {
		while (this.queue.length && !this.destroyed) {
			(this.host.raise ?? raiseComponentEvent)(this.queue.shift()!);
		}
	}

	/** The instance is gone: nothing queued or later raised leaves. */
	destroy(): void {
		this.destroyed = true;
		this.queue = [];
	}

	private later(): void {
		if (!this.queue.length || this.scheduled) return;
		if (!this.host.schedule) {
			this.drain();
			return;
		}
		this.scheduled = true;
		this.host.schedule(() => {
			this.scheduled = false;
			this.drain();
		});
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
		if (!event || this.destroyed) return;
		// Only the fields the event declares, each with a value its type takes (validation reports
		// the rest): Flow never receives a field it has no pin for.
		const payload: Record<string, number | boolean | string> = {};
		for (const field of event.payload ?? []) {
			const value = action.payload?.[field.name];
			if (value === undefined || !fits(field.type?.t, valueType(value, this.kinds))) continue;
			let resolved = this.payloadValue(value);
			// A pointer reading is fractional pixels: a whole-number field takes it rounded.
			if (typeof value === 'object' && 'pointer' in value && typeof resolved === 'number')
				resolved = field.type?.t === 'float' ? resolved : Math.round(resolved);
			if (resolved === undefined || !integral(field.type?.t, resolved)) continue;
			payload[field.name] = resolved;
		}
		this.queue.push({
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
		if ('pointer' in value)
			return isPointerField(value.pointer) ? this.at?.[value.pointer] : undefined;
		return isLocalizationKey(value.key) ? value.key : undefined;
	}
}

const stateKey = (layer: string, state: string): string => `${layer}\u0000${state}`;

const POINTER_FIELDS: ReadonlySet<unknown> = new Set(POINTER_PAYLOAD_FIELDS);
/** Is `field` a pointer reading (`x`, `y`, `dx`, `dy`)? */
export const isPointerField = (field: unknown): field is PointerPayloadField =>
	POINTER_FIELDS.has(field);

/** An `int` / `ms` field takes a whole number only. */
const integral = (type: string | undefined, value: number | boolean | string): boolean =>
	(type !== 'int' && type !== 'ms') || Number.isInteger(value);

// ---- validation ---------------------------------------------------------------------------------

export type ComponentEventIssueCode =
	| 'event-duplicate'
	| 'event-input-collision'
	| 'event-payload-duplicate'
	| 'event-payload-type'
	| 'event-pin-id'
	| 'listener-duplicate'
	| 'listener-input-unknown'
	| 'listener-input-kind'
	| 'listener-value-kind'
	| 'listener-align-target'
	| 'listener-swipe'
	| 'raise-event-unknown'
	| 'raise-payload-unknown'
	| 'raise-payload-type'
	| 'raise-payload-input'
	| 'raise-payload-key'
	| 'raise-payload-pointer'
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
	/** The state an `onEnter` / `onExit` raise is on, and which of the two (`exit` only on an
	 *  `onExit` row). */
	layer?: string;
	state?: string;
	on?: 'exit';
	/** The timeline an `event:` cue is on. */
	timeline?: string;
}

const PAYLOAD_TYPES: ReadonlySet<string> = new Set(EVENT_PAYLOAD_TYPES);
const SWIPE: ReadonlySet<string> = new Set(SWIPE_DIRECTIONS);

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
	if ('pointer' in value) return 'number';
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
		if (event.id.includes(':')) {
			issues.push({
				code: 'event-pin-id',
				level: 'error',
				event: event.id,
				message: `Event "${event.id}": an event id cannot carry ":" (Flow's pin separator); the event gets no pin.`,
			});
		}
		if (kinds.has(event.id)) {
			issues.push({
				code: 'event-input-collision',
				level: 'warning',
				event: event.id,
				input: event.id,
				message: `Event "${event.id}" has the same id as an input. They are different wires (an input comes in, an event goes out)${kinds.get(event.id) === 'trigger' ? ', but the trigger is also a signal on the instance bus' : ''}; rename one if that is not intended.`,
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
			if (field.name.includes(':')) {
				issues.push({
					code: 'event-pin-id',
					level: 'error',
					event: event.id,
					message: `Event "${event.id}": payload field "${field.name}" cannot carry ":" (Flow's pin separator); the field gets no pin.`,
				});
			}
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
				: at.on === 'exit'
					? `On exit of state "${at.state}" (layer "${at.layer}")`
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
			if (typeof value === 'object' && 'pointer' in value) {
				const reason = !isPointerField(value.pointer)
					? `${JSON.stringify(value.pointer)}, which is not a pointer reading (x, y, dx, dy)`
					: !at.node
						? 'the pointer, but no pointer runs it, so it arrives empty'
						: undefined;
				if (reason) {
					issues.push({
						...at,
						code: 'raise-payload-pointer',
						level: 'error',
						event: action.event,
						message: `${where(at)} fills "${name}" with ${reason}.`,
					});
					continue;
				}
			}
			if (typeof value === 'object' && 'key' in value && !isLocalizationKey(value.key)) {
				issues.push({
					...at,
					code: 'raise-payload-key',
					level: 'error',
					event: action.event,
					message: `${where(at)} fills "${name}" with ${JSON.stringify(value.key)}, which is not a localization key (a key is its source text and has at least one letter).`,
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
			} else if (typeof value === 'number' && !integral(field.type?.t, value)) {
				issues.push({
					...at,
					code: 'raise-payload-type',
					level: 'error',
					event: action.event,
					message: `${where(at)} fills "${name}" (${String(field.type?.t)}) with ${value}, which is not a whole number.`,
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

	const nodes = new Map<string, LayoutNode>();
	const index = (n: LayoutNode): void => {
		nodes.set(n.id, n);
		if (n.kind === 'container') n.children.forEach(index);
	};
	if (def.root) index(def.root);
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
			const swipe = listener.event === 'swipe' ? listener.swipe : undefined;
			if (
				swipe &&
				((swipe.direction !== undefined && !SWIPE.has(swipe.direction)) ||
					(swipe.threshold !== undefined &&
						!(Number.isFinite(swipe.threshold) && swipe.threshold >= 0)))
			) {
				issues.push({
					...here,
					code: 'listener-swipe',
					level: 'error',
					message: `Node "${at.node}": a swipe listener's direction must be left, right, up or down and its threshold a distance of 0 or more.`,
				});
			}
			if (action.kind === 'raise') {
				checkRaise(action, here);
				continue;
			}
			if (action.kind === 'align') {
				const target = nodes.get(action.target);
				if (!target || target === def.root) {
					issues.push({
						...here,
						code: 'listener-align-target',
						level: 'error',
						message: target
							? `Node "${at.node}": Align Target cannot move the component's root (an instance is placed by its node).`
							: `Node "${at.node}": Align Target moves node "${action.target}", which is not in this component.`,
					});
				}
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
			const at = { layer: layer.name || layer.id, state: state.name || state.id };
			for (const action of state.onEnter ?? []) checkRaise(action, at);
			for (const action of state.onExit ?? []) checkRaise(action, { ...at, on: 'exit' });
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
