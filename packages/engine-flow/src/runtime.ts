/**
 * The runtime surface the choreography executor drives — injected, never imported, so the
 * interpreter stays decoupled from the Svelte-rune state modules (`stateBet.svelte.ts`)
 * and the game-specific emitter. The game wires these once at boot to the SAME primitives
 * the coded path uses (`eventEmitter`, `stateBetDerived.timeScale`, `waitForTimeout`), so
 * the executor reproduces the coded behaviour byte-for-byte (design doc §8, §11.1).
 */

/** The emitter contract, structurally identical to `createEventEmitter`'s return.
 *  `broadcast` is synchronous fire-and-return; `broadcastAsync` returns a promise that settles
 *  once the subscribers have (design doc §8 — emitter semantics). */
export type FlowEmitter = {
	broadcast: (emitterEvent: { type: string } & Record<string, unknown>) => void;
	/** The executor only ever AWAITS this (or drops it) — the subscriber results are never read —
	 *  so the return is deliberately opaque, letting the game wrap it (e.g. race it against the
	 *  round's slam token) without having to fabricate a results array. */
	broadcastAsync: (emitterEvent: { type: string } & Record<string, unknown>) => Promise<unknown>;
};

/**
 * A registered game-side effect — the implementation of a FlowDoc `effect` node. Receives
 * the resolved payload (whitelisted accessors already evaluated to plain values) and may
 * return a promise the executor awaits (so an effect mirroring an awaited coded operation —
 * `enhancedBoard.spin(…)`, a board column morph — blocks the sequence exactly as the coded
 * handler does). The game wires these at boot beside the emitter; their bodies do the
 * non-emitter work (state mutations, board ops) the bounded choreography vocabulary cannot
 * express — the `declare ≠ implement` contract (design doc §3, §11.4).
 */
export type FlowEffect = (payload: Record<string, unknown>) => void | Promise<void>;

export type FlowRuntime = {
	emitter: FlowEmitter;
	/** Live turbo scalar — `() => stateBet.isTurbo ? 2 : 1` (design doc §8, speed). */
	timeScale: () => number;
	/** `waitForTimeout` — `(ms) => new Promise(r => setTimeout(r, ms))`. The executor passes
	 *  the ALREADY-scaled duration, matching the coded `ms / timeScale()` call sites. */
	waitForTimeout: (ms: number) => Promise<void>;
	/**
	 * Resolve a registered game-side effect by name (the `effect` choreography node), or
	 * `undefined` if none is registered — in which case the executor treats it as a no-op
	 * (parity-safe: an un-registered effect cannot break an un-baked boot). The game injects
	 * a closed map at boot; engine-flow never implements an effect itself (design doc §11.4).
	 */
	effect?: (name: string) => FlowEffect | undefined;
};
