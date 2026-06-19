import type { WinLevelData } from './winLevelMap';

/**
 * Shared reactive bridge for the free-spin OUTRO gate → visual split (§17 Phase 3).
 * The full-screen GATE owns the `WinCountUpProvider` (the count-up tween) + the
 * round-blocking await, and WRITES the win level (on the `freeSpinOutroCountUp` event)
 * and the live tweened `countUpAmount` (per frame, via `OutroStatePublisher`) here. The
 * editor-positioned VISUAL READS them — `winLevelData` picks the big/small win sprite +
 * gates its render, `countUpAmount` feeds the count text in the spine slot. A plain
 * reactive rune in a `.svelte.ts` module; the per-frame write is fine. `WinCoins` stays
 * in the gate (board-centred via its own `MainContainer`, which the canvas gate scene
 * allows but the game-space visual scene would double-wrap), so it needs nothing here.
 */
export const freeSpinOutroState = $state<{
	winLevelData: WinLevelData | undefined;
	countUpAmount: number;
}>({
	winLevelData: undefined,
	countUpAmount: 0,
});
