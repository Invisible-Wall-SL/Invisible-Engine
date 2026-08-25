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

/** What a TAP during the win count-up does: advance the chain one tier, or LAND the total. */
export type WinTapAction =
	| { kind: 'step'; toTier: number }
	| { kind: 'land'; hold: boolean };

/**
 * What a tap on the win presentation means, given where the tier walk currently is.
 *
 * A tap is not one intent. Mid-chain it means "next tier, faster". On the FINAL tier — where there
 * is nothing left to step to — it means "show me the number now". Neither of those is "get off my
 * screen": the escalating win exists to be looked at, and a tap asking to SEE the total is the
 * worst possible moment to take it away. So the landing tap only LANDS, and the presentation then
 * HOLDS on the total until a second, deliberate tap dismisses it (`WinGate.awaitingDismiss` →
 * `WinAnimation.holdOutro`) — the two-tap grammar every other slot uses for a big win.
 *
 * `hold` is the escalation flag, not a separate authoring: an UN-escalating win has no tiers, no
 * outro and nothing to look at once the number lands, so holding it would only make small wins
 * sticky. That path lands and concludes exactly as it always has.
 *
 * Extracted here, with {@link tierHasExit}, because it decides how long a presentation BLOCKS THE
 * ROUND — the class of rule this file exists to keep testable without a renderer (see
 * `packages/engine-game/fixtures/winTapLand.fixture.ts`).
 */
export const resolveWinTap = (ctx: {
	/** Whether a tier CHAIN is presenting (`winState.escalationActive`). */
	escalating: boolean;
	/** The tier the walk is showing (`winState.escalationStepIndex`). */
	tierIndex: number;
	/** How many tiers the chain renders. 0 on a surface that cannot step (the coded press). */
	tierCount: number;
}): WinTapAction => {
	const next = ctx.tierIndex + 1;
	if (ctx.escalating && next < ctx.tierCount) return { kind: 'step', toTier: next };
	return { kind: 'land', hold: ctx.escalating };
};
