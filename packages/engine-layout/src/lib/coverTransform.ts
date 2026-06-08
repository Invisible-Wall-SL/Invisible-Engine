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
