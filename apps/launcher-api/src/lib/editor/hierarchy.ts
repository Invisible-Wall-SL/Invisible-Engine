/**
 * The Outline's tree operations (Rive plan Phase 9a): walk to a parent or first child, reorder and
 * re-parent by drag, and the editor-only Hide / Isolate view. Pure: every function reads a
 * `LayoutNode[]` (a scene's `nodes` or a component's edited children), and only {@link moveNode}
 * mutates it — the host owns the reassign + markDirty.
 *
 * Hide and Isolate never touch a node: {@link effectiveHiddenIds} returns the ids the STAGE skips,
 * which the editor keeps in memory (`setViewHidden`) and never writes into the doc, so a hidden
 * node still saves, bakes and plays with its authored `visible`. `check:editor-hierarchy` holds it.
 */
import type { LayoutNode } from 'engine-layout';

/** Where a dragged row lands relative to the row it is dropped on. */
export type DropZone = 'before' | 'after' | 'inside';

interface Located {
	siblings: LayoutNode[];
	index: number;
	parent: LayoutNode | null;
}

function locate(nodes: LayoutNode[], id: string, parent: LayoutNode | null = null): Located | null {
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (n.id === id) return { siblings: nodes, index: i, parent };
		if (n.kind === 'container') {
			const found = locate(n.children, id, n);
			if (found) return found;
		}
	}
	return null;
}

function childrenOf(node: LayoutNode): LayoutNode[] {
	return node.kind === 'container' ? node.children : [];
}

function eachInSubtree(node: LayoutNode, visit: (n: LayoutNode) => void): void {
	visit(node);
	for (const c of childrenOf(node)) eachInSubtree(c, visit);
}

/** The ids above `id`, outermost first; `null` when `id` is not in the tree. */
export function ancestorIds(nodes: LayoutNode[], id: string): string[] | null {
	for (const n of nodes) {
		if (n.id === id) return [];
		const below = ancestorIds(childrenOf(n), id);
		if (below) return [n.id, ...below];
	}
	return null;
}

/** `Esc`: the node's container, or `null` at the top level (or when `id` is unknown). */
export function parentIdOf(nodes: LayoutNode[], id: string): string | null {
	return locate(nodes, id)?.parent?.id ?? null;
}

/** `Enter`: a container's first child, or `null` for a leaf or an empty container. */
export function firstChildIdOf(nodes: LayoutNode[], id: string): string | null {
	const found = locate(nodes, id);
	return found ? (childrenOf(found.siblings[found.index])[0]?.id ?? null) : null;
}

/** Lock applies to children: a node is locked when it, or any container above it, is. */
export function lockedInTree(nodes: LayoutNode[], id: string, underLocked = false): boolean {
	for (const n of nodes) {
		const locked = underLocked || n.locked === true;
		if (n.id === id) return locked;
		if (n.kind === 'container' && ancestorIds(n.children, id))
			return lockedInTree(n.children, id, locked);
	}
	return false;
}

/** The zone a pointer `offsetY` px into a row `height` px tall picks: a container's middle half
 *  drops inside it, otherwise the top half goes before and the bottom half after. */
export function dropZoneAt(offsetY: number, height: number, isContainer: boolean): DropZone {
	const f = height > 0 ? offsetY / height : 0;
	if (isContainer && f > 0.25 && f < 0.75) return 'inside';
	return f < 0.5 ? 'before' : 'after';
}

/**
 * A drop is refused onto itself, into its own subtree, `inside` anything but a container, and
 * wherever Lock forbids it: a locked node (or one under a locked container) never moves, and
 * nothing lands in a locked container. A slot-filling or engine-bound node stays at the top level,
 * where the editor and the game look it up.
 */
export function canDrop(
	nodes: LayoutNode[],
	dragId: string,
	overId: string,
	zone: DropZone,
): boolean {
	if (dragId === overId) return false;
	const drag = locate(nodes, dragId);
	const over = locate(nodes, overId);
	if (!drag || !over) return false;
	const target = over.siblings[over.index];
	if (zone === 'inside' && target.kind !== 'container') return false;
	if ((ancestorIds(nodes, overId) ?? []).includes(dragId)) return false;
	if (lockedInTree(nodes, dragId)) return false;
	const into = zone === 'inside' ? target : over.parent;
	if (into && lockedInTree(nodes, into.id)) return false;
	const node = drag.siblings[drag.index];
	return !(into && (node.slotId !== undefined || node.bind !== undefined));
}

/**
 * Move `dragId` before / after `overId` among its siblings, or `inside` it as the LAST child (the
 * top of its paint order: rows paint top-down, so the last row draws over the rest). The node keeps
 * its own local x/y, so a re-parented node moves with its new container. Returns `false` (and
 * changes nothing) when {@link canDrop} refuses or the node would land where it already is.
 */
export function moveNode(
	nodes: LayoutNode[],
	dragId: string,
	overId: string,
	zone: DropZone,
): boolean {
	if (!canDrop(nodes, dragId, overId, zone)) return false;
	const from = locate(nodes, dragId)!;
	const before = { siblings: from.siblings, index: from.index };
	const [node] = from.siblings.splice(from.index, 1);
	const over = locate(nodes, overId)!;
	let siblings: LayoutNode[];
	let index: number;
	if (zone === 'inside') {
		siblings = childrenOf(over.siblings[over.index]);
		index = siblings.length;
	} else {
		siblings = over.siblings;
		index = zone === 'before' ? over.index : over.index + 1;
	}
	siblings.splice(index, 0, node);
	return !(siblings === before.siblings && index === before.index);
}

/**
 * The ids the stage skips: every explicitly hidden node and everything under it, and — while
 * `isolatedId` names a node in this tree — everything except that node's subtree and the
 * containers holding it. An unknown `isolatedId` (a node on another screen, or deleted) isolates
 * nothing. Reads only; the nodes are never changed.
 */
export function effectiveHiddenIds(
	nodes: LayoutNode[],
	hidden: ReadonlySet<string>,
	isolatedId: string | null,
): Set<string> {
	const out = new Set<string>();
	const walk = (list: LayoutNode[], underHidden: boolean): void => {
		for (const n of list) {
			const isHidden = underHidden || hidden.has(n.id);
			if (isHidden) out.add(n.id);
			walk(childrenOf(n), isHidden);
		}
	};
	walk(nodes, false);
	const chain = isolatedId === null ? null : ancestorIds(nodes, isolatedId);
	if (chain && isolatedId !== null) {
		const keep = new Set(chain);
		const iso = locate(nodes, isolatedId)!;
		eachInSubtree(iso.siblings[iso.index], (n) => keep.add(n.id));
		const all = (list: LayoutNode[]): void => {
			for (const n of list) {
				if (!keep.has(n.id)) out.add(n.id);
				all(childrenOf(n));
			}
		};
		all(nodes);
	}
	return out;
}
