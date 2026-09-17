/**
 * Single source of truth for background cover/contain sizing, shared by the game
 * runtime (`LayoutNodeView`) and the editor preview (`EditorSpineLayer` /
 * `EditorCanvas`). See `docs/design/invisible-editor.md` §10.2.
 *
 * Unlike `utils-layout`'s `createBackgroundLayout` — which drives the cover off a
 * configured `backgroundRatio` and so UNDER-covers when that ratio ≠ the art's real
 * aspect — this computes a TRUE cover from the art's authored dimensions: it scales
 * the art so it fully covers (cover) or fully fits inside (contain) the target, then
 * centres it. The result is edge-to-edge for `cover` regardless of how
 * `backgroundRatio` is configured.
 *
 * The fitted scale is uniform; a dedicated `coverScale` multiplies it as a uniform
 * zoom (1 = exact cover), and a per-axis `stretchX`/`stretchY` applies the free
 * non-uniform stretch on top — so the returned scale is per-axis (`scaleX`/`scaleY`).
 *
 * The fit is always COMPUTED against the centre of the target; `anchorX`/`anchorY`
 * then ALIGN the fitted art inside it (0 = left/top edge, 0.5 = centred — the
 * default, 1 = right/bottom edge), i.e. they slide the art within the crop overflow
 * the way CSS `object-position` does. That is the only meaning a cover node's anchor
 * has: the art is always drawn from its own centre (pivot 0.5), so the alignment
 * lives in the returned `x`/`y`.
 *
 * Art dimensions: spine art uses `skeleton.data.width/height` (the authored size —
 * the same source the pixi-svelte spine-sizing fix reads); sprite art uses the
 * texture's natural size.
 */

/**
 * How the art is fitted to the target box:
 * - `cover` (default) — fill it, cropping the overflowing axis (`max` of the two axis scales).
 * - `contain` — fit fully inside it, letterboxing the short axis (`min`).
 * - `width` — match the target's WIDTH exactly (fit on X), whatever that does to the height.
 * - `height` — match the target's HEIGHT exactly (fit on Y).
 *
 * `cover`/`contain` pick the axis by aspect, so which one drives the scale flips as the window
 * ratio crosses the art's; `width`/`height` PIN it to the named axis, which is what an author
 * wants when a backdrop must always span the window horizontally (and be cropped/gapped
 * vertically by design) regardless of ratio. Per-layout overridable — see
 * {@link NodeOverride.fit} — so a portrait bucket can fit on Y while desktop fits on X.
 */
export type CoverFit = 'cover' | 'contain' | 'width' | 'height';

export interface CoverInput {
	/** Authored art width (spine `skeleton.data.width`, sprite natural width). */
	artWidth: number;
	/** Authored art height (spine `skeleton.data.height`, sprite natural height). */
	artHeight: number;
	/** Target box width (the canvas / window / frame the art covers). */
	targetWidth: number;
	/** Target box height. */
	targetHeight: number;
	/** Uniform multiplier on the fitted scale (`1` = exact edge-to-edge cover). */
	coverScale?: number;
	/** Free horizontal stretch applied on top of the fitted cover scale (default 1). */
	stretchX?: number;
	/** Free vertical stretch applied on top of the fitted cover scale (default 1). */
	stretchY?: number;
	/** How the art is fitted to the target box — see {@link CoverFit}. Default `'cover'`. */
	fit?: CoverFit;
	/** Horizontal alignment inside the target: 0 = left edge, 0.5 = centred (default), 1 = right. */
	anchorX?: number;
	/** Vertical alignment inside the target: 0 = top edge, 0.5 = centred (default), 1 = bottom. */
	anchorY?: number;
}

export interface CoverTransform {
	/** Horizontal scale to apply to the art (`fitScale * coverScale * stretchX`). */
	scaleX: number;
	/** Vertical scale to apply to the art (`fitScale * coverScale * stretchY`). */
	scaleY: number;
	/** Where to draw the art's CENTRE — the target centre, slid by the anchor alignment. */
	x: number;
	/** Where to draw the art's CENTRE on y — the target centre, slid by the anchor alignment. */
	y: number;
}

