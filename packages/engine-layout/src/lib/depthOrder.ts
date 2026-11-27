import type { Container } from 'pixi.js';

/**
 * A DRAW ORDER BY DEPTH THAT SORTS ONLY WHEN IT CHANGES: a projected world's spawned instances
 * (`<SpawnLayer>`, ground-depth order) move every frame, and a `zIndex` set to a new value makes
 * Pixi sort the parent and rebuild its render group's draw list, even when nothing changed place.
 *
 * {@link setDepth} keeps each child's depth and sets its `zIndex` only when it is out of the
 * parent's container or a sort is due. Before every sort of the parent (Pixi's, or one asked for
 * by a mount) each child is given its depth as its `zIndex`, so the sort sees the depths as if they
 * had been set all along; and before each render the parent is sorted if its children are no
 * longer in depth order. A stable sort of children already in order leaves them as they are, so the
 * order drawn is the one setting the `zIndex` every frame gave, ties included.
 */

const depths = new WeakMap<Container, number>();
const kept = new WeakSet<Container>();

/** Each child given its depth as its `zIndex`: through its setter, which asks the parent for a
 *  sort (and its render group for a new draw list) if one changed; or, `quiet`, for a sort already
 *  under way, whose draw list is being built or already asked for. */
const flush = (parent: Container, quiet = false) => {
	for (const child of parent.children) {
		const depth = depths.get(child);
		if (depth === undefined) continue;
		if (quiet) child._zIndex = depth;
		else child.zIndex = depth;
	}
};

/** Whether `parent`'s children are in order by their depths (a child without one, its zIndex). */
const inOrder = (parent: Container) => {
	let last = -Infinity;
	for (const child of parent.children) {
		const depth = depths.get(child) ?? child.zIndex;
		if (depth < last) return false;
		last = depth;
	}
	return true;
};

function keep(parent: Container) {
	if (kept.has(parent)) return;
	kept.add(parent);
	const sort = parent.sortChildren;
	parent.sortChildren = () => {
		if (parent.sortDirty) flush(parent, true);
		sort.call(parent);
	};
	const before = parent.onRender;
	parent.onRender = (renderer) => {
		before?.(renderer);
		if (!parent.sortDirty && !inOrder(parent)) flush(parent);
	};
}

/** Draw `child` at `depth` among its parent's children (a zIndex, set only when it must be). */
export function setDepth(child: Container, depth: number): void {
	depths.set(child, depth);
	const parent = child.parent;
	if (!parent) {
		child.zIndex = depth;
		return;
	}
	keep(parent);
	if (parent.sortDirty) child.zIndex = depth;
}
