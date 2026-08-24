/**
 * Invisible Engine — WIN TIER ESCALATION, the decisions that end a chain.
 *
 * PURE + dependency-light, in the same spirit as `winOwnership.ts`, so the rule that decides when a
 * big-win presentation is OVER lives in one place and can be exercised without a renderer (see
 * `packages/engine-game/fixtures/winEscalationOutro.fixture.ts`) rather than only by playing a
 * mega win on a live game.
 */

/** The three animation names a win tier binds, as `WinAnimationStep.animationMap` carries them. */
export type TierAnimationMap = {
	intro: string;
	idle: string;
	outro: string;
};

/**
 * Whether a tier has a distinct EXIT clip — the animation whose `complete` is allowed to end the
 * presentation.
 *
 * The escalation chain concludes by playing the final tier's outro and waiting for the spine to
 * report `complete`. That wait BLOCKS THE ROUND, so it matters a great deal whether an exit exists
 * at all. Two authorings mean it does not, and they are the same case:
 *
 *  - an EMPTY outro name. Nothing is played, so nothing ever reports.
 *  - an outro name equal to that tier's own IDLE. The `win` component's outro dropdown makes an
 *    author pick SOMETHING from the tier's spine, so a rig with no exit clip gets the idle pointed
 *    at it. The two are different classes of art, not interchangeable takes on one: measured across
 *    the engine's reference `bigwin` rig, every `*_win_exit` is 467ms and every `*_win_idle` is
 *    12000ms — a resting loop, authored to be cut off by a hide, never to be waited out.
 *
 * Treating the second case as a real exit is what left the Book of Borut remake's win overlay on
 * screen after the count-up landed: the gate sat waiting for the end of a 12-second idle cycle that
 * carried no meaning, with (before the same change) no tap surface left to cut it short.
 *
 * A tier that HAS an exit is untouched — it plays, it reports, the gate concludes on it.
 */
export const tierHasExit = (animationMap: TierAnimationMap): boolean =>
	!!animationMap.outro && animationMap.outro !== animationMap.idle;
