/**
 * Invisible Flow v2 — the interpreter-handle holder (Phase 4b).
 *
 * The v2 runtime needs the LIVE editor doc (loaded async at boot), so — like the v1
 * `flowInterpreterHolder` — Game.svelte builds the handle once the doc resolves and stows it
 * here; the book-event play path (`game/utils.ts`) reads it to decide, per event, whether a v2
 * flow drives the presentation.
 *
 * ABSENT by default (no `__IE_FLOW_V2_DOC__` ⇒ `createLinesFlowV2` returns `undefined` ⇒ nothing
 * is set), so `flowV2` stays `undefined` and every book event runs its v1/coded path — the game
 * is byte-identical to current `main`. v2 is a DEV-gated opt-in for now (Phase 5 hard-cuts v1).
 */

import type { LinesFlowV2 } from './flowV2Runtime.svelte';

declare global {
	/** DEV live-verify handle (Phase 4b) — the built v2 handle, published for ad-hoc verification:
	 *  `window.__IE_FLOW_V2__.dispatch('<event>', {...})` runs an authored handler (showing/hiding
	 *  containers, firing cues), and `.ordered()` reads the mounted set. Mirrors the existing
	 *  `__IE_FLOW_VALUE__` dev affordance. `undefined` when no v2 doc is authored. */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2__: LinesFlowV2 | undefined;
}

let flowV2: LinesFlowV2 | undefined;

/** Set once Game.svelte has built the v2 handle from the live editor doc + an authored v2 doc. */
export const setFlowV2 = (handle: LinesFlowV2 | undefined): void => {
	flowV2 = handle;
	// Publish the handle for dev live-verify (see the global above). Harmless on a normal boot
	// (handle is `undefined`); never read by product code.
	if (typeof globalThis !== 'undefined') globalThis.__IE_FLOW_V2__ = handle;
};

/** The active v2 handle, or `undefined` when no v2 FlowDoc is authored (v1/coded path owns). */
export const getFlowV2 = (): LinesFlowV2 | undefined => flowV2;

/**
 * Dispatch a NON-book game event (a lifecycle/signal like `load`, or an intent) into the v2 flow.
 * Runs v2 ALONE when the flow OWNS the event (returns `true`); returns `false` when v2 doesn't own
 * it, so the caller runs its v1/coded path unchanged (parity). No v2 doc ⇒ always `false`.
 */
export const dispatchFlowV2Event = async (
	name: string,
	payload: Record<string, unknown> = {},
): Promise<boolean> => {
	if (!flowV2?.ownsEvent(name)) return false;
	await flowV2.dispatch(name, payload);
	return true;
};

/**
 * The tap-to-continue / `completeOnLoaded` "the current screen finished" hook (Phase A). v2 has no
 * stateful active screen, so "complete" is scoped to the TOPMOST shown container: dispatch
 * `complete:<top>` (a translated flow authors these — e.g. `complete:loading` swaps loading→game).
 * Runs v2 ALONE when the flow owns that screen's complete (returns `true`); else `false` so the v1
 * `completeActiveScreen` path runs (parity). No v2 doc / nothing shown / un-authored ⇒ `false`.
 */
export const dispatchFlowV2Complete = async (): Promise<boolean> => {
	const top = flowV2?.ordered().at(-1)?.id;
	return top ? dispatchFlowV2Event(`complete:${top}`) : false;
};
