/**
 * Pure tree / id helpers shared by the editor-family tools (Scene Editor,
 * Component Editor). These walk a `LayoutNode[]` (a scene's `nodes` or a
 * component root's `children`) and never touch reactive state — the per-page
 * callers own the actual mutation (scene array vs `componentDraft.root.children`).
 */
import type { LayoutNode } from 'engine-layout';

/** A fresh component id (`c_…`). */
export function genComponentId(): string {
	return 'c_' + Math.random().toString(36).slice(2, 10);
}

/** Find a node by id anywhere in the tree (depth-first), or `null`. */
export function findById(nodes: LayoutNode[], id: string): LayoutNode | null {
	for (const n of nodes) {
		if (n.id === id) return n;
		if (n.kind === 'container') {
			const found = findById(n.children, id);
			if (found) return found;
		}
	}
	return null;
}

/** Remove a node by id (mutating the array in place); `true` if it was found. */
export function removeNode(nodes: LayoutNode[], id: string): boolean {
	const i = nodes.findIndex((n) => n.id === id);
	if (i !== -1) {
		nodes.splice(i, 1);
		return true;
	}
	for (const n of nodes) {
		if (n.kind === 'container' && removeNode(n.children, id)) return true;
	}
	return false;
}

/** Pre-order (depth-first) ids of a tree — the order the outliner shows rows, so
 * a Shift range-select matches what the user sees. */
export function flattenSceneIds(nodes: LayoutNode[], out: string[] = []): string[] {
	for (const n of nodes) {
		out.push(n.id);
		if (n.kind === 'container') flattenSceneIds(n.children, out);
	}
	return out;
}
