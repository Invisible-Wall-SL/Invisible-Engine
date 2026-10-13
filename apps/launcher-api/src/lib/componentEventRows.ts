import type {
	ComponentEvent,
	ContainerNode,
	EventPayloadType,
	EventPayloadValue,
	LayoutNode,
	ListenerAction,
	NodeListener,
	RaiseEventAction,
	SmEnterAction,
} from 'engine-layout';
import {
	EVENT_PAYLOAD_TYPES,
	isLocalizationKey,
	LISTENER_ACTION_KINDS,
	NODE_LISTENER_EVENTS,
} from 'engine-layout';

/**
 * The readers of a component's Phase 6 rows (Rive plan §5–6.1) — an event's payload fields, a
 * node's listeners, a state's on-enter actions — shared by the normalizer (`componentStorage.ts`),
 * the save graft (`componentUnknownFields.ts`) and the editor's save guard (`listenerEdit.ts`), so
 * all three agree on which row this build cannot read: the read drops it, the save puts a stored
 * one back where it stood, and the editor refuses to save one it made.
 *
 * Fail-closed: a row this build cannot read whole is dropped whole, never widened (a listener
 * whose payload has one unreadable value is not kept as a raise with fewer fields).
 */

type Row = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Row =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const LISTENER_EVENTS: ReadonlySet<unknown> = new Set(NODE_LISTENER_EVENTS);
const ACTION_KINDS: ReadonlySet<unknown> = new Set(LISTENER_ACTION_KINDS);
const PAYLOAD_TYPES: ReadonlySet<unknown> = new Set(EVENT_PAYLOAD_TYPES);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '';
/** Every key of `obj` is one this build knows. A newer key inside an action, a payload value or a
 *  payload type makes the whole row unreadable: rebuilding it without the key would change what
 *  it does, so the read drops it and the save puts it back whole. */
const only = (obj: Row, ...keys: string[]): boolean =>
	Object.keys(obj).every((k) => keys.includes(k));

/** An event's payload field, or `undefined` when Flow could not carry it (an enum, a struct, a
 *  list — a payload holds numbers, bools and localization keys) or it is malformed. */
export function readPayloadField(
	f: unknown,
): NonNullable<ComponentEvent['payload']>[number] | undefined {
	if (!isPlainObject(f) || !isId(f.name)) return undefined;
	if (!isPlainObject(f.type) || !only(f.type, 't') || !PAYLOAD_TYPES.has(f.type.t))
		return undefined;
	const field: NonNullable<ComponentEvent['payload']>[number] = {
		name: f.name,
		type: { t: f.type.t as EventPayloadType },
	};
	if (typeof f.description === 'string' && f.description) field.description = f.description;
	if (f.optional === true) field.optional = true;
	return field;
}

/**
 * An action, or `undefined` when this build cannot read it — an unknown kind, a key it does not
 * know, a missing input or event, a payload value that is not a number, a bool, `{ input }` or
 * `{ key }` holding a localization key (`isLocalizationKey`). `extra` names the keys the row the
 * action is read from may also carry (an on-enter row's `id`).
 */
export function readAction(input: unknown, ...extra: string[]): ListenerAction | undefined {
	if (!isPlainObject(input) || !ACTION_KINDS.has(input.kind)) return undefined;
	if (input.kind === 'raise') return readRaise(input, extra);
	if (!isId(input.input)) return undefined;
	if (input.kind === 'set') {
		if (!only(input, 'kind', 'input', 'value', ...extra)) return undefined;
		if (!(typeof input.value === 'boolean' || finite(input.value))) return undefined;
		return { kind: 'set', input: input.input, value: input.value };
	}
	if (!only(input, 'kind', 'input', ...extra)) return undefined;
	return { kind: input.kind as 'fire' | 'toggle', input: input.input };
}

function readRaise(input: Row, extra: string[]): RaiseEventAction | undefined {
	if (!isId(input.event) || !only(input, 'kind', 'event', 'payload', ...extra)) return undefined;
	const action: RaiseEventAction = { kind: 'raise', event: input.event };
	if (input.payload === undefined) return action;
	if (!isPlainObject(input.payload)) return undefined;
	const payload: Record<string, EventPayloadValue> = {};
	for (const [name, v] of Object.entries(input.payload)) {
		if (typeof v === 'boolean' || finite(v)) payload[name] = v;
		else if (isPlainObject(v) && only(v, 'input') && isId(v.input))
			payload[name] = { input: v.input };
		else if (isPlainObject(v) && only(v, 'key') && isLocalizationKey(v.key))
			payload[name] = { key: v.key };
		else return undefined;
	}
	if (Object.keys(payload).length) action.payload = payload;
	return action;
}

export function readListener(item: unknown): NodeListener | undefined {
	if (!isPlainObject(item) || !isId(item.id) || !LISTENER_EVENTS.has(item.event)) return undefined;
	const action = readAction(item.action);
	return action ? { id: item.id, event: item.event as NodeListener['event'], action } : undefined;
}

export function readEnterAction(item: unknown): SmEnterAction | undefined {
	if (!isPlainObject(item) || !isId(item.id)) return undefined;
	const action = readAction(item, 'id');
	return action?.kind === 'raise' ? { id: item.id, ...action } : undefined;
}

/** Rows read by `read`, the first of each id kept. */
function readRows<T>(input: unknown, id: string, read: (row: unknown) => T | undefined): T[] {
	if (!Array.isArray(input)) return [];
	const out: T[] = [];
	const seen = new Set<unknown>();
	for (const item of input) {
		const row = read(item);
		if (!row) continue;
		const key = (row as Row)[id];
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(row);
	}
	return out;
}

export const normalizeListeners = (input: unknown): NodeListener[] =>
	readRows(input, 'id', readListener);

export const normalizeEnterActions = (input: unknown): SmEnterAction[] =>
	readRows(input, 'id', readEnterAction);

export function normalizeEvents(input: unknown): ComponentEvent[] {
	return readRows(input, 'id', (item) => {
		if (!isPlainObject(item) || !isId(item.id)) return undefined;
		const event: ComponentEvent = { id: item.id };
		const payload = readRows(item.payload, 'name', readPayloadField);
		if (payload.length) event.payload = payload;
		if (typeof item.note === 'string' && item.note) event.note = item.note;
		return event;
	});
}

/**
 * Node listeners are the one node field the component normalizer reads: every other node field
 * passes through. A node whose `on` reads as nothing loses the key; a node without one is the
 * same object.
 */
export function normalizeRootListeners(root: ContainerNode): ContainerNode {
	const walk = (node: LayoutNode): LayoutNode => {
		if (!isPlainObject(node)) return node;
		let next: LayoutNode = node;
		if ('on' in node) {
			const { on, ...rest } = node;
			const listeners = normalizeListeners(on);
			next = (listeners.length ? { ...rest, on: listeners } : rest) as LayoutNode;
		}
		if (next.kind === 'container' && Array.isArray(next.children)) {
			const before = next.children;
			const children = before.map(walk);
			if (children.some((c, i) => c !== before[i])) next = { ...next, children };
		}
		return next;
	};
	return walk(root) as ContainerNode;
}

/** A stored row with an id that the read dropped: the author never saw it, so the save keeps it. */
export const unreadable =
	(id: string, read: (row: unknown) => unknown) =>
	(row: Row): boolean =>
		isId(row[id]) && read(row) === undefined;
