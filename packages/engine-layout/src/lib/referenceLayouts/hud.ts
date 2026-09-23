import { HUD_BUTTON_ACTION_MAP } from '../buttonConvert';
import type { ComponentInstanceNode, LayoutNode, NodeOverride, Scene } from '../types';

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
 * PORTRAIT carries an override too (the UNFOLDED resting position of each bar
 * element), computed from `LayoutPortrait.svelte`'s constants. Its bar is an
 * animated fold-out DRAWER (behaviour, not static placement): `LayoutEditable`'s
 * portrait branch reproduces the drawer, applying the `drawerTween` y-offset ON TOP
 * of these resting coords (the author authors the unfolded layout). `<UIDefault>`
 * only routes portrait to `LayoutEditable` when the doc carries portrait authoring
 * (`hudHasPortrait`) — a freshly-seeded / "Refresh HUD layer" doc does, so it then
 * renders the data-driven portrait byte-for-byte like the coded `LayoutPortrait`;
 * an un-refreshed doc (no portrait override) keeps the coded layout (parity).
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

// --- portrait (LayoutPortrait.svelte) — box 1080×1920, scale 1 (the animated drawer).
// These are the UNFOLDED resting positions; `LayoutEditable`'s portrait branch adds
// the `drawerTween` y-offset on top (the author authors the unfolded layout). Each is
// the absolute (x, y) the coded layout places the element at in the 1080×1920 box.
const PW = 1080;
const PH = 1920;
const p = (x: number, y: number): XY => ({ x, y });

const DESKTOP_SCALE = { x: 0.8, y: 0.8 };
const TABLET_SCALE = { x: 1, y: 1 };
const PORTRAIT_SCALE = { x: 1, y: 1 };

// Real element sizes (unscaled) for the editor preview chips:
const BTN_SIZE = 150; // UI_BASE_SIZE — buttons are 150×150 rounded squares
const LABEL_W = D * 0.3 * 3 * (326 / 73); // UiLabel `base_ticker` width (≈603)
const LABEL_H = D * 0.3 * 3; // ≈135

/** A bottom-bar element with its desktop base + landscape/tablet overrides. */
function barNode(
	id: string,
	label: string,
	component: string,
	props: Record<string, unknown>,
	desktop: XY,
	landscape: XY,
	tablet: XY,
	portrait: XY,
): LayoutNode {
	const isLabel = props === LABEL;
	const overrides: Partial<Record<'landscape' | 'tablet' | 'portrait', NodeOverride>> = {
		landscape: { x: landscape.x, y: landscape.y }, // scale inherits desktop 0.8
		tablet: { x: tablet.x, y: tablet.y, scale: TABLET_SCALE },
		// Portrait = the drawer's UNFOLDED resting position (`LayoutEditable` adds the
		// fold tween); scale 1 (the coded `LayoutPortrait` uses no element scale).
		portrait: { x: portrait.x, y: portrait.y, scale: PORTRAIT_SCALE },
	};
	return {
		id,
		label,
		kind: 'container',
		x: desktop.x,
		y: desktop.y,
		// Anchor matches how the real snippet renders at the node origin: labels
		// are top-centred (UiLabel stacked), buttons centred.
		anchor: isLabel ? { x: 0.5, y: 0 } : { x: 0.5, y: 0.5 },
		scale: DESKTOP_SCALE,
		bind: { component, props },
		overrides,
		preview: isLabel
			? { w: LABEL_W, h: LABEL_H, style: 'label' }
			: { w: BTN_SIZE, h: BTN_SIZE, style: 'button' },
		children: [],
	};
}

const LABEL = { stacked: true };
const BTN = { anchor: 0.5 };

