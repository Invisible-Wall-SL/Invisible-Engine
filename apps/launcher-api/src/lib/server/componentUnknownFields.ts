import type { ComponentDef, LayoutNode } from 'engine-layout';
import {
	COMPONENT_DEF_FIELDS,
	COMPONENT_INPUT_FIELDS,
	COMPONENT_INPUT_KINDS,
	COMPONENT_PARAM_FIELDS,
	COMPONENT_SIGNAL_FIELDS,
	LAYOUT_NODE_FIELDS,
	SM_LAYER_FIELDS,
	SM_STATE_FIELDS,
	SM_TRANSITION_FIELDS,
	STATE_MACHINE_FIELDS,
	TEMPLATE_SLOT_FIELDS,
} from 'engine-layout';
import { isPlainObject, setKey } from './stripUnknownKeys';
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

/** The def's id-keyed rows, which a normalizer rebuilds field by field. */
const ROW_ARRAYS = [
	{ field: 'params', id: 'key', isKnown: known(COMPONENT_PARAM_FIELDS) },
	{ field: 'signals', id: 'key', isKnown: known(COMPONENT_SIGNAL_FIELDS) },
	{ field: 'slots', id: 'slotId', isKnown: known(TEMPLATE_SLOT_FIELDS) },
	{ field: 'inputs', id: 'id', isKnown: known(COMPONENT_INPUT_FIELDS) },
] as const;
/** The rows of one state-machine layer, matched by id within that layer. */
const LAYER_ARRAYS = [
	{ field: 'states', isKnown: known(SM_STATE_FIELDS) },
	{ field: 'transitions', isKnown: known(SM_TRANSITION_FIELDS) },
] as const;

/**
 * `next` (an author's normalized save) with what a NEWER launcher wrote into `stored` that this
 * build does not know (`docs/conventions/doc-readers.md`, "Round-tripping"):
 *
 * - every unknown top-level field of the def, and of `stateMachine` (a fixed namespace, kept also
 *   when the author removed every layer, like a win-text family);
 * - inside each ENTITY the author kept, matched to its stored copy by id: the unknown fields of a
 *   node anywhere under `root` (the root included), of a param, signal, slot or input, and of a
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
	indexNodes(stored.root, storedNodes);
	set('root', graftNode(next.root, storedNodes), next.root);

	for (const { field, id, isKnown } of ROW_ARRAYS) {
		const rows = next[field] as Row[] | undefined;
		const merged = rows ? graftRows(rows, stored[field], id, isKnown) : rows;
		set(field, field === 'inputs' ? withUnreadableInputs(merged, stored.inputs) : merged, rows);
	}

	const machine = graftStateMachine(next.stateMachine as Row | undefined, stored.stateMachine);
	set('stateMachine', machine, next.stateMachine);

	const blocks = Object.entries(unknownFields(isDefField, stored)).filter(
		([key]) => !Object.hasOwn(out, key),
	);
	for (const [key, value] of blocks) setKey(out, key, value);
	if (blocks.length) grafted = true;

	return grafted ? (out as unknown as ComponentDef) : next;
}

/** `rows` with each row that has a stored twin (same `id`, first of a duplicate) given back its
 *  unknown fields, then `inner` applied to the pair. `rows` itself when nothing changed. */
function graftRows(
	rows: Row[],
	stored: unknown,
	id: string,
	isKnown: IsKnown,
	inner?: (row: Row, stored: Row) => Row,
): Row[] {
	const byId = rowsById(stored, id);
	let changed = false;
	const merged = rows.map((row) => {
		const twin = typeof row[id] === 'string' ? byId.get(row[id]) : undefined;
		if (!twin) return row;
		const own = withUnknownFields(isKnown, twin, row);
		const kept = inner ? inner(own, twin) : own;
		if (kept !== row) changed = true;
		return kept;
	});
	return changed ? merged : rows;
}

function rowsById(stored: unknown, id: string): Map<string, Row> {
	const byId = new Map<string, Row>();
	for (const row of Array.isArray(stored) ? stored : []) {
		if (isPlainObject(row) && typeof row[id] === 'string' && !byId.has(row[id])) {
			byId.set(row[id], row);
		}
	}
	return byId;
}

