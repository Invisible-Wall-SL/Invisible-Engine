import type { LayoutNode, LayoutType, NodeOverride, ResolvedTransform, Scene } from './types';

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
		node.kind === 'text'
			? node
			: undefined;
	const tintedBase = node.kind === 'sprite' ? node : undefined;

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
		visible,
		screenAnchor: override.screenAnchor ?? node.screenAnchor,
	};
}
