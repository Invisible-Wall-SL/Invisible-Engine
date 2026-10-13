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

/** Add an event; an empty or taken id adds nothing. */
/** An event id a timeline cue can name (`event:<id>`): no spaces, no `:`. */
export function isEventId(id: string): boolean {
	return id.length > 0 && !/[\s:]/.test(id);
}

export function addEvent(def: ComponentDef, id: string): ComponentEvent | undefined {
	const clean = id.trim();
	if (!isEventId(clean) || componentEvents(def).some((e) => e.id === clean)) return undefined;
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
 * when the new id is empty or already an event.
 */
export function renameEvent(def: ComponentDef, from: string, to: string): boolean {
	const next = to.trim();
	if (!isEventId(next) || next === from) return false;
	if (componentEvents(def).some((e) => e.id === next)) return false;
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

/** Add a payload field to an event; an empty or taken name adds nothing. */
export function addPayloadField(
	event: ComponentEvent,
	name: string,
	t: EventPayloadType = 'float',
): boolean {
	const clean = name.trim();
	if (!clean || (event.payload ?? []).some((f) => f.name === clean)) return false;
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
