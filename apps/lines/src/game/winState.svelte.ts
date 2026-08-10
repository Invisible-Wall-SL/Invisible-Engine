import type { WinLevelData } from './winLevelMap';

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
 * `escalationBoundaries` is the count-up AMOUNT (book units) at which each RENDERED escalation tier is
 * reached — `tier.threshold × BOOK_AMOUNT_MULTIPLIER`, in chain order (`WinVisual` publishes it). This
 * makes the COUNT the clock for the escalation: `WinAnimation` derives the active tier from where the
 * live `countUpAmount` sits against these boundaries (tiers pop as the number crosses them), and the
 * GATE's TAP-to-step jumps the count forward to the NEXT boundary (`WinCountUpProvider.jumpTo`) so a tap
 * advances one tier and snaps the number to that tier's amount. Empty when un-escalating.
 */
export const winState = $state<{
	winLevelData: WinLevelData | undefined;
	amount: number;
	countUpAmount: number;
	coinsEmit: boolean;
	countUpComplete: boolean;
	escalationActive: boolean;
	escalationOutroComplete: boolean;
	escalationSpeedScale: number;
	escalationBoundaries: number[];
}>({
	winLevelData: undefined,
	amount: 0,
	countUpAmount: 0,
	coinsEmit: false,
	countUpComplete: false,
	escalationActive: false,
	escalationOutroComplete: false,
	escalationSpeedScale: 1,
	escalationBoundaries: [],
});
