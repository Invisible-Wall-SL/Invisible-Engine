import type { LayoutNode, NodeOverride, Scene } from '../types';

/**
 * Engine-truth import of the game HUD (the `<UI>` layer) as editor scenes — the
 * logo / game-name corners + the bottom bar (balance/win/bet labels + the spin/
 * menu/bet button cluster). The HUD is identical across game types (one shared
 * `components-ui-pixi/UI`), so this module is reused by every reference layout
 * and the per-project seed.
 *
 * Two scenes, by coordinate space (see `Scene.space`):
 * - `hudBar` (`standard`) — the bottom bar, authored in the fixed standard box
 *   (1920×1080, or 1920×1920 for tablet). Each element is a bind node at the
 *   FLATTENED absolute position from the matching `Layout*.svelte` (its pivot-
 *   centred inner container folded in), with per-`layoutType` `overrides` for
 *   landscape + tablet. Desktop is the base. So the game renders byte-for-byte
 *   when these scenes are mounted in `<MainContainer standard alignVertical=…>`.
 * - `hudCorners` (`canvas`) — logo + game name, pinned to the window edges via
 *   `screenAnchor` (generalises `Layout*`'s `x = canvasWidth - 20`), identical
 *   across layoutTypes.
 *
 * PORTRAIT is intentionally omitted (no override): its bar lives in an animated
 * fold-out drawer (`LayoutPortrait.svelte`) — behaviour, not static placement —
 * so portrait keeps rendering the coded layout. The other three are data-driven.
 *
 * Positions are COMPUTED from the same constants as `Layout*.svelte` (not magic
 * numbers) so they stay verifiable.
 */

type XY = { x: number; y: number };

// --- desktop (LayoutDesktop.svelte) — box 1920×1080, element scale 0.8 ---
const D = 150 * 0.9; // DESKTOP_BASE_SIZE = 135
const D_SUM = D * (188 / 116) + 800 + 350 + D * (340 / 116); // DESKTOP_BACKGROUND_WIDTH_LIST sum
const dOX = 1920 * 0.5 - 0.5 * D_SUM;
const dOY = 1080 - D - 10;
const dLabelY = dOY + D * 0.5 - 160;
const dBtnY = dOY + D * 0.5;
const d = (lx: number, y: number): XY => ({ x: dOX + lx, y });

// --- landscape (LayoutLandscape.svelte) — box 1920×1080, scale 0.8, two groups ---
const L = 150 * 1.1; // LANDSCAPE_BASE_SIZE = 165
const L_SUM = L * (188 / 116) + 1000 + L * (373 / 116);
const lO1X = 1920 * 0.5 - 0.5 * L_SUM;
const lO1Y = 1080 - L - 40;
const lLabelY = lO1Y + L * 0.5;
const lBtnY = lO1Y + L * 0.5 - 90;
const l1 = (lx: number, y: number): XY => ({ x: lO1X + lx, y });
// right-edge vertical cluster (autoSpin / bet / turbo), pivot anchor {1, 0.5}
const lO2X = 1920 - 60 - L;
const lO2Y = 1080 * 0.5 - L * 0.5;
const l2 = (childY: number): XY => ({ x: lO2X + L * 0.5, y: lO2Y + childY });

// --- tablet (LayoutTablet.svelte) — box 1920×1920, scale 1, desktop base+widths ---
const tOX = 1920 * 0.5 - 0.5 * D_SUM;
const tOY = 1920 - D - 30;
const tLabelY = tOY + D * 0.5 - 220;
const tBtnY = tOY + D * 0.5;
const t = (lx: number, y: number): XY => ({ x: tOX + lx, y });

const DESKTOP_SCALE = { x: 0.8, y: 0.8 };
const TABLET_SCALE = { x: 1, y: 1 };

