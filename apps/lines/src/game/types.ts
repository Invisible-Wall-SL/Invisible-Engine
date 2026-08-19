import type config from './config';

/**
 * The game-type-agnostic symbol/board vocabulary now lives in `engine-game` (Phase A of
 * `docs/design/game-type-templates.md`). Re-exported here so the ~7 modules that import
 * `../game/types` keep working unchanged.
 */
export {
	SYMBOL_STATES,
	type SymbolName,
	type RawSymbol,
	type SymbolState,
	type SymbolCellInfo,
	type SymbolInfoMap,
	type Position,
} from 'engine-game';

/**
 * Bet mode / game type stay bound to the COMPILED config, unlike `SymbolName`, and so stay in the
 * APP rather than moving to `engine-game`.
 *
 * Not an oversight: these two are shared vocabulary with the RGS — the server names the game type
 * on every `reveal` and prices the bet mode — so they cannot be freely invented per project the way
 * a symbol id can, and widening them would erase real checking across the bet selector and the
 * state machine for no gain. An authored config that adds a mode is a coordinated RGS change, and
 * the day one appears this is the line to revisit.
 */
export type BetMode = keyof typeof config.betModes;
export type GameType = keyof typeof config.paddingReels;
