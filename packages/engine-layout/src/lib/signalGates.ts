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
