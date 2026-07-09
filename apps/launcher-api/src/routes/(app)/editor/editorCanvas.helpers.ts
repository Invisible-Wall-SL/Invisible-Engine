import {
	MAX_COMPONENT_DEPTH,
	resolveTransform,
	type ComponentDef,
	type LayoutNode,
	type LayoutType,
	type ResolvedTransform,
	type Scene,
} from 'engine-layout';

export interface Vec2 {
	x: number;
	y: number;
}

/**
 * A 2D affine matrix `[a, b, c, d, tx, ty]` in the SAME column convention the 2D
 * canvas uses, so a point `(x, y)` maps to `(a·x + c·y + tx, b·x + d·y + ty)`.
 * This is exactly what a `CanvasRenderingContext2D` accumulates, and what PIXI's
 * `Matrix` / `Container.setFromMatrix` consume — so the editor's 2D canvas and the
 * PIXI text overlay compose nested transforms through ONE definition.
 */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY_AFFINE: Affine = [1, 0, 0, 1, 0, 0];

/**
 * The affine matrix a `ResolvedTransform` represents — byte-equivalent to
 * `ctx.translate(t.x, t.y); ctx.rotate(t.rotation); ctx.scale(sx, sy)` (the EXACT
 * sequence {@link drawNode} runs). `ctx` post-multiplies its current matrix by this
 * `T·R·S`, so folding {@link matMul} over a node's ancestor chain reproduces the
 * canvas's world matrix for any nested node. Anchor is NOT folded in here: it is a
 * per-leaf local offset the renderer (sprite/text) applies on top, exactly as the
 * canvas + runtime do.
 */
export function matFromTransform(t: ResolvedTransform): Affine {
	const sx = t.scale?.x ?? 1;
	const sy = t.scale?.y ?? 1;
	const rot = t.rotation ?? 0;
	const cos = Math.cos(rot);
	const sin = Math.sin(rot);
	// T(x,y) · R(rot) · S(sx,sy)
	return [cos * sx, sin * sx, -sin * sy, cos * sy, t.x, t.y];
}

/** Matrix product `m · n` (apply `n` first, then `m`) — same convention as `ctx`. */
export function matMul(m: Affine, n: Affine): Affine {
	const [a, b, c, d, e, f] = m;
	const [a2, b2, c2, d2, e2, f2] = n;
	return [
		a * a2 + c * b2,
		b * a2 + d * b2,
		a * c2 + c * d2,
		b * c2 + d * d2,
		a * e2 + c * f2 + e,
		b * e2 + d * f2 + f,
	];
}

/**
 * The LOCAL transform of a NESTED node (one with a parent in the doc tree), in its
 * parent's space — i.e. NO scene-space framing (`mainToWorld`/`mainScale`, background
 * cover, standard fit). It mirrors `<LayoutNodeView>` for a child inside a container:
 * raw {@link resolveTransform}, with `screenAnchor` folded into x/y only for a
 * `canvas`-space scene (the parent chain already carries every framing transform once,
 * exactly like the single root `<MainContainer>`). This is what lets the overlay +
 * canvas + runtime compose nested nodes identically: framing is applied ONCE at the
 * top-level node (the canvas's `nodeTransform`), children compose in pure local space.
 */
export function childLocalTransform(
	node: LayoutNode,
	layoutType: LayoutType,
	space: Scene['space'],
	frameWidth: number,
	frameHeight: number,
): ResolvedTransform {
	const t = resolveTransform(node, layoutType);
	if (space === 'canvas' && t.screenAnchor) {
		return {
			...t,
			x: t.screenAnchor.x * frameWidth + t.x,
			y: t.screenAnchor.y * frameHeight + t.y,
		};
	}
	return t;
}

/**
 * The WORLD matrix of a nested node, composed from its ancestor chain the SAME way
 * the 2D canvas's `ctx` matrix stack does: fold {@link matFromTransform} of each
 * ancestor's resolved transform (top → leaf) via {@link matMul}. The TOP-LEVEL node
 * (`chain[0]`) is framed via `topTransform` (the canvas's `nodeTransform` — the editor
 * equivalent of the single root `<MainContainer>`); every nested node uses
 * `childTransform` (pure local space). So the overlay and the canvas land a nested
 * node at the identical spot, and both match the runtime's container composition, by
 * construction. `chain` is root-first, leaf-last.
 */
