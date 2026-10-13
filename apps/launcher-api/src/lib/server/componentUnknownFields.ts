import type { ComponentDef, LayoutNode } from 'engine-layout';
import { COMPONENT_INPUT_KINDS } from 'engine-layout';
import {
	COMPONENT_DEF_FIELDS,
	COMPONENT_EVENT_FIELDS,
	EVENT_PAYLOAD_FIELDS,
	NODE_LISTENER_FIELDS,
	SM_ENTER_ACTION_FIELDS,
	COMPONENT_INPUT_FIELDS,
	COMPONENT_PARAM_FIELDS,
	COMPONENT_SIGNAL_FIELDS,
	LAYOUT_NODE_FIELDS,
	SM_LAYER_FIELDS,
	SM_STATE_FIELDS,
	SM_TRANSITION_FIELDS,
	STATE_MACHINE_FIELDS,
	TEMPLATE_SLOT_FIELDS,
} from './componentFields';
import { readEnterAction, readListener, readPayloadField, unreadable } from '../componentEventRows';
import { isPlainObject } from './stripUnknownKeys';
import { unknownFields, withUnknownFields } from './unknownBlocks';

type IsKnown = (key: string) => boolean;
type Row = Record<string, unknown>;

const known =
	(set: ReadonlySet<string>): IsKnown =>
	(key) =>
		set.has(key);
const isDefField = known(COMPONENT_DEF_FIELDS);
const isNodeField = known(LAYOUT_NODE_FIELDS);
const isStateMachineField = known(STATE_MACHINE_FIELDS);
const isLayerField = known(SM_LAYER_FIELDS);
const INPUT_KINDS: ReadonlySet<string> = new Set(COMPONENT_INPUT_KINDS);

/**
 * The Phase 6 rows nested in an entity (Rive plan §5–6.1): a node's listeners and a state's
 * on-enter actions by `id`, an event's payload fields by `name`. Each kept row takes its twin's
 * unknown fields; a stored row this build cannot read (a newer action kind or pointer event, a
 * payload type Flow cannot carry yet) is put back where it stood, as an unreadable input is.
 */
interface NestedRows {
	/** The projection key's kind. */
	name: string;
	field: string;
	id: string;
	isKnown: IsKnown;
	isUnreadable: (row: Row) => boolean;
}
const LISTENER_ROWS: NestedRows = {
	name: 'listener',
	field: 'on',
	id: 'id',
	isKnown: known(NODE_LISTENER_FIELDS),
	isUnreadable: unreadable('id', readListener),
};
const ENTER_ROWS: NestedRows = {
	name: 'onEnter',
	field: 'onEnter',
	id: 'id',
	isKnown: known(SM_ENTER_ACTION_FIELDS),
	isUnreadable: unreadable('id', readEnterAction),
};
const PAYLOAD_ROWS: NestedRows = {
	name: 'payload',
	field: 'payload',
	id: 'name',
	isKnown: known(EVENT_PAYLOAD_FIELDS),
	isUnreadable: unreadable('name', readPayloadField),
};
const graftListeners = nested(LISTENER_ROWS);
const graftEnterActions = nested(ENTER_ROWS);
const graftPayload = nested(PAYLOAD_ROWS);

/**
 * The def's id-keyed rows, which a normalizer rebuilds field by field. Their ids are NAMES the
 * editor re-adds (a deleted `label` param can come back as `label`), so a row that carries a
 * `kind` takes its twin's fields only while the kind is the same: a `label` re-added as an image
 * param is a different param, though the engine binds both by key.
 */
const ROW_ARRAYS = [
	{ field: 'params', id: 'key', isKnown: known(COMPONENT_PARAM_FIELDS), byKind: true },
	{ field: 'signals', id: 'key', isKnown: known(COMPONENT_SIGNAL_FIELDS), byKind: false },
	{ field: 'slots', id: 'slotId', isKnown: known(TEMPLATE_SLOT_FIELDS), byKind: true },
	{ field: 'inputs', id: 'id', isKnown: known(COMPONENT_INPUT_FIELDS), byKind: true },
	{
		field: 'events',
		id: 'id',
		isKnown: known(COMPONENT_EVENT_FIELDS),
		byKind: false,
		inner: graftPayload,
	},
] as const;
/** The rows of one state-machine layer, matched by id within that layer. */
const LAYER_ARRAYS = [
	{ field: 'states', isKnown: known(SM_STATE_FIELDS), inner: graftEnterActions },
	{ field: 'transitions', isKnown: known(SM_TRANSITION_FIELDS), inner: undefined },
] as const;

