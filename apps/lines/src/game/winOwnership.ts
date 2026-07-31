/**
 * Invisible Flow — WIN OVERLAY mount decision (design doc §14, the win-overlay twin of the FS-7 outro).
 *
 * PURE + dependency-light, so the SAME decision is shared by `Game.svelte`'s win mount site AND a
 * headless spike. OWNERSHIP-based + NAME-AGNOSTIC: the trigger is whether the flow OWNS the `setWin`
 * event (`flowV2Runtime`'s `ownsEvent('setWin')`), NOT a scene named `bigWin`. So an author names their
 * win container ANYTHING, rebuilds it from primitives (own dim / text box / art / tap), and the engine
 * mounts only the LOAD-BEARING headless count-up driver behind it. Nothing here inspects a scene by id.
 */

/** What the engine mounts at the WIN band. `driver` = the HEADLESS `<WinGate headless>` (count-up +
 *  `winState` publish, NO dim) when the flow OWNS `setWin` — the authored container owns dim / text /
 *  art / tap; `gate` = the full `<WinGate>` (big-win dim + count-up + suppressed press) when the flow
 *  does NOT own `setWin` (the coded `setWin` handler broadcasts `winShow`/`winUpdate` — today's Borut
 *  remake path); `null` = nothing (a coded `Win`/`WinGate` in `basegameOverlays` already subscribes
 *  `winUpdate`, or a non-flow game where the coded composer owns the overlay). */
export type WinMount = 'driver' | 'gate' | null;

/**
 * The SINGLE decision for which WIN surface mounts, so the mount site can't drift from the
 * exactly-one-`winUpdate`-subscriber invariant. The engine participates ONLY under a v2 flow that
 * DRIVES the screens (`flowV2DrivesScreens`) — a non-flow / book-events-only game never mounts the
 * engine gate (the coded composer owns it) ⇒ `null` ⇒ byte-identical to today. It stands DOWN when a
 * coded `Win`/`WinGate` binds the (always-mounted) `basegameOverlays` scene
 * (`basegameOverlaysHasCodedWinGate`) — that gate is already the sole subscriber, regardless of `setWin`
 * ownership (mirrors `main`'s `flowV2DrivesScreens && !basegameOverlaysHasCodedWinGate` condition, so a
 * non-owning game is byte-identical). Otherwise it mounts the HEADLESS `driver` when the flow OWNS
 * `setWin` (the authored container owns dim / text / art / tap) or the full `gate` when it does not
 * (the coded `setWin` handler drives the presentation — parity).
 *
 * The `winUpdate` SUBSCRIBER COUNT under v2 is
 * `(mount ? 1 : 0) + (basegameOverlaysHasCodedWinGate ? 1 : 0)`, which this guarantees is exactly 1
 * for every combination (asserted headlessly, `fs7Win`).
 */
export const resolveWinMount = (ctx: {
	flowV2DrivesScreens: boolean;
	flowOwnsSetWin: boolean;
	basegameOverlaysHasCodedWinGate: boolean;
}): WinMount => {
	if (!ctx.flowV2DrivesScreens) return null;
	if (ctx.basegameOverlaysHasCodedWinGate) return null;
	return ctx.flowOwnsSetWin ? 'driver' : 'gate';
};
