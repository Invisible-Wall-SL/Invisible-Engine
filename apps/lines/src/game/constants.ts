import type { SymbolState } from './types';

// The reel strips moved to `paddingReels()` in `./gameConfig` — deliberately NOT re-exported from
// here. `constants.ts` must stay import-light: the build-time `publish-symbol-defaults.mjs` imports
// this module standalone to read `SYMBOL_INFO_MAP`, and pulling in `gameConfig` → `editor-scenes`
// would drag the whole engine graph (`state-shared`, …) into that import and the publish would bail.
// Consumers import the strips straight from `./gameConfig`.

export const SYMBOL_SIZE = 120;

/**
 * Fraction of the cell a SPINE (animated) symbol fills — sprite symbols are fine at full
 * contain, but a spine character (badge + figure) reads visually bigger, so we contain its
 * bounds to `SYMBOL_SIZE × this` to bring it down to match the sprite icons. Spine-only:
 * sprites are untouched. Tune to taste (1 = same as sprites). See
 * `feedback_symbols_size_from_art_no_param`.
 */
export const SYMBOL_SPINE_FILL = 0.5;

export const REEL_PADDING = 0.53;

// The board GRID (dimensions, pixel size, pre-spin fill) moved to `boardDimensions()` /
// `boardSizes()` / `initialBoard()` in `./gameConfig` — they derive from the active game config
// (Invisible Game Config's numReels/numRows), so authoring the grid resizes the board. Kept OUT
// of this module for the same reason the strips are: `publish-symbol-defaults.mjs` imports
// `constants.ts` standalone for SYMBOL_INFO_MAP, and a `gameConfig` import would drag the whole
// engine graph into it.

export const BACKGROUND_RATIO = 2039 / 1000;
export const PORTRAIT_BACKGROUND_RATIO = 1242 / 2208;
const PORTRAIT_RATIO = 800 / 1422;
const LANDSCAPE_RATIO = 1600 / 900;
const DESKTOP_RATIO = 1422 / 800;

const DESKTOP_HEIGHT = 800;
const LANDSCAPE_HEIGHT = 900;
const PORTRAIT_HEIGHT = 1422;
export const DESKTOP_MAIN_SIZES = { width: DESKTOP_HEIGHT * DESKTOP_RATIO, height: DESKTOP_HEIGHT };
export const LANDSCAPE_MAIN_SIZES = {
	width: LANDSCAPE_HEIGHT * LANDSCAPE_RATIO,
	height: LANDSCAPE_HEIGHT,
};
export const PORTRAIT_MAIN_SIZES = {
	width: PORTRAIT_HEIGHT * PORTRAIT_RATIO,
	height: PORTRAIT_HEIGHT,
};

export const HIGH_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'H5'];

export const INITIAL_SYMBOL_STATE: SymbolState = 'static';

const HIGH_SYMBOL_SIZE = 0.9;
const LOW_SYMBOL_SIZE = 0.9;
const SPECIAL_SYMBOL_SIZE = 1;

const SPIN_OPTIONS_SHARED = {
	reelBounceBackSpeed: 0.15,
	reelSpinSpeedBeforeBounce: 4,
	reelPaddingMultiplierNormal: 1.2,
	reelPaddingMultiplierAnticipated: 10,
	// Free-spin sequential-stop padding knob (higher = longer gap between reel stops). Only
	// applies when the sequential-stop flag selects the `sequential` spinType, so the base game
	// is unaffected.
	reelPaddingMultiplierSequential: 4,
	// Sequential-cascade spin speed (higher = faster reels, which also shortens the gap between
	// stops for a given `reelPaddingMultiplierSequential`). Matches `reelSpinSpeed` by default.
	reelSpinSpeedSequential: 3,
	reelSpinDelay: 145,
};

export const SPIN_OPTIONS_DEFAULT = {
	...SPIN_OPTIONS_SHARED,
	reelPreSpinSpeed: 2,
	reelSpinSpeed: 3,
	reelBounceSizeMulti: 0.3,
};