/**
 * A bottom-bar READOUT (balance / win / bet) as a `componentInstance` of the
 * `hudReadout` ComponentDef (§14 B4.4 parity flip). The OPT-IN replacement for
 * the `barNode(... 'UiLabel*' ...)` `bind` node: the def MOUNTS the coded
 * `HudReadout`, which reuses `UiLabel`'s stacked caption+value + the per-source
 * currency formatting + count-up — so the readout renders byte-for-byte where the
 * coded `Label*` snippet sat. Transform (x/y desktop + landscape/tablet overrides,
 * scale 0.8) is IDENTICAL to the `bind` `barNode`, so `LayoutEditable`'s `hudPos()`
 * lands it at the same position. The game feeds the live number via
 * `registerComponentValues` keyed by the `source` param; `countUp` is on only for
 * `win` (matching `LabelWin`'s tween; balance/bet snap, like their coded labels).
 *
 * Emitted ONLY when a consumer requests `{ readouts: true }` (currently just
 * `apps/lines` — see `hudScenes`). The default stays the `bind` `barNode`, so the
 * editor's "Add HUD layer", Book of Borut's seed, and every other consumer remain
 * byte-identical — the flip is `apps/lines`-scoped, as B4.4 requires.
 */
function readoutNode(
	id: string,
	label: string,
	source: 'balance' | 'win' | 'bet',
	desktop: XY,
	landscape: XY,
	tablet: XY,
	portrait: XY,
): ComponentInstanceNode {
	return {
		id,
		label,
		kind: 'componentInstance',
		componentId: 'hudReadout',
		x: desktop.x,
		y: desktop.y,
		anchor: { x: 0.5, y: 0 },
		scale: DESKTOP_SCALE,
		// The BET readout carries the `betMenu` action binding, because tapping the stake to change
		// it is what the readout DOES (the press has always been there, hard-coded inside `HudValue`).
		// Naming it as an action is what makes it authorable: the coded press still opens the HTML
		// bet menu, and the binding also projects a `<hud-bet>.onBetMenu` exec pin the flow can own to
		// show an authored screen instead. balance/win have no press, so they carry no action.
		params: {
			source,
			label,
			countUp: source === 'win',
			...(source === 'bet' ? { action: 'betMenu' } : {}),
		},
		overrides: {
			landscape: { x: landscape.x, y: landscape.y },
			tablet: { x: tablet.x, y: tablet.y, scale: TABLET_SCALE },
			portrait: { x: portrait.x, y: portrait.y, scale: PORTRAIT_SCALE },
		},
		preview: { w: LABEL_W, h: LABEL_H, style: 'label' },
	};
}

/** A coded `UiLabel*` `bind` label (the pre-B4.4 default for every consumer). */
function labelBarNode(
	id: string,
	label: string,
	component: string,
	desktop: XY,
	landscape: XY,
	tablet: XY,
	portrait: XY,
): LayoutNode {
	return barNode(id, label, component, LABEL, desktop, landscape, tablet, portrait);
}

/**
 * A bottom-bar BUTTON as a `componentInstance` of the `button` ComponentDef (§16.4
 * B6.4 parity flip). The OPT-IN replacement for a `barNode(... 'UiButton*' ...)`
 * `bind` node: the def MOUNTS the coded `ButtonFrame` + `ButtonLabel` parts, which
 * reuse `UiButton`'s tile + localized label — so the button renders byte-for-byte
 * where the coded `button*` snippet sat. Transform (x/y desktop + landscape/tablet
 * overrides, anchor `{0.5,0.5}`, scale 0.8) is IDENTICAL to the `bind` `barNode` it
 * replaces, so `LayoutEditable`'s `hudPos()` lands it at the same position. The game
 * feeds live behaviour (`onpress` + `disabled`/`active`/`label`) via
 * `registerComponentActions` keyed by the `action` param.
 *
 * `icon` names the localized glyph the coded button passed to `UiButton` (e.g.
 * `'menu'`); the spin button is the lone exception — it passes NO `icon`, so its
 * caption comes from the action's dynamic `label` TextSource (the bet↔stop flip).
 *
 * Emitted ONLY when a consumer requests `{ buttons: true }`. Default stays the
 * `bind` `barNode`, so the editor + Book of Borut + every other consumer remain
 * byte-identical — the flip is opt-in, exactly like `readouts` (B4.4).
 */
