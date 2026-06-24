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
