import _ from 'lodash';

import { stateBet } from 'state-shared';
import { checkIsMultipleRevealEvents } from 'utils-book';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import type { Bet } from './typesBookEvent';
import { stateXstateDerived } from './stateXstate';
import { playBet, convertTorResumableBet } from './utils';
import { clearWinPresentation } from './winSymbolCycle';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { paddingReels } from './gameConfig';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: (betToResume) => convertTorResumableBet(betToResume),
	onResumeGameInactive: (betToResume) => {
		const lastRevealEvent = _.findLast(
			betToResume.state,
			(bookEvent) => bookEvent?.type === 'reveal',
		);

		if (lastRevealEvent) stateGameDerived.enhancedBoard.settle(lastRevealEvent.board);
	},
	onNewGameStart: async () => {
		// The reels are about to roll — clear the previous round's win line, stamped amount/message
		// and info toast NOW (on the button press, before the RGS responds) so the board is clean the
		// instant the spin starts. Runs BEFORE the continuous-bet guard below so autoplay/space-hold
		// rounds clean up too.
		clearWinPresentation();
		if ((stateBet.isTurbo && stateXstateDerived.isAutoBetting()) || stateBet.isSpaceHold) return;
		stateBet.winBookEventAmount = 0;
		// A swap-in-place board has no roll to pre-start, and this is the ONE place the roll begins
		// that the reveal cannot stand down: the pre-spin fires on the BUTTON PRESS, before the RGS
		// has answered, so `presentReveal` skipping `enhancedBoard.spin` never unwinds it. Left in, the
		// reels roll from the press until the drop-in hides them — which is exactly what a swap-in-place
		// board is defined as not doing, and it reads as "the reels spin, then stop mid-spin and new
		// symbols appear". It also flattens the board on the way: a rolling strip runs far past the
		// visible rows, and the seat's depth ramp clamps there, so every symbol draws at front-row
		// size for the length of the roll. Off ⇒ this is unreachable and the pre-spin is untouched.
		if (stateGameDerived.boardSwapsInPlace()) return;
		await stateGameDerived.enhancedBoard.preSpin({
			paddingBoard: paddingReels(stateGame.gameType),
		});
	},
	onNewGameError: () => stateGameDerived.enhancedBoard.settle(),
	onPlayGame: async (bet) => await playBet(bet),
	checkIsBonusGame: (bet) => checkIsMultipleRevealEvents({ bookEvents: bet.state }),
});

const intermediateMachines = createIntermediateMachines(primaryMachines);

export const gameActor = createGameActor(intermediateMachines);