function buttonInstanceNode(
	id: string,
	label: string,
	action: string,
	icon: string | undefined,
	desktop: XY,
	landscape: XY,
	tablet: XY,
	portrait: XY,
	visibleSource?: string,
): ComponentInstanceNode {
	return {
		id,
		label,
		kind: 'componentInstance',
		componentId: 'button',
		x: desktop.x,
		y: desktop.y,
		anchor: { x: 0.5, y: 0.5 },
		scale: DESKTOP_SCALE,
		// Spin gets `{ action }` only (NO `icon`) so `ButtonLabel` renders the action's
		// dynamic `label` (bet↔stop); the other six get `{ action, icon }`. `visibleSource`
		// (turbo/auto-spin only) gates the instance on the config-feature store so it hides
		// exactly like the coded `UIDefault` `{#if config.features.*}` wrap (parity, B6 M1).
		params: {
			...(icon === undefined ? { action } : { action, icon }),
			...(visibleSource ? { visibleSource } : {}),
		},
		overrides: {
			landscape: { x: landscape.x, y: landscape.y },
			tablet: { x: tablet.x, y: tablet.y, scale: TABLET_SCALE },
			portrait: { x: portrait.x, y: portrait.y, scale: PORTRAIT_SCALE },
		},
		preview: { w: BTN_SIZE, h: BTN_SIZE, style: 'button' },
	};
}

/** Options for {@link hudBarScene}. */
export interface HudBarOptions {
	/**
	 * Emit balance/win/bet as parametric `componentInstance(hudReadout)` nodes
	 * (B4.4) instead of coded `UiLabel*` `bind` nodes. Opt-in, `apps/lines`-only:
	 * the game must register the `hudReadout` def + the coded `HudReadout` bound
	 * component + the `balance`/`win`/`bet` value sources for these to render.
	 * Absent/false ⇒ the pre-B4.4 coded `bind` labels (parity for the editor + Borut).
	 */
	readouts?: boolean;
	/**
	 * Emit the 7-button cluster (menu / buy-bonus / auto-spin / spin / turbo /
	 * decrease / increase) as parametric `componentInstance(button)` nodes (B6.4)
	 * instead of coded `UiButton*` `bind` nodes. Opt-in, currently DEFAULT-OFF even
	 * for `apps/lines` (the spin behaviour is re-implemented from `ButtonBetProvider`
	 * and needs online verification before it becomes the default): the game must
	 * register the `button` def + the coded `ButtonFrame`/`ButtonLabel` parts + the
	 * 7 `action` sources (`registerComponentActions`) for these to render — AND mount
	 * a replacement Space hotkey gated on this same flag (the flip suppresses the
	 * coded `ButtonBet`'s own `OnHotkey`). Absent/false ⇒ the coded `bind` buttons +
	 * their coded hotkey (parity for the editor + Borut + the current `apps/lines`).
	 */
	buttons?: boolean;
}

