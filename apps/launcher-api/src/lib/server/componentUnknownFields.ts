import type { ComponentDef, LayoutNode } from 'engine-layout';
import {
	COMPONENT_DEF_FIELDS,
	COMPONENT_PARAM_FIELDS,
	COMPONENT_SIGNAL_FIELDS,
	LAYOUT_NODE_FIELDS,
	TEMPLATE_SLOT_FIELDS,
} from 'engine-layout';
import { isPlainObject, setKey } from './stripUnknownKeys';
import { unknownFields, withUnknownFields } from './unknownBlocks';

const known =
	(set: ReadonlySet<string>) =>
	(key: string): boolean =>
		set.has(key);
const isDefField = known(COMPONENT_DEF_FIELDS);
const isNodeField = known(LAYOUT_NODE_FIELDS);

/** The id-keyed entity arrays of a def whose rows a normalizer rebuilds field by field. */
const ENTITY_ARRAYS = [
	{ field: 'params', id: 'key', isKnown: known(COMPONENT_PARAM_FIELDS) },
	{ field: 'signals', id: 'key', isKnown: known(COMPONENT_SIGNAL_FIELDS) },
	{ field: 'slots', id: 'slotId', isKnown: known(TEMPLATE_SLOT_FIELDS) },
] as const;

/**
 * `next` (an author's normalized save) with what a NEWER launcher wrote into `stored` that this
 * build does not know (`docs/conventions/doc-readers.md`, "Round-tripping"):
 *
 * - every unknown top-level field of the def;
 * - inside each ENTITY the author kept, matched to its stored copy by id: the unknown fields of a
 *   node anywhere under `root` (the root included), of a param, a signal or a slot.
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
	const out: Record<string, unknown> = { ...next };
	let grafted = false;

	const storedNodes = new Map<string, Record<string, unknown>>();
	indexNodes(stored.root, storedNodes);
	const root = graftNode(next.root, storedNodes);
	if (root !== next.root) {
		out.root = root;
		grafted = true;
	}

	for (const { field, id, isKnown } of ENTITY_ARRAYS) {
		const rows = next[field];
		if (!rows) continue;
		const byId = new Map<unknown, unknown>();
		for (const row of Array.isArray(stored[field]) ? stored[field] : []) {
			if (isPlainObject(row) && !byId.has(row[id])) byId.set(row[id], row);
		}
		let changed = false;
		const merged = rows.map((row: object) => {
			const rowId = (row as Record<string, unknown>)[id];
			const kept = withUnknownFields(isKnown, byId.get(rowId), row);
			if (kept !== row) changed = true;
			return kept;
		});
		if (changed) {
			out[field] = merged;
			grafted = true;
		}
	}

	const blocks = Object.entries(unknownFields(isDefField, stored)).filter(
		([key]) => !Object.hasOwn(out, key),
	);
	for (const [key, value] of blocks) setKey(out, key, value);
	if (blocks.length) grafted = true;

	return grafted ? (out as unknown as ComponentDef) : next;
}

/**
 * Whether `a` and `b` hold the same unknown fields: at the top level, on each node by id, and on
 * each row by id. The version bump compares this beside the known-only content.
 */
export function sameUnknownComponentFields(a: unknown, b: unknown): boolean {
	return canonical(unknownComponentFields(a)) === canonical(unknownComponentFields(b));
}

function unknownComponentFields(doc: unknown): Record<string, unknown> {
	if (!isPlainObject(doc)) return {};
	const out: Record<string, unknown> = { def: unknownFields(isDefField, doc) };
	const nodes = new Map<string, Record<string, unknown>>();
	indexNodes(doc.root, nodes);
	const byNode: Record<string, unknown> = {};
	for (const [id, node] of nodes) {
		const extra = unknownFields(isNodeField, node);
		if (Object.keys(extra).length) setKey(byNode, id, extra);
	}
	out.nodes = byNode;
	for (const { field, id, isKnown } of ENTITY_ARRAYS) {
		const byRow: Record<string, unknown> = {};
		for (const row of Array.isArray(doc[field]) ? doc[field] : []) {
			const extra = unknownFields(isKnown, row);
			if (isPlainObject(row) && Object.keys(extra).length) setKey(byRow, String(row[id]), extra);
		}
		out[field] = byRow;
	}
	return out;
}

/** JSON with object keys sorted, so key order never reads as a change. */
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) =>
		isPlainObject(v)
			? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
			: v,
	);
}

function indexNodes(node: unknown, out: Map<string, Record<string, unknown>>): void {
	if (!isPlainObject(node)) return;
	if (typeof node.id === 'string' && !out.has(node.id)) out.set(node.id, node);
	if (Array.isArray(node.children)) for (const child of node.children) indexNodes(child, out);
}

/** `node` and its subtree, each node that still has a stored twin given back its unknown fields. */
function graftNode<T extends LayoutNode>(node: T, stored: Map<string, Record<string, unknown>>): T {
	const next = withUnknownFields(isNodeField, stored.get(node.id), node);
	if (next.kind !== 'container' || !Array.isArray(next.children)) return next;
	const before: LayoutNode[] = next.children;
	const children = before.map((child) => graftNode(child, stored));
	return children.some((child, i) => child !== before[i]) ? { ...next, children } : next;
}