/**
 * `next` (an author's normalized save) with what a NEWER launcher wrote into `stored` that this
 * build does not know (`docs/conventions/doc-readers.md`, "Round-tripping"):
 *
 * - every unknown top-level field of the def, and of `stateMachine` (a fixed namespace, kept also
 *   when the author removed every layer, like a win-text family);
 * - inside each ENTITY the author kept, matched to its stored copy by id: the unknown fields of a
 *   node anywhere under `root` (the root included; not a node whose id is duplicated, which has
 *   no single twin), of a param, signal, slot, input (of the same `kind`) or event, and of a
 *   state-machine layer and, within the same layer, its states and transitions. A transition's
 *   `conditions` are its own known data and are not walked;
 * - a stored INPUT row of a kind this build does not know, which the read dropped, back in its
 *   stored position: the author never saw it, so its absence is not a deletion.
 *
 * An entity whose id is gone from `next` was deleted, so nothing of it comes back. One level per
 * entity: the fields of a known field (a node's `overrides`, `preview`) are not walked. A field
 * `next` already carries is left as posted. Only a child node can carry one: the normalizer has
 * already dropped the posted top-level, root and row fields, so the stored copy wins there.
 *
 * Returns `next` itself when nothing is grafted, so a known-only def saves byte-identically.
 */
export function withUnknownComponentFields(next: ComponentDef, stored: unknown): ComponentDef {
	if (!isPlainObject(stored)) return next;
	const out: Row = { ...next };
	let grafted = false;
	const set = (field: string, value: unknown, before: unknown): void => {
		if (value === before) return;
		out[field] = value;
		grafted = true;
	};

	const storedNodes = new Map<string, Row>();
	const duplicated = new Set<string>();
	indexNodes(stored.root, storedNodes, duplicated);
	indexNodes(next.root, new Map(), duplicated);
	if (duplicated.size) {
		console.warn(`[component] ${next.id}: not grafting unknown fields onto duplicated node ids —`, [
			...duplicated,
		]);
		for (const id of duplicated) storedNodes.delete(id);
	}
	set('root', graftNode(next.root, storedNodes), next.root);

	for (const row of ROW_ARRAYS) {
		const { field, id, isKnown, byKind } = row;
		const rows = next[field] as Row[] | undefined;
		const isInputs = field === 'inputs';
		const inner = 'inner' in row ? row.inner : undefined;
		const twin = { skip: isInputs ? isUnreadableInput : undefined, byKind, inner };
		const merged = rows ? graftRows(rows, stored[field], id, isKnown, twin) : rows;
		set(field, isInputs ? withUnreadableInputs(merged, stored.inputs, next.signals) : merged, rows);
	}

	const machine = graftStateMachine(next.stateMachine as Row | undefined, stored.stateMachine);
	set('stateMachine', machine, next.stateMachine);

	// In its stored position, so an older launcher's no-op save rewrites the very same bytes.
	const withBlocks = withUnknownFields(isDefField, stored, out);
	return grafted || withBlocks !== out ? (withBlocks as unknown as ComponentDef) : next;
}

interface TwinRule {
	/** Rows the read drops, which are never a twin. */
	skip?: (row: Row) => boolean;
	/** Only a stored row of the same `kind` is a twin. */
	byKind?: boolean;
	/** Applied to each matched pair after its own fields (a layer's states and transitions). */
	inner?: (row: Row, stored: Row) => Row;
}

/** `rows` with each row that has a stored twin (same `id`, first of a duplicate) given back its
 *  unknown fields. `rows` itself when nothing changed. */
function graftRows(
	rows: Row[],
	stored: unknown,
	id: string,
	isKnown: IsKnown,
	{ skip, byKind, inner }: TwinRule = {},
): Row[] {
	const byId = rowsById(stored, id, skip);
	let changed = false;
	const merged = rows.map((row) => {
		const twin = typeof row[id] === 'string' ? byId.get(row[id]) : undefined;
		if (!twin || (byKind && twin.kind !== row.kind)) return row;
		const own = withUnknownFields(isKnown, twin, row);
		const kept = inner ? inner(own, twin) : own;
		if (kept !== row) changed = true;
		return kept;
	});
	return changed ? merged : rows;
}

/**
 * The rows of `stored` by `id`, first wins. `skip` leaves out rows the read drops, so a twin is
 * always the row the author saw, the way `normalizeInputs` claims an id only for a readable row.
 */
function rowsById(stored: unknown, id: string, skip?: (row: Row) => boolean): Map<string, Row> {
	const byId = new Map<string, Row>();
	for (const row of Array.isArray(stored) ? stored : []) {
		if (!isPlainObject(row) || typeof row[id] !== 'string' || byId.has(row[id])) continue;
		if (!skip?.(row)) byId.set(row[id], row);
	}
	return byId;
}