/** Bottom bar — balance/win/bet labels + the button cluster (standard space). */
export function hudBarScene(options: HudBarOptions = {}): Scene {
	const balanceLabel: LayoutNode = options.readouts
		? readoutNode(
				'hud-balance',
				'Balance',
				'balance',
				d(900 - 500, dLabelY),
				l1(420, lLabelY),
				t(880 - 640, tLabelY),
				p(PW * 0.5, PH - 270),
			)
		: labelBarNode(
				'hud-balance',
				'Balance',
				'UiLabelBalance',
				d(900 - 500, dLabelY),
				l1(420, lLabelY),
				t(880 - 640, tLabelY),
				p(PW * 0.5, PH - 270),
			);
	const winLabel: LayoutNode = options.readouts
		? readoutNode(
				'hud-win',
				'Win',
				'win',
				d(900, dLabelY),
				l1(910, lLabelY),
				t(880, tLabelY),
				p(PW * 0.5, PH - 670),
			)
		: labelBarNode(
				'hud-win',
				'Win',
				'UiLabelWin',
				d(900, dLabelY),
				l1(910, lLabelY),
				t(880, tLabelY),
				p(PW * 0.5, PH - 670),
			);
	const betLabel: LayoutNode = options.readouts
		? readoutNode(
				'hud-bet',
				'Bet',
				'bet',
				d(900 + 500, dLabelY),
				l1(1400, lLabelY),
				t(880 + 640, tLabelY),
				p(PW * 0.5, PH - 130),
			)
		: labelBarNode(
				'hud-bet',
				'Bet',
				'UiLabelBet',
				d(900 + 500, dLabelY),
				l1(1400, lLabelY),
				t(880 + 640, tLabelY),
				p(PW * 0.5, PH - 130),
			);
	// Each button is coded `UiButton*` `bind` by default; `componentInstance(button)`
	// when `buttons` is set (B6.4). `btn()` picks per the flag, passing the SAME
	// transform args to both builders so the flip is byte-identical placement. The
	// `action`/`icon` are looked up from `HUD_BUTTON_ACTION_MAP` (the single source,
	// shared with the editor's "Convert to parametric button") keyed by `component`:
	// menu→`menu`, buyBonus→`buyBonus`, autoSpin→`autoSpin`, turbo→`turbo`,
	// increase→`increase`, decrease→`decrease` (the EXACT `icon` each passes to
	// `UiButton`); the spin button (`hud-btn-bet`, `UiButtonBet`) is `action:'spin'`
	// with NO icon — its caption is the action's dynamic `label` (bet↔stop), matching
	// `ButtonBet`'s text logic.
	const btn = (
		id: string,
		label: string,
		component: string,
		desktop: XY,
		landscape: XY,
		tablet: XY,
		portrait: XY,
	): LayoutNode | ComponentInstanceNode => {
		if (!options.buttons)
			return barNode(id, label, component, BTN, desktop, landscape, tablet, portrait);
		// turbo / auto-spin carry a config-feature `visibleSource` (from the shared map) so they hide
		// when the game config disables that feature — parity with the coded `UIDefault`
		// `{#if config.features.*}` wraps (the other five buttons have no such coded gate).
		const { action, icon, visibleSource } = HUD_BUTTON_ACTION_MAP[component];
		return buttonInstanceNode(
			id,
			label,
			action,
			icon,
			desktop,
			landscape,
			tablet,
			portrait,
			visibleSource,
		);
	};
	return {
		id: 'hudBar',
		name: 'HUD — bottom bar',
		space: 'standard',
		align: { vertical: 'bottom' },
		nodes: [
			// labels — coded `UiLabel*` `bind` by default; `componentInstance(hudReadout)`
			// when `readouts` is set (B4.4, `apps/lines` only). Either way the live HUD
			// renders identically; the readout path is reversible (drop `readouts`).
			balanceLabel,
			winLabel,
			betLabel,
			// buttons — coded `UiButton*` `bind` by default; `componentInstance(button)`
			// when `buttons` is set (B6.4). Reversible (drop `buttons`).
			btn(
				'hud-btn-menu',
				'Menu',
				'UiButtonMenu',
				d(220, dBtnY),
				l1(85 + 20, lBtnY),
				t(20, tBtnY),
				p(PW * 0.5 - 440, PH - 400),
			),
			btn(
				'hud-btn-buybonus',
				'Buy bonus',
				'UiButtonBuyBonus',
				d(220 + 150, dBtnY),
				l1(220 + 20, lBtnY),
				t(20 + 180, tBtnY),
				p(PW * 0.5 + 440, PH - 400),
			),
			btn(
				'hud-btn-autospin',
				'Auto spin',
				'UiButtonAutoSpin',
				d(160 + 150 * 4, dBtnY),
				l2(L * 0.5 - 140),
				t(-10 + 180 * 4, tBtnY),
				p(PW * 0.5 - 180, PH - 400),
			),
			btn(
				'hud-btn-bet',
				'Spin / Bet',
				'UiButtonBet',
				d(160 + 150 * 5, dBtnY),
				l2(L * 0.5),
				t(-10 + 180 * 5, tBtnY),
				p(PW * 0.5, PH - 400),
			),
			btn(
				'hud-btn-turbo',
				'Turbo',
				'UiButtonTurbo',
				d(160 + 150 * 6, dBtnY),
				l2(L * 0.5 + 140),
				t(-10 + 180 * 6, tBtnY),
				p(PW * 0.5 + 180, PH - 400),
			),
			btn(
				'hud-btn-decrease',
				'Decrease',
				'UiButtonDecrease',
				d(1440, dBtnY),
				l1(1580, lBtnY),
				t(1560, tBtnY),
				p(PW * 0.5 - 390, PH - 85),
			),
			btn(
				'hud-btn-increase',
				'Increase',
				'UiButtonIncrease',
				d(1440 + 150, dBtnY),
				l1(1715, lBtnY),
				t(1560 + 180, tBtnY),
				p(PW * 0.5 + 390, PH - 85),
			),
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
				anchor: { x: 0, y: 0 },
				// Left text-less: the game-name defaults to the PROJECT display name,
				// injected at doc-load (applyHudGameNameDefault), overridable in the editor.
				bind: { component: 'HudGameName' },
				preview: { w: 260, h: 56, style: 'text' },
				children: [],
			},
			{
				id: 'hud-logo',
				label: 'Logo',
				kind: 'container',
				screenAnchor: { x: 1, y: 0 },
				x: -20,
				y: 0,
				anchor: { x: 1, y: 0 },
				bind: { component: 'HudLogo' },
				preview: { w: 220, h: 56, style: 'text' },
				children: [],
			},
		],
	};
}

