import {
	MAX_COMPONENT_DEPTH,
	resolveTransform,
	type ComponentDef,
	type LayoutNode,
	type LayoutType,
	type ResolvedTransform,
} from 'engine-layout';

export interface Vec2 {
	x: number;
	y: number;
}

export interface NodeBox {
	/** Untransformed local-space rect (before scale/rotation/translate). */
	w: number;
	h: number;
	ax: number;
	ay: number;
}

/** Resolve a sensible local-space box for any node kind. */
export function nodeBox(
	node: LayoutNode,
	t: ResolvedTransform,
	naturalSize: (node: LayoutNode) => { w: number; h: number } | null,
	componentMap?: Map<string, ComponentDef>,
	layoutType?: LayoutType,
): NodeBox {
	const ax = t.anchor?.x ?? (node.kind === 'sprite' ? 0 : 0.5);
	const ay = t.anchor?.y ?? (node.kind === 'sprite' ? 0 : 0.5);
	// A componentInstance DRAWS its def's content (drawComponentInstance expands
	// `def.root.children`), so the selection box must frame that content — not the
	// generic placeholder size — or the rect offsets/mismatches the drawn chip. Return
	// the union bounding box of the def's children in the instance's local space (each
	// child's own box, offset by its local x/y + anchored). For the single-mount
	// `HudReadout` this is the mount's `preview` box (240×135) at the instance anchor.
	if (node.kind === 'componentInstance' && componentMap && layoutType !== undefined) {
		const content = componentInstanceContentBox(
			node,
			naturalSize,
			componentMap,
			layoutType,
			0,
			[],
		);
		if (content) return content;
	}
	// A preview-art anchor selects at the RENDERED art's box. The art may be an
	// explicit `node.preview.art` OR a catalog default resolved live (no baked
	// `preview.art`): in both cases EditorCanvas bakes the fit size into the resolved
	// transform's width/height, so honour those for any `bind` container too. Falls
	// back to the art's natural size (via naturalSize) when no size is baked.
	if (node.preview?.art || (node.bind && (t.width !== undefined || t.height !== undefined))) {
		const nat = naturalSize(node);
		const w = t.width ?? nat?.w ?? 160;
		const h = t.height ?? nat?.h ?? 100;
		return { w, h, ax, ay };
	}
	// HUD preview chips select at their drawn size (w/h are optional → defaulted).
	if (node.preview) return { w: node.preview.w ?? 160, h: node.preview.h ?? 100, ax, ay };
	if (node.kind === 'sprite') {
		const nat = naturalSize(node);
		const w = t.width ?? nat?.w ?? 100;
		const h = t.height ?? nat?.h ?? 100;
		return { w, h, ax, ay };
	}
	if (node.kind === 'spine') {
		return { w: t.width ?? 160, h: t.height ?? 100, ax, ay };
	}
	if (node.kind === 'text') {
		return { w: 160, h: 28, ax, ay };
	}
	// Reel grid selects at its full footprint: reels × rows cells of cellSize.
	if (node.kind === 'reelGrid') {
		return {
			w: Math.max(1, Math.round(node.reels)) * node.cellSize,
			h: Math.max(1, Math.round(node.rows)) * node.cellSize,
			ax,
			ay,
		};
	}
	return { w: 160, h: 100, ax, ay };
}

/**
 * Local-space content box of a `componentInstance` — the union, in the instance's
 * own pre-scale space, of every box its `def.root.children` draw (mirroring
 * {@link drawComponentInstance}, which expands those children directly under the
 * instance transform). Each child contributes its own {@link nodeBox} placed at its
 * resolved local x/y + anchor; a nested instance recurses. Returns `null` when the
 * def is missing or a depth/cycle guard trips (caller keeps its default), or when the
 * def has no children. The result is expressed as a top-left-anchored box (ax=ay=0)
 * around the union so `nodeCornersWorld` frames the real drawn extent at the instance.
 */
