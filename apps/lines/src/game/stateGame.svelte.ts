import { createGameState } from 'engine-game';

import type { GameType, RawSymbol } from './types';
import { stateLayoutDerived } from './stateLayout';
import { eventEmitter } from './eventEmitter';
import { bakedStackedConfig } from '../editor-scenes';
import { SCATTER_LAND_SOUND_MAP, STACKED_PICTURE } from './constants';
import { boardDimensions, boardSizes, initialBoard } from './gameConfig';

/**
 * This game's board state: the engine machinery from `engine-game`, wired to THIS game's config,
 * layout and sounds. Phase A4 of `docs/design/game-type-templates.md`.
 *
 * Everything reactive still lives in one place at module scope — the factory is called exactly
 * once here, so `stateGame.board`'s array identity (which `enhancedBoard` closes over at init, and
 * which `rebuildBoard` splices rather than reassigns for that reason) behaves exactly as before.
 */

/**
 * GAME CONTENT: what this game plays when a symbol lands. Stays in the app because the symbol ids
 * (`S`, `W`) and the cue names are this game's, not the engine's.
 *
 * Reads `scatterLandIndex` off the constructed state below. Declared first and referenced lazily —
 * it only ever runs on a real symbol landing, long after the factory has returned.
 */
const onSymbolLand = ({ rawSymbol }: { rawSymbol: RawSymbol }) => {
	if (rawSymbol.name === 'S') {
		eventEmitter.broadcast({ type: 'soundScatterCounterIncrease' });
		eventEmitter.broadcast({
			type: 'soundOnce',
			name: SCATTER_LAND_SOUND_MAP[gameState.stateGameDerived.scatterLandIndex()],
		});
	}

	if (rawSymbol.name === 'W') {
		eventEmitter.broadcast({
			type: 'soundOnce',
			name: 'sfx_multiplier_landing',
		});
	}
};

const gameState = createGameState<GameType>({
	initialGameType: 'basegame' as GameType,
	initialBoard,
	boardDimensions,
	boardSizes,
	layout: stateLayoutDerived,
	eventEmitter,
	stackedConfig: bakedStackedConfig,
	stackedFallback: STACKED_PICTURE,
	onSymbolLand,
});

export const {
	stateGame,
	stateGameDerived,
	setBoardOverride,
	setWinDim,
	winDimCellKey,
	getSymbolX,
	rebuildBoard,
	stackedScrollStrip,
	stackedPictureRuns,
	stackedCoverage,
	getWinLevelDataByWinLevelAlias,
} = gameState;

export type {
	Reel,
	ReelSymbol,
	MultiplierSymbol,
	StackedArt,
	StackedPictureRun,
} from 'engine-game';
