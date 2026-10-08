import { armSpinHold, stateBetDerived } from 'state-shared';

import { activeRespinMode } from './activeRespinMode.svelte';
import { parksBeforeRespin } from './respinModes';
import type { BookEvent } from './typesBookEvent';

/**
 * A MANUAL RESPIN MODE (`GameModeDecl.holdAndWin.play: 'manual'`, bonus-games Phase 4): the player
 * presses SPIN for each respin. The book parks before each of the mode's `respinReveal`s on the
 * free-spin hold (`armSpinHold`): the spin button reads SPIN, and its press (or Space, or the flow's
 * `spin` action) releases the respin — no bet, no slam. The intro and the outro stay timed, as in
 * `auto`. Under autoplay or space-hold it never parks ({@link parksBeforeRespin}).
 *
 * Hung off the play seam BEFORE the event (`createPlayBook`'s `holdBeforeEvent`), on every dispatch
 * path, so it parks the same whether the coded handler or a flow presents the respin. Returns nothing
 * for an event that does not park, so every other event, and every `auto` respin, costs nothing.
 */
export const holdBeforeRespin = (bookEvent: BookEvent): Promise<void> | undefined => {
	const play = activeRespinMode()?.play;
	if (!parksBeforeRespin(bookEvent.type, play, stateBetDerived.isContinuousBet())) return undefined;
	return new Promise<void>((resolve) => armSpinHold(resolve));
};
