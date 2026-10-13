import {
	componentEvents,
	componentInputs,
	eventCueId,
	type CinematicDoc,
	type ComponentDef,
	type ComponentEvent,
	type EventPayloadType,
	type EventPayloadValue,
	type LayoutNode,
	type ListenerAction,
	type ListenerActionKind,
	type NodeListener,
	type NodeListenerEvent,
	type RaiseEventAction,
	type SmEnterAction,
	type SmState,
} from 'engine-layout';

import { readEnterAction, readListener, readPayloadField } from '../componentEventRows';

/**
 * The Listeners and Events EDITS (Rive plan Phase 6b), as pure functions over the draft
 * `ComponentDef` so the gate can prove them: node listeners, a state's on-enter raises, the def's
 * events and their payload fields. Every function mutates what it is given (the editor's draft).
 *
 * Ids. A listener's and an on-enter row's id is MINTED with a random suffix that no id of the draft
 * or of the last-saved def uses: the save keeps a row a newer build wrote and this build cannot
 * read, by id, so a new row must not be able to take that id — and the client never sees such a
 * row. An event's id is its NAME (the wire Flow's pins will use), chosen by the author, like an
 * input's; renaming one is a replace.
 */

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `<prefix>_<6 random chars>`, none of `taken`. */
export function mintId(prefix: string, taken: Iterable<string>, random = Math.random): string {
	const used = new Set(taken);
	for (;;) {
		let suffix = '';
		for (let i = 0; i < 6; i++) suffix += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
		const id = `${prefix}_${suffix}`;
		if (!used.has(id)) return id;
	}
}

/** Every node of a def's tree, root first. */
export function defNodes(def: Pick<ComponentDef, 'root'> | null | undefined): LayoutNode[] {
	const out: LayoutNode[] = [];
	const walk = (n: LayoutNode): void => {
		out.push(n);
		if (n.kind === 'container') n.children.forEach(walk);
	};
	if (def?.root) walk(def.root);
	return out;
}

/** Every listener and on-enter id a def uses — with the saved def's, what a new row must avoid. */
export function rowIds(
	def: Pick<ComponentDef, 'root' | 'stateMachine'> | null | undefined,
): Set<string> {
	const out = new Set<string>();
	for (const n of defNodes(def)) for (const l of n.on ?? []) out.add(l.id);
	for (const layer of def?.stateMachine?.layers ?? []) {
		for (const state of layer.states) for (const a of state.onEnter ?? []) out.add(a.id);
	}
	return out;
}

/** Every listener and raise payload of the def that reads input `id` — what a rename must follow
 *  and a removal must warn about, beside the state machine's conditions. */
export function inputReads(def: ComponentDef, id: string): string[] {
	const out: string[] = [];
	const readsPayload = (payload: RaiseEventAction['payload']): boolean =>
		Object.values(payload ?? {}).some(
			(v) => typeof v === 'object' && 'input' in v && v.input === id,
		);
	for (const n of defNodes(def)) {
		for (const l of n.on ?? []) {
			const a = l.action;
			if ((a.kind !== 'raise' && a.input === id) || (a.kind === 'raise' && readsPayload(a.payload)))
				out.push(`a listener on "${n.label || n.id}"`);
		}
	}
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states) {
			if ((state.onEnter ?? []).some((a) => readsPayload(a.payload)))
				out.push(`On enter of "${state.name || state.id}"`);
		}
	}
	return out;
}

/** Point every listener and raise payload that reads input `from` at `to`. */
export function renameInputReads(def: ComponentDef, from: string, to: string): void {
	const follow = (payload: RaiseEventAction['payload']): void => {
		for (const v of Object.values(payload ?? {})) {
			if (typeof v === 'object' && 'input' in v && v.input === from) v.input = to;
		}
	};
	for (const n of defNodes(def)) {
		for (const l of n.on ?? []) {
			if (l.action.kind === 'raise') follow(l.action.payload);
			else if (l.action.input === from) l.action.input = to;
		}
	}
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states) for (const a of state.onEnter ?? []) follow(a.payload);
	}
}