/** An input row the read dropped for its kind alone: a non-empty id and a kind this build does
 *  not know (a newer build's), not a malformed row. */
function isUnreadableInput(row: Row): boolean {
	return (
		typeof row.id === 'string' &&
		row.id !== '' &&
		typeof row.kind === 'string' &&
		row.kind !== '' &&
		!INPUT_KINDS.has(row.kind)
	);
}

/**
 * `inputs` with every stored row of an unknown `kind` that it lacks put back where it stood: after
 * the nearest stored row before it that is still there, else first. Not when the author's save
 * now uses that id for an input or a signal (signals share the input id space,
 * `componentInputs`): the author's entity wins. Its fields are never re-normalized, so a newer
 * value inside it cannot fail a save.
 */
function withUnreadableInputs(
	inputs: Row[] | undefined,
	stored: unknown,
	signals: ComponentDef['signals'],
): Row[] | undefined {
	const signalKeys = new Set((signals ?? []).map((signal) => signal.key));
	return withUnreadableRows(inputs, stored, 'id', isUnreadableInput, signalKeys);
}

/**
 * `rows` with every stored row `isUnreadable` picks that it lacks put back where it stood: after
 * the nearest stored row before it that is still there, else first. Not when the author's save
 * now uses that id (or `taken` holds it): the author's entity wins. Its fields are never
 * re-normalized, so a newer value inside it cannot fail a save.
 */
function withUnreadableRows(
	rows: Row[] | undefined,
	stored: unknown,
	id: string,
	isUnreadable: (row: Row) => boolean,
	taken?: ReadonlySet<string>,
): Row[] | undefined {
	if (!Array.isArray(stored)) return rows;
	const out = [...(rows ?? [])];
	let added = false;
	let anchor = -1;
	for (const row of stored) {
		if (!isPlainObject(row)) continue;
		const at = out.findIndex((kept) => kept[id] === row[id]);
		if (at !== -1) {
			anchor = at;
			continue;
		}
		if (!isUnreadable(row) || taken?.has(row[id] as string)) continue;
		out.splice(++anchor, 0, row);
		added = true;
	}
	return added ? out : rows;
}

/** A grafter for the rows `field` of an entity: see {@link graftListeners}. */
function nested({
	field,
	id,
	isKnown,
	isUnreadable,
}: NestedRows): (row: Row, stored: Row | undefined) => Row {
	return (row, stored) => {
		if (!isPlainObject(stored) || !Array.isArray(stored[field])) return row;
		const rows = Array.isArray(row[field]) ? (row[field] as Row[]) : undefined;
		const grafted = rows
			? graftRows(rows, stored[field], id, isKnown, { skip: isUnreadable })
			: rows;
		const kept = withUnreadableRows(grafted, stored[field], id, isUnreadable);
		return kept === rows || !kept?.length ? row : { ...row, [field]: kept };
	};
}

function graftStateMachine(next: Row | undefined, stored: unknown): Row | undefined {
	if (!isPlainObject(stored)) return next;
	const layers = next?.layers as Row[] | undefined;
	const merged = layers
		? graftRows(layers, stored.layers, 'id', isLayerField, { inner: graftLayer })
		: layers;
	const base: Row = next
		? merged === layers
			? next
			: { ...next, layers: merged }
		: { layers: [] };
	const out = withUnknownFields(isStateMachineField, stored, base);
	return out === base && !next ? next : out;
}

function graftLayer(layer: Row, stored: Row): Row {
	let out = layer;
	for (const { field, isKnown, inner } of LAYER_ARRAYS) {
		const rows = layer[field];
		if (!Array.isArray(rows)) continue;
		const merged = graftRows(rows as Row[], stored[field], 'id', isKnown, { inner });
		if (merged !== rows) out = { ...out, [field]: merged };
	}
	return out;
}

/**
 * Whether `next` holds the same unknown fields as `stored`: at the top level, in `stateMachine`,
 * and on each node and row `next` still has (by id; the first of a duplicated id). A stored entity
 * `next` lacks is already a known-content change when the author deleted it; when the READ dropped
 * it (a param of an unknown kind), the author changed nothing about it. The version bump compares
 * this beside the known-only content.
 */
export function sameUnknownComponentFields(next: unknown, stored: unknown): boolean {
	const mine = unknownComponentFields(next);
	const theirs = unknownComponentFields(stored);
	for (const key of theirs.keys()) {
		if (!mine.has(key) && !ALWAYS_COMPARED.has(JSON.parse(key)[0])) theirs.delete(key);
	}
	return canonical(mine) === canonical(theirs);
}

