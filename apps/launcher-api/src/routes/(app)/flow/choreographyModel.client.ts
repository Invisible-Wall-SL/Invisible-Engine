/**
 * Invisible Flow — micro choreography authoring model (Phase 3, design doc §5/§9).
 *
 * The MACRO graph (`flowModel.client.ts`) authors screens + transitions; this module is
 * its MICRO sibling: the per-screen enter/while/exit timeline a node opens on double-click.
 * A choreography is a {@link ChoreographyNode} TREE (the executor's closed node set —
 * sequence/parallel/broadcast/delay/branch/forEach, design doc §8); these helpers are the
 * PURE command layer over it (each returns a NEW FlowDoc, never mutates), so every edit
 * round-trips through the SAME `createFlowHistory` command stack the macro graph uses.
 *
 * Two reuse rules held here:
 *  - the node kinds map 1:1 onto the EXECUTOR's `ChoreographyNode` kinds — no new
 *    vocabulary is invented (design doc §9.A);
 *  - the tree is addressed by a stable PATH (an array of child indices from the
 *    sub-graph root), so a mutation targets one node deterministically and the command
 *    stack snapshots a clean before/after.
 *
 * A sub-graph is addressed by a {@link ChoreoTarget}: a screen phase (`enter`/`while`/
 * `exit`) or a per-event choreography (`events[]`). Both resolve to a single
 * {@link ChoreographyNode} root (a `sequence` by convention when authored fresh, so the
 * editor always has an ordered container to append into).
 */

import type {
	ChoreographyNode,
	EventChoreography,
	FlowAccessor,
	FlowDoc,
	FlowGuard,
	FlowPayload,
} from 'engine-flow';

/** The author-facing node kinds — exactly the executor's {@link ChoreographyNode} kinds. */
export type ChoreoKind = ChoreographyNode['kind'];

/** Which sub-graph a choreography edit targets. */
export type ChoreoTarget =
	| { kind: 'screen'; screenId: string; phase: 'enter' | 'while' | 'exit' }
	| { kind: 'event'; event: string };

/** A path from the sub-graph root to a node: each step is a child index (or a named branch
 *  slot for `branch`/`forEach`, encoded as `then`/`otherwise`/`body`). Root = `[]`. */
export type ChoreoPath = (number | 'then' | 'otherwise' | 'body')[];

// JSON round-trip, not `structuredClone`: choreography edits snapshot the live `$state`
// FlowDoc proxy, and `structuredClone` throws DataCloneError on a Svelte 5 proxy. The doc
// is pure JSON, so this is a faithful deep clone.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// Default node factories — each maps to one executor kind, with valid empty defaults.
// ---------------------------------------------------------------------------

const EMPTY_GUARD: FlowGuard = {
	all: [
		{ left: { kind: 'literal', value: true }, op: 'eq', right: { kind: 'literal', value: true } },
	],
};

/** Build a fresh node of `kind` with valid, normalize-surviving defaults. */
export const makeChoreoNode = (kind: ChoreoKind): ChoreographyNode => {
	switch (kind) {
		case 'sequence':
			return { kind: 'sequence', children: [] };
		case 'parallel':
			return { kind: 'parallel', children: [] };
		case 'broadcast':
			return { kind: 'broadcast', event: '' };
		case 'delay':
			return { kind: 'delay', ms: 300 };
		case 'forEach':
			return {
				kind: 'forEach',
				list: { kind: 'trigger', path: '' },
				mode: 'sequence',
				body: { kind: 'sequence', children: [] },
			};
		case 'branch':
			return {
				kind: 'branch',
				guard: clone(EMPTY_GUARD),
				then: { kind: 'sequence', children: [] },
			};
	}
};

// ---------------------------------------------------------------------------
// Sub-graph access — read/replace the root for a target on a FlowDoc.
// ---------------------------------------------------------------------------

