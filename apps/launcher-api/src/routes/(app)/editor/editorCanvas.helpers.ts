import {
	MAX_COMPONENT_DEPTH,
	REPEATER_INDEX_PARAM,
	anchoredPosition,
	aspectBox,
	boundComponentRidesBone,
	boundComponentTileImage,
	componentDesignSize,
	componentInputs,
	forwardInstanceParams,
	isCountRepeater,
	instancePreviewRigBundle,
	resolveBoundValue,
	resolveComponentParams,
	resolveLayoutInstanceParams,
	resolveReelGridPerspective,
	repeaterCount,
	repeaterCountOffsets,
	repeaterSegmentComponent,
	repeaterSegmentValues,
	resolveTransform,
	type BoneRiderBinding,
	type CountRepeaterNode,
	type ComponentDef,
	type LayoutNode,
	type LayoutType,
	type RepeaterCountLayout,
	type RepeaterItemSize,
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

/** The inverse of `m`, or null when it collapses a dimension (a zero scale). */
export function invertAffine([a, b, c, d, tx, ty]: Affine): Affine | null {
	const det = a * d - b * c;
	if (!det || !Number.isFinite(det)) return null;
	return [d / det, -b / det, -c / det, a / det, (c * ty - d * tx) / det, (b * tx - a * ty) / det];
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
	/** The draw paths pass the value-binding preview's resolver; geometry edits keep the default. */
	resolve: typeof resolveTransform = resolveTransform,
): ResolvedTransform {
	const t = resolve(node, layoutType);
	return { ...t, ...anchoredPosition(t, space, frameWidth, frameHeight) };
}

/**
 * Where the rig layer draws a rig node placed straight on a screen: its skeleton origin in window
 * px and its scale, y still up. In a `canvas` screen the node's `screenAnchor` is folded in by the
 * shared `anchoredPosition`, as the selection box (`nodeTransform`) and the game's `LayoutNodeView`
 * do; a `game` node is mapped through the main box like `<MainContainer>`. A `standard` node keeps
 * its raw x/y, which matches the box only while its screen is the active frame (`standardToWorld`).
 */
export function placedRigTransform(
	t: ResolvedTransform,
	space: Scene['space'] | undefined,
	frameWidth: number,
	frameHeight: number,
	main: { scale: number; toWorld: (p: Vec2) => Vec2 },
): { x: number; y: number; scaleX: number; scaleY: number } {
	const sx = t.scale?.x ?? 1;
	const sy = t.scale?.y ?? 1;
	if (space === 'standard' || space === 'canvas') {
		return { ...anchoredPosition(t, space, frameWidth, frameHeight), scaleX: sx, scaleY: sy };
	}
	return { ...main.toWorld({ x: t.x, y: t.y }), scaleX: sx * main.scale, scaleY: sy * main.scale };
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

/**
 * The signed per-axis scale of a matrix's linear part (`a b c d`, see {@link Affine}) for a
 * renderer that draws it UNROTATED (the rig preview: a skeleton is placed by x/y/scale alone).
 * With the rotation dropped, the axis that carries the mirror is what the author sees, so it can't
 * be left to the determinant alone: X is flipped when its axis points backwards (`a < 0`), and the
 * determinant says whether Y flips with it (both axes mirrored, or a half turn — the same matrix)
 * or on its own. A `scale.x = -1` then mirrors the rig left-right, as the game does, rather than
 * turning it upside down.
 */
export function unrotatedScale(
	a: number,
	b: number,
	c: number,
	d: number,
): { x: number; y: number } {
	const sx = Math.hypot(a, b) || 1;
	const sy = Math.hypot(c, d) || 1;
	const flipX = a < 0;
	const flipY = a * d - b * c < 0 ? !flipX : flipX;
	return { x: flipX ? -sx : sx, y: flipY ? -sy : sy };
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
 * rigs report just `{ w, h }` (the node's transform anchor frames them). An `effect`
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

/** A node's natural draw size. `instanceRigBundle` / `instanceParams` are the ENCLOSING
 * componentInstance's authored rig bundle and resolved params, for a part whose size follows them. */
export type NaturalSizeFn = (
	node: LayoutNode,
	instanceRigBundle?: string,
	instanceParams?: Record<string, unknown>,
) => NaturalSize | null;

/**
 * FALLBACK geometry for a `repeater`'s editor SAMPLE grid — used when the config can't tell us the
 * real item count (unknown/unconfigured `source`) and the component def declares no size. The editor
 * can't run the live `source` array, so it stands in a small number of item boxes laid out by the
 * node's `layout` rule. A feature-card-ish item size keeps the placeholder legible. The COUNT and the
 * item SIZE are overridden per node when resolvable — see {@link repeaterPlaceholderGrid}.
 */
export const REPEATER_PLACEHOLDER = { itemW: 200, itemH: 280, sampleCount: 3 } as const;

/**
 * A `repeater` SOURCE's editor preview data, resolved server-side from the project's game config: how
 * MANY items the source yields, and the per-item `engineProvided` values (title/price/… for feature
 * cards) each item's card previews. Keyed by SOURCE name in {@link RepeaterSourceMap} — the same
 * `source` string a `repeater` node names — so a new source is a new map entry, not new plumbing. An
 * unknown/unconfigured source is simply absent ⇒ the fixed fallback + def defaults (parity).
 */
export interface RepeaterSourcePreview {
	count: number;
	items: Array<Record<string, unknown>>;
}
export type RepeaterSourceMap = Record<string, RepeaterSourcePreview>;

/**
 * The natural FOOTPRINT (union box) of a ComponentDef's `root` children, from their raw transform
 * positions + explicit `width`/`height` — so a `repeater` can size each SAMPLE box to the real card
 * (a sprite/rect carries a size; text/rig, which don't, are skipped). Used ONLY for the sample
 * grid's item size + the per-box placement offset; `null` when no child declares a size (⇒ the caller
 * keeps the fixed fallback). Approximate by design (ignores nested rotation/scale) — it frames the
 * layout, it is not a render bound.
 */
export function componentDefFootprint(
	def: ComponentDef,
): { w: number; h: number; minX: number; minY: number } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const walk = (nodes: LayoutNode[], ox: number, oy: number): void => {
		for (const n of nodes) {
			const ax = n.anchor?.x ?? (n.kind === 'sprite' ? 0 : 0.5);
			const ay = n.anchor?.y ?? (n.kind === 'sprite' ? 0 : 0.5);
			const w = 'width' in n && typeof n.width === 'number' ? n.width : undefined;
			const h = 'height' in n && typeof n.height === 'number' ? n.height : undefined;
			if (w !== undefined && h !== undefined) {
				const left = ox + n.x - w * ax;
				const top = oy + n.y - h * ay;
				if (left < minX) minX = left;
				if (top < minY) minY = top;
				if (left + w > maxX) maxX = left + w;
				if (top + h > maxY) maxY = top + h;
			}
			if (n.kind === 'container') walk(n.children, ox + n.x, oy + n.y);
		}
	};
	walk(def.root.children, 0, 0);
	if (minX === Infinity) return null;
	const w = maxX - minX;
	const h = maxY - minY;
	if (w <= 0 || h <= 0) return null;
	return { w, h, minX, minY };
}

/** The resolved SAMPLE-grid layout of a `repeater` placeholder (columns/rows + footprint),
 * so the canvas draw and the selection {@link nodeBox} agree on one geometry. */
export interface RepeaterPlaceholderGrid {
	cols: number;
	rows: number;
	itemW: number;
	itemH: number;
	gap: number;
	count: number;
	w: number;
	h: number;
}

/**
 * Lay the sample items out by the repeater's `layout` (row = single line advancing +x; grid = wrap
 * every `columns`), returning the grid + total footprint. `opts.count` (the config-resolved item
 * count) overrides the fixed sample count so the preview matches the live list; `opts.def` (the
 * repeated component) sizes each box to the real card footprint. Both fall back to the fixed
 * {@link REPEATER_PLACEHOLDER} when unresolved, so an unconfigured repeater is byte-identical.
 */
export function repeaterPlaceholderGrid(
	node: Extract<LayoutNode, { kind: 'repeater' }>,
	opts?: { count?: number; def?: ComponentDef | null },
): RepeaterPlaceholderGrid {
	const footprint = opts?.def ? componentDefFootprint(opts.def) : null;
	const itemW = footprint?.w ?? REPEATER_PLACEHOLDER.itemW;
	const itemH = footprint?.h ?? REPEATER_PLACEHOLDER.itemH;
	const count =
		opts?.count !== undefined && opts.count > 0
			? Math.round(opts.count)
			: REPEATER_PLACEHOLDER.sampleCount;
	const gap = Number.isFinite(node.layout?.gap) ? Math.max(0, node.layout.gap) : 0;
	let cols: number = count;
	if (node.layout?.direction === 'grid') {
		const columns =
			node.layout.columns && node.layout.columns > 0 ? Math.round(node.layout.columns) : count;
		cols = Math.min(columns, count);
	} else if (node.layout?.direction === 'column') {
		cols = 1;
	}
	cols = Math.max(1, cols);
	const rows = Math.max(1, Math.ceil(count / cols));
	return {
		cols,
		rows,
		itemW,
		itemH,
		gap,
		count,
		w: cols * itemW + (cols - 1) * gap,
		h: rows * itemH + (rows - 1) * gap,
	};
}

/** One synthetic per-item box for a `repeater`'s editor preview. */
export interface RepeaterBox {
	/** A container node placed at the grid cell whose children ARE the component def's `root.children`,
	 *  so both the 2D canvas and the text overlay expand the SAME nodes there. */
	container: Extract<LayoutNode, { kind: 'container' }>;
	/** The item's resolved params: def defaults ◁ the per-item `engineProvided` values the config feeds. */
	params: Record<string, unknown>;
}

/**
 * Build the per-item boxes for a `repeater`'s editor preview — the ONE source of the box layout +
 * component expansion, so the 2D canvas draw ({@link '../editor/EditorCanvas.svelte'} `drawRepeater`)
 * and the text overlay ({@link '../editor/EditorTextLayer.svelte'} `collectTextTargets`) place + fill
 * every box identically. Each box is a container positioned at its grid cell whose children are the
 * def's own `root.children`, plus that item's resolved params. `items[i]` feeds box i; with fewer
 * items than boxes the first item repeats, and NO items ⇒ def defaults only (an unconfigured repeater
 * still previews the real card, just with its default copy). `anchorX`/`anchorY` are the repeater
 * node's anchor — the grid's origin offset is baked into each container so it composes on top of the
 * repeater's own (anchor-less) transform matrix, matching how the canvas + overlay compose the chain.
 */
export function repeaterBoxes(
	node: Extract<LayoutNode, { kind: 'repeater' }>,
	def: ComponentDef,
	grid: RepeaterPlaceholderGrid,
	items: Array<Record<string, unknown>>,
	anchorX: number,
	anchorY: number,
	/** THIS def's per-project param defaults (§13.3) — the layer between the def's own
	 * defaults and the per-item values. Undefined (no sidecar) ⇒ resolved exactly as before. */
	projectDefaults?: Record<string, unknown>,
): RepeaterBox[] {
	const footprint = componentDefFootprint(def);
	const offX = footprint?.minX ?? 0;
	const offY = footprint?.minY ?? 0;
	const left = -grid.w * anchorX;
	const top = -grid.h * anchorY;
	const boxes: RepeaterBox[] = [];
	for (let i = 0; i < grid.count; i++) {
		const col = i % grid.cols;
		const rowIdx = Math.floor(i / grid.cols);
		const x = left + col * (grid.itemW + grid.gap);
		const y = top + rowIdx * (grid.itemH + grid.gap);
		const itemValues = items.length ? (items[i] ?? items[0]) : {};
		boxes.push({
			container: {
				id: `${node.id}::rep${i}`,
				kind: 'container',
				x: x - offX,
				y: y - offY,
				anchor: { x: 0, y: 0 },
				children: def.root.children,
			},
			params: resolveComponentParams(def, itemValues, projectDefaults),
		});
	}
	return boxes;
}

/** The selectable frame of a count-mode repeater that draws nothing (no segment, or unsized ones). */
export const REPEATER_SEGMENT_PLACEHOLDER = { w: 80, h: 80 } as const;

/** N as the editor draws a count-mode repeater: its preview count, clamped as the game clamps. */
export function repeaterPreviewCount(node: CountRepeaterNode): number {
	return repeaterCount(node, node.count.preview);
}

/**
 * Where a count-mode repeater's segments sit in the editor — the game's own geometry
 * (`repeaterCountOffsets`) over the game's own measure of each segment component
 * (`componentDesignSize`, no textures), so the canvas, the overlay and the selection box frame what
 * the game draws. A missing or unsizable component measures 0 × 0, as in game.
 */
export function repeaterPreviewLayout(
	node: CountRepeaterNode,
	componentMap: ReadonlyMap<string, ComponentDef> | undefined,
	layoutType: LayoutType,
	n = repeaterPreviewCount(node),
): RepeaterCountLayout {
	const sizes = new Map<string, RepeaterItemSize | null>();
	return repeaterCountOffsets(node, n, (id) => {
		if (!sizes.has(id)) {
			const def = componentMap?.get(id);
			sizes.set(id, def ? componentDesignSize(def, () => null, layoutType) : null);
		}
		return sizes.get(id) ?? null;
	});
}

/** A count-mode segment's box: the shared {@link RepeaterBox} plus what drew it. */
export interface RepeaterCountBox extends RepeaterBox {
	def: ComponentDef;
	/** 1-based, as the segment's `index` param reads it. */
	index: number;
}

/** What a count-mode segment's state machine is previewed at: its number inputs — `index` /
 *  `count` from the repeater, then the author's test values (`previewInputs`); any other input
 *  keeps its own default. */
export function repeaterSegmentInputs(
	node: CountRepeaterNode,
	def: ComponentDef,
	values: Record<string, number>,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const input of componentInputs(def)) {
		if (input.kind !== 'number') continue;
		const given = values[input.id];
		const test = node.previewInputs?.[input.id];
		if (given !== undefined) out[input.id] = given;
		else if (typeof test === 'number' && Number.isFinite(test)) out[input.id] = test;
	}
	return out;
}

/**
 * Build a count-mode repeater's per-segment boxes — the ONE source the 2D canvas draw and the text
 * overlay share, as {@link repeaterBoxes} is for a source list. Segment i is its variant's def at
 * its {@link repeaterPreviewLayout} offset (the group anchored against the whole footprint), with
 * params def defaults ◁ project defaults ◁ `{ index: i + 1, count: N }`. `pose` (the settled
 * state-machine pose, `segmentPreview.ts`) replaces the def's children for that segment's inputs;
 * absent or `null` ⇒ the base pose. A segment whose def is missing is left out.
 */
export function repeaterCountBoxes(
	node: CountRepeaterNode,
	componentMap: ReadonlyMap<string, ComponentDef>,
	layoutType: LayoutType,
	anchorX: number,
	anchorY: number,
	componentDefaults?: Record<string, Record<string, unknown>>,
	pose?: (
		def: ComponentDef,
		inputs: Record<string, number>,
		params: Record<string, unknown>,
	) => LayoutNode[] | null,
): { layout: RepeaterCountLayout; boxes: RepeaterCountBox[] } {
	const n = repeaterPreviewCount(node);
	const layout = repeaterPreviewLayout(node, componentMap, layoutType, n);
	const left = -layout.width * anchorX;
	const top = -layout.height * anchorY;
	const boxes: RepeaterCountBox[] = [];
	layout.offsets.forEach((offset, i) => {
		const def = componentMap.get(repeaterSegmentComponent(node, i, n));
		if (!def) return;
		const values = repeaterSegmentValues(i, n);
		const params = resolveComponentParams(def, values, componentDefaults?.[def.id]);
		const children =
			pose?.(def, repeaterSegmentInputs(node, def, values), params) ?? def.root.children;
		boxes.push({
			def,
			index: i + 1,
			params,
			container: {
				id: `${node.id}::seg${i}`,
				kind: 'container',
				x: left + offset.x,
				y: top + offset.y,
				anchor: { x: 0, y: 0 },
				children,
			},
		});
	});
	return { layout, boxes };
}

/** A new count-mode repeater (the Components side's "Repeat (count)" element): three segments of
 *  `componentId` in a row, 8 px apart. Its source list is unused, so `source` is `''`. */
export function newCountRepeater(
	base: Pick<LayoutNode, 'id' | 'x' | 'y'> & Partial<Pick<LayoutNode, 'anchor' | 'scale'>>,
	componentId: string,
): CountRepeaterNode {
	return {
		...base,
		kind: 'repeater',
		label: 'Segments',
		source: '',
		componentId,
		count: { preview: 3 },
		layout: { direction: 'row', gap: 8 },
	};
}

/** The component a new "Repeat (count)" element repeats: the first that declares an `index`
 *  (param or number input — what lights a segment by position), else the first offered. */
export function defaultSegmentComponent(defs: readonly ComponentDef[]): string {
	const lights = (def: ComponentDef) =>
		(def.params ?? []).some((p) => p.key === REPEATER_INDEX_PARAM) ||
		componentInputs(def).some((i) => i.id === REPEATER_INDEX_PARAM && i.kind === 'number');
	return (defs.find(lights) ?? defs[0])?.id ?? '';
}

/** Resolve a sensible local-space box for any node kind. */
export function nodeBox(
	node: LayoutNode,
	t: ResolvedTransform,
	naturalSize: NaturalSizeFn,
	componentMap?: Map<string, ComponentDef>,
	layoutType?: LayoutType,
	/** The ENCLOSING componentInstance's AUTHORED preview rig bundle (its first `spine`-kind
	 * param value; see `instancePreviewRigBundle`), threaded by {@link componentInstanceContentBox}
	 * so a nested RIG bind (the win / free-spin VISUAL) frames its selection box at the AUTHORED
	 * rig's natural bounds — the SAME size the rig layer renders it at — instead of the generic
	 * 160×100 chip. Undefined for a top-level node or a non-rig-param instance ⇒ prior box (parity). */
	instanceRigBundle?: string,
	/** The config-resolved SAMPLE item count for a `repeater` node (its `source`'s live length —
	 * e.g. `featureCards` → the non-default bet modes), so the selection rect frames the SAME grid
	 * {@link repeaterPlaceholderGrid} lays out in the draw. Undefined ⇒ the fixed fallback count. */
	repeaterCount?: number,
	/** Per-project component DEFAULTS by component id (§13.3), threaded into
	 * {@link componentInstanceContentBox} so an instance's selection box frames the art the
	 * project's defaults actually draw. Undefined / empty ⇒ resolved exactly as before. */
	componentDefaults?: Record<string, Record<string, unknown>>,
	/** The ENCLOSING componentInstance's resolved params (the Component Editor's open-def params for
	 * a top-level node), so a part sized by them frames the box it draws. Undefined ⇒ parity. */
	instanceParams?: Record<string, unknown>,
): NodeBox {
	// A repeater defaults its unset anchor to 0 (extend-right) like a sprite, so the selection rect
	// frames the same footprint the runtime <Repeater> lays out (parity). A flipbook is atlas art
	// drawn through the SAME region path as a sprite, so it must share the sprite's anchor default
	// or its selection box would straddle the origin while the frame drew from the top-left.
	const anchorlessKind =
		node.kind === 'sprite' || node.kind === 'repeater' || node.kind === 'flipbook';
	const ax = t.anchor?.x ?? (anchorlessKind ? 0 : 0.5);
	const ay = t.anchor?.y ?? (anchorlessKind ? 0 : 0.5);
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
			componentDefaults,
			instanceParams ?? {},
		);
		if (content) return content;
	}
	// A coded tile part skinned with a picked frame (the readout's Background — see
	// `TileImageBinding`) frames the box it DRAWS: `aspectBox` over the frame's natural size and the
	// instance's overrides, exactly as EditorCanvas sizes the art. No frame picked (or one still
	// loading with no override) ⇒ the coded tile box below (parity).
	const tile = node.bind ? boundComponentTileImage(node.bind.component) : undefined;
	const tileImage = tile ? instanceParams?.[tile.imageParam] : undefined;
	if (tile && instanceParams && typeof tileImage === 'string' && tileImage) {
		const num = (key?: string): number | undefined =>
			key && typeof instanceParams[key] === 'number' ? (instanceParams[key] as number) : undefined;
		const sized = aspectBox(
			naturalSize(node, instanceRigBundle, instanceParams),
			num(tile.widthParam),
			num(tile.heightParam),
		);
		if (sized.width !== undefined && sized.height !== undefined)
			return { w: sized.width, h: sized.height, ax, ay };
	}
	// A nested RIG bind (the win / free-spin VISUAL inside a rig-param componentInstance): frame
	// the selection box at the AUTHORED rig's natural bounds so it matches what the rig layer draws
	// (natural size, no fit — see `bindRigTarget`). Without this the box stayed the generic 160×100
	// while the rig rendered huge, so the instance couldn't be sized/placed. Gated on a plain
	// (non-riding, non-chip, unsized) bind inside a rig-param instance so HUD chips, sized binds and
	// the bone-riding symbol reveal keep their existing box (parity). The bone-rider selects at its
	// ridden SYMBOL, not the backdrop rig, so it is excluded here.
	if (
		node.bind &&
		instanceRigBundle !== undefined &&
		!boundComponentRidesBone(node.bind.component) &&
		!node.preview?.art &&
		!node.preview?.style &&
		t.width === undefined &&
		t.height === undefined
	) {
		// `bindRigTarget` draws it with its skeleton origin at the node, like a placed rig node.
		const nat = naturalSize(node, instanceRigBundle);
		if (nat && nat.w > 0 && nat.h > 0)
			return { w: nat.w, h: nat.h, ax: nat.ax ?? ax, ay: nat.ay ?? ay };
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
	// HUD preview chips select at their drawn size (w/h are optional → defaulted). A `kind:'text'`
	// node carries a `preview` too (e.g. `{style:'text', textParam}` — the exposed-param twin), but
	// its selection box is its TEXT box / measured glyphs (handled below), NOT a generic chip — so it
	// must fall through to the text branch, or resizing its box does nothing on-canvas.
	if (node.preview && node.kind !== 'text')
		return { w: node.preview.w ?? 160, h: node.preview.h ?? 100, ax, ay };
	// A flipbook frames exactly like the region sprite it animates — its `naturalSize` is the
	// clip's FIRST frame, so the box stays still while the animation plays through it.
	if (node.kind === 'sprite' || node.kind === 'flipbook') {
		const nat = naturalSize(node);
		const w = t.width ?? nat?.w ?? 100;
		const h = t.height ?? nat?.h ?? 100;
		return { w, h, ax, ay };
	}
	if (node.kind === 'spine') {
		// Frame the rig at its real setup-pose bounds (reported by the WebGL overlay via
		// `naturalSize`), like a sprite — not a fixed 160×100, which leaves the transform
		// box far smaller than the rendered skeleton.
		//
		// WHERE the box sits is the rig's, not the node's: the game (`LayoutNodeView` → a
		// `<RigProvider>` with no anchor) and the rig layer both put the skeleton ORIGIN at the
		// node's x/y, so the box sits around that origin exactly as the rig's box does
		// (`rigOriginAnchor`) and the node's anchor moves nothing. One authored dimension scales
		// the rig uniformly (`rigSizeScale`), so the other follows the art's aspect.
		const nat = naturalSize(node);
		const w =
			t.width ?? (nat && t.height !== undefined ? (nat.w * t.height) / nat.h : (nat?.w ?? 160));
		const h =
			t.height ?? (nat && t.width !== undefined ? (nat.h * t.width) / nat.w : (nat?.h ?? 100));
		return { w, h, ax: nat?.ax ?? 0.5, ay: nat?.ay ?? 0.5 };
	}
	if (node.kind === 'text') {
		// A text box's selection frame is its explicit box (`width`/`height`); an auto-size
		// text node hugs the RENDERED glyphs — the PIXI overlay measures the real object and
		// reports it back through `naturalSize` (keyed by node id), exactly like a sprite's
		// texture size. Falls back to the old 160×28 only until the first measurement lands.
		// Anchor default TOP-LEFT (0), matching how both the overlay and the runtime draw a
		// text node (pixi `Text`/`BitmapText` default anchor 0, and the box path below uses the
		// SAME default) — so the frame hugs the glyphs / box instead of straddling the origin,
		// and adding a box never jumps the node (the default is identical box vs auto-size).
		const tax = t.anchor?.x ?? 0;
		const tay = t.anchor?.y ?? 0;
		const nat = naturalSize(node);
		// Prefer the EXPLICIT box — the per-layoutType override (via `t`) OR the node's own base
		// `width`/`height` — so the selection frame + resize handles track the AUTHORED box, and
		// resizing it (drag or the width/height fields) visibly moves the frame. Only an auto-size
		// text node (no box on either) falls back to the measured glyph extent, which hugs the text.
		const w = t.width ?? node.width ?? nat?.w ?? 160;
		const h = t.height ?? node.height ?? nat?.h ?? 28;
		return { w, h, ax: tax, ay: tay };
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
	// A count-mode repeater selects at its segments' layout (`repeaterPreviewLayout`, as drawn).
	if (node.kind === 'repeater' && isCountRepeater(node) && layoutType !== undefined) {
		const layout = repeaterPreviewLayout(node, componentMap, layoutType);
		return layout.width > 0 && layout.height > 0
			? { w: layout.width, h: layout.height, ax, ay }
			: { ...REPEATER_SEGMENT_PLACEHOLDER, ax, ay };
	}
	// A repeater selects at the footprint of its editor SAMPLE grid — the config-resolved item
	// count + the repeated component's own footprint (both via `repeaterPlaceholderGrid`), so the
	// selection rect matches what `drawRepeater` draws (which passes the same count + def).
	if (node.kind === 'repeater') {
		const g = repeaterPlaceholderGrid(node, {
			count: repeaterCount,
			def: componentMap?.get(node.componentId),
		});
		return { w: g.w, h: g.h, ax, ay };
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
	naturalSize: NaturalSizeFn,
	componentMap: Map<string, ComponentDef>,
	layoutType: LayoutType,
	depth: number,
	stack: string[],
	componentDefaults: Record<string, Record<string, unknown>> | undefined,
	/** The enclosing instance's resolved params — what the instance's forwarded params read. */
	outerParams: Record<string, unknown>,
): NodeBox | null {
	const def = componentMap.get(node.componentId);
	if (!def) return null;
	if (depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) return null;
	const childStack = [...stack, def.id];
	// This instance's AUTHORED preview rig bundle (its first `spine`-kind param value), resolved
	// EXACTLY like the rig layer's `collectNestedRigs`, so a nested rig bind's box tracks the
	// authored rig's natural bounds (matching what the rig layer renders). Undefined ⇒ parity.
	const rigBundle = instancePreviewRigBundle(
		def,
		resolveComponentParams(
			def,
			forwardInstanceParams(node, node.params, outerParams),
			componentDefaults?.[def.id],
		),
	);
	// The params the children DRAW with — per-ratio overrides and forwarded params included, as
	// `drawComponentInstance` resolves them — so a part sized by them frames what the canvas draws.
	const params = resolveComponentParams(
		def,
		forwardInstanceParams(node, resolveLayoutInstanceParams(node, layoutType), outerParams),
		componentDefaults?.[def.id],
	);

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const child of def.root.children) {
		const ct = resolveTransform(child, layoutType);
		// A parametric Text Box binds its box `width`/`height` to instance params, so the
		// selection frame must resolve them here (the union otherwise frames the auto-size text,
		// mismatching the boxed render). Text-only; unbound ⇒ the node's own transform (parity).
		if (child.kind === 'text' && child.paramBindings) {
			const bw = resolveBoundValue(child.paramBindings, 'width', params);
			const bh = resolveBoundValue(child.paramBindings, 'height', params);
			if (typeof bw === 'number') ct.width = bw;
			if (typeof bh === 'number') ct.height = bh;
		}
		const cb =
			child.kind === 'componentInstance'
				? (componentInstanceContentBox(
						child,
						naturalSize,
						componentMap,
						layoutType,
						depth + 1,
						childStack,
						componentDefaults,
						params,
					) ??
					nodeBox(
						child,
						ct,
						naturalSize,
						componentMap,
						layoutType,
						rigBundle,
						undefined,
						componentDefaults,
						params,
					))
				: nodeBox(
						child,
						ct,
						naturalSize,
						componentMap,
						layoutType,
						rigBundle,
						undefined,
						componentDefaults,
						params,
					);
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

/**
 * The local point (pre-scale, relative to the node's origin) a resize handle measures its drag
 * from. Every node measures from its origin, which scales in place. A rig's origin can sit on an
 * edge of its box or outside it (`rigOriginAnchor`), where a corner's offset from the origin is
 * zero or points the wrong way, so a rig measures from its box CENTRE and the origin moves to
 * hold that centre still ({@link resizeOriginShift}). A box centred on its origin gets (0, 0).
 */
export function resizePivot(node: LayoutNode, box: NodeBox): Vec2 {
	if (node.kind !== 'spine') return { x: 0, y: 0 };
	return { x: box.w * (0.5 - box.ax), y: box.h * (0.5 - box.ay) };
}

/**
 * How far (world px) a node's origin moves so its {@link resizePivot} stays put when its drawn
 * scale changes by `ratio` per axis, rotated by `rotation`. Zero for a pivot at the origin.
 */
export function resizeOriginShift(
	pivot: Vec2,
	drawScale: Vec2,
	ratio: Vec2,
	rotation: number,
): Vec2 {
	const lx = pivot.x * drawScale.x * (1 - ratio.x);
	const ly = pivot.y * drawScale.y * (1 - ratio.y);
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return { x: lx * cos - ly * sin, y: lx * sin + ly * cos };
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

// ---------- bone-ridden stand-in symbol (Scene Editor preview) ----------

/**
 * A stand-in symbol transform PUBLISHED by {@link '../editor/EditorRigLayer.svelte'} for a
 * bone-riding component instance, in editor WORLD coords (pre pan/zoom — the SAME space the 2D
 * canvas's `ctx` draws in, so the box maps to screen via `world*zoom + pan` with no mirror). The
 * rig layer owns the skeleton↔screen mapping (it bakes the X-mirror + pan/zoom into the
 * skeleton), so it resolves the bone here where that mapping lives and hands the 2D canvas a plain
 * world transform. `scaleX`/`scaleY` are the DIMENSIONLESS symbol scale factors (`symbolScale` ×
 * the bone's world scale when `followScale`), which the 2D canvas multiplies by its symbol base
 * size. `region` is an optional resolved atlas-frame ref (`<assetKey>::<region>`) to draw instead
 * of the placeholder box. Keyed by the host component-instance node id. Held in a plain (non-$state)
 * Map + read by the 2D canvas's own RAF, so the per-frame follow never churns Svelte reactivity.
 */
export interface BoneRiderTransform {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
	region?: string;
}

/** The instance-param values a {@link BoneRiderBinding} resolves to (defaults match the runtime
 * `FreeSpinIntroSymbolReveal.svelte`: follow on, offset 0, scale 1). `boneName` empty ⇒ no rider. */
export interface ResolvedBoneRider {
	boneName: string;
	offsetX: number;
	offsetY: number;
	followRotation: boolean;
	followScale: boolean;
	symbolScale: number;
	animation?: string;
	region?: string;
}

/** Resolve a bone-rider binding against a component instance's effective params (from
 * `resolveComponentParams`). Pure — reads only the param keys the binding names. */
export function resolveBoneRider(
	binding: BoneRiderBinding,
	params: Record<string, unknown>,
): ResolvedBoneRider {
	const str = (k?: string): string | undefined => {
		const v = k ? params[k] : undefined;
		return typeof v === 'string' && v.length > 0 ? v : undefined;
	};
	const num = (k: string | undefined, d: number): number => {
		const v = k ? params[k] : undefined;
		return typeof v === 'number' && Number.isFinite(v) ? v : d;
	};
	const bool = (k: string | undefined, d: boolean): boolean => {
		const v = k ? params[k] : undefined;
		return typeof v === 'boolean' ? v : d;
	};
	return {
		boneName: str(binding.boneParam) ?? '',
		offsetX: num(binding.offsetXParam, 0),
		offsetY: num(binding.offsetYParam, 0),
		followRotation: bool(binding.followRotationParam, true),
		followScale: bool(binding.followScaleParam, true),
		symbolScale: num(binding.scaleParam, 1),
		animation: str(binding.animationParam),
		region: str(binding.imageParam),
	};
}

/** The rig-bundle `assetKey` a bone-rider previews on — resolved from the instance's
 * `spineParam` value against the project's rigs (its `name` → bundle `key`). Empty when the
 * param is unset or names no project rig; the caller then falls back to the catalog default. */
export function resolveBoneRiderRigKey(
	binding: BoneRiderBinding,
	params: Record<string, unknown>,
	rigs: { name: string; key: string }[],
): string {
	const name = params[binding.spineParam];
	if (typeof name !== 'string' || !name) return '';
	return rigs.find((s) => s.name === name)?.key ?? '';
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

/** One symbol seat of a reel board, in the `reelGrid` node's OWN local space (the caller
 * applies the node transform / world matrix). `x`/`y`/`w`/`h` is the cell BOX (the reel window
 * cell); `cx`/`cy` is the SEAT centre the symbol art is centred on — the cell centre moved
 * by the reel/row lead + the per-cell alignment. */
export interface ReelGridSeat {
	/** Grid coordinates. `j * reels + i` is the order the preview cycles symbols in. */
	i: number;
	j: number;
	x: number;
	y: number;
	/**
	 * Cell BOX size. On a flat board this is `cellW`/`cellH` verbatim (the same float, not a
	 * product) — under perspective it is this ROW's size, i.e. `cellW * scale` / `cellH * scale`.
	 * Consumers must size a symbol off THESE, never off `cellW`/`cellH`, or a back-row symbol draws
	 * at the front row's size.
	 */
	w: number;
	h: number;
	/**
	 * This row's PERSPECTIVE scale — exactly `1` on a flat board (the literal, not a computed one).
	 * The game applies the identical number to the symbol container (`getSymbolSeat().scale`), so a
	 * consumer that multiplies the cell box by it lands on the live symbol's size.
	 */
	scale: number;
	/**
	 * The SEAT centre the symbol art is centred on — the cell centre moved by the reel/row lead and
	 * the per-cell alignment. Under perspective those two offsets are scaled with the row, so a
	 * symbol sits the same FRACTION into a shallow back-row cell as into a deep front-row one.
	 */
	cx: number;
	cy: number;
}

/** The resolved geometry of a `reelGrid` node's board preview — the cell boxes, the board
 * box, and every symbol seat. */
export interface ReelGridGeometry {
	reels: number;
	rows: number;
	cellW: number;
	cellH: number;
	/**
	 * Board box (every cell + the gaps between them), anchored + board-nudged. This stays the FLAT
	 * footprint even under perspective — it is the un-contracted extent the model contracts FROM,
	 * and the node's own transform/selection box is drawn against it. For the shape actually on
	 * screen use {@link outline} / {@link clip}.
	 */
	left: number;
	top: number;
	width: number;
	height: number;
	seats: ReelGridSeat[];
	/**
	 * The board's on-screen OUTLINE under perspective — 4 corners in draw order (back-left,
	 * back-right, front-right, front-left). Absent ⇒ FLAT, and the outline is exactly the
	 * `(left, top, width, height)` rect, which is what the caller keeps drawing so the flat board
	 * cannot move by a float bit.
	 *
	 * It is a TRAPEZOID, not a general quad, and each individual CELL is still an axis-aligned
	 * rectangle: every cell in a row shares that row's scale, so a row contracts uniformly about the
	 * vanishing point and stays a rectangle. It is the BOARD that converges, not the cell.
	 */
	outline?: Vec2[];
	/**
	 * Axis-aligned clip window under perspective (the bounding box of {@link outline}). Absent ⇒
	 * FLAT, and the caller clips to the `(left, top, width, height)` rect as before.
	 *
	 * Deliberately a RECTANGLE and deliberately the OUTER bound: the game masks the board window
	 * with a rectangle too (`BoardMask` — "in a symmetric one-point projection the far edge is a
	 * straight horizontal line"), and it over-extends horizontally by a whole cell so the widest
	 * (front) row is never clipped. Clipping the editor to the trapezoid instead would crop art at
	 * the back of the board that the live game shows.
	 */
	clip?: { x: number; y: number; w: number; h: number };
	/**
	 * SYMBOL OVERFLOW — how far past the board window a SETTLED symbol's art may spill, in this
	 * node's own px, on each axis. `0`/`0` unless authored, which is every board that predates the
	 * knob.
	 *
	 * The preview spends it on the CLIP and nowhere else, exactly as the game does: no cell moves and
	 * no seat moves, so a board gains room for its art without gaining size. It is handed back rather
	 * than folded into {@link clip} because the flat board has no `clip` to fold into — the caller
	 * builds that rect from `left`/`top`/`width`/`height`, and both paths have to grow the same way.
	 *
	 * WHAT THE PREVIEW CANNOT SHOW is the gating: live, the spill only appears once every reel has
	 * stopped (`boardOverflow` in `gameState.svelte.ts`). A static preview IS the settled board, so
	 * drawing it always is the honest reading — but it means the editor shows the most generous
	 * moment of the spin, not every moment of it.
	 */
	overflowX: number;
	overflowY: number;
}

/**
 * The engine's board-LOCAL cell unit — `SYMBOL_SIZE` in
 * `packages/engine-game/src/game/constants.ts`. Written as a literal because `engine-game` is a
 * RUNTIME package the launcher does not (and should not) depend on; `engine-layout` carries the
 * same literal for the same reason (see `builtinComponents.ts`'s coded panel width).
 *
 * It is needed for exactly ONE thing: an authored `vanishX` is in the game's board-local space (the
 * space `getSymbolX` returns), so converting it to editor px needs the board container's scale,
 * `cellSize / SYMBOL_SIZE`. Every other term below is derived from the flat editor lattice and
 * never touches it.
 */
const BOARD_LOCAL_CELL = 120;

/**
 * Resolve a `reelGrid` node's board geometry in its own local space — the ONE definition
 * the editor's 2D board preview and the WebGL rig layer both read, so a sprite symbol and
 * a rig symbol land on the same seat.
 *
 * The grid COUNT comes from the Game Config (`dims`, the same source the game sizes off)
 * with the node's own `reels`/`rows` as the fallback. The cell boxes are the reel WINDOW
 * (they move only with `boardNudge*`); the SEAT is where the symbol art sits, moved by the
 * two independent contributions the game applies (`getSymbolX` / `getSymbolLead`): the
 * reel/row LEAD (`reelPadding`/`rowPadding`, in cell-SIZE units — seats the whole cluster)
 * plus the per-cell SEAT ALIGNMENT (`symbolAlignX/Y`, in cell-W/H units — art inside its own
 * cell). Both default 0.5 ⇒ no offset ⇒ centred.
 *
 * PERSPECTIVE (`docs/design/perspective-board-mode.md`) is mirrored here from the engine's
 * `getSymbolSeat` — see the block inside. It is authored on the node, so it must be resolved in
 * THIS one function: a consumer that re-derived a scale ramp or a vanishing-point contraction in
 * its own drawing code would be a second definition, and the 2D board preview and the WebGL rig
 * layer would stop agreeing on where a symbol sits — the exact drift this helper exists to prevent.
 *
 * Without an authored perspective the function EARLY-RETURNS the flat lattice, expression for
 * expression, rather than multiplying a scale of 1 through it (that subtracts and adds back around
 * the vanishing point, and that rounds). `scripts/verify-reel-grid-geometry.mjs` asserts both the
 * byte-parity and the equivalence with the engine's seats.
 */
export function reelGridGeometry(
	node: Extract<LayoutNode, { kind: 'reelGrid' }>,
	anchor: { x: number; y: number } | undefined,
	dims:
		| { reels: number; rows: number; rowsPerReel?: number[]; rowOffsets?: number[] }
		| null
		| undefined,
): ReelGridGeometry {
	const reels = Math.max(1, Math.round(dims?.reels ?? node.reels));
	const rows = Math.max(1, Math.round(dims?.rows ?? node.rows));
	const cellW = node.cellWidth && node.cellWidth > 0 ? node.cellWidth : node.cellSize;
	const cellH = node.cellHeight && node.cellHeight > 0 ? node.cellHeight : node.cellSize;
	const gapX = Number.isFinite(node.gapX) ? (node.gapX as number) : 0;
	const gapY = Number.isFinite(node.gapY) ? (node.gapY as number) : 0;
	const pitchX = cellW + gapX;
	const pitchY = cellH + gapY;
	const width = reels * cellW + (reels - 1) * gapX;
	const height = rows * cellH + (rows - 1) * gapY;
	const nudgeX = Number.isFinite(node.boardNudgeX) ? (node.boardNudgeX as number) : 0;
	const nudgeY = Number.isFinite(node.boardNudgeY) ? (node.boardNudgeY as number) : 0;
	// Clip-only, so it is read here and never enters `left`/`top`/`width`/`height` or a seat. Read
	// through the SAME "finite and positive" gate the engine's resolver uses — a negative would
	// shrink the window rather than grow it, and the preview must reject exactly what the game does.
	const overflowX =
		Number.isFinite(node.overflowX) && (node.overflowX as number) > 0
			? (node.overflowX as number)
			: 0;
	const overflowY =
		Number.isFinite(node.overflowY) && (node.overflowY as number) > 0
			? (node.overflowY as number)
			: 0;
	const left = -width * (anchor?.x ?? 0.5) + nudgeX;
	const top = -height * (anchor?.y ?? 0.5) + nudgeY;

	const leadX = Number.isFinite(node.reelPadding) ? (node.reelPadding as number) : 0.5;
	const leadY = Number.isFinite(node.rowPadding) ? (node.rowPadding as number) : 0.5;
	const alignX = Number.isFinite(node.symbolAlignX) ? (node.symbolAlignX as number) : 0.5;
	const alignY = Number.isFinite(node.symbolAlignY) ? (node.symbolAlignY as number) : 0.5;
	const seatDX = node.cellSize * (leadX - 0.5) + cellW * (alignX - 0.5);
	const seatDY = node.cellSize * (leadY - 0.5) + cellH * (alignY - 0.5);

	// STEPPED GRIDS (docs/design/stepped-grid.md) — how many rows THIS column shows, and how far
	// down it sits. Both come pre-resolved from the server (`resolveGrid`, the same resolver the game
	// runs), so the editor previews the placement the game will draw rather than re-deriving the
	// alignment rule and drifting from it. Absent ⇒ every column is `rows` tall at offset 0, which is
	// the literal loop that was here before.
	const rowsAt = (reel: number) => dims?.rowsPerReel?.[reel] ?? rows;
	const offsetAt = (reel: number) => dims?.rowOffsets?.[reel] ?? 0;

	const seats: ReelGridSeat[] = [];
	for (let i = 0; i < reels; i++) {
		const columnRows = rowsAt(i);
		const columnOffset = offsetAt(i);
		for (let j = 0; j < columnRows; j++) {
			const x = left + i * pitchX;
			const y = top + (j + columnOffset) * pitchY;
			seats.push({
				i,
				j,
				x,
				y,
				w: cellW,
				h: cellH,
				scale: 1,
				cx: x + cellW / 2 + seatDX,
				cy: y + cellH / 2 + seatDY,
			});
		}
	}
	const flat: ReelGridGeometry = {
		reels,
		rows,
		cellW,
		cellH,
		left,
		top,
		width,
		height,
		seats,
		overflowX,
		overflowY,
	};

	// ---- PERSPECTIVE (docs/design/perspective-board-mode.md) ------------------------------------
	// The mode's ON switch, read + guarded EXACTLY as the engine's `boardPerspective` reads it:
	// absent, non-finite, `<= 0` (collapses/mirrors the board) or exactly `1` (the identity) all
	// mean FLAT, and flat is this early return of the expressions above — not the algebra below with
	// a scale that happens to be 1. Nothing authors a perspective on a live game yet, so a moved
	// float here is a board preview that silently disagrees with the game it is previewing.
	const authored = resolveReelGridPerspective(node);
	const farScale = authored?.farScale;
	if (typeof farScale !== 'number' || !Number.isFinite(farScale) || farScale <= 0 || farScale === 1)
		return flat;

	// The depth ramp: `scale(row) = farScale + perRow * row`, so the BACK row (0, visually furthest)
	// draws at `farScale` and the FRONT row draws at exactly 1. A one-row board has no depth to ramp
	// across, so every row sits at `farScale` — a uniformly smaller board, not a divide by zero.
	// Identical to `perspectiveRowScale` in `gameState.svelte.ts`; the clamp is a no-op for the
	// editor's `0..rows-1` but is kept so the two read as the same function.
	const frontRow = rows > 1 ? rows - 1 : 0;
	const perRow = frontRow > 0 ? (1 - farScale) / frontRow : 0;
	const rowScale = (row: number) => farScale + perRow * Math.min(Math.max(row, 0), frontRow);
	// `Σ_{k<row} scale(k)` in units of `pitchY` — how many base row pitches deep a row sits once
	// every row above it has contributed only its OWN (compressed) pitch. The engine's closed form
	// (`perspectiveRowSum`), branch for branch, so the editor's depth cannot drift from the game's.
	const rowSum = (row: number) => {
		const ramp = (r: number) => farScale * r + (perRow * r * (r - 1)) / 2;
		if (row <= 0) return farScale * row;
		if (row <= frontRow) return ramp(row);
		return ramp(frontRow) + (row - frontRow);
	};

	// The board-local ORIGIN, in editor px — the affine map between the game's seat space and this
	// one, written out because the whole point of this block is that the two agree.
	//
	// The game seats in board-LOCAL units (`SYMBOL_SIZE`-based) inside a container scaled by
	// `cellSize / SYMBOL_SIZE`; the editor seats in layout px. Folding the game's container pivot
	// through that scale gives `editorX = X0 + boardScale * gameX` with
	// `X0 = left + (cellW - cellSize) / 2` and `Y0 = top - gapY / 2` — i.e. the game's board-local
	// origin is half a NON-SQUARE overhang right of the board box's left edge, and half a row GAP
	// above its top edge (the game's row pitch cell wraps the gap symmetrically around the drawn
	// cell). Both collapse to `left`/`top` on the square, flush board.
	const boardScale = node.cellSize / BOARD_LOCAL_CELL;
	const originX = left + (cellW - node.cellSize) / 2;
	const originY = top - gapY / 2;
	// The vanishing point, in editor px. Authored ⇒ it is a board-LOCAL x (the space `getSymbolX`
	// returns), so it travels the map above. Absent ⇒ the lattice CENTRE: the midpoint of the FIRST
	// and LAST column SEATS, which is what the engine defaults to — taken from the seats themselves,
	// not from the board box, so the lead + alignment terms are included and a symmetric board
	// contracts symmetrically.
	const authoredVanishX = authored?.vanishX;
	const seatCx = (i: number) => left + i * pitchX + cellW / 2 + seatDX;
	const vanishX =
		typeof authoredVanishX === 'number' && Number.isFinite(authoredVanishX)
			? originX + boardScale * authoredVanishX
			: (seatCx(0) + seatCx(reels - 1)) / 2;
	/** Contract a flat board-local x toward the vanishing point by a row's scale. */
	const converge = (x: number, scale: number) => vanishX + (x - vanishX) * scale;

	const perspectiveSeats: ReelGridSeat[] = seats.map((s) => {
		const scale = rowScale(s.j);
		const w = cellW * scale;
		const h = cellH * scale;
		// The cell BOX: its centre converges with its row and it shrinks with its row. Its top edge
		// is the running sum of the compressed row pitches, plus the half-gap that pitch carries
		// (itself compressed) — so the cells of a gapped board stay separated by a gap that shrinks
		// with them.
		const boxCx = converge(s.x + cellW / 2, scale);
		const boxCy = originY + pitchY * rowSum(s.j) + (pitchY * scale) / 2;
		// The SEAT is the box centre plus the lead + alignment offsets — scaled, so a symbol sits the
		// same FRACTION into a shallow back-row cell as into a deep front-row one. That is the same
		// composition the engine makes, where those terms ride INSIDE the contracted `getSymbolX`
		// and inside `pitch * scale * getSymbolLead()`.
		return {
			i: s.i,
			j: s.j,
			x: boxCx - w / 2,
			y: boxCy - h / 2,
			w,
			h,
			scale,
			cx: boxCx + seatDX * scale,
			cy: boxCy + seatDY * scale,
		};
	});

	// The board OUTLINE. A row's board edge is that row's contraction of the FLAT edge (the cell
	// half-widths cancel exactly), so only the back and front rows are needed: the sides are
	// straight lines between them.
	const backScale = rowScale(0);
	const frontScale = rowScale(frontRow);
	const backY = originY + (gapY * backScale) / 2;
	const frontY = originY + pitchY * rowSum(frontRow) + (gapY * frontScale) / 2 + cellH * frontScale;
	const outline: Vec2[] = [
		{ x: converge(left, backScale), y: backY },
		{ x: converge(left + width, backScale), y: backY },
		{ x: converge(left + width, frontScale), y: frontY },
		{ x: converge(left, frontScale), y: frontY },
	];
	const xs = outline.map((p) => p.x);
	const ys = outline.map((p) => p.y);
	const clipX = Math.min(...xs);
	const clipY = Math.min(...ys);
	return {
		...flat,
		seats: perspectiveSeats,
		outline,
		clip: { x: clipX, y: clipY, w: Math.max(...xs) - clipX, h: Math.max(...ys) - clipY },
	};
}

/**
 * One DEPTH SEGMENT of a game screen: a stretch of its draw order that the editor gives its own
 * stack of surfaces (2D → rig → text → FX).
 *
 * The editor draws each kind on a surface of its own, so inside one stack every FX sits above
 * every sprite, rig and text whatever the outline says. The game draws one scene graph in outline
 * order. Walking the tree in that order — into groups, parts and nested components — and starting
 * a new stack at the first art drawn after an FX puts that art back above the FX, at any depth. A
 * screen with no FX ahead of other art stays ONE segment, keyed by the scene id, so its surfaces
 * and report keys are what they always were.
 */
export interface DepthSegment {
	/** The scene id for the first segment, `<sceneId>#seg<i>` after it. */
	key: string;
	sceneId: string;
	index: number;
	/** The top-level nodes with anything in this segment, in doc order. A group or component that
	 * an FX splits appears in every segment it spans. */
	nodes: LayoutNode[];
	/** True when this one segment is the whole screen (nothing was split off). */
	whole: boolean;
	/** Which segment each node is drawn in, keyed by {@link depthKey} of its id path (a nested
	 * component's nodes sit under the instance's id). Shared by every segment of the screen. */
	segmentOf: Map<string, number>;
	/** Changes exactly when the screen's split does — for memoizing what is derived from it. */
	sig: string;
}

/** What a renderer needs to draw ONE segment: the screen's split and the segment to keep. */
export interface DepthSlice {
	segmentOf: Map<string, number>;
	index: number;
}

/** The key of a node's id path from the top of its screen (component def roots are skipped, as
 * every renderer expands an instance straight into `def.root.children`). */
export function depthKey(ids: readonly string[]): string {
	return ids.join('\n');
}

/** The segment a node at this id path draws in. A path the split never visited (a repeater's cards,
 * say) draws with its nearest ancestor. */
export function depthSegmentOf(segmentOf: Map<string, number>, ids: readonly string[]): number {
	for (let i = ids.length; i > 0; i--) {
		const seg = segmentOf.get(depthKey(ids.slice(0, i)));
		if (seg !== undefined) return seg;
	}
	return 0;
}

/** Whether the node at this id path is drawn in `slice`'s segment (`null` ⇒ the whole screen). */
export function inDepthSlice(slice: DepthSlice | null, ids: readonly string[]): boolean {
	return !slice || depthSegmentOf(slice.segmentOf, ids) === slice.index;
}

/** The nodes a renderer expands a node into — a group's children, a component's def children —
 * with the component depth/stack they recurse at; `null` for a node that is drawn as itself. */
function depthChildren(
	n: LayoutNode,
	componentMap: Map<string, ComponentDef>,
	depth: number,
	stack: string[],
): { nodes: LayoutNode[]; depth: number; stack: string[] } | null {
	if (n.kind === 'container') return { nodes: n.children, depth, stack };
	if (n.kind === 'componentInstance') {
		const def = componentMap.get(n.componentId);
		if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) return null;
		return { nodes: def.root.children, depth: depth + 1, stack: [...stack, def.id] };
	}
	return null;
}

/** Split a screen into {@link DepthSegment}s: walk its tree in draw order and start a new segment
 * at the first node that draws art of its own once the current one holds an FX. A group or a
 * resolvable component draws only its children, unless it is a bound anchor (its preview / part
 * skin); a missing component still draws its placeholder. */
export function depthSegments(
	scene: Scene,
	componentMap: Map<string, ComponentDef>,
): DepthSegment[] {
	const segmentOf = new Map<string, number>();
	const touched: Set<string>[] = [new Set()];
	let index = 0;
	let hasFx = false;
	const walk = (
		nodes: LayoutNode[],
		ids: string[],
		depth: number,
		stack: string[],
		top: string | null,
	): void => {
		for (const n of nodes) {
			const path = [...ids, n.id];
			const children = depthChildren(n, componentMap, depth, stack);
			const ownArt = n.kind !== 'effect' && (!!n.bind || !children);
			if (ownArt && hasFx) {
				index++;
				touched.push(new Set());
				hasFx = false;
			}
			segmentOf.set(depthKey(path), index);
			touched[index].add(top ?? n.id);
			if (n.kind === 'effect') hasFx = true;
			if (children) walk(children.nodes, path, children.depth, children.stack, top ?? n.id);
		}
	};
	walk(scene.nodes, [], 0, [], null);
	const sig = [...segmentOf].map(([k, i]) => `${k}=${i}`).join('|');
	return touched.map((ids, i) => ({
		key: i === 0 ? scene.id : `${scene.id}#seg${i}`,
		sceneId: scene.id,
		index: i,
		nodes: scene.nodes.filter((n) => ids.has(n.id)),
		whole: touched.length === 1,
		segmentOf,
		sig,
	}));
}

/** A placed effect's measured particle spread, in the node's own local space: `x`/`y` are the
 * top-left offset from the node origin (`EditorEffectLayer` → the selection box). */
export interface SpreadBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The smallest box enclosing both. */
export function unionBox(a: SpreadBox, b: SpreadBox): SpreadBox {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Fold the effect overlays' spread reports into one box per node id. Each scene, depth segment
 * and blend group reports from its own overlay, and the placements of one component part can land
 * in different ones, so a node reports the union of all its boxes. */
export function mergeSpreadBoxes(
	reports: Iterable<Map<string, SpreadBox>>,
): Map<string, SpreadBox> {
	const merged = new Map<string, SpreadBox>();
	for (const report of reports) {
		for (const [id, box] of report) {
			const prev = merged.get(id);
			merged.set(id, prev ? unionBox(prev, box) : box);
		}
	}
	return merged;
}
