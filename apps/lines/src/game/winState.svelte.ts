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
 */
export const winState = $state<{
	winLevelData: WinLevelData | undefined;
	amount: number;
	countUpAmount: number;
	coinsEmit: boolean;
}>({
	winLevelData: undefined,
	amount: 0,
	countUpAmount: 0,
	coinsEmit: false,
});
