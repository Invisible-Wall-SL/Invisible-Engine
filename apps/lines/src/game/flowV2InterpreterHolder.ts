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

import type { FlowPressResolver } from 'engine-layout';

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
 * Container-event PRESS resolver (§Part 2) — the ONE place ownership → dispatch is decided for a
 * component press. Registered into engine-layout's `registerFlowPress`, so `<ComponentInstance>`
 * consults it (at click time) before the coded `onpress`. When the flow OWNS `(componentId, action)`
 * — an authored exec edge from that `showContainer` node's fused pin — this returns a press handler
 * that routes to the flow ALONE (its wired chain, e.g. `startSpin` → the `invokeIntent` bridge, runs);
 * the coded `onpress` is then SUPPRESSED (never also called) ⇒ no double-fire. When the flow does NOT
 * own it (no wired edge, or no v2 doc ⇒ `getFlowV2()` is `undefined`), this returns `undefined` and
 * the coded press runs unchanged (parity). Typed to satisfy engine-layout's `FlowPressResolver`.
 */
export const resolveFlowV2Press: FlowPressResolver = (
	componentId: string,
	action: string,
): (() => void) | undefined => {
	const h = getFlowV2();
	if (!h?.ownsContainerEvent(componentId, action)) return undefined;
	return () => void h.dispatchContainerEvent(componentId, action);
};

/**
 * The tap-to-continue / `completeOnLoaded` "the current screen finished" hook (Phase A). v2 has no
 * stateful active screen, so "complete" is scoped to a shown container. A tap resolves ONE of two
 * authoring shapes, scanning the shown containers TOP-OF-STACK first (persistent HUDs sit above the
 * game screens by z but own neither, so the completing source is the highest game screen underneath):
 *
 *   1. LINEAR HOLD — the container is held by a `showContainer{awaitComplete}` node. The tap RELEASES
 *      that hold (`mount.complete`), so the SAME exec chain resumes past the show node (show → hide →
 *      next), no separate event needed. This is the common overlay pattern.
 *   2. HANDOFF — the flow authors a dedicated `complete:<id>` event (hide self + show the next screen).
 *      The tap dispatches it. This is what the v1→v2 translator emits.
 *
 * Runs v2 ALONE when either resolves (returns `true`); else `false` so the v1 `completeActiveScreen`
 * path runs (parity). No v2 doc / nothing held-or-authored ⇒ `false`.
 */
export const dispatchFlowV2Complete = async (): Promise<boolean> => {
	const h = flowV2;
	if (!h) return false;
	const shown = h.ordered(); // z-ascending
	for (let i = shown.length - 1; i >= 0; i--) {
		const id = shown[i].id;
		if (h.mount.complete(id)) return true; // 1. a held container → the tap resumes its chain.
		if (await dispatchFlowV2Event(`complete:${id}`)) return true; // 2. an authored complete handoff.
	}
	return false;
};
