import { createPlayBook, createSymbolInfo, isHoldAndWinEvent } from 'engine-game';

import { activeWinLevelData } from './gameConfig';
import { symbolMap } from './symbolMap';
import { eventEmitter } from './eventEmitter';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import {
	cueBigWinCountUp,
	setPendingScatterAwardFs,
	showAllWinLines,
	winsOnThisBoard,
} from './flowEffects';
import { getFlowInterpreter } from './flowInterpreterHolder';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { runBookEventPresentation, startsCelebration } from './unskippablePresentation';
import { trackCascadeStep } from './soundBindings';
import {
	explodeSpinWinners,
	explodeWinnersBeforeBoardChange,
	forgetWinCycleWins,
	recordWinCycleWins,
	startWinCycle,
	stopWinCycle,
} from './winSymbolCycle';
import { bakedWinLineConfig } from '../editor-scenes';
import { clearSpinHold, holdAfterBigWin } from './freeSpinHold';
import { stateModes } from './stateModes.svelte';
import { recordHoldAndWinEvent } from './stateHoldAndWin.svelte';

/**
 * THE SYMBOL RESOLVER, built on this game's symbol map. The resolution itself — the memo, the
 * missing-art guards, the state inheritance — is type-agnostic and lives in `engine-game`
 * (Phase A of `docs/design/game-type-templates.md`); the only thing per-game about it is WHICH map
 * it reads, so the map instance is the whole seam.
 *
 * Constructed here rather than in `symbolMap.ts` so the ten components that import `getSymbolInfo`
 * from `../game/utils` keep the import they already have.
 */
export const { getSymbolInfo, hasAuthoredSymbolState } = createSymbolInfo({ symbolMap });

/**
 * THE PLAY PIPELINE, wired to this game's presentation. How a round is played — the seams every
 * book event crosses and which path presents it — is the engine's (`createPlayBook`); what each
 * seam DOES is this game's, handed in by name.
 */
export const { playBookEvent, playBookEvents, playBet, convertTorResumableBet } = createPlayBook({
	bookEventHandlerMap,
	getFlowInterpreter,
	getFlowV2,
	eventEmitter,
	runBookEventPresentation,
	startsCelebration,
	recordWinCycleWins,
	forgetWinCycleWins,
	stopWinCycle,
	startWinCycle,
	explodeSpinWinners,
	explodeWinnersBeforeBoardChange,
	bakedWinLineConfig,
	winsOnThisBoard,
	showAllWinLines,
	activeWinLevelData,
	cueBigWinCountUp,
	setPendingScatterAwardFs,
	holdAfterBigWin,
	clearSpinHold,
	trackCascadeStep,
	recordBookEvent: (bookEvent) => {
		if (isHoldAndWinEvent(bookEvent)) recordHoldAndWinEvent(bookEvent);
	},
	modes: stateModes,
});
