import { resolveTransform, type LayoutType, type Scene } from 'engine-layout';

export interface HudPos {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	visible: boolean;
}

/**
 * Resolve a HUD element's transform from an editor HUD scene by node id, so the
 * coded `<UI>` can position its snippets from author-edited data. `canvas`-space
 * scenes (the corners) apply `screenAnchor` (worldPos = screenAnchor*canvasSize
 * + x/y). Falls back to the supplied literal when the scene/node is absent, so a
 * game that opts out — or a node the author hasn't placed — renders as before.
 */
export function hudPos(
	scene: Scene | undefined,
	id: string,
	layoutType: LayoutType,
	canvas: { width: number; height: number },
	fallback: { x: number; y: number; scaleX?: number; scaleY?: number },
): HudPos {
	const node = scene?.nodes.find((n) => n.id === id);
	if (!node) {
		return {
			x: fallback.x,
			y: fallback.y,
			scaleX: fallback.scaleX ?? 1,
			scaleY: fallback.scaleY ?? 1,
			visible: true,
		};
	}
	const t = resolveTransform(node, layoutType);
	let x = t.x;
	let y = t.y;
	if (scene?.space === 'canvas' && t.screenAnchor) {
		x = t.screenAnchor.x * canvas.width + t.x;
		y = t.screenAnchor.y * canvas.height + t.y;
	}
	return {
		x,
		y,
		scaleX: t.scale?.x ?? 1,
		scaleY: t.scale?.y ?? 1,
		visible: t.visible,
	};
}
