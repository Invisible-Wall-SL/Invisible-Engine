import {
	hasCelebrationOverlay,
	hasContinuePress,
	hasSpinHold,
	hasUnskippablePresentation,
	releaseSpinHold,
	stateBet,
	stateBetDerived,
} from 'state-shared';

/**
 * The spin button is inert while a non-skippable presentation owns the screen: a celebration
 * SCREEN is mounted (`hasCelebrationOverlay`, driven off the flow's active screens), a
 * press-to-continue overlay is up (`hasContinuePress` — catches a big win presented as a HUD
 * count-up + tap, which mounts no celebration screen), OR an unskippable presentation with no
 * screen yet is running (`hasUnskippablePresentation` — the free-spin intro's scatter-match phase
 * and the book reveal, the window BEFORE the intro screen mounts). Any one locks the press + greys
 * it, so a slam can't trip the round token in a gap and skip the celebration that follows.
 *
 * Exported because the SPIN button is not the only chrome that must stand down: the turbo toggle
 * greys off the same read. Greying is the AFFORDANCE only — what actually stops a stray press
 * landing on the HUD is the game's canvas-top `<ContinuePressMask>`, since an inert button still
 * swallows the pointer it sits under.
 */
export const isCelebrationLocked = (): boolean =>
	hasCelebrationOverlay() || hasContinuePress() || hasUnskippablePresentation();

import { roundSkip } from './skipToken';

export type SpinButtonKey = 'spin_default' | 'spin_disabled' | 'stop_default' | 'stop_disabled';

/**
 * The spin button's key. Slam stop is ALWAYS available, so any round in progress shows a live
 * STOP — a single bet is no longer inert.
 *
 * EXCEPT during a non-skippable celebration (free-spin intro/outro, big win): there the button
 * locks to `stop_disabled` so a press can't slam-fast-forward the celebration (the STOP caption
 * stays, only the press goes inert). See `hasCelebrationOverlay`.
 *
 * During autoplay the second press means "cancel the sequence" rather than "slam", but the key
 * vocabulary has no caption for that and inventing one would be dead art in every existing game,
 * so both presses render as STOP.
 */
export const getSpinButtonKey = ({ isIdle }: { isIdle: boolean }): SpinButtonKey => {
	// A SPIN HOLD outranks every other mid-round state: the round is deliberately parked on its
	// winning board waiting for the player to start the next free spin, so the button reads SPIN and
	// is live. Never affordability-gated — the bonus book was paid for by the bet that triggered it,
	// and a player whose balance dropped below one bet mid-feature must still be able to continue.
	// Checked FIRST so a celebration latch left standing by the presentation that just ended can't
	// grey out the very button the hold is asking the player to press.
	if (hasSpinHold()) return 'spin_default';
	if (isIdle) return stateBetDerived.isBetCostAvailable() ? 'spin_default' : 'spin_disabled';
	if (isCelebrationLocked()) return 'stop_disabled';
	return 'stop_default';
};

/**
 * Whether the spin button should render its ROLLING frame (`imageSpinning`, rotated) — reels
 * turning on a plain bet, not an autoplay sequence.
 *
 * The rolling frame is suppressed during a SPIN HOLD: the round is technically still in flight, but
 * the reels are parked and the button is being offered to the player as a live SPIN, so animating it
 * as "busy" would contradict what it is asking for.
 *
 * Lives here, beside the key/press/sound decisions, because the game's parametric `spin` action and
 * the coded `ButtonBetProvider` had derived it separately — the exact duplication that let the two
 * drift before.
 */
export const isSpinButtonSpinning = ({ isPlaying }: { isPlaying: boolean }): boolean =>
	isPlaying && !stateBetDerived.hasAutoBetCounter() && !hasSpinHold();

/** Whether a spin-button key means the button is inert (unaffordable bet, or celebration lock). */
export const isSpinButtonDisabled = (key: SpinButtonKey): boolean =>
	key === 'spin_disabled' || key === 'stop_disabled';

export type SpinPressSound = { type: 'soundPressBet' } | { type: 'soundPressStop' };

/**
 * The press SOUND for the spin button. A mid-round press is a SLAM, not a bet, so it gets a cue of
 * its own — the press sound was previously broadcast BEFORE `runSpinOrSlamStop` decided, so a slam
 * played the identical spin whoosh and gave the player no audible confirmation.
 *
 * Kept OUT of `runSpinOrSlamStop` (which stays sound-free, so an intent-invoked action can't double
 * the sound the button already made) but beside it, so the coded button, the parametric `spin`
 * action, the Space hotkey and the flow press replay share one decision instead of re-deriving it
 * four times. Takes the SAME `isIdle` read the press body decides on, so cue and behaviour can't
 * disagree.
 */
export const getSpinPressSound = ({ isIdle }: { isIdle: boolean }): SpinPressSound =>
	// A hold-releasing press STARTS the next free spin, so it gets the bet whoosh even though the
	// round is technically still in flight — the stop cue would announce a slam that isn't happening.
	isIdle || hasSpinHold() ? { type: 'soundPressBet' } : { type: 'soundPressStop' };

/**
 * The press body shared by the coded `ButtonBetProvider`, the Space hotkey and the flow's `spin`
 * action — ONE source of truth for the idle→bet / rolling→slam decision.
 *
 * Rolling, press 1: SLAM. Trips `roundSkip` and broadcasts `stopButtonClick` — the signal the
 * board (`enhancedBoard.stop()`) and the turbo button hang off. The reels land on the resolved
 * result and the whole post-reveal presentation fast-forwards to its final state.
 *
 * Rolling, press 2 (autoplay only): CANCEL the remaining sequence. The segment in front of the
 * player is already slammed, so there is nothing left to fast-forward; zeroing `autoSpinsCounter`
 * is the only useful thing a second press can do. Autoplay therefore always remains cancellable —
 * it just costs two presses, which is what lets press 1 mean "hurry this spin up" instead of
 * "stop everything".
 *
 * "Already slammed" is read from the token, so it follows whatever the game scopes a segment to. In
 * `apps/lines` a bonus book re-arms per free spin, so the two presses must land in the SAME spin to
 * cancel — press once per spin and each press slams that spin instead. That is the intended
 * trade-off: a cancel is always one extra press away, in whichever spin is playing.
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
	// SPIN HOLD — the round is parked between free spins. The press means "play the next spin": it
	// releases the hold and nothing else. Checked before the idle branch (no bet — the bonus book is
	// already paid for) and before the slam branch (the player asked to resume at full pace, not to
	// fast-forward the rest of the feature). Handled here rather than in the button so the Space
	// hotkey, the flow `spin` action and an invoked intent all release it too.
	if (hasSpinHold()) {
		releaseSpinHold();
		return;
	}

	if (isIdle) {
		if (stateBetDerived.activeBetMode()?.type === 'buy') stateBet.activeBetModeKey = 'BASE';
		broadcast({ type: 'bet' });
		return;
	}

	// A non-skippable celebration owns the screen — the press is inert so it can't slam-skip it.
	// The button already renders disabled (`getSpinButtonKey` → `stop_disabled`); this guards the
	// direct callers (flow `spin` action, Space hotkey, intent) that bypass the button's own gate.
	if (isCelebrationLocked()) return;

	if (roundSkip.isSkipped()) {
		if (stateBetDerived.hasAutoBetCounter()) stateBet.autoSpinsCounter = 0;
		return;
	}

	roundSkip.skip();
	broadcast({ type: 'stopButtonClick' });
};