/**
 * Compute a true-cover (or contain / per-axis) transform for art of the given authored
 * dimensions over the given target box. The fitted scale is uniform; `coverScale`
 * zooms it uniformly and `stretchX`/`stretchY` apply the free non-uniform stretch on
 * top. Degenerate art (zero dims) falls back to `coverScale * stretch` so a draw never
 * collapses to nothing.
 *
 * The returned `x`/`y` is where the art's CENTRE goes: the target centre for the default
 * `0.5` anchor, slid within the overflow (`fitted size − target size`) for any other —
 * anchor `0` puts the art's left/top edge on the target's, anchor `1` its right/bottom.
 * So the fit is unchanged by the anchor; only where the crop falls moves.
 */
export function coverTransform({
	artWidth,
	artHeight,
	targetWidth,
	targetHeight,
	coverScale = 1,
	stretchX = 1,
	stretchY = 1,
	fit = 'cover',
	anchorX = 0.5,
	anchorY = 0.5,
}: CoverInput): CoverTransform {
	const align = (target: number, drawn: number, anchor: number): number =>
		target / 2 + (0.5 - anchor) * (drawn - target);
	if (!(artWidth > 0) || !(artHeight > 0)) {
		return {
			scaleX: coverScale * stretchX,
			scaleY: coverScale * stretchY,
			x: align(targetWidth, 0, anchorX),
			y: align(targetHeight, 0, anchorY),
		};
	}
	const sx = targetWidth / artWidth;
	const sy = targetHeight / artHeight;
	const fitScale =
		fit === 'width'
			? sx
			: fit === 'height'
				? sy
				: fit === 'contain'
					? Math.min(sx, sy)
					: Math.max(sx, sy);
	const scaleX = fitScale * coverScale * stretchX;
	const scaleY = fitScale * coverScale * stretchY;
	return {
		scaleX,
		scaleY,
		x: align(targetWidth, artWidth * scaleX, anchorX),
		y: align(targetHeight, artHeight * scaleY, anchorY),
	};
}

/**
 * The anchor ALIGNMENT alone — how far the fitted art is slid off the target centre
 * ({@link coverTransform}'s `x`/`y` minus that centre). For the cover paths that do NOT
 * position the art themselves (a spine, sized by pixi-svelte's `fit` from its skeleton
 * dims and placed at its own authored spot): they keep their position and ADD this, so a
 * default `0.5` anchor is byte-identical (`0`) and a moved anchor slides the art the same
 * distance it would slide a sprite. One formula, so a spine background and a sprite
 * background cannot align differently.
 */
export function coverAnchorOffset(input: CoverInput): { dx: number; dy: number } {
	const cover = coverTransform(input);
	return { dx: cover.x - input.targetWidth / 2, dy: cover.y - input.targetHeight / 2 };
}

/**
 * Canonical readers for a background cover node's doc-driven cover **scale**,
 * **stretch**, **fit** and **anchor** (§10.3 step 4) — the SINGLE place every cover code
 * path resolves them, so the game runtime + all three editor cover paths agree:
 *
 * - **cover scale** = `node.coverScale` (the uniform cover multiplier; `1` = exact
 *   edge-to-edge cover).
 * - **cover stretch** = `{ x: node.scale.x, y: node.scale.y }` (the free per-axis
 *   stretch applied on top of the fitted cover; default `{1, 1}`).
 * - **cover fit** = the node's `fit` field, with a `bind` preview-art anchor
 *   reading `preview.art.fit` instead (the field the editor already round-trips
 *   for those anchors). Default `'cover'`.
 * - **cover anchor** = `node.anchor` read as the ALIGNMENT of the fitted art inside the
 *   window (default `{0.5, 0.5}` = centred, which is what every editor-spawned node
 *   carries — so this is parity until an author moves it).
 *
 * Every reader takes the active `layoutType` and honours that bucket's
 * {@link NodeOverride} first, so a cover can be fitted/zoomed/stretched/aligned
 * differently per screen ratio. Omitting it reads the BASE values only — pass it from
 * any surface that renders a specific layout (all of them do).
 *
 * `node` is typed loosely so this lives in the dependency-free cover module (consumers
 * pass a `LayoutNode`; only `coverScale`/`scale`/`anchor`/`fit`/`preview`/`overrides`
 * are read).
 */
