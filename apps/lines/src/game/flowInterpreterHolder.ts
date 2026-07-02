/**
 * Invisible Flow — the interpreter singleton holder (Phase 4).
 *
 * The interpreter needs the LIVE editor doc (loaded asynchronously at boot), so it can't be
 * constructed at module-import time alongside `playBookEvents` (`game/utils.ts`). Instead
 * Game.svelte builds it once the doc resolves and stows it here; the book-event play path
 * (`game/utils.ts`) reads it to decide, per event, whether the interpreter drives it or the
 * coded handler runs (the §7 fall-through).
 *
 * ABSENT by default (no FlowDoc ⇒ `createLinesFlow` returns `undefined` ⇒ nothing is set),
 * so `flowInterpreter` stays `null` and every book event runs its coded handler — the game
 * is byte-identical to current `main`. This holder is the single place the runtime consults.
 */

import type { LinesFlow } from './flowRuntime.svelte';

let flowInterpreter: LinesFlow | undefined;

/** Set once Game.svelte has the live editor doc + (optionally) an authored FlowDoc. */
export const setFlowInterpreter = (interpreter: LinesFlow | undefined): void => {
	flowInterpreter = interpreter;
};

/** The active interpreter, or `undefined` when no FlowDoc is authored (pure coded path). */
export const getFlowInterpreter = (): LinesFlow | undefined => flowInterpreter;

/**
 * Tap-to-continue — "complete the active screen" (design doc §6.2). A tap-enabled overlay
 * component calls this on click to run the active screen's exit choreography → fire its
 * `complete`/`exited` pin → so a `complete`-triggered edge from that screen advances the flow.
 * A SAFE no-op when no interpreter is active (no FlowDoc ⇒ the coded path owns the flow).
 * Returns true when a `complete` transition was taken.
 */
export const completeActiveScreen = (): Promise<boolean> =>
	flowInterpreter?.completeActiveScreen() ?? Promise.resolve(false);

/**
 * Tap-to-continue — "emit a named flow signal" (design doc §6.2). A tap-enabled overlay
 * component calls this on click so any active-screen `{kind:'signal', signal}` transition
 * fires. A SAFE no-op when no interpreter is active or no edge listens for the signal.
 * Returns true when a `signal` transition was taken.
 */
export const emitFlowSignal = (signal: string): Promise<boolean> =>
	flowInterpreter?.emitSignal(signal) ?? Promise.resolve(false);

/**
 * Functional action pins (design doc §8.5) — "is this button's action wired into a flow intent?"
 * A bound button reads this to decide whether its press routes through the flow (an authored
 * intent) or its coded path. SAFE `false` when no interpreter is held or the action is unwired,
 * so the coded spin/stop path stays authoritative until an author wires the pin (parity §8.8).
 */
export const hasFlowAction = (key: string): boolean => flowInterpreter?.hasAction(key) ?? false;

/**
 * Functional action pins (design doc §8.5) — fire a flow-bound button's action, invoking the game
 * intent on the wired host (for `spin`, today's coded bet/stop via `invokeIntent`). Fire-and-forget
 * (mirrors `emitFlowSignal`'s shape but discards the promise, since a button `onpress` is sync). A
 * SAFE no-op when no interpreter is held or the action is unwired.
 */
export const emitFlowAction = (key: string): void => {
	void flowInterpreter?.emitAction(key);
};