// ---- actions ------------------------------------------------------------------------------------

/** The listener action kinds the editor offers, with what each needs. */
export const ACTION_CHOICES: { kind: ListenerActionKind; label: string }[] = [
	{ kind: 'fire', label: 'fire trigger' },
	{ kind: 'set', label: 'set input' },
	{ kind: 'toggle', label: 'toggle bool' },
	{ kind: 'raise', label: 'raise event' },
];

/** The inputs an action of `kind` can act on. */
export function inputsFor(
	def: Pick<ComponentDef, 'inputs' | 'signals'>,
	kind: ListenerActionKind,
): { id: string; kind: string }[] {
	const wanted =
		kind === 'fire'
			? ['trigger']
			: kind === 'toggle'
				? ['bool']
				: kind === 'set'
					? ['bool', 'number']
					: [];
	return componentInputs(def).filter((i) => wanted.includes(i.kind));
}

/** A fresh action of `kind`, on the first input or event that fits (empty when none does yet —
 *  validation flags it and the save drops it, never widening anything). */
export function defaultAction(
	def: Pick<ComponentDef, 'inputs' | 'signals' | 'events'>,
	kind: ListenerActionKind,
): ListenerAction {
	if (kind === 'raise') return { kind: 'raise', event: componentEvents(def)[0]?.id ?? '' };
	const input = inputsFor(def, kind)[0];
	if (kind === 'set')
		return { kind: 'set', input: input?.id ?? '', value: input?.kind === 'number' ? 0 : true };
	return { kind, input: input?.id ?? '' };
}

/** Retarget an action (a new input or event). A `set` takes the new input's kind of value. */
export function setActionTarget(
	def: Pick<ComponentDef, 'inputs' | 'signals'>,
	action: ListenerAction,
	target: string,
): void {
	if (action.kind === 'raise') {
		action.event = target;
		delete action.payload;
		return;
	}
	action.input = target;
	if (action.kind === 'set') {
		const kind = componentInputs(def).find((i) => i.id === target)?.kind;
		action.value = kind === 'number' ? (typeof action.value === 'number' ? action.value : 0) : true;
	}
}

/** Fill (or with `undefined`, clear) one payload field of a raise. */
export function setRaisePayload(
	action: RaiseEventAction,
	field: string,
	value: EventPayloadValue | undefined,
): void {
	const payload = { ...(action.payload ?? {}) };
	if (value === undefined) delete payload[field];
	else payload[field] = value;
	if (Object.keys(payload).length) action.payload = payload;
	else delete action.payload;
}

// ---- listeners ----------------------------------------------------------------------------------

/** Add a listener to `node` — on click, the first action the def can do. */
export function addListener(
	node: LayoutNode,
	def: ComponentDef,
	reserved: Iterable<string> = [],
	event: NodeListenerEvent = 'click',
): NodeListener {
	const kind: ListenerActionKind = inputsFor(def, 'fire').length
		? 'fire'
		: componentEvents(def).length
			? 'raise'
			: inputsFor(def, 'set').length
				? 'set'
				: 'fire';
	const listener: NodeListener = {
		id: mintId('l', [...rowIds(def), ...reserved]),
		event,
		action: defaultAction(def, kind),
	};
	node.on = [...(node.on ?? []), listener];
	return listener;
}

export function removeListener(node: LayoutNode, id: string): void {
	const next = (node.on ?? []).filter((l) => l.id !== id);
	if (next.length) node.on = next;
	else delete node.on;
}