/** Read the choreography root for a target (undefined if none authored yet). */
export const getChoreoRoot = (doc: FlowDoc, target: ChoreoTarget): ChoreographyNode | undefined => {
	if (target.kind === 'screen') {
		const screen = doc.screens.find((s) => s.id === target.screenId);
		return screen?.choreography?.[target.phase];
	}
	return doc.events?.find((e) => e.event === target.event)?.choreography;
};

/** Return a NEW doc with the choreography root for a target replaced (or cleared if
 *  `root` is `undefined`). Sparse: clearing the last phase drops the choreography object,
 *  and clearing an event drops its `events[]` entry, preserving the §7 fall-through. */
export const setChoreoRoot = (
	doc: FlowDoc,
	target: ChoreoTarget,
	root: ChoreographyNode | undefined,
): FlowDoc => {
	const next = clone(doc);
	if (target.kind === 'screen') {
		const screen = next.screens.find((s) => s.id === target.screenId);
		if (!screen) return doc;
		const choreo = { ...(screen.choreography ?? {}) };
		if (root) choreo[target.phase] = root;
		else delete choreo[target.phase];
		if (Object.keys(choreo).length > 0) screen.choreography = choreo;
		else delete screen.choreography;
		return next;
	}
	// Event target.
	const events: EventChoreography[] = next.events ? [...next.events] : [];
	const idx = events.findIndex((e) => e.event === target.event);
	if (root) {
		if (idx >= 0) events[idx] = { event: target.event, choreography: root };
		else events.push({ event: target.event, choreography: root });
	} else if (idx >= 0) {
		events.splice(idx, 1);
	}
	if (events.length > 0) next.events = events;
	else delete next.events;
	return next;
};

/** Ensure a target has a root; if absent, seed it with an empty `sequence` (the editor's
 *  default ordered container) and return the new doc. No-op if a root already exists. */
export const ensureChoreoRoot = (doc: FlowDoc, target: ChoreoTarget): FlowDoc => {
	if (getChoreoRoot(doc, target)) return doc;
	return setChoreoRoot(doc, target, { kind: 'sequence', children: [] });
};

// ---------------------------------------------------------------------------
// Path-addressed tree navigation (pure).
// ---------------------------------------------------------------------------

const childContainer = (
	node: ChoreographyNode,
	step: ChoreoPath[number],
): { get: () => ChoreographyNode | undefined; set: (n: ChoreographyNode) => void } | undefined => {
	if (typeof step === 'number') {
		if (node.kind === 'sequence' || node.kind === 'parallel') {
			return {
				get: () => node.children[step],
				set: (n) => {
					node.children[step] = n;
				},
			};
		}
		return undefined;
	}
	if (step === 'body' && node.kind === 'forEach') {
		return { get: () => node.body, set: (n) => (node.body = n) };
	}
	if (step === 'then' && node.kind === 'branch') {
		return { get: () => node.then, set: (n) => (node.then = n) };
	}
	if (step === 'otherwise' && node.kind === 'branch') {
		return { get: () => node.otherwise, set: (n) => (node.otherwise = n) };
	}
	return undefined;
};

/** Resolve a node at `path` within a (cloned) root. Returns the node or undefined. */
export const getNodeAt = (
	root: ChoreographyNode,
	path: ChoreoPath,
): ChoreographyNode | undefined => {
	let current: ChoreographyNode | undefined = root;
	for (const step of path) {
		if (!current) return undefined;
		current = childContainer(current, step)?.get();
	}
	return current;
};

/** Mutate the node at `path` in-place inside `root` via `mutate`. Returns true on success. */
const withNodeAt = (
	root: ChoreographyNode,
	path: ChoreoPath,
	mutate: (node: ChoreographyNode) => void,
): boolean => {
	const node = getNodeAt(root, path);
	if (!node) return false;
	mutate(node);
	return true;
};

// ---------------------------------------------------------------------------
// Mutations — append / remove / replace a node, edit a node's own fields.
// Each operates on a cloned root then writes it back via setChoreoRoot.
// ---------------------------------------------------------------------------

