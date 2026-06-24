/**
 * The runtime surface the choreography executor drives — injected, never imported, so the
 * interpreter stays decoupled from the Svelte-rune state modules (`stateBet.svelte.ts`)
 * and the game-specific emitter. The game wires these once at boot to the SAME primitives
 * the coded path uses (`eventEmitter`, `stateBetDerived.timeScale`, `waitForTimeout`), so
 * the executor reproduces the coded behaviour byte-for-byte (design doc §8, §11.1).
 */

/** The emitter contract, structurally identical to `createEventEmitter`'s return.
 *  `broadcast` is synchronous fire-and-return; `broadcastAsync` returns the `Promise.all`
 *  of subscriber results (design doc §8 — emitter semantics). */
export type FlowEmitter = {
	broadcast: (emitterEvent: { type: string } & Record<string, unknown>) => void;
	broadcastAsync: (emitterEvent: { type: string } & Record<string, unknown>) => Promise<unknown[]>;
};

export type FlowRuntime = {
	emitter: FlowEmitter;
	/** Live turbo scalar — `() => stateBet.isTurbo ? 2 : 1` (design doc §8, speed). */
	timeScale: () => number;
	/** `waitForTimeout` — `(ms) => new Promise(r => setTimeout(r, ms))`. The executor passes
	 *  the ALREADY-scaled duration, matching the coded `ms / timeScale()` call sites. */
	waitForTimeout: (ms: number) => Promise<void>;
};