/** Change what a listener does: a new action of `kind`, keeping its target when it still fits. */
export function setListenerKind(
	def: ComponentDef,
	listener: NodeListener,
	kind: ListenerActionKind,
): void {
	if (listener.action.kind === kind) return;
	const fresh = defaultAction(def, kind);
	const old = listener.action;
	if (fresh.kind !== 'raise' && old.kind !== 'raise') {
		if (inputsFor(def, kind).some((i) => i.id === old.input))
			setActionTarget(def, fresh, old.input);
	}
	listener.action = fresh;
}

// ---- on enter -----------------------------------------------------------------------------------

/** Add an "on enter → raise" row to a state, raising the def's first event. */
export function addEnterAction(
	state: SmState,
	def: ComponentDef,
	reserved: Iterable<string> = [],
): SmEnterAction {
	const row: SmEnterAction = {
		id: mintId('e', [...rowIds(def), ...reserved]),
		kind: 'raise',
		event: componentEvents(def)[0]?.id ?? '',
	};
	state.onEnter = [...(state.onEnter ?? []), row];
	return row;
}

export function removeEnterAction(state: SmState, id: string): void {
	const next = (state.onEnter ?? []).filter((a) => a.id !== id);
	if (next.length) state.onEnter = next;
	else delete state.onEnter;
}

// ---- events -------------------------------------------------------------------------------------

/** The payload types an event field may have — what Flow can carry and a value can fill. */
export const PAYLOAD_TYPE_CHOICES: { t: EventPayloadType; label: string }[] = [
	{ t: 'int', label: 'int' },
	{ t: 'float', label: 'number' },
	{ t: 'ms', label: 'ms' },
	{ t: 'bool', label: 'bool' },
	{ t: 'string', label: 'text key' },
];

/** An event id a timeline cue can name (`event:<id>`): no spaces, no `:`. */
export function isEventId(id: string): boolean {
	return id.length > 0 && !/[\s:]/.test(id);
}

/**
 * Why naming an event `id` (adding one, or renaming one to it) is refused, or null: an empty name,
 * one a cue cannot name, a taken one — or the name of an event removed earlier whose listeners or
 * On enter rows are still there, flagged: taking it would silently reconnect them. (A timeline cue
 * naming it is not counted: it shows ⚠ in the State machine tab, and declaring the event it names
 * is how a typo is fixed.)
 */
export function eventNameRefusal(def: ComponentDef, id: string): string | null {
	const name = id.trim();
	if (!name) return 'Type a name.';
	if (!isEventId(name)) return `"${name}" has a space or ":" — a timeline cue could not name it.`;
	if (componentEvents(def).some((e) => e.id === name)) return `"${name}" is already an event.`;
	const used = eventUsage(def, name);
	const stale = [
		...used.listeners.map((l) => `a listener on "${l.node}"`),
		...used.states.map((st) => `entering "${st.state}" (${st.layer})`),
	];
	return stale.length
		? `"${name}" is still raised by ${stale.join(', ')} (from an event removed earlier). Taking the name would silently reconnect them — repoint or remove those first, or pick another name.`
		: null;
}

/** Add an event; refused (undefined) for any reason `eventNameRefusal` gives. */
export function addEvent(def: ComponentDef, id: string): ComponentEvent | undefined {
	if (eventNameRefusal(def, id) !== null) return undefined;
	const clean = id.trim();
	const event: ComponentEvent = { id: clean };
	def.events = [...(def.events ?? []), event];
	return event;
}

/** What raises an event in the def: its listeners (by node) and its states' on-enter rows. */
export interface EventUsage {
	listeners: { node: string; listener: string }[];
	states: { layer: string; state: string }[];
}

export function eventUsage(def: ComponentDef, id: string): EventUsage {
	const out: EventUsage = { listeners: [], states: [] };
	for (const n of defNodes(def)) {
		for (const l of n.on ?? []) {
			if (l.action.kind === 'raise' && l.action.event === id)
				out.listeners.push({ node: n.label || n.id, listener: l.id });
		}
	}
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states) {
			if ((state.onEnter ?? []).some((a) => a.event === id))
				out.states.push({ layer: layer.name || layer.id, state: state.name || state.id });
		}
	}
	return out;
}

