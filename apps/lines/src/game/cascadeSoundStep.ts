/**
 * WHERE THE CASCADE IS, for the tumble-explosion sound — which rung of the ladder the next pop
 * plays, and whether the pop should sound at all.
 *
 * Its own module, free of every import, because it is the one genuinely SUBTLE piece of the sound
 * wiring and the only piece worth exercising offline (`cascadeSoundStep.fixture.ts`). The rest of
 * `soundBindings.ts` is lookups; this is a small state machine driven by the book-event stream, and
 * it answers a question that has a wrong answer nobody would hear until a player did.
 *
 * That question is the second field. `tumbleBoardExplode` serves TWO moments that look identical on
 * screen: the cascade blowing away the cells that just paid, and `clearOutgoingSymbols` emptying the
 * board before a drop-in reveal (`/config` → Reel behaviour → "Clear the board before the new
 * symbols fall in"). Same cue, same animation — but in the second, nothing has won, and a win ladder
 * firing there would celebrate a spin that has not happened yet. The clear only ever runs under a
 * `reveal`, so "is the event being dispatched right now a `tumbleBoard`" separates them exactly,
 * with no new field on the cue and nothing for a flow author to remember to pass.
 */

/** `-1` = no cascade has run this round. The round's first `tumbleBoard` takes it to `0`, the
 *  ladder's first rung. */
let step = -1;

/** Is the book event being dispatched RIGHT NOW a cascade step? */
let inCascade = false;

/**
 * Advance the round's cascade position for one book event.
 *
 * `reveal` is the round boundary — the same event `flowEffects` already treats as the boundary that
 * invalidates the resting-board win cycle — so the ladder restarts from rung 1 each spin rather than
 * climbing forever across a session.
 *
 * Every OTHER event clears `inCascade`, deliberately rather than leaving it alone: a stale `true`
 * would let a later board clear play the win ladder, which is the exact failure this exists to
 * prevent.
 */
export function trackCascadeStep(eventType: string): void {
	if (eventType === 'reveal') {
		step = -1;
		inCascade = false;
		return;
	}
	if (eventType === 'tumbleBoard') {
		step += 1;
		inCascade = true;
		return;
	}
	inCascade = false;
}

/**
 * The ladder rung this pop should play, or `null` when the explosion is not a cascade and must stay
 * silent. `null` rather than `-1` so a caller cannot accidentally use it as an index — the clamp in
 * `resolveSounds().pick` would happily turn a `-1` into rung 1.
 */
export function cascadeSoundRung(): number | null {
	return inCascade ? Math.max(step, 0) : null;
}

/** Test seam — drop the round's position. Never called by the game: the `reveal` of the next round
 *  does this, and a second reset path would be a second thing to keep in step. */
export function resetCascadeSoundStep(): void {
	step = -1;
	inCascade = false;
}
