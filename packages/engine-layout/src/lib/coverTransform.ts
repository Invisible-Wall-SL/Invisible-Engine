/**
 * Single source of truth for background cover/contain sizing, shared by the game
 * runtime (`LayoutNodeView`) and the editor preview (`EditorSpineLayer` /
 * `EditorCanvas`). See `docs/design/invisible-editor.md` §10.2.
 *
 * Unlike `utils-layout`'s `createBackgroundLayout` — which drives the cover off a
 * configured `backgroundRatio` and so UNDER-covers when that ratio ≠ the art's real
 * aspect — this computes a TRUE cover from the art's authored dimensions: it scales
 * the art uniformly so it fully covers (cover) or fully fits inside (contain) the
 * target, then centres it. The result is edge-to-edge for `cover` regardless of how
 * `backgroundRatio` is configured.
 *
 * Art dimensions: spine art uses `skeleton.data.width/height` (the authored size —
 * the same source the pixi-svelte spine-sizing fix reads); sprite art uses the
 * texture's natural size.
 */
export interface CoverInput {
	/** Authored art width (spine `skeleton.data.width`, sprite natural width). */
	artWidth: number;
	/** Authored art height (spine `skeleton.data.height`, sprite natural height). */
	artHeight: number;
	/** Target box width (the canvas / window / frame the art covers). */
	targetWidth: number;
	/** Target box height. */
	targetHeight: number;
	/** Multiplier on the fitted scale (`1` = exact edge-to-edge cover). */
	coverScale?: number;
	/** `cover` (default) fills the target (may crop); `contain` fits inside it. */
	fit?: 'cover' | 'contain';
}

export interface CoverTransform {
	/** Uniform scale to apply to the art. */
	scale: number;
	/** Centre x of the target (the art is drawn centred on this). */
	x: number;
	/** Centre y of the target. */
	y: number;
}

/**
 * Compute a centred true-cover (or contain) transform for art of the given authored
 * dimensions over the given target box. Degenerate art (zero dims) falls back to a
 * unit scale centred on the target so a draw never collapses to nothing.
 */
export function coverTransform({
	artWidth,
	artHeight,
	targetWidth,
	targetHeight,
	coverScale = 1,
	fit = 'cover',
}: CoverInput): CoverTransform {
	const x = targetWidth / 2;
	const y = targetHeight / 2;
	if (!(artWidth > 0) || !(artHeight > 0)) {
		return { scale: coverScale, x, y };
	}
	const sx = targetWidth / artWidth;
	const sy = targetHeight / artHeight;
	const scale = (fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)) * coverScale;
	return { scale, x, y };
}

/**
 * Canonical readers for a background cover node's doc-driven cover **scale** and
 * **fit** (§10.3 step 4) — the SINGLE place every cover code path resolves them,
 * so the game runtime + all three editor cover paths agree:
 *
 * - **cover scale** = `node.scale.x` (the cover multiplier; `1` = exact
 *   edge-to-edge cover). Uniform — `scale.y` is ignored for the cover.
 * - **cover fit** = the node's `fit` field, with a `bind` preview-art anchor
 *   reading `preview.art.fit` instead (the field the editor already round-trips
 *   for those anchors). Default `'cover'`.
 *
 * `node` is typed loosely so this lives in the dependency-free cover module
 * (consumers pass a `LayoutNode`; only `scale`/`fit`/`preview` are read).
 */
interface BackgroundCoverNode {
	scale?: { x: number; y: number };
	fit?: 'cover' | 'contain';
	preview?: { art?: { fit?: 'cover' | 'contain' } };
}

/** The cover scale multiplier (`scale.x`, default `1` = exact edge-to-edge cover). */
export function backgroundCoverScale(node: BackgroundCoverNode): number {
	return node.scale?.x ?? 1;
}

/** The canonical cover fit — `preview.art.fit` for a bind anchor, else `node.fit`; default `'cover'`. */
export function backgroundFit(node: BackgroundCoverNode): 'cover' | 'contain' {
	return node.preview?.art?.fit ?? node.fit ?? 'cover';
}
