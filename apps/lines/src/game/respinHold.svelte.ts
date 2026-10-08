import { armSpinHold, stateBet } from 'state-shared';

import { activeRespinMode } from './activeRespinMode.svelte';
import { parksBeforeRespin } from './respinModes';
import type { BookEvent } from './typesBookEvent';

/**
 * A MANUAL RESPIN MODE (`GameModeDecl.holdAndWin.play: 'manual'`, bonus-games Phase 4): the player
 * presses SPIN for each respin. The book parks before each of the mode's `respinReveal`s on the
 * free-spin hold (`armSpinHold`): the spin button reads SPIN, and its press (or Space, or the flow's
 * `spin` action) releases the respin — no bet, no slam. While it is parked a tap anywhere releases it
 * too ({@link stateRespinPark}), so a mode whose HUD has no spin button never strands a touch player.
 * The intro and the outro stay timed, as in `auto`. Under autoplay or hold-to-spin it never parks.
 *
 * Hung off the play seam BEFORE the event (`createPlayBook`'s `holdBeforeEvent`), on every dispatch
 * path, so it parks the same whether the coded handler or a flow presents the respin. Returns nothing
 * for an event that does not park, so every other event, and every `auto` respin, costs nothing.
 */

/** Is a Manual respin parked on SPIN now? `Game.svelte` lays the tap-anywhere release over it. */
export const stateRespinPark = $state({ parked: false });

/**
 * Hands-off play: autoplay is running (its counter is decremented only AFTER a round, so it is still
 * at least 1 through the LAST autoplay round) or hold-to-spin is held.
 */
const handsOff = (): boolean => stateBet.autoSpinsCounter > 0 || stateBet.isSpaceHold;

export const holdBeforeRespin = (bookEvent: BookEvent): Promise<void> | undefined => {
	if (!parksBeforeRespin(bookEvent.type, activeRespinMode()?.play, handsOff())) return undefined;
	stateRespinPark.parked = true;
	return new Promise<void>((resolve) =>
		armSpinHold(() => {
			stateRespinPark.parked = false;
			resolve();
		}),
	);
};
