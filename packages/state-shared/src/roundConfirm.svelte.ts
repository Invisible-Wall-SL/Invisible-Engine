import { stateBet } from './stateBet.svelte';
import { stateOperator } from './stateOperator.svelte';
import { stateUi, stopAutoSpins } from './stateUi.svelte';

/**
 * The operator's ROUND-START CONFIRMATION (`confirmGameRoundStart`): before every PAID round the
 * player is asked, and the bet is placed only on a yes. Free spins inside a round are not new rounds
 * and are never asked about. The dialog is `components-ui-html`'s `<RoundStartConfirm>`, which keys
 * on {@link stateRoundConfirm} and answers through {@link answerRoundStart}.
 */
export const stateRoundConfirm = $state({ open: false });

/** Held outside `$state`: a callback, not data anything renders off. */
let answer: ((confirmed: boolean) => void) | undefined;

/**
 * Ask whether the paid round about to start may start. `null` when the operator did not ask for
 * confirmation — the caller then goes straight on, without so much as an await, which is what keeps
 * a launch that declares nothing exactly as it was.
 *
 * While the question is open the spin press is inert: the round is already in flight (the machine
 * left idle on the press), so a second press would otherwise read as a SLAM and trip the round
 * token and turbo for a round that has not started. Raising the unskippable-presentation latch is
 * what `utils-shared/spinStop` already reads for exactly that — the button greys, and the Space
 * hotkey, the flow `spin` action and an intent all stand down with it. Between rounds nothing else
 * holds that latch (`playBet` clears it at every round end), and it is restored, not cleared.
 *
 * A NO stops continuous play with it: the autoplay counter is zeroed and a Space hold released, so
 * the machine ends instead of asking again on the next round the player just refused.
 */
export const requestRoundStart = (): Promise<boolean> | null => {
	if (!stateOperator.confirmGameRoundStart) return null;
	// A question left open by an actor that was torn down is refused first, so the latch it raised
	// is restored before this one reads it — otherwise the spin button would stay inert for good.
	answer?.(false);
	const lockedBefore = stateUi.unskippablePresentationActive;
	stateUi.unskippablePresentationActive = true;
	stateRoundConfirm.open = true;
	return new Promise<boolean>((resolve) => {
		answer = (confirmed) => {
			answer = undefined;
			stateRoundConfirm.open = false;
			stateUi.unskippablePresentationActive = lockedBefore;
			if (!confirmed) {
				stopAutoSpins();
				stateBet.isSpaceHold = false;
			}
			resolve(confirmed);
		};
	});
};

/** The player's answer to the open question. A no-op when nothing is being asked. */
export const answerRoundStart = (confirmed: boolean): void => answer?.(confirmed);