/** The names of the timelines that raise `id` with an `event:` cue. */
export function timelinesRaising(docs: Iterable<CinematicDoc>, id: string): string[] {
	const out: string[] = [];
	for (const doc of docs) {
		const raises = (doc.tracks ?? []).some(
			(track) =>
				track.kind === 'cue' &&
				Array.isArray(track.keys) &&
				(track.keys as { cue?: unknown }[]).some(
					(k) => typeof k?.cue === 'string' && eventCueId(k.cue) === id,
				),
		);
		if (raises) out.push(doc.name || doc.id);
	}
	return out;
}

/** Every `event:` cue in `docs`, by timeline name. */
export function eventCues(docs: Iterable<CinematicDoc>): { timeline: string; event: string }[] {
	const out: { timeline: string; event: string }[] = [];
	for (const doc of docs) {
		for (const track of doc.tracks ?? []) {
			if (track.kind !== 'cue' || !Array.isArray(track.keys)) continue;
			for (const k of track.keys as { cue?: unknown }[]) {
				const event = typeof k?.cue === 'string' ? eventCueId(k.cue) : undefined;
				if (event !== undefined) out.push({ timeline: doc.name || doc.id, event });
			}
		}
	}
	return out;
}

/**
 * Why removing event `id` is refused, or null. Removing the LAST event turns the def back into
 * one that declares none, and there an `event:` cue keeps its pre-Phase-6 meaning — a broadcast of
 * its bare name to the whole screen (`routeComponentCue`) — so a cue left behind would be widened,
 * not left inert. The cues are fixed first. `timelines` are this project's, as last saved: a
 * SHARED def's timelines live in every project that uses it, out of sight, so it keeps its last
 * event outright.
 */
export function removeEventRefusal(
	def: ComponentDef,
	id: string,
	timelines: Iterable<CinematicDoc>,
): string | null {
	if (componentEvents(def).some((e) => e.id !== id)) return null;
	if (def.scope !== 'project')
		return `"${id}" is this component's last event. Shared components keep their last event: other projects' timelines may raise it.`;
	const cues = eventCues(timelines);
	if (!cues.length) return null;
	const list = cues.map((c) => `event:${c.event} in "${c.timeline}"`).join(', ');
	return `"${id}" is this component's last event, and its timelines (as last saved) still have event cues (${list}). Without any event a cue is broadcast to the whole screen, so remove or change those cues in the Timeline tab first.`;
}

/**
 * The `event:` cues of `timelines` that adding a first event would re-route: on a def that declares
 * none they are broadcasts by bare name; once it declares one they raise its events (and an
 * undeclared one raises nothing). Empty when the def already declares events.
 */
export function firstEventCues(
	def: ComponentDef,
	timelines: Iterable<CinematicDoc>,
): { timeline: string; event: string }[] {
	return componentEvents(def).length ? [] : eventCues(timelines);
}

/**
 * Remove an event. What raises it STAYS — a raise of an undeclared event does nothing in game and
 * validation flags it (`raise-event-unknown`), so the author sees ⚠ and fixes it; nothing is
 * dropped silently. Returns what raised it.
 */
export function removeEvent(def: ComponentDef, id: string): EventUsage {
	const used = eventUsage(def, id);
	if (def.events) {
		def.events = def.events.filter((e) => e.id !== id);
		if (!def.events.length) delete def.events;
	}
	return used;
}

/**
 * Rename an event: the event and every listener and on-enter raise of it in the def follow. A cue
 * in a timeline is another document and is not rewritten (the dialog lists those). Refused (false)
 * for any reason `eventNameRefusal` gives.
 */
