import type { SymbolState } from './types';

/**
 * The engine's FEEL knobs — the half of a game's `constants.ts` that is not about a particular
 * game's symbols or art.
 *
 * Phase A3.5 of `docs/design/game-type-templates.md`. `apps/lines/src/game/constants.ts` mixed two
 * unrelated things: these defaults, and that game's own symbol names, sprite bindings and scatter
 * sounds. Only the first half is shared by every game type, so only it lives here; the game content
 * stays in the app, which is also what keeps `constants.ts` importable standalone by
 * `publish-symbol-defaults.mjs` (see the note in that file).
 *
 * These are DEFAULTS, not per-game configuration. `docs/design/invisible-game-config.md` records
 * that they "rarely need per-game" values, which is why they are shared constants today rather than
 * another arm of the authored config. A game type that genuinely needs its own belongs in the
 * mechanic, not in a fork of this file.
 */

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

/**
 * The tint applied to a NON-winning symbol while the win-celebration dim is on (Invisible Symbols
 * State Machine → `winCycle.dimNonWinning`). A Pixi v8 `Container.tint` multiplies down to every
 * child (sprite / spine / flipbook alike), so `0x666666` darkens a losing symbol to ~40% brightness
 * — dark enough to recede behind the lit paying line, bright enough to stay legible. `0xffffff` (the
 * default tint) is the untouched, full-bright symbol.
 */
export const SYMBOL_DIM_TINT = 0x666666;

export const INITIAL_SYMBOL_STATE: SymbolState = 'static';

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