function componentInstanceContentBox(
	node: Extract<LayoutNode, { kind: 'componentInstance' }>,
	naturalSize: (node: LayoutNode) => { w: number; h: number } | null,
	componentMap: Map<string, ComponentDef>,
	layoutType: LayoutType,
	depth: number,
	stack: string[],
): NodeBox | null {
	const def = componentMap.get(node.componentId);
	if (!def) return null;
	if (depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) return null;
	const childStack = [...stack, def.id];

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const child of def.root.children) {
		const ct = resolveTransform(child, layoutType);
		const cb =
			child.kind === 'componentInstance'
				? (componentInstanceContentBox(
						child,
						naturalSize,
						componentMap,
						layoutType,
						depth + 1,
						childStack,
					) ?? nodeBox(child, ct, naturalSize, componentMap, layoutType))
				: nodeBox(child, ct, naturalSize, componentMap, layoutType);
		// The child's box (already including its anchor) is placed at its local x/y and
		// scaled by its own scale — match drawNode's transform so the union frames the
		// drawn art. Rotation is ignored here (HUD content is axis-aligned); the union is
		// an axis-aligned envelope, which the instance transform then scales/rotates.
		const csx = ct.scale?.x ?? 1;
		const csy = ct.scale?.y ?? 1;
		const left = ct.x - cb.w * cb.ax * csx;
		const top = ct.y - cb.h * cb.ay * csy;
		const right = left + cb.w * csx;
		const bottom = top + cb.h * csy;
		if (left < minX) minX = left;
		if (top < minY) minY = top;
		if (right > maxX) maxX = right;
		if (bottom > maxY) maxY = bottom;
	}
	if (minX === Infinity) return null;
	// Express the union as a TL-anchored box (ax/ay encode where the instance origin sits
	// inside it) so nodeCornersWorld(instanceTransform, box) lands the rect on the union.
	const w = maxX - minX;
	const h = maxY - minY;
	if (w <= 0 || h <= 0) return null;
	return { w, h, ax: -minX / w, ay: -minY / h };
}

/** Compute the 4 world-space corners (TL, TR, BR, BL) of a node's box. */
export function nodeCornersWorld(t: ResolvedTransform, box: NodeBox): [Vec2, Vec2, Vec2, Vec2] {
	const sx = t.scale?.x ?? 1;
	const sy = t.scale?.y ?? 1;
	const rot = t.rotation ?? 0;
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	const left = -box.w * box.ax * sx;
	const top = -box.h * box.ay * sy;
	const right = left + box.w * sx;
	const bottom = top + box.h * sy;
	const local: Vec2[] = [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: right, y: bottom },
		{ x: left, y: bottom },
	];
	return local.map((p) => ({
		x: t.x + p.x * cos - p.y * sin,
		y: t.y + p.x * sin + p.y * cos,
	})) as [Vec2, Vec2, Vec2, Vec2];
}

/** Top-edge midpoint in world space, used to anchor the rotation handle. */
export function topMidWorld(t: ResolvedTransform, box: NodeBox): Vec2 {
	const sx = t.scale?.x ?? 1;
	const sy = t.scale?.y ?? 1;
	const rot = t.rotation ?? 0;
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	const cxLocal = -box.w * box.ax * sx + (box.w * sx) / 2;
	const cyLocal = -box.h * box.ay * sy;
	return {
		x: t.x + cxLocal * cos - cyLocal * sin,
		y: t.y + cxLocal * sin + cyLocal * cos,
	};
}

/** Point-in-quad via per-edge cross-product sign (works for convex quads). */
export function pointInQuad(p: Vec2, quad: [Vec2, Vec2, Vec2, Vec2]): boolean {
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
		if (cross === 0) continue;
		const s = cross > 0 ? 1 : -1;
		if (sign === 0) sign = s;
		else if (sign !== s) return false;
	}
	return true;
}

/** Axis-aligned screen-space bounding box of 4 world points, expanded by pad. */
export function expandedAABBContains(p: Vec2, pts: Vec2[], pad: number): boolean {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const q of pts) {
		if (q.x < minX) minX = q.x;
		if (q.y < minY) minY = q.y;
		if (q.x > maxX) maxX = q.x;
		if (q.y > maxY) maxY = q.y;
	}
	return p.x >= minX - pad && p.x <= maxX + pad && p.y >= minY - pad && p.y <= maxY + pad;
}