/** Append a child `kind` under the container at `parentPath` (sequence/parallel only). */
export const appendChoreoChild = (
	doc: FlowDoc,
	target: ChoreoTarget,
	parentPath: ChoreoPath,
	kind: ChoreoKind,
): FlowDoc => {
	const seeded = ensureChoreoRoot(doc, target);
	const root = clone(getChoreoRoot(seeded, target)!);
	const ok = withNodeAt(root, parentPath, (node) => {
		if (node.kind === 'sequence' || node.kind === 'parallel') {
			node.children.push(makeChoreoNode(kind));
		}
	});
	return ok ? setChoreoRoot(seeded, target, root) : doc;
};

/** Set the `body` of a `forEach`, or a `then`/`otherwise` of a `branch`, to a fresh `kind`. */
export const setChoreoSlot = (
	doc: FlowDoc,
	target: ChoreoTarget,
	parentPath: ChoreoPath,
	slot: 'body' | 'then' | 'otherwise',
	kind: ChoreoKind,
): FlowDoc => {
	const root = clone(getChoreoRoot(doc, target) ?? { kind: 'sequence', children: [] });
	const ok = withNodeAt(root, parentPath, (node) => {
		const fresh = makeChoreoNode(kind);
		if (slot === 'body' && node.kind === 'forEach') node.body = fresh;
		else if (slot === 'then' && node.kind === 'branch') node.then = fresh;
		else if (slot === 'otherwise' && node.kind === 'branch') node.otherwise = fresh;
	});
	return ok ? setChoreoRoot(doc, target, root) : doc;
};

/** Remove the node at `path`. Removing the root clears the whole sub-graph (fall-through). */
export const removeChoreoNode = (doc: FlowDoc, target: ChoreoTarget, path: ChoreoPath): FlowDoc => {
	if (path.length === 0) return setChoreoRoot(doc, target, undefined);
	const root = clone(getChoreoRoot(doc, target));
	if (!root) return doc;
	const parentPath = path.slice(0, -1);
	const last = path[path.length - 1];
	const ok = withNodeAt(root, parentPath, (parent) => {
		if (typeof last === 'number' && (parent.kind === 'sequence' || parent.kind === 'parallel')) {
			parent.children.splice(last, 1);
		} else if (last === 'otherwise' && parent.kind === 'branch') {
			delete parent.otherwise;
		}
		// `then`/`body` are required slots — removing them is handled by re-seeding, not delete.
	});
	return ok ? setChoreoRoot(doc, target, root) : doc;
};

/** The editable per-node fields surfaced in the node inspector. */
export interface ChoreoNodeEdit {
	/** broadcast: the emitter event type. */
	event?: string;
	/** broadcast: payload accessors (replaces the whole payload; empty clears it). */
	payload?: FlowPayload | null;
	/** broadcast: async / await shape (the three-way split, design doc §11.1). */
	async?: boolean;
	await?: boolean;
	/** delay: milliseconds. */
	ms?: number;
	/** forEach: the list accessor + iteration mode. */
	list?: FlowAccessor;
	mode?: 'sequence' | 'parallel';
	/** branch: the guard predicate set. */
	guard?: FlowGuard;
}

/** Edit the node at `path`'s own fields (event/ms/list/guard/…) — kind-checked per field. */
export const editChoreoNode = (
	doc: FlowDoc,
	target: ChoreoTarget,
	path: ChoreoPath,
	edit: ChoreoNodeEdit,
): FlowDoc => {
	const root = clone(getChoreoRoot(doc, target));
	if (!root) return doc;
	const ok = withNodeAt(root, path, (node) => {
		if (node.kind === 'broadcast') {
			if (typeof edit.event === 'string') node.event = edit.event;
			if (edit.payload === null) delete node.payload;
			else if (edit.payload) node.payload = edit.payload;
			if (typeof edit.async === 'boolean') node.async = edit.async;
			if (typeof edit.await === 'boolean') node.await = edit.await;
		} else if (node.kind === 'delay') {
			if (typeof edit.ms === 'number' && Number.isFinite(edit.ms)) node.ms = edit.ms;
		} else if (node.kind === 'forEach') {
			if (edit.list) node.list = edit.list;
			if (edit.mode) node.mode = edit.mode;
		} else if (node.kind === 'branch') {
			if (edit.guard) node.guard = edit.guard;
		}
	});
	return ok ? setChoreoRoot(doc, target, root) : doc;
};