/**
 * `inputs` with every stored row of an unknown `kind` that it lacks put back where it stood: after
 * the nearest stored row before it that is still there, else first. Its fields are never
 * re-normalized, so a newer value inside it cannot fail a save.
 */
function withUnreadableInputs(inputs: Row[] | undefined, stored: unknown): Row[] | undefined {
	if (!Array.isArray(stored)) return inputs;
	const out = [...(inputs ?? [])];
	let added = false;
	let anchor = -1;
	for (const row of stored as unknown[]) {
		if (!isPlainObject(row) || typeof row.id !== 'string') continue;
		const at = out.findIndex((kept) => kept.id === row.id);
		if (at !== -1) {
			anchor = at;
			continue;
		}
		if (typeof row.kind !== 'string' || INPUT_KINDS.has(row.kind)) continue;
		out.splice(++anchor, 0, row);
		added = true;
	}
	return added ? out : inputs;
}

function graftStateMachine(next: Row | undefined, stored: unknown): Row | undefined {
	if (!isPlainObject(stored)) return next;
	const layers = next?.layers as Row[] | undefined;
	const merged = layers ? graftRows(layers, stored.layers, 'id', isLayerField, graftLayer) : layers;
	const extra = Object.entries(unknownFields(isStateMachineField, stored)).filter(
		([key]) => !next || !Object.hasOwn(next, key),
	);
	if (merged === layers && !extra.length) return next;
	const out: Row = next ? { ...next, layers: merged } : {};
	for (const [key, value] of extra) setKey(out, key, value);
	return out;
}

function graftLayer(layer: Row, stored: Row): Row {
	let out = layer;
	for (const { field, isKnown } of LAYER_ARRAYS) {
		const rows = layer[field];
		if (!Array.isArray(rows)) continue;
		const merged = graftRows(rows as Row[], stored[field], 'id', isKnown);
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
		if (!mine.has(key) && key !== 'def' && key !== 'stateMachine') theirs.delete(key);
	}
	return canonical(mine) === canonical(theirs);
}

/** Every entity of a def, keyed `<kind>:<id>` (states and transitions under their layer), mapped
 *  to its unknown fields. The first of a duplicated key wins. */
function unknownComponentFields(doc: unknown): Map<string, Row> {
	const out = new Map<string, Row>();
	const add = (key: string, value: unknown, isKnown: IsKnown): void => {
		if (!out.has(key)) out.set(key, unknownFields(isKnown, value));
	};
	if (!isPlainObject(doc)) return out;
	add('def', doc, isDefField);
	const nodes = new Map<string, Row>();
	indexNodes(doc.root, nodes);
	for (const [id, node] of nodes) add(`node:${id}`, node, isNodeField);
	for (const { field, id, isKnown } of ROW_ARRAYS) {
		for (const [rowId, row] of rowsById(doc[field], id)) add(`${field}:${rowId}`, row, isKnown);
	}
	const machine = doc.stateMachine;
	if (isPlainObject(machine)) {
		add('stateMachine', machine, isStateMachineField);
		for (const [layerId, layer] of rowsById(machine.layers, 'id')) {
			add(`layer:${layerId}`, layer, isLayerField);
			for (const { field, isKnown } of LAYER_ARRAYS) {
				for (const [rowId, row] of rowsById(layer[field], 'id')) {
					add(`${field}:${layerId}/${rowId}`, row, isKnown);
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

function indexNodes(node: unknown, out: Map<string, Row>): void {
	if (!isPlainObject(node)) return;
	if (typeof node.id === 'string' && !out.has(node.id)) out.set(node.id, node);
	if (Array.isArray(node.children)) for (const child of node.children) indexNodes(child, out);
}

/** `node` and its subtree, each node that still has a stored twin given back its unknown fields. */
function graftNode<T extends LayoutNode>(node: T, stored: Map<string, Row>): T {
	const next = withUnknownFields(isNodeField, stored.get(node.id), node);
	if (next.kind !== 'container' || !Array.isArray(next.children)) return next;
	const before: LayoutNode[] = next.children;
	const children = before.map((child) => graftNode(child, stored));
	return children.some((child, i) => child !== before[i]) ? { ...next, children } : next;
}