/** Projection keys compared whether or not the save still has them: the two fixed namespaces,
 *  and the input rows the read dropped (their absence is never the author's). */
const ALWAYS_COMPARED = new Set([
	'def',
	'stateMachine',
	'unreadableInput',
	...[LISTENER_ROWS, ENTER_ROWS, PAYLOAD_ROWS].map(({ name }) => `unreadable:${name}`),
]);

/**
 * Every entity of a def, keyed by a JSON `[kind, …ids]` (states and transitions under their
 * layer; listeners, `onEnter` rows and payload fields under their node, state or event), mapped to
 * its unknown fields. An input or a nested row this build cannot read is projected WHOLE, since all
 * of it is unknown here. The first of a duplicated key wins.
 */
function unknownComponentFields(doc: unknown): Map<string, Row> {
	const out = new Map<string, Row>();
	const add = (key: string[], value: Row): void => {
		const at = JSON.stringify(key);
		if (!out.has(at)) out.set(at, value);
	};
	if (!isPlainObject(doc)) return out;
	/** A nested row under its parent's ids: a readable one by its unknown fields, an unreadable one
	 *  WHOLE, as an unreadable input is. */
	const addNested = (parent: string[], row: Row, spec: NestedRows): void => {
		const rows: unknown[] = Array.isArray(row[spec.field]) ? (row[spec.field] as unknown[]) : [];
		for (const r of rows) {
			if (!isPlainObject(r) || typeof r[spec.id] !== 'string') continue;
			const at = [...parent, r[spec.id] as string];
			if (spec.isUnreadable(r)) add([`unreadable:${spec.name}`, ...at], r);
			else add([spec.name, ...at], unknownFields(spec.isKnown, r));
		}
	};
	add(['def'], unknownFields(isDefField, doc));
	const nodes = new Map<string, Row>();
	indexNodes(doc.root, nodes);
	for (const [id, node] of nodes) {
		add(['node', id], unknownFields(isNodeField, node));
		addNested([id], node, LISTENER_ROWS);
	}
	for (const { field, id, isKnown } of ROW_ARRAYS) {
		const skip = field === 'inputs' ? isUnreadableInput : undefined;
		for (const [rowId, row] of rowsById(doc[field], id, skip)) {
			add([field, rowId], unknownFields(isKnown, row));
			if (field === 'events') addNested([rowId], row, PAYLOAD_ROWS);
		}
	}
	for (const row of Array.isArray(doc.inputs) ? doc.inputs : []) {
		if (isPlainObject(row) && isUnreadableInput(row))
			add(['unreadableInput', row.id as string], row);
	}
	const machine = doc.stateMachine;
	if (isPlainObject(machine)) {
		add(['stateMachine'], unknownFields(isStateMachineField, machine));
		for (const [layerId, layer] of rowsById(machine.layers, 'id')) {
			add(['layer', layerId], unknownFields(isLayerField, layer));
			for (const { field, isKnown } of LAYER_ARRAYS) {
				for (const [rowId, row] of rowsById(layer[field], 'id')) {
					add([field, layerId, rowId], unknownFields(isKnown, row));
					if (field === 'states') addNested([layerId, rowId], row, ENTER_ROWS);
				}
			}
		}
	}
	return out;
}

/** The entities with unknown fields, as JSON with keys sorted, so order never reads as a change. */
function canonical(fields: Map<string, Row>): string {
	const entries = [...fields].filter(([, extra]) => Object.keys(extra).length).sort(byKey);
	return JSON.stringify(entries, (_key, v: unknown) =>
		isPlainObject(v) ? Object.fromEntries(Object.entries(v).sort(byKey)) : v,
	);
}

function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Every node under `node` by id, first wins; an id seen twice is added to `duplicated`. */
function indexNodes(node: unknown, out: Map<string, Row>, duplicated?: Set<string>): void {
	if (!isPlainObject(node)) return;
	if (typeof node.id === 'string') {
		if (!out.has(node.id)) out.set(node.id, node);
		else duplicated?.add(node.id);
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) indexNodes(child, out, duplicated);
	}
}

/** `node` and its subtree, each node that still has a stored twin given back its unknown fields. */
function graftNode<T extends LayoutNode>(node: T, stored: Map<string, Row>): T {
	const twin = stored.get(node.id);
	const own = withUnknownFields(isNodeField, twin, node) as unknown as Row;
	const next = graftListeners(own, twin) as unknown as T;
	if (next.kind !== 'container' || !Array.isArray(next.children)) return next;
	const before: LayoutNode[] = next.children;
	const children = before.map((child) => graftNode(child, stored));
	return children.some((child, i) => child !== before[i]) ? { ...next, children } : next;
}
