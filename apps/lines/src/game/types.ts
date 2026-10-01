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
	type SymbolLayerSpec,
	type SymbolInfoMap,
	type Position,
} from 'engine-game';

/**
 * Bet mode stays bound to the COMPILED config, unlike `SymbolName`, and so stays in the APP rather
 * than moving to `engine-game`: it is shared vocabulary with the RGS, which prices it, so it cannot be
 * freely invented per project, and widening it would erase real checking across the bet selector.
 */
export type BetMode = keyof typeof config.betModes;
/**
 * The game type is the active GAME MODE's (`game-config` `gameTypeForMode`, design hold-and-win
 * §4.5): the compiled config's `basegame` / `freegame`, or the game type of a mode the project's
 * Game Config declares (`respin` for Hold and Win, a mode's own id by default). Widened on purpose —
 * modes are authored per project — while the compiled keys stay spelled out for completion.
 */
export type GameType = keyof typeof config.paddingReels | (string & {});