export function renameEvent(def: ComponentDef, from: string, to: string): boolean {
	if (to.trim() === from || eventNameRefusal(def, to) !== null) return false;
	const next = to.trim();
	for (const event of def.events ?? []) if (event.id === from) event.id = next;
	for (const n of defNodes(def)) {
		for (const l of n.on ?? [])
			if (l.action.kind === 'raise' && l.action.event === from) l.action.event = next;
	}
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states) {
			for (const a of state.onEnter ?? []) if (a.event === from) a.event = next;
		}
	}
	return true;
}

/** Add a payload field to an event; an empty or taken name, or one carrying `:` (Flow's pin
 *  separator — the field would get no pin), adds nothing. */
export function addPayloadField(
	event: ComponentEvent,
	name: string,
	t: EventPayloadType = 'float',
): boolean {
	const clean = name.trim();
	if (!clean || clean.includes(':') || (event.payload ?? []).some((f) => f.name === clean))
		return false;
	event.payload = [...(event.payload ?? []), { name: clean, type: { t } }];
	return true;
}

export function removePayloadField(event: ComponentEvent, name: string): void {
	const next = (event.payload ?? []).filter((f) => f.name !== name);
	if (next.length) event.payload = next;
	else delete event.payload;
}

export function setPayloadFieldType(
	event: ComponentEvent,
	name: string,
	t: EventPayloadType,
): void {
	const field = (event.payload ?? []).find((f) => f.name === name);
	if (field) field.type = { t };
}

export function setPayloadFieldOptional(
	event: ComponentEvent,
	name: string,
	optional: boolean,
): void {
	const field = (event.payload ?? []).find((f) => f.name === name);
	if (!field) return;
	if (optional) field.optional = true;
	else delete field.optional;
}

/** A one-line summary of what a listener does, for the row's title. */
export function actionLabel(action: ListenerAction): string {
	switch (action.kind) {
		case 'fire':
			return `fire ${action.input || '?'} ▸`;
		case 'set':
			return `set ${action.input || '?'} = ${String(action.value)}`;
		case 'toggle':
			return `toggle ${action.input || '?'}`;
		case 'raise':
			return `raise ${action.event || '?'}`;
	}
}

// ---- the save guard -----------------------------------------------------------------------------

/**
 * The rows the server's reader would drop from this def on save because it cannot READ them
 * (`componentEventRows.ts` — the same functions, row by row): a listener or on-enter row with an
 * empty target or an unreadable payload value (a text key that is not a localization key), an
 * event's unreadable payload field — plus an `int` / `ms` payload value that is not a whole number
 * (which the server keeps). Not mirrored: the reader's drop of a second row with an id or a field
 * name already taken — the editor mints ids and refuses taken names, so it never makes one. The
 * editor refuses to save while any listed row is left: the save would lose it while the editor
 * showed it as saved.
 */
export function unsavableRows(def: ComponentDef): string[] {
	const out: string[] = [];
	const types = new Map(
		componentEvents(def).map((e) => [
			e.id,
			new Map((e.payload ?? []).map((f) => [f.name, f.type.t])),
		]),
	);
	const fractional = (a: RaiseEventAction): boolean =>
		Object.entries(a.payload ?? {}).some(([name, v]) => {
			const t = types.get(a.event)?.get(name);
			return typeof v === 'number' && (t === 'int' || t === 'ms') && !Number.isInteger(v);
		});
	const plain = <T>(row: T): unknown => JSON.parse(JSON.stringify(row));
	for (const n of defNodes(def)) {
		for (const l of n.on ?? []) {
			if (!readListener(plain(l)) || (l.action.kind === 'raise' && fractional(l.action)))
				out.push(`a listener on "${n.label || n.id}"`);
		}
	}
	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states) {
			if ((state.onEnter ?? []).some((a) => !readEnterAction(plain(a)) || fractional(a)))
				out.push(`On enter of "${state.name || state.id}"`);
		}
	}
	for (const event of def.events ?? []) {
		if ((event.payload ?? []).some((f) => !readPayloadField(plain(f))))
			out.push(`a payload field of event "${event.id}"`);
	}
	return out;
}
