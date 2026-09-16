import type { WinLevelData } from 'engine-game';

/**
 * Shared reactive bridge for the WIN overlay gate → visual split (mirrors
 * `freeSpinOutroState`). The full-screen GATE owns the `WinCountUpProvider` (the
 * count-up tween) + the round-blocking await, and WRITES the win level + final amount
 * (on the `winUpdate` event), the live tweened `countUpAmount` (per frame, via
 * `WinStatePublisher`) and the coin-fountain emit signal (`coinsEmit`, = `!countUpCompleted`)
 * here. The editor-positioned VISUAL READS them — `winLevelData` picks the big-win spine vs
 * the plain-number path + gates its render, `amount` feeds the authored win-level caption
 * (Invisible Win Text), `countUpAmount` feeds the count text in the spine slot, `coinsEmit`
 * drives the now-positionable `WinCoins` fountain (emit while the count-up runs). A plain
 * reactive rune in a `.svelte.ts` module; the per-frame write is fine.
 *
 * `countUpComplete` is the ORDER-INDEPENDENT latch for the `winCountUpComplete` signal (mirrors
 * `freeSpinOutroState.countUpComplete`). `WinGate` resets it false on `winShow` and sets it true
 * right before broadcasting the signal on count-up completion; the registered signal source SEEDS
 * off it on subscribe, so a late-subscribing authored `bigWin` container still arms its
 * `tapArmAfterSignal` tap — a ZERO / instant count-up completes within the same tick the container
 * mounts, so the fire would otherwise be lost (no emitter replay) and the tap would never arm.
 *
 * `escalationActive` / `escalationOutroComplete` coordinate the SEQUENTIAL-ESCALATION chain
 * (`WinAnimation`) with the GATE's round-block, so a fast-forward / tap-to-skip of the count-up
 * concludes the WHOLE presentation coherently instead of truncating the escalation. `WinVisual`
 * sets `escalationActive` true while an escalation chain is presenting (a final-tier outro WILL
 * play); `WinAnimation` sets `escalationOutroComplete` true when that outro finishes. The gate then
 * defers its `oncomplete()` until the outro completes on the escalation path — so a collapsed chain
 * (count-up done mid-chain ⇒ jump to the final tier + play its outro) is never cut off mid-animation.
 * `escalationActive` is owned by `WinVisual` (its effect tracks whether a chain is presenting);
 * `escalationOutroComplete` is reset by `WinGate` on `winShow`/`winHide`. Un-escalating ⇒
 * `escalationActive` stays false and the gate concludes exactly as before (byte-identical).
 *
 * `escalationSpeedScale` is the live HOLD-to-fast-forward multiplier (`WinGate`'s
 * `interactionSpeedScale`, 1 when not held). `WinAnimation` applies it as a spine `timeScale` to the
 * escalating intro/idle tiers, so the tiers VISIBLY ACCELERATE in lockstep with the count-up while the
 * player holds (a smooth ramp), reverting to 1 on release. Only the HOLD drives it (a `tapToSkip` slam
 * stays an instant collapse); 1 whenever hold-to-speed-up is off / un-escalating (byte-identical).
 *
 * TAP-TO-STEP escalation coordination (the count-up is NOT the tier clock — the proven idle-complete
 * WALK is, so the tiers are robust to a fast/instant count-up; the tap layers on top):
 * - `escalationBoundaries` — the count-up AMOUNT (book units) of each RENDERED tier, chain order
 *   (`tier.threshold × BOOK_AMOUNT_MULTIPLIER`; `WinVisual` publishes it). Used to SEEK the count to the
 *   tapped tier's amount.
 * - `escalationStepIndex` — the active tier index `WinAnimation` is showing (it publishes it), so the
 *   GATE knows whether a next tier exists (step) or it's the final tier (slam).
 * - `escalationForceStep` — the GATE bumps this on each tap; `WinAnimation` jumps the walk forward to it.
 * All three empty/0 when un-escalating. `WinGate` resets the step fields per win.
 *
 * `awaitingDismiss` — the final tier's count-up was LANDED by an explicit tap, so the presentation
 * HOLDS on the total until a second (dismiss) tap. A tap on the final tier is two different intents —
 * "show me the number now" and "I am done, get off my screen" — and collapsing both into the one tap meant
 * the amount the player tapped to SEE flashed past in the ~300ms settle. So the landing tap only lands:
 * `WinAnimation` keeps the final tier's idle looping instead of flipping to its outro (`holdOutro`),
 * and the gate's conclusion waits on the dismiss press — which sets `escalationOutroComplete`, so the overlay
 * still hides INSTANTLY with the outro skipped (#295's intent, unchanged). Set ONLY on the escalation
 * path — a plain win has no tiers and no outro, so holding it would just make small wins sticky — and
 * only by a tap that actually reached the gate, which is also what proves the gate owns the tap (see
 * `WinGate.holdOnLand`). Every other win concludes exactly as before. Reset on `winShow`/`winHide`.
 *
 * `flowHoldsPresentation` — the AUTHORED flow already holds this presentation open after the count-up
 * (a `showContainer{awaitComplete}` container is on screen; `Game.svelte` publishes the same
 * name-agnostic `winAwaitTargets` ∩ shown test the celebration lock reads). When it does, the gate must
 * NOT arm `awaitingDismiss` on top of it: the flow's hold already keeps the total on screen and its
 * `tapToContinue` already dismisses it, so a second, engine-side hold only adds a rival press surface —
 * and `<ContinuePressMask>` runs the TOP-registered press alone, so whichever surface loses is dead.
 * That is what left the win overlay on screen for the full `DISMISS_HOLD_CAP_MS` after the landing tap:
 * the authored tap (armed a flush later, by the very `winCountUpComplete` the landing tap produced)
 * shadowed the gate's dismiss press, and only that press could release the gate's hold. False with no
 * flow / a flow that authors no hold ⇒ the gate holds exactly as it does today.
 */