interface BackgroundCoverFields {
	coverScale?: number;
	scale?: { x: number; y: number };
	anchor?: { x: number; y: number };
	fit?: CoverFit;
}

interface BackgroundCoverNode extends BackgroundCoverFields {
	preview?: { art?: { fit?: CoverFit } };
	overrides?: Partial<Record<string, BackgroundCoverFields>>;
}

/** This node's per-layoutType cover override, when the caller named a layout that has one. */
function coverOverride(
	node: BackgroundCoverNode,
	layoutType?: string,
): BackgroundCoverFields | undefined {
	return layoutType ? node.overrides?.[layoutType] : undefined;
}

/** The uniform cover scale multiplier (`coverScale`, default `1` = exact edge-to-edge cover). */
export function backgroundCoverScale(node: BackgroundCoverNode, layoutType?: string): number {
	return coverOverride(node, layoutType)?.coverScale ?? node.coverScale ?? 1;
}

/** The free per-axis cover stretch (`node.scale`, default `{ x: 1, y: 1 }`). */
export function backgroundCoverStretch(
	node: BackgroundCoverNode,
	layoutType?: string,
): { x: number; y: number } {
	const scale = coverOverride(node, layoutType)?.scale ?? node.scale;
	return { x: scale?.x ?? 1, y: scale?.y ?? 1 };
}

/**
 * The cover ALIGNMENT (`node.anchor`, default centred). A cover node's art is always drawn
 * from its own centre, so its anchor cannot mean "pivot" the way a placed node's does — it
 * means where the fitted art sits inside the window (0 = left/top edge, 1 = right/bottom).
 * Before this it meant NOTHING on a cover node: every cover path overwrote it with `0.5`.
 */
export function backgroundCoverAnchor(
	node: BackgroundCoverNode,
	layoutType?: string,
): { x: number; y: number } {
	const anchor = coverOverride(node, layoutType)?.anchor ?? node.anchor;
	return { x: anchor?.x ?? 0.5, y: anchor?.y ?? 0.5 };
}

/** The canonical cover fit — `preview.art.fit` for a bind anchor, else `node.fit`; default `'cover'`. */
export function backgroundFit(node: BackgroundCoverNode, layoutType?: string): CoverFit {
	return coverOverride(node, layoutType)?.fit ?? node.preview?.art?.fit ?? node.fit ?? 'cover';
}

/**
 * Node kinds that COVER the window — full-bleed automatically in a `space:'background'` scene, or
 * on the per-node `coverFit` opt-in in a flow-gated `canvas` scene.
 *
 * THE single definition, read by the runtime (`LayoutNodeView`'s `isCanvasCoverFit`) and by every
 * editor surface (`EditorCanvas.nodeTransform` + `isBackgroundCover`, the Properties "Fill" toggle
 * and cover section). It exists because the same kind list was previously spelled out at each of
 * those gates: adding the `flipbook` kind updated none of them, so a placed clip on a background
 * screen kept its authored size — it never filled the window and stayed drag-resizable in the
 * editor, unlike every other background art node.
 *
 * A `componentInstance` covers as a composed unit and is deliberately NOT here: it has no single
 * piece of art to measure (its size is the union of its children) and it covers only in
 * `background` space, never through the `coverFit` opt-in.
 */
export function isCoverFitKind(node: { kind: string }): boolean {
	return node.kind === 'sprite' || node.kind === 'spine' || node.kind === 'flipbook';
}

/**
 * The subset of {@link isCoverFitKind} whose cover is measured from ONE atlas TEXTURE's natural
 * size — a still `sprite` and a `flipbook` (the same atlas art, played in order; it measures its
 * FIRST frame). Both take the identical texture → {@link coverTransform} → centred per-axis
 * `scale` path. A `spine` is excluded: it has no texture to measure and covers through
 * pixi-svelte's `fit` from `skeleton.data` dims instead.
 */
export function isCoverArtKind(node: { kind: string }): boolean {
	return node.kind === 'sprite' || node.kind === 'flipbook';
}
