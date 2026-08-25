import { createGameState } from 'engine-game';
import { landSlotForSymbol } from 'game-config';

import type { GameType, RawSymbol } from './types';
import { stateLayoutDerived } from './stateLayout';
import { eventEmitter } from './eventEmitter';
import { bakedStackedConfig } from '../editor-scenes';
import { STACKED_PICTURE } from './constants';
import { playSymbolLandSound } from './soundBindings';
import {
	activeGrid,
	activeReelBehaviour,
	activeSounds,
	boardDimensions,
	boardSizes,
	getActiveGameConfig,
	initialBoard,
} from './gameConfig';

/**
 * This game's board state: the engine machinery from `engine-game`, wired to THIS game's config,
 * layout and sounds. Phase A4 of `docs/design/game-type-templates.md`.
 *
 * Everything reactive still lives in one place at module scope — the factory is called exactly
 * once here, so `stateGame.board`'s array identity (which `enhancedBoard` closes over at init, and
 * which `rebuildBoard` splices rather than reassigns for that reason) behaves exactly as before.
 */

/**
 * GAME CONTENT: what this game plays when a symbol lands — on the reels at the end of a spin, and on
 * the tumble overlay when a cascade refill falls in (`tumbleBoardSlideDown` calls this same hook).
 *
 * The scatter COUNTER stays here because it is game state, not sound: it is what the counter readout
 * and the anticipation both read. The cue itself has moved to `soundBindings`, which decides between
 * the scatter / wild / picture / royal slots off the config dictionary — so the two hardcoded ids
 * (`S`, `W`) and their two literal cue names are gone, along with the silence every OTHER symbol
 * landed in. See `game-config/sounds`.
 *
 * Reads `scatterLandIndex` off the constructed state below. Declared first and referenced lazily —
 * it only ever runs on a real symbol landing, long after the factory has returned.
 */
const onSymbolLand = ({ rawSymbol }: { rawSymbol: RawSymbol }) => {
	// "Is this a scatter" is asked through the SAME routing the cue uses (a symbol routes to
	// `scatterLand` exactly when the config marks it a scatter), rather than a second definition
	// alongside it — one of the two would eventually disagree, and the hardcoded `'S'` this replaces
	// was already that disagreement waiting for a project that names its scatter anything else.
	if (landSlotForSymbol(rawSymbol.name, getActiveGameConfig().symbols) === 'scatterLand') {
		eventEmitter.broadcast({ type: 'soundScatterCounterIncrease' });
	}
	playSymbolLandSound(rawSymbol.name, gameState.stateGameDerived.scatterLandIndex());
};

const gameState = createGameState<GameType>({
	initialGameType: 'basegame' as GameType,
	initialBoard,
	boardDimensions,
	activeGrid,
	boardSizes,
	layout: stateLayoutDerived,
	eventEmitter,
	stackedConfig: bakedStackedConfig,
	stackedFallback: STACKED_PICTURE,
	onSymbolLand,
	// How a round PRESENTS — roll or swap in place, clear first, stagger the columns. Passed as the
	// accessor, not its value: the live runtime bundle resolves after this module evaluates, so a
	// value read here would freeze every board to the compiled sample config.
	reelBehaviour: activeReelBehaviour,
	// The accessor, not its value, for the same reason `reelBehaviour` is one: the live runtime
	// bundle resolves after this module evaluates, so a value read here would freeze the game's
	// sound bindings to the compiled sample config.
	sounds: activeSounds,
});

export const {
	stateGame,
	stateGameDerived,
	setBoardOverride,
	setWinDim,
	winDimCellKey,
	getSymbolX,
	getSymbolY,
	getSymbolSeat,
	rebuildBoard,
	stackedScrollStrip,
	stackedPictureRuns,
	stackedCoverage,
	stackedWinHoldMs,
	getWinLevelDataByWinLevelAlias,
} = gameState;

export type {
	Reel,
	ReelSymbol,
	MultiplierSymbol,
	StackedArt,
	StackedPictureRun,
} from 'engine-game';
