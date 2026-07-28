import type { WinLevelAlias, WinLevelData } from './winLevelMap';

/** Author-controlled coin-fountain config for the FS-7 headless outro driver (decision 2 — the
 *  fountain stays BAKED in the engine driver; the author only toggles/positions it). Defaults
 *  reproduce today's behaviour (on, board-origin, level derived from the win). Set by the optional
 *  `FreeSpinOutroCoins` config marker the author places in the `freeSpinOutro` scene; unset ⇒ these
 *  defaults ⇒ byte-identical to a fountain the author never touched. */
export interface OutroCoinsConfig {
	/** Emit the fountain at all. Default `true` (current behaviour). */
	show: boolean;
	/** Local x offset of the fountain origin (0 = the driver's origin, today's position). */
	x: number;
	/** Local y offset of the fountain origin. */
	y: number;
	/** Force the coin tier; unset ⇒ derive from the win level (`winLevelData.alias`). */
	levelAlias?: WinLevelAlias;
}

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
 */
export const freeSpinOutroState = $state<{
	winLevelData: WinLevelData | undefined;
	countUpAmount: number;
	coins: OutroCoinsConfig;
}>({
	winLevelData: undefined,
	countUpAmount: 0,
	coins: { show: true, x: 0, y: 0 },
});
