import type { Scene } from './types';
import { UI_TEXT } from './uiText';

/**
 * The engine-default HUD MENU screens — the in-canvas, authorable twins of the HTML `ModalBetMenu`
 * and `ModalAutoSpin`. Each is a `canvas`-space takeover built from the same three pieces as
 * `defaultBuyFeatureScene`: a dimmed window-anchored backdrop, a title, and a `repeater` of
 * `optionCard` tiles fed by a registered source. They are SEEDS, not fixtures — the whole point is
 * that an author opens one in the Scene Editor and rebuilds it with their own art.
 *
 * Neither screen shows itself. A flow authors WHEN: the HUD bet readout's `<hud-bet>.onBetMenu` pin
 * (its `action: 'betMenu'` binding) and the auto-spin button's `<hud-btn-autospin>.onAutoSpin` pin
 * feed a `Show`, and each screen's own presses feed the matching engine action and a `Hide`. With no
 * flow owning those pins the coded HTML modals still open, byte-identical to today — these scenes
 * simply never mount.
 *
 * The tile is `OPTION_CARD_WIDTH`×`HEIGHT` (220×96) and each repeater carries anchor `{0.5,0.5}`, so
 * the engine centres the WHOLE laid-out grid on the node position (no manual half-tile offset).
 */

/** Dim + a centred column: the shared frame both menus are built on. */
const backdrop = (id: string): Scene['nodes'][number] => ({
	id,
	label: 'Backdrop',
	kind: 'rect',
	screenAnchor: { x: 0.5, y: 0.5 },
	x: 0,
	y: 0,
	// Oversized so it covers any viewport; the default {0.5,0.5} rect anchor keeps it centred on
	// the window via `screenAnchor`.
	width: 4000,
	height: 4000,
	color: 0x000000,
	alpha: 0.78,
});

/**
 * A heading. `text` comes from {@link UI_TEXT}, whose values are source-as-key: the literal IS the
 * localization key, so a seeded title is already translatable through /localization instead of being
 * English an author has to notice and replace.
 */
const heading = (id: string, text: string, y: number): Scene['nodes'][number] => ({
	id,
	label: 'Title',
	kind: 'text',
	screenAnchor: { x: 0.5, y: 0.5 },
	anchor: { x: 0.5, y: 0.5 },
	x: 0,
	y,
	text,
	style: { fontFamily: 'proxima-nova', fontSize: 44, fill: 0xffffff, align: 'center' },
});

/**
 * The screen's WAY OUT. Every seeded menu carries one, because a flow-shown screen is a full-canvas
 * takeover: an author who wires only the `Show` would otherwise leave the player trapped on it (the
 * HTML modals this replaces both have a ✕ and a backdrop click). `close` is a registered action, so
 * the button works out of the box AND projects a `<id>.onClose` pin to wire to `Hide`.
 */
const closeButton = (id: string, y: number): Scene['nodes'][number] => ({
	id,
	label: 'Close',
	kind: 'componentInstance',
	screenAnchor: { x: 0.5, y: 0.5 },
	anchor: { x: 0.5, y: 0.5 },
	x: 0,
	y,
	componentId: 'button',
	params: { action: 'close', label: UI_TEXT.cancel },
});

/**
 * The BET MENU seed: the amount ladder as a 3-column grid, mirroring the HTML grid's shape. The
 * `betOptions` source feeds the same `stateConfig.betMenuOptions` ladder the modal shows, already
 * currency-formatted and with the staked amount marked `selected`.
 */
export function defaultBetMenuScene(): Scene {
	return {
		id: 'betMenu',
		name: 'Bet Menu',
		space: 'canvas',
		role: 'betMenu',
		nodes: [
			backdrop('bet-menu-dim'),
			heading('bet-menu-title', UI_TEXT.selectYourBet, -320),
			{
				id: 'bet-menu-options',
				label: 'Bet amounts',
				kind: 'repeater',
				screenAnchor: { x: 0.5, y: 0.5 },
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 0,
				source: 'betOptions',
				componentId: 'optionCard',
				layout: { direction: 'grid', gap: 16, columns: 3 },
			},
			closeButton('bet-menu-close', 320),
		],
	};
}

/**
 * The AUTO SPIN seed: the round-count ladder, plus the two ADVANCED limit ladders the HTML modal
 * folds away and a START button. The limits are laid out below the counts rather than hidden behind
 * a disclosure — an author who doesn't want them deletes their four nodes (two headings, two grids)
 * and the run then uses the standing limits, which default to `∞`.
 */
export function defaultAutoSpinScene(): Scene {
	return {
		id: 'autoSpin',
		name: 'Auto Spin',
		space: 'canvas',
		role: 'autoSpin',
		nodes: [
			backdrop('auto-spin-dim'),
			heading('auto-spin-title', UI_TEXT.numberOfRounds, -360),
			{
				id: 'auto-spin-options',
				label: 'Round counts',
				kind: 'repeater',
				screenAnchor: { x: 0.5, y: 0.5 },
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: -180,
				source: 'autoSpinOptions',
				componentId: 'optionCard',
				layout: { direction: 'grid', gap: 16, columns: 3 },
			},
			heading('auto-spin-loss-title', UI_TEXT.lossLimit, 40),
			{
				id: 'auto-spin-loss-options',
				label: 'Loss limits',
				kind: 'repeater',
				screenAnchor: { x: 0.5, y: 0.5 },
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 130,
				source: 'autoSpinLossLimitOptions',
				componentId: 'optionCard',
				layout: { direction: 'grid', gap: 16, columns: 3 },
			},
			heading('auto-spin-win-title', UI_TEXT.singleWinLimit, 250),
			{
				id: 'auto-spin-win-options',
				label: 'Single-win limits',
				kind: 'repeater',
				screenAnchor: { x: 0.5, y: 0.5 },
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 340,
				source: 'autoSpinWinLimitOptions',
				componentId: 'optionCard',
				layout: { direction: 'grid', gap: 16, columns: 3 },
			},
			{
				id: 'auto-spin-start',
				label: 'Start',
				kind: 'componentInstance',
				screenAnchor: { x: 0.5, y: 0.5 },
				anchor: { x: 0.5, y: 0.5 },
				x: 0,
				y: 470,
				componentId: 'button',
				// `autoSpinStart` is a registered action, so the button is pressable out of the box
				// AND projects a `<auto-spin-start>.onAutoSpinStart` flow pin the author wires to
				// `startAutoSpins ▶ Hide(autoSpin)`.
				params: { action: 'autoSpinStart', label: UI_TEXT.startAutoplay },
			},
			closeButton('auto-spin-close', 560),
		],
	};
}