/** A bottom-bar element with its desktop base + landscape/tablet overrides. */
function barNode(
	id: string,
	label: string,
	component: string,
	props: Record<string, unknown>,
	desktop: XY,
	landscape: XY,
	tablet: XY,
): LayoutNode {
	const overrides: Partial<Record<'landscape' | 'tablet', NodeOverride>> = {
		landscape: { x: landscape.x, y: landscape.y }, // scale inherits desktop 0.8
		tablet: { x: tablet.x, y: tablet.y, scale: TABLET_SCALE },
	};
	return {
		id,
		label,
		kind: 'container',
		x: desktop.x,
		y: desktop.y,
		scale: DESKTOP_SCALE,
		bind: { component, props },
		overrides,
		children: [],
	};
}

const LABEL = { stacked: true };
const BTN = { anchor: 0.5 };

/** Bottom bar — balance/win/bet labels + the button cluster (standard space). */
export function hudBarScene(): Scene {
	return {
		id: 'hudBar',
		name: 'HUD — bottom bar',
		space: 'standard',
		nodes: [
			// labels
			barNode('hud-balance', 'Balance', 'UiLabelBalance', LABEL,
				d(900 - 500, dLabelY), l1(420, lLabelY), t(880 - 640, tLabelY)),
			barNode('hud-win', 'Win', 'UiLabelWin', LABEL,
				d(900, dLabelY), l1(910, lLabelY), t(880, tLabelY)),
			barNode('hud-bet', 'Bet', 'UiLabelBet', LABEL,
				d(900 + 500, dLabelY), l1(1400, lLabelY), t(880 + 640, tLabelY)),
			// buttons
			barNode('hud-btn-menu', 'Menu', 'UiButtonMenu', BTN,
				d(220, dBtnY), l1(85 + 20, lBtnY), t(20, tBtnY)),
			barNode('hud-btn-buybonus', 'Buy bonus', 'UiButtonBuyBonus', BTN,
				d(220 + 150, dBtnY), l1(220 + 20, lBtnY), t(20 + 180, tBtnY)),
			barNode('hud-btn-autospin', 'Auto spin', 'UiButtonAutoSpin', BTN,
				d(160 + 150 * 4, dBtnY), l2(L * 0.5 - 140), t(-10 + 180 * 4, tBtnY)),
			barNode('hud-btn-bet', 'Spin / Bet', 'UiButtonBet', BTN,
				d(160 + 150 * 5, dBtnY), l2(L * 0.5), t(-10 + 180 * 5, tBtnY)),
			barNode('hud-btn-turbo', 'Turbo', 'UiButtonTurbo', BTN,
				d(160 + 150 * 6, dBtnY), l2(L * 0.5 + 140), t(-10 + 180 * 6, tBtnY)),
			barNode('hud-btn-decrease', 'Decrease', 'UiButtonDecrease', BTN,
				d(1440, dBtnY), l1(1580, lBtnY), t(1560, tBtnY)),
			barNode('hud-btn-increase', 'Increase', 'UiButtonIncrease', BTN,
				d(1440 + 150, dBtnY), l1(1715, lBtnY), t(1560 + 180, tBtnY)),
		],
	};
}

/** Logo + game name, pinned to the window edges (canvas space, all layoutTypes). */
export function hudCornersScene(): Scene {
	return {
		id: 'hudCorners',
		name: 'HUD — corners',
		space: 'canvas',
		nodes: [
			{
				id: 'hud-gamename',
				label: 'Game name',
				kind: 'container',
				screenAnchor: { x: 0, y: 0 },
				x: 20,
				y: 0,
				bind: { component: 'HudGameName' },
				children: [],
			},
			{
				id: 'hud-logo',
				label: 'Logo',
				kind: 'container',
				screenAnchor: { x: 1, y: 0 },
				x: -20,
				y: 0,
				bind: { component: 'HudLogo' },
				children: [],
			},
		],
	};
}

/** Both HUD scenes, in render order (bar then corners). */
export function hudScenes(): Scene[] {
	return [hudBarScene(), hudCornersScene()];
}
