import {
	getHudTextOverride,
	resolveTransform,
	type HudTextOverride,
	type LayoutType,
	type Scene,
	type TextStyle,
} from 'engine-layout';

export interface HudPos {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	/** Authored rotation in radians (resolved base + override). 0 when unset. */
	rotation: number;
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
			rotation: 0,
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
		rotation: t.rotation ?? 0,
		visible: t.visible,
	};
}

/**
 * Read an editor-authored font/text override for a HUD text element (logo /
 * game-name) from a HUD scene by node id, so `<LayoutEditable>` can hand it to the
 * game's coded snippet. `undefined` when the scene/node is absent or unstyled →
 * the snippet renders its coded default (parity).
 */
export function hudTextOverride(scene: Scene | undefined, id: string): HudTextOverride | undefined {
	return getHudTextOverride(scene?.nodes.find((n) => n.id === id));
}

/** A HUD bind anchor's editor-authored `bind.props`, defensively narrowed. */
function hudProps(scene: Scene | undefined, id: string): Record<string, unknown> | undefined {
	const props = scene?.nodes.find((n) => n.id === id)?.bind?.props;
	if (!props || typeof props !== 'object') return undefined;
	return props as Record<string, unknown>;
}

/**
 * Read an editor-authored text-style override (`bind.props.style`) for a HUD bar
 * LABEL element, so `<LayoutEditable>` can merge it over the label's coded base
 * styles. `undefined` when the scene/node/style is absent → coded default (parity).
 */
export function hudStyle(scene: Scene | undefined, id: string): Partial<TextStyle> | undefined {
	const style = hudProps(scene, id)?.style;
	return style && typeof style === 'object' ? (style as Partial<TextStyle>) : undefined;
}

/**
 * Read an editor-authored replacement caption (`bind.props.text`) for a HUD bar
 * LABEL element. `undefined` when absent → the coded caption (parity).
 */
export function hudText(scene: Scene | undefined, id: string): string | undefined {
	const text = hudProps(scene, id)?.text;
	return typeof text === 'string' ? text : undefined;
}

/**
 * Read an editor-authored recolour tint (`bind.props.tint`, a Pixi colour number)
 * for a HUD bar BUTTON element. `undefined` when absent → no tint (white = parity).
 */
export function hudTint(scene: Scene | undefined, id: string): number | undefined {
	const tint = hudProps(scene, id)?.tint;
	return typeof tint === 'number' ? tint : undefined;
}

/**
 * Portrait parity gate (the data-driven portrait HUD opt-in). Portrait's coded
 * layout (`LayoutPortrait.svelte`) is an animated fold-out drawer, so unlike the
 * other three layoutTypes a doc must EXPLICITLY carry portrait authoring before we
 * drive it from data — otherwise a doc with no portrait overrides would render its
 * desktop coords inside the 1080×1920 portrait box. True when at least one HUD node
 * (bar OR corners) carries an `overrides.portrait` entry; the freshly-seeded
 * `hudBarScene()` does (it now emits portrait overrides), so a seeded / "Refresh HUD
 * layer" doc opts in, while an un-refreshed doc keeps the coded `LayoutPortrait`.
 */
export function hudHasPortrait(hud: { bar?: Scene; corners?: Scene } | undefined): boolean {
	const hasPortraitOverride = (scene: Scene | undefined): boolean =>
		(scene?.nodes ?? []).some((node) => node.overrides?.portrait !== undefined);
	return hasPortraitOverride(hud?.bar) || hasPortraitOverride(hud?.corners);
}
