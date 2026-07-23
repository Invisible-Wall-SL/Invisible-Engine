import type { WinLevelData } from './winLevelMap';

/**
 * Shared reactive bridge for the WIN overlay gate → visual split (mirrors
 * `freeSpinOutroState`). The full-screen GATE owns the `WinCountUpProvider` (the
 * count-up tween) + the round-blocking await, and WRITES the win level + final amount
 * (on the `winUpdate` event) and the live tweened `countUpAmount` (per frame, via
 * `WinStatePublisher`) here. The editor-positioned VISUAL READS them — `winLevelData`
 * picks the big-win spine vs the plain-number path + gates its render, `amount` feeds
 * the authored win-level caption (Invisible Win Text), `countUpAmount` feeds the count
 * text in the spine slot. A plain reactive rune in a `.svelte.ts` module; the per-frame
 * write is fine. `WinCoins` stays in the gate (board-centred via its own `MainContainer`,
 * which the canvas gate scene allows but the game-space visual scene would double-wrap),
 * so it needs nothing here.
 */
export const winState = $state<{
	winLevelData: WinLevelData | undefined;
	amount: number;
	countUpAmount: number;
}>({
	winLevelData: undefined,
	amount: 0,
	countUpAmount: 0,
});
