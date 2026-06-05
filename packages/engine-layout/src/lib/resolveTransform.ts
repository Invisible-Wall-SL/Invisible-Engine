import type { LayoutNode, LayoutType, NodeOverride, ResolvedTransform } from './types';

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
		node.kind === 'sprite' || node.kind === 'spine' || node.kind === 'container'
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