export const SPIN_OPTIONS_FAST = {
	...SPIN_OPTIONS_SHARED,
	reelPreSpinSpeed: 5,
	reelSpinSpeed: 5,
	reelBounceSizeMulti: 0.05,
};

export const MOTION_BLUR_VELOCITY = 31;

export const zIndexes = {
	background: {
		backdrop: -3,
		normal: -2,
		feature: -1,
	},
};

const explosion = {
	type: 'spine',
	assetKey: 'explosion',
	animationName: 'explosion',
	sizeRatios: { width: 1, height: 1 },
};

const h1Static = { type: 'sprite', assetKey: 'h1.webp', sizeRatios: { width: 1, height: 1 } };
const h2Static = { type: 'sprite', assetKey: 'h2.webp', sizeRatios: { width: 1, height: 1 } };
const h3Static = { type: 'sprite', assetKey: 'h3.webp', sizeRatios: { width: 1, height: 1 } };
const h4Static = { type: 'sprite', assetKey: 'h4.webp', sizeRatios: { width: 1, height: 1 } };
const h5Static = { type: 'sprite', assetKey: 'h5.webp', sizeRatios: { width: 1, height: 1 } };

const l1Static = { type: 'sprite', assetKey: 'l1.webp', sizeRatios: { width: 1, height: 1 } };
const l2Static = { type: 'sprite', assetKey: 'l2.webp', sizeRatios: { width: 1, height: 1 } };
const l3Static = { type: 'sprite', assetKey: 'l3.webp', sizeRatios: { width: 1, height: 1 } };
const l4Static = { type: 'sprite', assetKey: 'l4.webp', sizeRatios: { width: 1, height: 1 } };
const l5Static = {
	type: 'spine',
	assetKey: 'M',
	animationName: 'low_multiplier_static',
	sizeRatios: { width: 0.3, height: 0.3 },
};

const sStatic = { type: 'sprite', assetKey: 's.png', sizeRatios: { width: 1.243, height: 1.243 } };
const wStatic = { type: 'sprite', assetKey: 'w.png', sizeRatios: { width: 1.12, height: 1.12 } };

const wSizeRatios = { width: 1.5 * 0.9, height: SPECIAL_SYMBOL_SIZE * 1.15 };
const sSizeRatios = { width: 2.5, height: SPECIAL_SYMBOL_SIZE * 2.3 };

// Each symbol's `win` spine binding, hoisted to a named const. The Special-Book
// reveal/idle states (`bookIntro`/`bookIdle`) are NOT coded here: they inherit the
// symbol's EFFECTIVE win binding at resolve time (see `getSymbolInfo`), so they track
// any authored win override instead of a frozen copy — unless explicitly bound.
const h1Win = {
	type: 'spine',
	assetKey: 'H1',
	animationName: 'h1',
	sizeRatios: { width: 0.5 * 1.15, height: HIGH_SYMBOL_SIZE * 0.57 },
} as const;
const h2Win = {
	type: 'spine',
	assetKey: 'H2',
	animationName: 'h2',
	sizeRatios: { width: 0.5, height: HIGH_SYMBOL_SIZE * 0.57 },
} as const;
const h3Win = {
	type: 'spine',
	assetKey: 'H3',
	animationName: 'h3',
	sizeRatios: { width: 0.5 * 0.9, height: HIGH_SYMBOL_SIZE * 0.53 },
} as const;
const h4Win = {
	type: 'spine',
	assetKey: 'H4',
	animationName: 'h4',
	sizeRatios: { width: 0.5 * 0.9, height: HIGH_SYMBOL_SIZE * 0.53 },
} as const;
const h5Win = {
	type: 'spine',
	assetKey: 'H5',
	animationName: 'h5',
	sizeRatios: { width: 0.5 * 0.9, height: HIGH_SYMBOL_SIZE * 0.53 },
} as const;
const l1Win = {
	type: 'spine',
	assetKey: 'L1',
	animationName: 'l1',
	sizeRatios: { width: 0.5 * 0.75, height: LOW_SYMBOL_SIZE * 0.65 },
} as const;
const l2Win = {
	type: 'spine',
	assetKey: 'L2',
	animationName: 'l2',
	sizeRatios: { width: 0.5 * 0.75, height: LOW_SYMBOL_SIZE * 0.65 },
} as const;
const l3Win = {
	type: 'spine',
	assetKey: 'L3',
	animationName: 'l3',
	sizeRatios: { width: 0.5 * 0.75, height: LOW_SYMBOL_SIZE * 0.63 },
} as const;
const l4Win = {
	type: 'spine',
	assetKey: 'L4',
	animationName: 'l4',
	sizeRatios: { width: 0.5 * 0.75, height: LOW_SYMBOL_SIZE * 0.63 },
} as const;
const l5Win = {
	type: 'spine',
	assetKey: 'M',
	animationName: 'low_multiplier_pay',
	sizeRatios: { width: 0.3, height: 0.3 },
} as const;
const wWin = {
	type: 'spine',
	assetKey: 'W',
	animationName: 'wild_dynamite',
	sizeRatios: wSizeRatios,
} as const;
const sWin = {
	type: 'spine',
	assetKey: 'S',
	animationName: 'scatter_win',
	sizeRatios: sSizeRatios,
} as const;

