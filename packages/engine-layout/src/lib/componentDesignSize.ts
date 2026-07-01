/**
 * Framework-agnostic design-SIZE resolver for a {@link ComponentDef} — the union
 * bounding box of everything its `root.children` draw, in the component's own local
 * (pre-scale) space. It's the runtime + editor-shared sibling of the editor canvas's
 * `componentInstanceContentBox` (a faithful port of its union math), lifted into
 * `engine-layout` so the game runtime can cover-fit a `componentInstance` placed in a
 * `background`-space scene against the SAME extent the editor previews.
 *
 * A `ComponentDef` declares NO explicit size (its `root` container is authored bare,
 * and builtin defs size only their leaf children), so the only reliable "design size"
 * is this computed union. Because a component's content is NOT anchored-centred like a
 * sprite, the box carries `minX`/`minY` (not just `width`/`height`) — the caller needs
 * them to place the union's CENTRE on the cover target.
 *
 * Leaf intrinsic sizes (sprite texture / spine bounds) are injected via `intrinsic`,
 * so this module stays free of the loaded-asset store (runtime) and the WebGL overlay
 * (editor). A child the getter can't size yet (returns `null`, e.g. an unloaded
 * texture) is SKIPPED rather than corrupting the union — the box grows as assets
 * resolve, exactly like the sprite cover path's transient (`coverTransform` centres on
 * zero dims until then). A `rect` falls back to its declared `width`/`height`.
 */
import { resolveTransform } from './resolveTransform';
import type { ComponentDef, LayoutNode, LayoutType } from './types';

/** Independent cycle-safe recursion cap for the geometry walk (deeper than the v1
 * instance-nesting cap so a legitimately deep prefab still measures fully; the cycle
 * guard is the real safety net). */
const MAX_DESIGN_DEPTH = 6;

export interface ComponentDesignBox {
	/** Left edge of the union in the component's local space. */
	minX: number;
	/** Top edge of the union in the component's local space. */
	minY: number;
	/** Union width (`> 0`). */
	width: number;
	/** Union height (`> 0`). */
	height: number;
}

/**
 * The local-space union box of `def.root.children`. `intrinsic` returns a leaf node's
 * natural draw size (sprite/spine), or `null` when it can't be sized (unloaded). Returns
 * `null` when the def has no sizable content (empty root, or every child unsizable) — the
 * caller then falls back to a degenerate cover.
 */
export function componentDesignSize(
	def: ComponentDef,
	intrinsic: (node: LayoutNode) => { w: number; h: number } | null,
	layoutType: LayoutType,
	componentMap?: Map<string, ComponentDef>,
): ComponentDesignBox | null {
	return unionChildren(def.root.children, intrinsic, layoutType, componentMap, 0, [def.id]);
}

/** Local-space box of ONE node (before its own scale/translate) — leaf via `intrinsic`,
 * `rect` via its declared size, container/instance via a recursive union of children. */
function nodeLocalBox(
	node: LayoutNode,
	intrinsic: (node: LayoutNode) => { w: number; h: number } | null,
	layoutType: LayoutType,
	componentMap: Map<string, ComponentDef> | undefined,
	depth: number,
	stack: string[],
): { w: number; h: number; ax: number; ay: number } | null {
	const t = resolveTransform(node, layoutType);
	const ax = t.anchor?.x ?? (node.kind === 'sprite' ? 0 : 0.5);
	const ay = t.anchor?.y ?? (node.kind === 'sprite' ? 0 : 0.5);
	if (node.kind === 'sprite' || node.kind === 'spine') {
		const nat = intrinsic(node);
		const w = t.width ?? nat?.w;
		const h = t.height ?? nat?.h;
		if (w === undefined || h === undefined || !(w > 0) || !(h > 0)) return null;
		return { w, h, ax, ay };
	}
	if (node.kind === 'rect') {
		const w = t.width ?? node.width;
		const h = t.height ?? node.height;
		if (!(w > 0) || !(h > 0)) return null;
		return { w, h, ax, ay };
	}
	if (node.kind === 'container') {
		const inner = unionChildren(node.children, intrinsic, layoutType, componentMap, depth, stack);
		if (!inner) return null;
		// Express the container's own box as anchored where its origin sits inside the
		// union (so the parent places it by x/y + this anchor consistently with a leaf).
		return { w: inner.width, h: inner.height, ax: -inner.minX / inner.width, ay: -inner.minY / inner.height };
	}
	if (node.kind === 'componentInstance') {
		if (!componentMap) return null;
		const child = componentMap.get(node.componentId);
		if (!child || depth >= MAX_DESIGN_DEPTH || stack.includes(child.id)) return null;
		const inner = unionChildren(
			child.root.children,
			intrinsic,
			layoutType,
			componentMap,
			depth + 1,
			[...stack, child.id],
		);
		if (!inner) return null;
		return { w: inner.width, h: inner.height, ax: -inner.minX / inner.width, ay: -inner.minY / inner.height };
	}
	// text / reelGrid: no meaningful cover-size contribution (skip so they don't
	// corrupt the union with a placeholder box).
	return null;
}

/** Union of a child list in the PARENT's local space: each child's box placed at its
 * resolved local x/y, anchored, and scaled by its own scale — mirroring how the runtime
 * (`<Container>` per node) and the editor (`drawNode`) compose them. `null` when nothing
 * sizable. */
function unionChildren(
	children: LayoutNode[],
	intrinsic: (node: LayoutNode) => { w: number; h: number } | null,
	layoutType: LayoutType,
	componentMap: Map<string, ComponentDef> | undefined,
	depth: number,
	stack: string[],
): ComponentDesignBox | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const child of children) {
		const box = nodeLocalBox(child, intrinsic, layoutType, componentMap, depth, stack);
		if (!box) continue;
		const ct = resolveTransform(child, layoutType);
		if (ct.visible === false) continue;
		const csx = ct.scale?.x ?? 1;
		const csy = ct.scale?.y ?? 1;
		const left = ct.x - box.w * box.ax * csx;
		const top = ct.y - box.h * box.ay * csy;
		const right = left + box.w * csx;
		const bottom = top + box.h * csy;
		if (left < minX) minX = left;
		if (top < minY) minY = top;
		if (right > maxX) maxX = right;
		if (bottom > maxY) maxY = bottom;
	}
	if (minX === Infinity) return null;
	const width = maxX - minX;
	const height = maxY - minY;
	if (!(width > 0) || !(height > 0)) return null;
	return { minX, minY, width, height };
}
