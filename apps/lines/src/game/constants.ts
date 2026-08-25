// This game's SYMBOL + ART content: the sprite/spine bindings and the stacked-picture map. The
// engine's shared feel knobs (SYMBOL_SIZE, REEL_PADDING, spin options, …) moved to `engine-game` in
// Phase A3.5 of docs/design/game-type-templates.md — import those from there, not from here. The
// scatter-land sound ladder moved to the Invisible Game Config sound SLOTS (`game-config/sounds`),
// so it is authorable per project rather than a constant only an engine edit could change.
//
// This module has NO imports, and must keep it that way. `publish-symbol-defaults.mjs` imports it
// STANDALONE under Node type-stripping to read `SYMBOL_INFO_MAP`; a value import of `engine-game`
// would pull the package barrel (and its `.svelte` components, which type-stripping cannot parse)
// into that graph and the publish would bail. The reel strips and board grid live in `./gameConfig`
// for the same reason.

const HIGH_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'H5'];

/**
 * Stacked-picture reel mode (docs/design/stacked-picture-mode.md). A LINES-only visual: when a
 * column lands a contiguous vertical run of the same eligible symbol, one tall picture (the symbol's
 * `stacked` state art) is drawn over the run, cropped to the TOP `runLength ÷ naturalHeight` and
 * top-aligned. OFF by default — a Flow effect (`enableStackedPictures`) turns it on, so nothing here
 * changes the game until authored (byte-parity).
 *
 * `heights` = each symbol's NATURAL picture height in cells (the crop denominator). `symbols` = the
 * default eligible set (high pays + Wild); a Flow payload can override it. `minRun` = the shortest
 * run that draws a picture. No magic ids in the components — they read this map. All per-game and
 * later overridable from the Invisible Game Config.
 */
export const STACKED_PICTURE = {
	heights: { H1: 2, H2: 3, H3: 3, H4: 4, H5: 4, W: 5 } as Record<string, number>,
	symbols: [...HIGH_SYMBOLS, 'W'],
	minRun: 2,
};

const HIGH_SYMBOL_SIZE = 0.9;
const LOW_SYMBOL_SIZE = 0.9;
const SPECIAL_SYMBOL_SIZE = 1;

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
