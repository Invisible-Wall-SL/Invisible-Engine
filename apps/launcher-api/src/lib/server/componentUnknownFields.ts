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
			if (isPlainObject(row) && typeof row[id] === 'string' && !byId.has(row[id])) {
				byId.set(row[id], row);
			}
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
 * Whether `next` holds the same unknown fields as `stored`: at the top level, and on each node and
 * row `next` still has (by id; the first of a duplicated id). A stored entity `next` lacks is
 * already a known-content change when the author deleted it; when the READ dropped it (a param of
 * an unknown kind), the author changed nothing about it. The version bump compares this beside
 * the known-only content.
 */
export function sameUnknownComponentFields(next: unknown, stored: unknown): boolean {
	const mine = unknownComponentFields(next);
	return canonical(mine) === canonical(unknownComponentFields(stored, mine.ids));
}

interface UnknownProjection {
	def: Record<string, unknown>;
	nodes: Record<string, unknown>;
	rows: Record<string, Record<string, unknown>>;
	/** The node and row ids this projection covers — the scope a stored one is compared within. */
	ids: { nodes: Set<string>; rows: Record<string, Set<string>> };
}

function unknownComponentFields(doc: unknown, scope?: UnknownProjection['ids']): UnknownProjection {
	const ids: UnknownProjection['ids'] = { nodes: new Set(), rows: {} };
	const out: UnknownProjection = { def: {}, nodes: {}, rows: {}, ids };
	if (!isPlainObject(doc)) return out;
	out.def = unknownFields(isDefField, doc);
	const nodes = new Map<string, Record<string, unknown>>();
	indexNodes(doc.root, nodes);
	for (const [id, node] of nodes) {
		if (scope && !scope.nodes.has(id)) continue;
		ids.nodes.add(id);
		const extra = unknownFields(isNodeField, node);
		if (Object.keys(extra).length) setKey(out.nodes, id, extra);
	}
	for (const { field, id, isKnown } of ENTITY_ARRAYS) {
		const byRow: Record<string, unknown> = {};
		const rowIds = new Set<string>();
		for (const row of Array.isArray(doc[field]) ? doc[field] : []) {
			if (!isPlainObject(row) || typeof row[id] !== 'string') continue;
			const rowId = row[id];
			if (rowIds.has(rowId) || (scope && !scope.rows[field]?.has(rowId))) continue;
			rowIds.add(rowId);
			const extra = unknownFields(isKnown, row);
			if (Object.keys(extra).length) setKey(byRow, rowId, extra);
		}
		out.rows[field] = byRow;
		ids.rows[field] = rowIds;
	}
	return out;
}

/** JSON with object keys sorted, so key order never reads as a change (the id scope left out). */
function canonical({ ids: _ids, ...value }: UnknownProjection): string {
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
