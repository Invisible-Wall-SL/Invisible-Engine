/**
 * Invisible Flow — pure component-scoped SIGNAL GATE helpers (intro-complete sequencing).
 *
 * A `componentInstance` tracks a per-instance fire-count per component-scoped signal name (a plain
 * `Record<string, number>`): `enter` fires on the visible edge, a game-registered signal fires when
 * its book event arrives, and a spine one-shot fires its authored {@link SpineCue.completeSignal} the
 * moment it completes. Two authoring gates read that map:
 *  - {@link isNodeRevealed} — a node with `hiddenUntilSignal` renders only after that signal fired.
 *  - {@link isTapArmed}     — a tap-to-continue surface accepts taps only after `tapArmAfterSignal`.
 *
 * These are extracted PURE (no Svelte, no rune) so the reveal/arm decision is testable over the real
 * module without a renderer, and so the two consumers (`LayoutNodeView`, `ComponentInstance`) can
 * never disagree about "fired ⇒ open". Every predicate is parity-safe: an UNSET gate is always open.
 */

/** The per-instance fired-signal fire-counts (signal name → times fired; 0/absent ⇒ never fired). */
export type FiredSignalCounts = Record<string, number>;

/** True once `signal` has fired at least once for this instance (a positive fire-count). */
export function hasSignalFired(signal: string, fired: FiredSignalCounts): boolean {
	return (fired[signal] ?? 0) > 0;
}

/**
 * Is a node with `hiddenUntilSignal` currently revealed? Unset ⇒ always revealed (parity). Set ⇒
 * revealed only once that signal has fired for the instance.
 */
export function isNodeRevealed(
	hiddenUntilSignal: string | undefined,
	fired: FiredSignalCounts,
): boolean {
	if (!hiddenUntilSignal) return true;
	return hasSignalFired(hiddenUntilSignal, fired);
}

/**
 * Is a tap-to-continue surface armed? Unset `tapArmAfterSignal` ⇒ armed on mount (parity — today's
 * behaviour). Set ⇒ armed only once that signal has fired for the instance (taps ignored before).
 */
export function isTapArmed(
	tapArmAfterSignal: string | undefined,
	fired: FiredSignalCounts,
): boolean {
	if (!tapArmAfterSignal) return true;
	return hasSignalFired(tapArmAfterSignal, fired);
}

/**
 * Should `SpineTrack` attach a completion listener that fires an authored `completeSignal`? Only for
 * a ONE-SHOT (non-looping) animation with a callback wired — a loop has no single completion, so it
 * would fire every cycle. Pure so the gate is testable without a spine runtime.
 */
export function wantsCompleteListener(loop: boolean | undefined, hasCallback: boolean): boolean {
	return hasCallback && !loop;
}

/** The active cue's playback, as `LayoutNodeView` resolves it. */
export type ActiveCuePlayback = {
	animation: string;
	loop?: boolean;
	/** Set ⇒ the cue declares a completion hand-off, which makes it a ONE-SHOT by construction
	 *  (see {@link handsOffToIdle}). */
	completeSignal?: string;
};

/**
 * Should an active spine cue play ONCE and then settle back into the resting `defaultAnimation`?
 *
 * TRUE is the free-spin-intro shape: `enter → intro` plays through, then the rig idles. FALSE keeps
 * the cue on the track under its own `loop` flag.
 *
 * Three ways it is false, in order:
 *  - a button STATE animation is in effect — it drives the track declaratively while its state holds,
 *    so a cue must not steal the hand-off;
 *  - the cue explicitly asked to LOOP **and declares no `completeSignal`** — a held mode (an idle
 *    character playing a spin loop for the length of a spin) has no completion to hand off at. This
 *    clause is the reason the predicate is not just "cue animation ≠ default": that older shape
 *    matched every idle-plus-a-mode rig and silently forced `loop` to `false`, so a looping cue
 *    played once. A looping cue now holds until another cue replaces it, which is the only way to
 *    end one — a fired cue is never cleared;
 *  - there is no distinct resting animation to hand back TO (absent, or the same clip).
 *
 * WHY `completeSignal` OVERRIDES `loop`: a cue carrying one is a one-shot by construction — the
 * field is documented as "ignored for a looping cue" and `SpineTrack` only attaches a completion
 * listener when `loop` is false. Honouring `loop` on such a cue would therefore silently drop the
 * hand-off, so a `hiddenUntilSignal` sibling would never reveal and a `tapArmAfterSignal` tap would
 * never arm — and a screen held by `showContainer{awaitComplete}` would hang the round forever.
 * The two fields contradict each other; `completeSignal` is the one with a consequence, so it wins
 * and the pre-existing behaviour of any doc carrying both is preserved exactly.
 */
export function handsOffToIdle(
	cue: ActiveCuePlayback | undefined,
	defaultAnimation: string | undefined,
	hasStateAnimation: boolean,
): boolean {
	if (hasStateAnimation || !cue) return false;
	if (cue.loop && !cue.completeSignal) return false;
	return !!defaultAnimation && defaultAnimation !== cue.animation;
}
