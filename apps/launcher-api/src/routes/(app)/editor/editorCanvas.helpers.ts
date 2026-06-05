import type { LayoutNode, ResolvedTransform } from 'engine-layout';

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
): NodeBox {
	const ax = t.anchor?.x ?? (node.kind === 'sprite' ? 0 : 0.5);
	const ay = t.anchor?.y ?? (node.kind === 'sprite' ? 0 : 0.5);
	// `preview.art` anchors select at the rendered art's box: the cover transform
	// bakes width/height; else use the art's natural size (resolved via naturalSize).
	if (node.preview?.art) {
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
	return { w: 160, h: 100, ax, ay };
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