export function composeWorldMatrix(
	chain: LayoutNode[],
	topTransform: (node: LayoutNode) => ResolvedTransform,
	childTransform: (node: LayoutNode) => ResolvedTransform,
): Affine {
	let m = IDENTITY_AFFINE;
	for (let i = 0; i < chain.length; i++) {
		const t = i === 0 ? topTransform(chain[i]) : childTransform(chain[i]);
		m = matMul(m, matFromTransform(t));
	}
	return m;
}

export interface NodeBox {
	/** Untransformed local-space rect (before scale/rotation/translate). */
	w: number;
	h: number;
	ax: number;
	ay: number;
}

/**
 * A node's measured natural size, optionally carrying its own local anchor. Sprites +
 * spines report just `{ w, h }` (the node's transform anchor frames them). An `effect`
 * reports `ax`/`ay` too, because its live particle spread is OFFSET from the node origin
 * (an upward-fanning burst has particles above/left of the origin), so the selection box
 * needs a per-node anchor — not the transform anchor — to enclose the particles. `ax`/`ay`
 * follow the {@link nodeCornersWorld} convention: the box spans local `-w*ax .. w*(1-ax)`,
 * so a spread occupying local `x .. x+w` maps to `ax = -x/w` (as `componentInstanceContentBox`
 * does with `-minX/w`).
 */
export interface NaturalSize {
	w: number;
	h: number;
	ax?: number;
	ay?: number;
}

/** Resolve a sensible local-space box for any node kind. */
export function nodeBox(
	node: LayoutNode,
	t: ResolvedTransform,
	naturalSize: (node: LayoutNode) => NaturalSize | null,
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
		const content = componentInstanceContentBox(node, naturalSize, componentMap, layoutType, 0, []);
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
		// Frame the spine at its real setup-pose bounds (reported by the WebGL overlay via
		// `naturalSize`), like a sprite — not a fixed 160×100, which leaves the transform
		// box far smaller than the rendered skeleton.
		const nat = naturalSize(node);
		const w = t.width ?? nat?.w ?? 160;
		const h = t.height ?? nat?.h ?? 100;
		return { w, h, ax, ay };
	}
	if (node.kind === 'text') {
		return { w: 160, h: 28, ax, ay };
	}
	// An effect's LIVE particle overlay (EditorEffectLayer) renders real particles that
	// spread — often asymmetrically (a burst fanning upward) — well beyond the fixed
	// placeholder chip. When the overlay has reported a measured spread (via `naturalSize`),
	// frame the selection at that spread so the box + hit-test enclose the particles: `nat`
	// carries its own `ax`/`ay` (the spread is offset from the node origin, so the box needs
	// a per-node anchor, not the transform anchor). Otherwise fall back to the fixed
	// placeholder box so a not-yet-emitting effect is still hit-testable/movable.
	if (node.kind === 'effect') {
		const nat = naturalSize(node);
		if (nat && nat.w > 0 && nat.h > 0) {
			return { w: nat.w, h: nat.h, ax: nat.ax ?? ax, ay: nat.ay ?? ay };
		}
		return { w: 160, h: 100, ax, ay };
	}
	// A rect frames at its own width/height (the fill box) — like a sprite, but the
	// size is intrinsic to the node (no art), so the transform handles resize it.
	if (node.kind === 'rect') {
		const w = t.width ?? node.width;
		const h = t.height ?? node.height;
		return { w, h, ax, ay };
	}
	// Reel grid selects at its full footprint: reels × rows cells, including any
	// non-square cell size + inter-cell gaps (so the box matches what's drawn).
	if (node.kind === 'reelGrid') {
		const reels = Math.max(1, Math.round(node.reels));
		const rows = Math.max(1, Math.round(node.rows));
		const cellW = node.cellWidth && node.cellWidth > 0 ? node.cellWidth : node.cellSize;
		const cellH = node.cellHeight && node.cellHeight > 0 ? node.cellHeight : node.cellSize;
		const gapX = Number.isFinite(node.gapX) ? (node.gapX as number) : 0;
		const gapY = Number.isFinite(node.gapY) ? (node.gapY as number) : 0;
		return {
			w: reels * cellW + (reels - 1) * gapX,
			h: rows * cellH + (rows - 1) * gapY,
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
	naturalSize: (node: LayoutNode) => NaturalSize | null,
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
