import type { LayoutNode, Scene } from '../types';

/**
 * Engine-truth import of the game HUD (the `<UI>` layer) as editor scenes — the
 * logo / game-name corners + the bottom bar (balance/win/bet labels + the spin/
 * menu/bet button cluster). The HUD is identical across game types (one shared
 * `components-ui-pixi/UI`), so this module is reused by every reference layout
 * and the per-project seed.
 *
 * Two scenes, by coordinate space (see `Scene.space`):
 * - `hudBar` (`standard`) — the bottom bar, authored in the fixed 1920×1080
 *   standard box. Coordinates are the FLATTENED absolute positions from
 *   `LayoutDesktop.svelte` (its pivot-centred inner container folded in), so the
 *   game renders byte-for-byte when this scene is mounted in
 *   `<MainContainer standard alignVertical="bottom">`.
 * - `hudCorners` (`canvas`) — logo + game name, pinned to the window edges via
 *   `screenAnchor` (generalises `LayoutDesktop`'s `x = canvasWidth - 20`).
 *
 * Each element is a `bind` node: the editor draws a positionable placeholder;
 * the game mounts the registered leaf component at the node's transform.
 *
 * NOTE: desktop positions only for now — per-layoutType `overrides` for tablet/
 * landscape/portrait (each `Layout*.svelte` arranges the bar differently) are a
 * follow-up. Other layoutTypes currently inherit the desktop placement.
 */

// --- LayoutDesktop.svelte derived constants (kept in sync with components-ui-pixi) ---
const UI_BASE_SIZE = 150;
const DESKTOP_BASE_SIZE = UI_BASE_SIZE * 0.9; // 135
const DESKTOP_BG_WIDTHS = [
	DESKTOP_BASE_SIZE * (188 / 116),
	800,
	350,
	DESKTOP_BASE_SIZE * (340 / 116),
];
const STANDARD = { width: 1920, height: 1080 };

// The bottom bar's inner container in LayoutDesktop sits at (W*0.5, H-BASE-10)
// with pivot = anchor{0.5,0} over the summed background width. Folding that in
// gives the inner origin in standard-box coords; child literals are added to it.
const BAR_ORIGIN_X = STANDARD.width * 0.5 - 0.5 * DESKTOP_BG_WIDTHS.reduce((s, w) => s + w, 0);
const BAR_ORIGIN_Y = STANDARD.height - DESKTOP_BASE_SIZE - 10;
const LABEL_Y = DESKTOP_BASE_SIZE * 0.5 - 160;
const BTN_Y = DESKTOP_BASE_SIZE * 0.5;
const BTN_SCALE = { x: 0.8, y: 0.8 };

/** A bottom-bar element: a bind node at the flattened absolute standard-box position. */
function barNode(
	id: string,
	label: string,
	component: string,
	localX: number,
	localY: number,
	props: Record<string, unknown>,
): LayoutNode {
	return {
		id,
		label,
		kind: 'container',
		x: BAR_ORIGIN_X + localX,
		y: BAR_ORIGIN_Y + localY,
		scale: BTN_SCALE,
		bind: { component, props },
		children: [],
	};
}

/** Bottom bar — balance/win/bet labels + the button cluster (standard space). */
export function hudBarScene(): Scene {
	return {
		id: 'hudBar',
		name: 'HUD — bottom bar',
		space: 'standard',
		nodes: [
			barNode('hud-balance', 'Balance', 'UiLabelBalance', 900 - 500, LABEL_Y, { stacked: true }),
			barNode('hud-win', 'Win', 'UiLabelWin', 900, LABEL_Y, { stacked: true }),
			barNode('hud-bet', 'Bet', 'UiLabelBet', 900 + 500, LABEL_Y, { stacked: true }),
			barNode('hud-btn-menu', 'Menu', 'UiButtonMenu', 220, BTN_Y, { anchor: 0.5 }),
			barNode('hud-btn-buybonus', 'Buy bonus', 'UiButtonBuyBonus', 220 + 150, BTN_Y, { anchor: 0.5 }),
			barNode('hud-btn-autospin', 'Auto spin', 'UiButtonAutoSpin', 160 + 150 * 4, BTN_Y, {
				anchor: 0.5,
			}),
			barNode('hud-btn-bet', 'Spin / Bet', 'UiButtonBet', 160 + 150 * 5, BTN_Y, { anchor: 0.5 }),
			barNode('hud-btn-turbo', 'Turbo', 'UiButtonTurbo', 160 + 150 * 6, BTN_Y, { anchor: 0.5 }),
			barNode('hud-btn-decrease', 'Decrease', 'UiButtonDecrease', 1440, BTN_Y, { anchor: 0.5 }),
			barNode('hud-btn-increase', 'Increase', 'UiButtonIncrease', 1440 + 150, BTN_Y, {
				anchor: 0.5,
			}),
		],
	};
}

/** Logo + game name, pinned to the window edges (canvas space). */
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
