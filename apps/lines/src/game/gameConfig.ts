import { createGameConfig } from 'engine-game';

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
	boardSizes,
	initialBoard,
	activeWinLevels,
	activeWaysCount,
	activeWinModel,
	activeReelBehaviour,
	publishWinPresentation,
	activeWinLevelData,
	activeWinLevelByAlias,
	activeWinLevelIsBig,
	activeBigTiers,
	activeBigTierThresholds,
	activeWinLevelChain,
	activeWinLevel,
	publishWinLevelsToFacade,
	warnOnGameConfigIssues,
	warnOnServerGridMismatch,
} = gameConfig;
