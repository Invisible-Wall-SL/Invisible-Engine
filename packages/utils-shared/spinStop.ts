import { stateBet, stateBetDerived } from 'state-shared';

import { roundSkip } from './skipToken';

export type SpinButtonKey = 'spin_default' | 'spin_disabled' | 'stop_default';

/**
 * The spin button's key. Slam stop is ALWAYS available, so any round in progress shows a live
 * STOP — a single bet is no longer inert.
 *
 * During autoplay the second press means "cancel the sequence" rather than "slam", but the key
 * vocabulary has no caption for that and inventing one would be dead art in every existing game,
 * so both presses render as STOP.
 */
export const getSpinButtonKey = ({ isIdle }: { isIdle: boolean }): SpinButtonKey => {
	if (isIdle) return stateBetDerived.isBetCostAvailable() ? 'spin_default' : 'spin_disabled';
	return 'stop_default';
};

export type SpinPressSound = { type: 'soundPressBet' } | { type: 'soundPressStop' };

/**
 * The press SOUND for the spin button. A mid-round press is a SLAM, not a bet, so it gets a cue of
 * its own — the press sound was previously broadcast BEFORE `runSpinOrSlamStop` decided, so a slam
 * played the identical spin whoosh and gave the player no audible confirmation.
 *
 * Kept OUT of `runSpinOrSlamStop` (which stays sound-free, so an intent-invoked action can't double
 * the sound the button already made) but beside it, so the coded button, the parametric `spin`
 * action and the Space hotkey share one decision instead of re-deriving it three times.
 */
export const getSpinPressSound = ({ isIdle }: { isIdle: boolean }): SpinPressSound =>
	isIdle ? { type: 'soundPressBet' } : { type: 'soundPressStop' };

/**
 * The press body shared by the coded `ButtonBetProvider`, the Space hotkey and the flow's `spin`
 * action — ONE source of truth for the idle→bet / rolling→slam decision.
 *
 * Rolling, press 1: SLAM. Trips `roundSkip` and broadcasts `stopButtonClick` — the signal the
 * board (`enhancedBoard.stop()`) and the turbo button hang off. The reels land on the resolved
 * result and the whole post-reveal presentation fast-forwards to its final state.
 *
 * Rolling, press 2 (autoplay only): CANCEL the remaining sequence. The round is already slammed,
 * so there is nothing left to fast-forward; zeroing `autoSpinsCounter` is the only useful thing a
 * second press can do. Autoplay therefore always remains cancellable — it just costs two presses,
 * which is what lets press 1 mean "hurry this spin up" instead of "stop everything".
 *
 * `roundSkip.skip()` runs BEFORE the broadcast, synchronously, so the token is already tripped for
 * every subscriber regardless of subscription order (see the reel note in `createReelForSpinning`).
 * No press SOUND here — that stays on the button so an intent-invoked action doesn't double it.
 */
export const runSpinOrSlamStop = ({
	isIdle,
	broadcast,
}: {
	isIdle: boolean;
	broadcast: (emitterEvent: { type: 'bet' } | { type: 'stopButtonClick' }) => void;
}): void => {
	if (isIdle) {
		if (stateBetDerived.activeBetMode()?.type === 'buy') stateBet.activeBetModeKey = 'BASE';
		broadcast({ type: 'bet' });
		return;
	}

	if (roundSkip.isSkipped()) {
		if (stateBetDerived.hasAutoBetCounter()) stateBet.autoSpinsCounter = 0;
		return;
	}

	roundSkip.skip();
	broadcast({ type: 'stopButtonClick' });
};
