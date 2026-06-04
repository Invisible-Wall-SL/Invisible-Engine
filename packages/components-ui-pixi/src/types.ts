import type { Snippet } from 'svelte';

import type { ButtonProps } from 'components-pixi';
import type { Scene } from 'engine-layout';
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

export type LayoutUiProps = {
	gameName: Snippet;
	logo: Snippet;
	amountBalance: Snippet<[{ stacked?: boolean }]>;
	amountWin: Snippet<[{ stacked?: boolean }]>;
	amountBet: Snippet<[{ stacked?: boolean }]>;
	buttonBuyBonus: Snippet<[Partial<ButtonProps>]>;
	buttonBet: Snippet<[Partial<ButtonProps>]>;
	buttonTurbo: Snippet<[Partial<ButtonProps>]>;
	buttonAutoSpin: Snippet<[Partial<ButtonProps>]>;
	buttonIncrease: Snippet<[Partial<ButtonProps>]>;
	buttonDecrease: Snippet<[Partial<ButtonProps>]>;
	buttonMenu: Snippet<[Partial<ButtonProps>]>;
	buttonMenuClose: Snippet<[Partial<ButtonProps>]>;
	buttonPayTable: Snippet<[Partial<ButtonProps>]>;
	buttonGameRules: Snippet<[Partial<ButtonProps>]>;
	buttonSettings: Snippet<[Partial<ButtonProps>]>;
	buttonSoundSwitch: Snippet<[Partial<ButtonProps>]>;
};
