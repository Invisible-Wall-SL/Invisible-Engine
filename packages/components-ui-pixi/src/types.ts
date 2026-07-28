import type { Snippet } from 'svelte';

import type { ButtonProps } from 'components-pixi';
import type { HudTextOverride, Scene, TextStyle } from 'engine-layout';
import type { ServerPayEntry } from 'utils-shared/paytable';

/**
 * Optional editor-authored HUD scenes a game may pass to `<UI>` to make the HUD
 * positionable in the Invisible Editor. `bar` = the standard-space bottom bar,
 * `corners` = the canvas-space logo / game name. When omitted, `<UI>` renders
 * the hardcoded `Layout*` components unchanged.
 */
export type UiHud = { bar?: Scene; corners?: Scene };

// ---- Info page (paytable / paylines / rules) manifest ----
// A game supplies this data-driven manifest; the shared <InfoOverlay> renders it
// so the same component serves every game. No game-specific code is imported.
export type InfoSymbolIcon = {
	type: 'sprite' | 'spine';
	assetKey: string;
	animationName?: string;
	sizeRatios: { width: number; height: number };
};

export type InfoRule = { heading: string; body: string };

export type InfoTheme = {
	fontFamily?: string;
	titleColor?: number;
	textColor?: number;
	accentColor?: number;
	dimColor?: number;
	dimAlpha?: number;
};

export type InfoManifest = {
	paytable: ServerPayEntry[];
	numLines: number;
	paylines: number[][];
	/** OPTIONAL per-payline colour (`#rrggbb`), aligned to {@link paylines} by declaration index —
	 *  the authored Invisible Game Config colour for each line, the SAME colour its win line draws in.
	 *  A line with no authored colour is `undefined` and the grid falls back to the theme accent, so an
	 *  un-coloured game renders exactly as before. */
	paylineColors?: (string | undefined)[];
	numRows: number;
	symbolSize: number;
	// symbol id -> static icon descriptor (resolved from the game's getSymbolInfo)
	symbols: Record<string, InfoSymbolIcon>;
	rules: InfoRule[];
	theme?: InfoTheme;
};

export type EmitterEventUi =
	| { type: 'hotKeySpace' }
	| { type: 'hotKeyEscape' }
	| { type: 'stopButtonClick' }
	| { type: 'stopButtonEnable' }
	| { type: 'uiShow' }
	| { type: 'uiHide' }
	| { type: 'drawerUnfold' }
	| { type: 'drawerFold' }
	| { type: 'drawerButtonShow' }
	| { type: 'drawerButtonHide' }
	// sound
	| { type: 'soundBetMode'; betModeKey: string }
	| { type: 'soundPressGeneral' }
	| { type: 'soundPressBet' }
	| { type: 'soundPressStop' }
	// bet services
	| { type: 'resumeBet' }
	| { type: 'autoBet' }
	| { type: 'bet' };

export type ButtonIcon =
	| 'decrease'
	| 'increase'
	| 'menu'
	| 'turbo'
	| 'autoSpin'
	| 'payTable'
	| 'info'
	| 'settings'
	| 'soundOn'
	| 'soundOff'
	| 'menuExit';

/** Args for a HUD bar LABEL snippet: placement flags + an optional editor-authored
 * text-style/caption override (from the bar scene's `bind.props`). A snippet that
 * ignores `style`/`text` renders its coded default → parity. */
export type UiLabelArgs = { stacked?: boolean; style?: Partial<TextStyle>; text?: string };

/** Args for a HUD bar BUTTON snippet: the coded button props + an optional editor-
 * authored recolour `tint` (from `bind.props.tint`). Absent = no tint → parity. */
export type UiButtonArgs = Partial<Omit<ButtonProps, 'children'>> & { tint?: number };

export type LayoutUiProps = {
	/** The logo / game-name snippets receive an optional editor-authored font/text
	 * override (from the HUD `corners` scene). A snippet that ignores it renders its
	 * coded default — so opting in is per-game and parity-preserving. */
	gameName: Snippet<[HudTextOverride?]>;
	logo: Snippet<[HudTextOverride?]>;
	amountBalance: Snippet<[UiLabelArgs]>;
	amountWin: Snippet<[UiLabelArgs]>;
	amountBet: Snippet<[UiLabelArgs]>;
	buttonBuyBonus: Snippet<[UiButtonArgs]>;
	buttonBet: Snippet<[UiButtonArgs]>;
	buttonTurbo: Snippet<[UiButtonArgs]>;
	buttonAutoSpin: Snippet<[UiButtonArgs]>;
	buttonIncrease: Snippet<[UiButtonArgs]>;
	buttonDecrease: Snippet<[UiButtonArgs]>;
	buttonMenu: Snippet<[UiButtonArgs]>;
	buttonMenuClose: Snippet<[UiButtonArgs]>;
	buttonPayTable: Snippet<[UiButtonArgs]>;
	buttonGameRules: Snippet<[UiButtonArgs]>;
	buttonSettings: Snippet<[UiButtonArgs]>;
	buttonSoundSwitch: Snippet<[UiButtonArgs]>;
};