/**
 * Both HUD scenes, in render order (bar then corners). `options` forwards to
 * {@link hudBarScene} — pass `{ readouts: true }` to emit the parametric
 * `hudReadout` instances (B4.4, `apps/lines`); omit for the coded `bind` labels.
 */
export function hudScenes(options: HudBarOptions = {}): Scene[] {
	return [hudBarScene(options), hudCornersScene()];
}

/** Scene ids of the reusable HUD screens (bottom bar + logo/game-name corners). */
export const HUD_SCENE_IDS: readonly string[] = ['hudBar', 'hudCorners'];

/** True when a scene is a HUD screen — used by the editor to group them in the
 * Screens list and render them on the top-most layer (the game draws the HUD as
 * its top UI layer, so the editor must match). Matches the two canonical HUD
 * scenes (`hudBar`/`hudCorners`) AND any author-created HUD screen, which the
 * editor mints with a `hud_` id prefix (the "New HUD screen" button). */
export function isHudScene(scene: { id: string }): boolean {
	return HUD_SCENE_IDS.includes(scene.id) || scene.id.startsWith('hud_');
}

/**
 * Default label text for the coded HUD text anchors (game-name / logo), keyed by
 * their bound component. Pre-filled on the anchors (above) so EVERY game's HUD text
 * box shows real, self-documenting text in the editor + in-game out of the box
 * (overridable per project via the editor's HUD-text field). The editor also uses
 * this as the fallback for older docs whose anchors predate the default.
 */
export const HUD_DEFAULT_TEXT: Record<string, string> = {
	HudGameName: 'GAME NAME',
	HudLogo: 'ADD YOUR LOGO',
};

/** The default HUD label for a bound component (`HudGameName`/`HudLogo`), if any. */
export function defaultHudText(component: string | undefined): string | undefined {
	return component ? HUD_DEFAULT_TEXT[component] : undefined;
}
