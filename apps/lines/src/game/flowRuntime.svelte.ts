/**
 * Invisible Flow — the apps/lines runtime wiring (Phase 4, design doc §8, §9 row 4).
 *
 * Builds the engine-flow interpreter wired to THIS game's real primitives — the same
 * `eventEmitter`, `stateBetDerived.timeScale`, and `waitForTimeout` the coded path uses
 * (design doc §8 — "the game wires it to the same primitives the coded path uses at boot")
 * — and the live editor doc's scenes (for the generic mounter to resolve).
 *
 * PARITY-FIRST (the §7 invariant, non-negotiable): the FlowDoc source is ABSENT by default,
 * so the interpreter is INERT and the game mounts + animates ENTIRELY via its coded path —
 * byte-identical to current `main`. A FlowDoc reaches the game only via:
 *   - a build-time dev override (`window.__IE_FLOW_DOC__`), used to prove the live mounter +
 *     transitions against the REAL running bundle in Phase 4 without touching the default;
 *   - (Phase 6) a baked `flow` slot in `BakedBundle` + the export→deploy→bake→register chain.
 * Neither exists for an un-baked `apps/lines` dev boot, so this module is a pure no-op there.
 *
 * It OBSERVES the XState platform FSM and book events; it NEVER drives a platform transition
 * (§12). The dispatcher's coded handlers are the un-authored fall-through.
 */

import type { FlowDoc } from 'engine-flow';
import { createFlowInterpreter } from 'engine-flow';
import type { LayoutDoc, Scene } from 'engine-layout';
import { stateBetDerived } from 'state-shared';
import { waitForTimeout } from 'utils-shared/wait';

import { eventEmitter } from './eventEmitter';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { flowEffect } from './flowEffects';
import { LINES_FLOW_DOC } from './flowDoc';
import type { BookEvent, BookEventContext } from './typesBookEvent';

declare global {
	// eslint-disable-next-line no-var
	var __IE_FLOW_DOC__: FlowDoc | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_LINES__: boolean | undefined;
}

/**
 * Source the authored FlowDoc. ABSENT by default ⇒ the interpreter is inert (parity, §7).
 *
 * Two opt-in dev hooks, neither set on a normal `apps/lines` boot (so the default is
 * byte-identical to current `main`):
 *  - `window.__IE_FLOW_DOC__` — an arbitrary FlowDoc injected at runtime (the Phase-4 hook,
 *    kept for ad-hoc single-screen/event live-verify);
 *  - `window.__IE_FLOW_LINES__` — load the COMMITTED, complete apps/lines FlowDoc
 *    (`LINES_FLOW_DOC` in `flowDoc.ts`) — the Phase-5 full-migration fixture. Setting this
 *    runs the WHOLE game through the interpreter for live-verify, ahead of the Phase-6 baked
 *    `flow` slot that will source the same doc without a hook.
 */
export const loadFlowDoc = (): FlowDoc | undefined => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_DOC__) return globalThis.__IE_FLOW_DOC__;
		if (globalThis.__IE_FLOW_LINES__) return LINES_FLOW_DOC;
	}
	return undefined;
};

/** The interpreter handle the game holds (or `undefined` when no FlowDoc ⇒ pure coded path). */
export type LinesFlow = ReturnType<typeof createFlowInterpreter<BookEvent, BookEventContext>>;

/**
 * Build the interpreter from the (optional) FlowDoc + the live editor doc. Returns
 * `undefined` when no FlowDoc is authored — the game then runs entirely coded (parity).
 * `editorDoc` is the live LayoutDoc the game already loads; the generic mounter resolves a
 * screen id to its `Scene` from it, so an authored screen mounts the SAME scene the editor
 * authored (the real scenes, untouched).
 */
export const createLinesFlow = (editorDoc: LayoutDoc): LinesFlow | undefined => {
	const flowDoc = loadFlowDoc();
	if (!flowDoc) return undefined;

	const resolveScene = (screenId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === screenId);

	return createFlowInterpreter<BookEvent, BookEventContext>({
		flowDoc,
		runtime: {
			emitter: {
				broadcast: (e) => eventEmitter.broadcast(e as never),
				broadcastAsync: (e) => eventEmitter.broadcastAsync(e as never),
			},
			// The LIVE turbo scalar — the same `stateBetDerived.timeScale()` the coded
			// `waitForTimeout(ms / timeScale())` call sites read, so a turbo toggle mid-round
			// scales the interpreter's delays identically (design doc §8, speed).
			timeScale: stateBetDerived.timeScale,
			waitForTimeout,
			// The game-side EFFECT registry — the `declare ≠ implement` bridge for the
			// non-emitter leaves (state mutations, board ops, win-level sound clusters). The
			// effect bodies are lifted VERBATIM from the coded handlers (`flowEffects.ts`), so
			// an authored `effect` node is byte-identical to its coded counterpart (§3, §11.4).
			effect: flowEffect,
		},
		resolveScene,
		codedHandlers: bookEventHandlerMap,
	});
};
