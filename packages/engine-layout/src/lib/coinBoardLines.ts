import { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';
import { resolveTransform } from './resolveTransform';
import type { ContainerNode, LayoutType, NodeOverride, Scene } from './types';

/**
 * WHERE A COIN BOARD'S LINES SELECTOR SITS (`docs/design/hold-and-win-coin-board.md` §1.3). The
 * selector is coded (`CoinBoardLinesSelector` in the shared runtime) and shows only on a board whose
 * player picks the lines; this is its placement, shared by the runtime and the coin-board Scene
 * Editor template so the two cannot disagree.
 *
 * An authorable ANCHOR: the HUD bar's `hud-lines` node, an empty container the author moves and
 * scales per layout like any HUD node. Without it (every project scaffolded before Phase 13e) the
 * selector sits right of the HUD's `hud-bet` readout, or above it when the standard box has no room,
 * and in the bottom-right corner when there is no bet node — the 13d placement.
 */

/** The HUD bar node the lines selector sits at. */
export const HUD_LINES_NODE = 'hud-lines';

/** The selector's panel, in its own space: `width` × `height`, its top `top` above the origin (the
 *  origin is the caption's top centre). */
export const LINES_SELECTOR_PANEL = { width: 200, height: 135, top: -20 } as const;

const GAP = 16;
/** The bet readout's panel width (`UiLabel`'s tiled ticker at the HUD font size). */
const READOUT_WIDTH = 135 * (326 / 73);
const CORNER_SCALE = 0.8;

export type LinesSelectorSpot = { x: number; y: number; scale: number };

const boxOf = (layoutType: string) =>
	STANDARD_MAIN_SIZES_MAP[layoutType as keyof typeof STANDARD_MAIN_SIZES_MAP] ??
	STANDARD_MAIN_SIZES_MAP.desktop;

/** The selector's coded spot in `layoutType`: beside the bet readout (or above it), else the corner. */
export function codedLinesSelectorSpot(
	bar: Scene | undefined,
	layoutType: LayoutType,
): LinesSelectorSpot {
	const box = boxOf(layoutType);
	const { width, height, top } = LINES_SELECTOR_PANEL;
	const bet = bar?.nodes.find((n) => n.id === 'hud-bet');
	const t = bet && resolveTransform(bet, layoutType);
	if (!t?.visible) {
		return {
			x: box.width - GAP - (width / 2) * CORNER_SCALE,
			y: box.height - GAP - (height + top) * CORNER_SCALE,
			scale: CORNER_SCALE,
		};
	}
	const scale = t.scale?.x ?? 1;
	const right = t.x + (READOUT_WIDTH / 2 + GAP + width / 2) * scale;
	return right + (width / 2) * scale <= box.width
		? { x: right, y: t.y, scale }
		: { x: t.x, y: t.y - (height + GAP) * scale, scale };
}

/** Where the selector draws in `layoutType`: at the bar's `hud-lines` anchor where it is shown,
 *  else at its coded spot. */
export function linesSelectorSpot(
	bar: Scene | undefined,
	layoutType: LayoutType,
): LinesSelectorSpot {
	const anchor = bar?.nodes.find((n) => n.id === HUD_LINES_NODE);
	const t = anchor && resolveTransform(anchor, layoutType);
	if (!t?.visible) return codedLinesSelectorSpot(bar, layoutType);
	return { x: t.x, y: t.y, scale: t.scale?.x ?? 1 };
}

/**
 * The `hud-lines` anchor for `bar`, placed where the coded selector draws in every layout, so a
 * scaffolded coin board looks exactly as before until the author moves it. Draws nothing itself.
 */
export function linesSelectorAnchor(bar: Scene): ContainerNode {
	const at = (layoutType: LayoutType) => codedLinesSelectorSpot(bar, layoutType);
	const desktop = at('desktop');
	const scaleOf = (spot: LinesSelectorSpot) => ({ scale: { x: spot.scale, y: spot.scale } });
	const overrides: Partial<Record<LayoutType, NodeOverride>> = {};
	for (const layoutType of Object.keys(STANDARD_MAIN_SIZES_MAP)) {
		if (layoutType === 'desktop') continue;
		const spot = at(layoutType);
		overrides[layoutType] = {
			x: spot.x,
			y: spot.y,
			...(spot.scale !== desktop.scale ? scaleOf(spot) : {}),
		};
	}
	return {
		id: HUD_LINES_NODE,
		label: 'Lines selector (when the player picks the lines)',
		kind: 'container',
		x: desktop.x,
		y: desktop.y,
		...(desktop.scale !== 1 ? scaleOf(desktop) : {}),
		overrides,
		preview: {
			w: LINES_SELECTOR_PANEL.width,
			h: LINES_SELECTOR_PANEL.height,
			style: 'label',
		},
		children: [],
	};
}
