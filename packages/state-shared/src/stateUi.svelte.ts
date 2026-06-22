export const INFINITY_MARK = '∞';

export const AUTO_SPINS_TEXT_OPTIONS = [
	'10',
	'25',
	'50',
	'75',
	'100',
	'250',
	'500',
	'1000',
	INFINITY_MARK,
] as const;
export type AutoSpinsText = (typeof AUTO_SPINS_TEXT_OPTIONS)[number];
export const AUTO_SPINS_TEXT_OPTION_MAP = {
	'10': 10,
	'25': 25,
	'50': 50,
	'75': 75,
	'100': 100,
	'250': 250,
	'500': 500,
	'1000': 1000,
	[INFINITY_MARK]: Infinity,
};

export const LOSS_LIMIT_TEXT_OPTIONS = ['5×', '10×', '25×', '50×', '100×', INFINITY_MARK] as const;
export type LossLimitText = (typeof LOSS_LIMIT_TEXT_OPTIONS)[number];
export const AUTO_SPINS_LOSS_LIMIT_MULTIPLIER_MAP = {
	'5×': 5,
	'10×': 10,
	'25×': 25,
	'50×': 50,
	'100×': 100,
	[INFINITY_MARK]: Infinity,
};

export const SINGLE_WIN_LIMIT_TEXT_OPTIONS = [
	'5×',
	'10×',
	'25×',
	'50×',
	'100×',
	INFINITY_MARK,
] as const;
export type SingleWinLimitText = (typeof SINGLE_WIN_LIMIT_TEXT_OPTIONS)[number];
export const AUTO_SPINS_SINGLE_WIN_LIMIT_MULTIPLIER_MAP = {
	'5×': 5,
	'10×': 10,
	'25×': 25,
	'50×': 50,
	'100×': 100,
	[INFINITY_MARK]: Infinity,
};

export type UIConfigMode = 'default' | 'replay';

/**
 * Player-led SPEED features, each independently toggleable per game/jurisdiction
 * (the "defang via config, never gut" rule — the machinery stays, config hides the
 * entry points). `turbo` = the turbo toggle button; `autoplay` = the autospin button
 * + its modal; `spaceHold` = hold-Space continuous betting. Note slam-stop is NOT a
 * flag here — the autoplay-only stop model already removed player-led single-spin
 * stopping by design.
 */
export type UIFeatureFlags = {
	turbo: boolean;
	autoplay: boolean;
	spaceHold: boolean;
};

/** Default profile — every speed feature available (non-UK markets). */
export const UI_FEATURES_DEFAULT: UIFeatureFlags = {
	turbo: true,
	autoplay: true,
	spaceHold: true,
};

/**
 * UK Gambling Commission profile: licensed UK slots PROHIBIT autoplay, turbo/quick
 * spin and player-led spin-stop, so all speed features are off. Apply with
 * `setUiFeatures(UI_FEATURES_UK)` for a UK build.
 */
export const UI_FEATURES_UK: UIFeatureFlags = {
	turbo: false,
	autoplay: false,
	spaceHold: false,
};

export const stateUi = $state({
	autoSpinsText: '10' as AutoSpinsText,
	autoSpinsLossLimitText: INFINITY_MARK as LossLimitText,
	autoSpinsSingleWinLimitText: INFINITY_MARK as SingleWinLimitText,
	freeSpinCounterShow: false,
	freeSpinCounterCurrent: 0,
	freeSpinCounterTotal: 0,
	// Round-lifecycle gates for screen/component visibility (a `Scene.visibleSource` or a
	// component `visibleSource` param binds to these): true only while that presentation
	// phase is on screen. Driven by the game's book-event handlers, alongside the existing
	// freeSpinIntro/Outro/win show↔hide event broadcasts. (free-game / base-game are derived
	// from `stateGame.gameType` in the game, so they aren't duplicated here.)
	freeSpinIntroShow: false,
	freeSpinOutroShow: false,
	winShow: false,
	bigWinShow: false,
	menuOpen: false,
	drawerFold: false,
	drawerButtonShow: false,
	config: {
		mode: 'default' as UIConfigMode,
		features: { ...UI_FEATURES_DEFAULT } as UIFeatureFlags,
	},
});

/** Merge a partial feature profile into the live UI config (e.g. a game's setup or
 * the editor-authored game settings supplying a jurisdiction preset). */
export const setUiFeatures = (features: Partial<UIFeatureFlags>) => {
	stateUi.config.features = { ...stateUi.config.features, ...features };
};
