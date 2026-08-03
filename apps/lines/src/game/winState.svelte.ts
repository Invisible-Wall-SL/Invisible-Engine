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
 * Both are reset by `WinGate` on `winShow`/`winHide`. Un-escalating ⇒ `escalationActive` stays false
 * and the gate concludes exactly as before (byte-identical).
 */
export const winState = $state<{
	winLevelData: WinLevelData | undefined;
	amount: number;
	countUpAmount: number;
	coinsEmit: boolean;
	countUpComplete: boolean;
	escalationActive: boolean;
	escalationOutroComplete: boolean;
}>({
	winLevelData: undefined,
	amount: 0,
	countUpAmount: 0,
	coinsEmit: false,
	countUpComplete: false,
	escalationActive: false,
	escalationOutroComplete: false,
});