export const SYMBOL_INFO_MAP = {
	H1: {
		explosion,
		win: h1Win,
		postWinStatic: h1Static,
		static: h1Static,
		spin: h1Static,
		land: h1Static,
	},
	H2: {
		explosion,
		win: h2Win,
		postWinStatic: h2Static,
		static: h2Static,
		spin: h2Static,
		land: h2Static,
	},
	H3: {
		explosion,
		win: h3Win,
		postWinStatic: h3Static,
		static: h3Static,
		spin: h3Static,
		land: h3Static,
	},
	H4: {
		explosion,
		win: h4Win,
		postWinStatic: h4Static,
		static: h4Static,
		spin: h4Static,
		land: h4Static,
	},
	H5: {
		explosion,
		win: h5Win,
		postWinStatic: h5Static,
		static: h5Static,
		spin: h5Static,
		land: h5Static,
	},
	L1: {
		explosion,
		win: l1Win,
		postWinStatic: l1Static,
		static: l1Static,
		spin: l1Static,
		land: l1Static,
	},
	L2: {
		explosion,
		win: l2Win,
		postWinStatic: l2Static,
		static: l2Static,
		spin: l2Static,
		land: l2Static,
	},
	L3: {
		explosion,
		win: l3Win,
		postWinStatic: l3Static,
		static: l3Static,
		spin: l3Static,
		land: l3Static,
	},
	L4: {
		explosion,
		win: l4Win,
		postWinStatic: l4Static,
		static: l4Static,
		spin: l4Static,
		land: l4Static,
	},
	L5: {
		explosion,
		win: l5Win,
		postWinStatic: l5Static,
		static: l5Static,
		spin: l5Static,
		land: l5Static,
	},
	W: {
		explosion,
		postWinStatic: {
			type: 'sprite',
			assetKey: 'explodedW.png',
			sizeRatios: { width: 0.85, height: 0.85 },
		},
		static: wStatic,
		spin: wStatic,
		win: wWin,
		land: {
			type: 'spine',
			assetKey: 'W',
			animationName: 'wild_dynamite_land',
			sizeRatios: wSizeRatios,
		},
	},
	S: {
		explosion,
		postWinStatic: sStatic,
		static: sStatic,
		spin: {
			type: 'spine',
			assetKey: 'S',
			animationName: 'scatter_spin',
			sizeRatios: sSizeRatios,
		},
		win: sWin,
		land: {
			type: 'spine',
			assetKey: 'S',
			animationName: 'scatter_land',
			sizeRatios: sSizeRatios,
		},
	},
} as const;

export const SCATTER_LAND_SOUND_MAP = {
	1: 'sfx_scatter_stop_1',
	2: 'sfx_scatter_stop_2',
	3: 'sfx_scatter_stop_3',
	4: 'sfx_scatter_stop_4',
	5: 'sfx_scatter_stop_5',
} as const;
