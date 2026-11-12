import { createGameConfig } from 'engine-game';
import { fillerStrips } from 'game-config';
import { stateBetDerived } from 'state-shared';

import { bakedGameConfig } from '../editor-scenes';
import compiledConfig from './config';
import type { GameType } from './types';

/**
 * This game's config resolver: the engine's `runtime → baked → compiled` resolution from
 * `engine-game`, pointed at THIS game's two sources. Phase A5 of
 * `docs/design/game-type-templates.md`.
 *
 * Constructed once at module scope, so the memo inside (`getActiveGameConfig`) behaves exactly as
 * it did when it was a module-level `let` — including the requirement that `Game.svelte` calls
 * `resetGameConfigCache()` once the live runtime bundle is applied. Miss that and an online game
 * silently runs the sample config forever.
 */
const gameConfig = createGameConfig<GameType>({
	bakedConfig: bakedGameConfig,
	compiledConfig,
});

export const {
	getActiveGameConfig,
	resetGameConfigCache,
	getSymbolsInPlay,
	getPaddingReels,
	paddingReels,
	getNumLines,
	getPaylines,
	paylineColor,
	payoutDivisor,
	getNumRows,
	boardDimensions,
	activeGrid,
	activeSpinsGame,
	activePaytableInputs,
	spinsGameOf,
	bindActiveMode,
	boardSizes,
	initialBoard,
	activeWinLevels,
	activeWaysCount,
	activeWinModel,
	activeReelBehaviour,
	activeSounds,
	publishSoundBindings,
	publishWinPresentation,
	activeWinLevelData,
	activeWinLevelByAlias,
	activeWinLevelIsBig,
	activeBigTiers,
	activeBigTierThresholds,
	activeWinLevelChain,
	activeWinLevel,
	publishWinLevelsToFacade,
	publishExpandMinReelsToFacade,
	warnOnGameConfigIssues,
	captureServerGrid,
	warnOnServerGridMismatch,
	warnOnServerPaytableMismatch,
} = gameConfig;

/**
 * The strips the reels ROLL for a spin of `gameType`. While the stake is a bet mode with
 * `fillerSymbols` (an ante whose reels deal only coins, collectors and blanks), the base game's
 * strips are filtered to those symbols, otherwise exactly {@link paddingReels}. The AUTHORED base
 * strips are filtered when they fit the board, so each reel keeps its own symbols (collectors on
 * the middle reel only) even where the server is authoritative and the roll is otherwise generated.
 * Presentation only: the dealt board still comes from the server.
 */
export function spinPaddingReels(gameType: GameType): ReturnType<typeof paddingReels> {
	const symbols = stateBetDerived.activeBetMode()?.fillerSymbols;
	if (gameType !== 'basegame' || !symbols?.length) return paddingReels(gameType);
	const rolled = getPaddingReels(gameType);
	const authored = getActiveGameConfig().paddingReels.basegame;
	const strips = authored?.length === rolled.length ? authored : rolled;
	return fillerStrips(strips, symbols) as ReturnType<typeof paddingReels>;
}
