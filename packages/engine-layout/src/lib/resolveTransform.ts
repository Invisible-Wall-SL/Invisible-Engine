import type {
	LayoutNode,
	LayoutType,
	NodeOverride,
	ResolvedTransform,
	Scene,
	TextStyle,
} from './types';

/**
 * A node's effective position — `screenAnchor` folded into x/y for a `canvas`-space scene,
 * raw x/y everywhere else. THE one implementation: the runtime (`<LayoutNodeView>`) and the
 * editor (`editorCanvas.helpers.ts` — canvas draw, overlays, hit-testing) both call this, so
 * "where does this node sit" cannot mean two different things in the two surfaces.
 *
 * It exists because they DID mean two different things. `screenAnchor` is defined only for
 * `canvas`-space scenes ({@link BaseNode.screenAnchor}); the editor honoured that, the runtime
 * applied the anchor in every space. A stray `screenAnchor` on a node in a `game` scene
 * therefore rendered at `canvasWidth + x` — off-screen — while the editor drew it exactly
 * where it was placed. The node was simply gone from the game, with no error and no warning.
 * Keep this shared: two copies of this rule is precisely how that shipped.
 */
export function anchoredPosition(
	transform: Pick<ResolvedTransform, 'x' | 'y' | 'screenAnchor'>,
	space: Scene['space'],
	canvasWidth: number,
	canvasHeight: number,
): { x: number; y: number } {
	if (space === 'canvas' && transform.screenAnchor) {
		return {
			x: transform.screenAnchor.x * canvasWidth + transform.x,
			y: transform.screenAnchor.y * canvasHeight + transform.y,
		};
	}
	return { x: transform.x, y: transform.y };
}

/**
 * Merge base node transform with per-layoutType override. Override fields
 * win when defined; everything else falls through. `visibleFor` (when set)
 * gates the node to the listed layoutTypes.
 */
export function resolveTransform(node: LayoutNode, layoutType: LayoutType): ResolvedTransform {
	const override: NodeOverride = node.overrides?.[layoutType] ?? {};
	const gated = node.visibleFor && !node.visibleFor.includes(layoutType);
	const visible = override.visible !== undefined ? override.visible : !gated;

	const sizedBase =
		node.kind === 'sprite' ||
		node.kind === 'spine' ||
		node.kind === 'container' ||
		node.kind === 'rect' ||
		node.kind === 'text' ||
		node.kind === 'flipbook'
			? node
			: undefined;
	const tintedBase = node.kind === 'sprite' || node.kind === 'flipbook' ? node : undefined;

	return {
		x: override.x ?? node.x,
		y: override.y ?? node.y,
		anchor: override.anchor ?? node.anchor,
		scale: override.scale ?? node.scale,
		rotation: override.rotation ?? node.rotation,
		alpha: override.alpha ?? node.alpha,
		zIndex: override.zIndex ?? node.zIndex,
		width: override.width ?? sizedBase?.width,
		height: override.height ?? sizedBase?.height,
		tint: override.tint ?? tintedBase?.tint,
		blendMode: override.blendMode ?? node.blendMode,
		visible,
		screenAnchor: override.screenAnchor ?? node.screenAnchor,
	};
}

const sameEntries = (a: object, b: object, same: (x: unknown, y: unknown) => boolean): boolean => {
	const keys = Object.keys(a);
	const fieldsA = a as Record<string, unknown>;
	const fieldsB = b as Record<string, unknown>;
	return (
		keys.length === Object.keys(b).length && keys.every((key) => same(fieldsA[key], fieldsB[key]))
	);
};

const samePoint = (a: unknown, b: unknown): boolean =>
	Object.is(a, b) ||
	(!!a && !!b && typeof a === 'object' && typeof b === 'object' && sameEntries(a, b, Object.is));

/**
 * `previous` when `next` reads the same in every field (a point compared by its own fields), else
 * `next`. A node's transform is derived again whenever anything it folds in moves — a timeline
 * playing the node samples every frame — and a new object with the same values still re-runs
 * everything that reads it: each prop sync of the node's view, every frame. Handing back the
 * previous object stops that where nothing the transform says has changed.
 */
export function stableTransform(
	previous: ResolvedTransform | undefined,
	next: ResolvedTransform,
): ResolvedTransform {
	return previous && sameEntries(previous, next, samePoint) ? previous : next;
}

/**
 * A text node's effective STYLE for a layoutType — the base `style` with the per-layoutType
 * {@link NodeOverride.style} patch merged on top ({@link resolveTransform}'s sibling for the
 * one field that never belonged in {@link ResolvedTransform}: text style is a nested object, not
 * a flat transform field). THE one implementation, shared by the runtime (`<LayoutNodeView>`)
 * and the editor (`EditorTextLayer`) so a per-ratio font size can't render one way in the editor
 * and another in the game.
 *
 * Returns a FRESH object (never `node.style` by reference) so a caller can safely fold its own
 * param-bound overrides on top, and — like `<LayoutNodeView>`'s existing spread — so PixiJS
 * re-syncs the `<Text>` when a field changes. A non-text node ⇒ `{}` (nothing to style). No
 * override for this layoutType ⇒ a copy of the base style (parity).
 */
export function resolveOverrideTextStyle(
	node: LayoutNode,
	layoutType: LayoutType,
): Partial<TextStyle> {
	if (node.kind !== 'text') return {};
	const override = node.overrides?.[layoutType]?.style;
	return override ? { ...node.style, ...override } : { ...node.style };
}
