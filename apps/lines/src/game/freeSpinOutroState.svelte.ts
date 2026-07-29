import type { WinLevelData } from './winLevelMap';

/**
 * Shared reactive bridge for the free-spin OUTRO gate/driver → visual split (§17 Phase 3, FS-7).
 * The GATE (fallback) or the HEADLESS DRIVER (`FreeSpinOutroDriver`, when the authored screen owns
 * the outro) owns the `WinCountUpProvider` (the count-up tween) + the round-blocking await, and
 * WRITES the win level (on the `freeSpinOutroCountUp` event) and the live tweened `countUpAmount`
 * (per frame, via `OutroStatePublisher`) here. The count text READS `countUpAmount` — the coded
 * `FreeSpinOutroVisual`'s spine slot, OR an authored text node bound to the `freeSpinOutroTotalWin`
 * value source (FS-7 decision C), both currency-formatted. `winLevelData` picks the big/small
 * sprite in the coded visual + gates its render; the authored art instead gates on the
 * `freeSpinOutroBigWin`/`freeSpinOutroSmallWin` signals (FS-7 decision D). A plain reactive rune in
 * a `.svelte.ts` module; the per-frame write is fine.
 *
 * `countUpComplete` is the ORDER-INDEPENDENT latch for the `freeSpinOutroCountUpComplete` signal.
 * The driver resets it false on `freeSpinOutroShow` and sets it true right before broadcasting the
 * signal. The registered signal source SEEDS off it on subscribe, so a late-subscribing authored
 * screen still arms its `tapArmAfterSignal` tap — a ZERO / instant count-up (level 1 `'zero'`,
 * `amount:0`, `presentDuration:0`) completes within the same tick the screen mounts, so the fire
 * would otherwise be lost (no emitter replay) and the tap would never arm (the stuck outro).
 */
export const freeSpinOutroState = $state<{
	winLevelData: WinLevelData | undefined;
	countUpAmount: number;
	countUpComplete: boolean;
}>({
	winLevelData: undefined,
	countUpAmount: 0,
	countUpComplete: false,
});