export const winState = $state<{
	winLevelData: WinLevelData | undefined;
	amount: number;
	countUpAmount: number;
	coinsEmit: boolean;
	countUpComplete: boolean;
	/** Where the big-win RUN-UP stopped (book units), so the overlay's own count CONTINUES from
	 *  that number instead of restarting at zero — the cue and the overlay are two renderers of
	 *  ONE number. Set by `cueBigWinCountUp` just before the overlay shows, read by `WinGate` as
	 *  the count-up's `startFrom`, cleared on `winHide`. 0 ⇒ no cue ran ⇒ count from zero. */
	cueHandoffAmount: number;
	/** The player's DISMISS press landed. The order-independent latch a PARKED win waits on
	 *  (`waitForPress`), mirroring `countUpComplete`: the press can arrive before the wait is
	 *  wired, and a promise that missed it would hold the round for the whole cap. Reset by
	 *  `WinGate` on `winShow` and `winHide`. */
	dismissPressed: boolean;
	escalationActive: boolean;
	escalationOutroComplete: boolean;
	escalationSpeedScale: number;
	escalationBoundaries: number[];
	escalationStepIndex: number;
	escalationForceStep: number;
	awaitingDismiss: boolean;
	flowHoldsPresentation: boolean;
}>({
	winLevelData: undefined,
	amount: 0,
	countUpAmount: 0,
	coinsEmit: false,
	countUpComplete: false,
	cueHandoffAmount: 0,
	dismissPressed: false,
	escalationActive: false,
	escalationOutroComplete: false,
	escalationSpeedScale: 1,
	escalationBoundaries: [],
	escalationStepIndex: 0,
	escalationForceStep: 0,
	awaitingDismiss: false,
	flowHoldsPresentation: false,
});

/**
 * End a pending LAND-then-dismiss hold from OUTSIDE the gate — the SAFETY NET under
 * {@link winState.flowHoldsPresentation}.
 *
 * The gate's own dismiss press and an authored container's `tapToContinue` both register with
 * `registerContinuePress`, and `<ContinuePressMask>` runs only the TOP one — so on any presentation
 * carrying both, one of them is silently dead. The gate's hold, though, can only be released by the
 * gate's press. Calling this from the authored tap makes the hold releasable by EITHER, so the two
 * surfaces can no longer deadlock each other whichever way the registration order falls.
 *
 * Sets the SAME latch the gate's `dismissNow` does (`escalationOutroComplete`), so the conclusion the
 * gate already has in flight resolves at once and the outro stays skipped on a deliberate dismiss
 * (#295's intent). `awaitingDismiss` is deliberately left set — clearing it would drop
 * `WinAnimation`'s `holdOutro` and start an exit clip in the same beat the overlay is leaving. A no-op
 * when no hold is armed, which is every non-escalating win and every untapped one.
 */
export const releaseWinDismissHold = (): void => {
	if (!winState.awaitingDismiss) return;
	winState.escalationOutroComplete = true;
};
