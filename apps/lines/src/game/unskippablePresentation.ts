/**
 * SLAM-STOP SCOPING for apps/lines — the two places the raw `roundSkip` token
 * (`utils-shared/skipToken`) is deliberately narrowed: the UNSKIPPABLE presentation carve-out, and
 * the PER-SPIN re-arm.
 *
 * A slam fast-forwards the round by RACING each presentation wait against the skip token. That is
 * right for a wait whose visual is a value the skip lands at its final state (a count-up, a win
 * line, a reel snap): the race ends the wait and the picture is already correct.
 *
 * It is WRONG for a presentation whose visual is a TIMELINE nobody cancels — the book / expanding
 * symbol reveal (a spine/`.irig` rig animation) and the free-spin intro. Racing those releases the
 * round chain while the rig keeps playing detached, so the next free spin's reels start underneath a
 * reveal that is still on screen. A detached animation is worse than a slow one, so these two run to
 * completion even when the token is tripped (owner direction 2026-07-20).
 *
 * The carve-out is scoped by BOOK EVENT rather than by cue name, because the cues themselves are
 * shared: `transition` / `uiHide` / `uiShow` punctuate the free-spin END too, and that must keep
 * fast-forwarding. `playBookEvent` opens the scope for the duration of ONE dispatch — coded, v1-flow
 * or v2-flow — and every wait inside it consults {@link inUnskippablePresentation}.
 *
 * THE HANG RULE. Making a wait unskippable is only safe when the promise settles on its OWN — a
 * timer, a spine `complete`, a `Promise.all` of those. A wait released only by a player PRESS must
 * stay raced: after a slam the spin button is inert and is drawn above the overlay, so it swallows
 * the very tap that would release the hold and the round never completes (the bug fixed in 350b473).
 * {@link PLAYER_GATED_CUES} is that exemption, and it applies INSIDE the scope.
 *
 * THE SPIN IS THE SKIPPABLE UNIT, not the round (owner direction 2026-07-20, reversing the original
 * whole-feature choice). One press used to fast-forward every remaining free spin, because the token
 * is sticky and was re-armed only per bet. It is now re-armed at the START of each spin of a bonus
 * book ({@link rearmSlamForSpin}), so a press slams the spin that is rolling and the feature resumes
 * at full pace — normal roll, normal anticipation, normal count-up — until the next press.
 */

import { roundSkip } from 'utils-shared/skipToken';
import { waitForTimeout } from 'utils-shared/wait';

/**
 * The book events whose whole presentation is unskippable.
 *  - `setExpandingSymbol` — the book reveal: `SpecialBook`'s shuffle→land→intro spine, or the
 *    authored `FreeSpinIntroSymbolReveal` rig the chosen symbol rides.
 *  - `freeSpinTrigger` — the free-spin intro: the scatter animation, the transition wipe and the
 *    intro screen's own animation/delays.
 */
export const UNSKIPPABLE_BOOK_EVENTS: ReadonlySet<string> = new Set([
	'setExpandingSymbol',
	'freeSpinTrigger',
]);

/**
 * Cues whose awaited hold is resolved ONLY by a player press. These keep racing the token even
 * inside an unskippable presentation — see "THE HANG RULE" above. Each is a `waitForResolve` held by
 * a `PressToContinue` gate: `freeSpinIntroUpdate` (`FreeSpinIntroGate` / `FreeSpinIntroFlowGate`),
 * `bookRevealGateShow` (`BookRevealGate`), `freeSpinOutroCountUp` (`FreeSpinOutroGate`).
 */
export const PLAYER_GATED_CUES: ReadonlySet<string> = new Set([
	'freeSpinIntroUpdate',
	'bookRevealGateShow',
	'freeSpinOutroCountUp',
]);

// Book events are dispatched strictly serially (`createPlayBookUtils`' `sequence`), so a plain
// counter is enough to scope one dispatch — and it nests safely for the resume path, where
// `createBonusSnapshot` replays a `freeSpinTrigger` from inside its own handler.
let depth = 0;

/** True while the round is inside a presentation that must run to completion. */
export const inUnskippablePresentation = (): boolean => depth > 0;

/** Run `dispatch` with the unskippable scope open iff this book event owns an unskippable
 *  presentation. Any other event runs untouched, so the base game keeps fast-forwarding. */
export const runBookEventPresentation = async (
	bookEventType: string,
	dispatch: () => Promise<void>,
): Promise<void> => {
	if (!UNSKIPPABLE_BOOK_EVENTS.has(bookEventType)) {
		await dispatch();
		return;
	}
	depth += 1;
	try {
		await dispatch();
	} finally {
		depth -= 1;
	}
};

/** Await an emitter cue's subscribers: fully inside an unskippable presentation (unless the cue is
 *  player-gated), raced against the slam token everywhere else. The single wrapper every awaited
 *  `broadcastAsync` in the game goes through — coded handler, effect registry, both flow runtimes. */
export const awaitCue = (cue: string, subscribers: Promise<unknown>): Promise<void> =>
	inUnskippablePresentation() && !PLAYER_GATED_CUES.has(cue)
		? subscribers.then(() => undefined)
		: roundSkip.race(subscribers);

/** A presentation delay — a real wait inside an unskippable presentation (an authored intro Delay
 *  paces a rig that nothing cancels), collapsed by the slam token everywhere else. */
export const waitPresentation = (time: number): Promise<void> =>
	inUnskippablePresentation() ? waitForTimeout(time) : roundSkip.wait(time);

/**
 * Re-arm the slam token for the spin that is ABOUT to roll — the per-spin unit of skippability.
 * Called at the top of the `reveal` leaf (coded handler + `revealBoard` effect) when the book holds
 * MORE THAN ONE reveal, i.e. this is a bonus book and each reveal is one free spin. A single-reveal
 * base-game book never calls it, so the base game keeps exactly the round-scoped behaviour the owner
 * approved.
 *
 * It is a DELIBERATE call at the site that owns the spin lifecycle, rather than a subscription to
 * the `stopButtonEnable` broadcast that used to carry it: that made the re-arm an invisible side
 * effect of a UI-enable event which ALSO fires from `playBet`'s `finally` (round end), where
 * re-arming means nothing.
 *
 * Re-arming can only ever return the token to the state an un-slammed round is already in, so it
 * cannot strand a wait: every hold reached after it behaves exactly as it does when nobody pressed.
 * It also cannot race the unskippable carve-out — the scope is opened and closed inside a SINGLE
 * book-event dispatch, book events are strictly serial, and `reveal` is a different dispatch from
 * the `setExpandingSymbol` / `freeSpinTrigger` that own the reveal and intro. The carve-out drops
 * the race outright rather than reading the token, so its behaviour does not depend on this at all.
 */
export const rearmSlamForSpin = (): void => roundSkip.reset();