// ---------------------------------------------------------------------------
// Flatten a choreography tree → xyflow nodes + edges (for the micro canvas).
// ---------------------------------------------------------------------------

/** A flattened choreography node for the micro canvas — carries its stable path + a label. */
export interface ChoreoFlatNode {
	/** Canvas node id = the path joined (root = `root`), so it is stable + addressable. */
	id: string;
	path: ChoreoPath;
	node: ChoreographyNode;
	/** Tree depth (for left-to-right layout). */
	depth: number;
	/** Sibling index within its parent slot (for vertical layout). */
	order: number;
	/** The slot label this node occupies under its parent (`then`/`otherwise`/`body`/index). */
	slotLabel?: string;
}

export interface ChoreoFlatEdge {
	id: string;
	source: string;
	target: string;
	label?: string;
}

const pathId = (path: ChoreoPath): string => (path.length === 0 ? 'root' : `n_${path.join('.')}`);

/** Flatten a choreography root into canvas nodes + edges, walking the tree depth-first.
 *  Container→child relationships become edges; branch/forEach slots are labelled. */
export const flattenChoreography = (
	root: ChoreographyNode | undefined,
): { nodes: ChoreoFlatNode[]; edges: ChoreoFlatEdge[] } => {
	const nodes: ChoreoFlatNode[] = [];
	const edges: ChoreoFlatEdge[] = [];
	if (!root) return { nodes, edges };

	const visit = (
		node: ChoreographyNode,
		path: ChoreoPath,
		depth: number,
		order: number,
		slotLabel: string | undefined,
	): void => {
		nodes.push({ id: pathId(path), path, node, depth, order, slotLabel });
		const parentId = pathId(path);

		const link = (childPath: ChoreoPath, label?: string): void => {
			edges.push({
				id: `e_${pathId(childPath)}`,
				source: parentId,
				target: pathId(childPath),
				label,
			});
		};

		if (node.kind === 'sequence' || node.kind === 'parallel') {
			node.children.forEach((child, i) => {
				const childPath = [...path, i];
				link(childPath, node.kind === 'sequence' ? `${i + 1}` : undefined);
				visit(child, childPath, depth + 1, i, undefined);
			});
		} else if (node.kind === 'forEach') {
			const childPath = [...path, 'body' as const];
			link(childPath, 'body');
			visit(node.body, childPath, depth + 1, 0, 'body');
		} else if (node.kind === 'branch') {
			const thenPath = [...path, 'then' as const];
			link(thenPath, 'then');
			visit(node.then, thenPath, depth + 1, 0, 'then');
			if (node.otherwise) {
				const elsePath = [...path, 'otherwise' as const];
				link(elsePath, 'else');
				visit(node.otherwise, elsePath, depth + 1, 1, 'otherwise');
			}
		}
	};

	visit(root, [], 0, 0, undefined);
	return { nodes, edges };
};

/** A short human summary of a choreography node (for the canvas node label). */
export const choreoNodeSummary = (node: ChoreographyNode): string => {
	switch (node.kind) {
		case 'sequence':
			return `Sequence (${node.children.length})`;
		case 'parallel':
			return `Parallel (${node.children.length})`;
		case 'broadcast': {
			const shape = node.async ? (node.await ? 'await' : 'fire') : 'sync';
			return `Broadcast: ${node.event || '…'} [${shape}]`;
		}
		case 'delay':
			return `Delay ${node.ms}ms`;
		case 'forEach':
			return `ForEach (${node.mode})`;
		case 'branch':
			return 'Branch';
	}
};
