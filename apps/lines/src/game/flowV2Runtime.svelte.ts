/**
 * Invisible Flow v2 — the apps/lines runtime wiring (Phase 4b, design `invisible-flow-v2-schema.md`
 * §10). The first time a v2 flow drives pixels in a real game.
 *
 * It builds the DEDICATED v2 interpreter's run context (`runFlowEvent(doc, ctx, event, payload)`)
 * wired to THIS game's real primitives — the SAME `eventEmitter`, `stateBetDerived.timeScale`,
 * `waitForTimeout`, effect registry (`flowEffect`) and `$engine` reader (`linesEngineReader`) the
 * coded/v1 path uses — plus the z-ordered container mount model (`createContainerMountModel`) that
 * replaces v1's active-set. Show/hide land in the model; the model's `onChange` mirror re-renders
 * the generic `<FlowV2Mount>` in Game.svelte.
 *
 * v2 is a DEV-GATED opt-in: `loadFlowV2Doc()` returns a doc ONLY when `window.__IE_FLOW_V2_DOC__`
 * is set, so a normal boot leaves v2 inert and the v1/coded path unchanged (parity). Phase 5 will
 * hard-cut v1 and source the v2 doc from the baked bundle.
 *
 * Phase 4c — the game runs against the REAL reference `BOOK_OF_VOCAB` (shipped from `engine-flow-v2`,
 * the SAME contract the `/flow-v2` editor authors against) and BACKS every surface it declares:
 * `actions` → `flowEffect`, `cues` → `eventEmitter.broadcast`, `collections`/`$engine` reads →
 * `linesEngineReader`. `assertVocabBacked` warns (dev) if an authored action has no implementation.
 */

import type { LayoutDoc, Scene } from 'engine-layout';
import type { MountedContainerRef } from 'engine-layout/svelte';
import {
	BOOK_OF_VOCAB,
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	type ContainerMountModel,
	type FlowDoc as FlowDocV2,
	type FunctionLibraryDoc,
	type MountedContainer,
	type RunContext,
} from 'engine-flow-v2';
import { stateBetDerived } from 'state-shared';
import { waitForTimeout } from 'utils-shared/wait';

import { eventEmitter } from './eventEmitter';
import { flowEffect, flowEffectNames } from './flowEffects';
import { linesEngineReader } from './flowRuntime.svelte';

declare global {
	/** DEV opt-in: an arbitrary v2 FlowDoc injected at runtime so a v2 flow can drive the game
	 *  WITHOUT a bake/deploy (the Phase-4b live-verify hook). Unset on a normal boot ⇒ v2 inert. */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2_DOC__: FlowDocV2 | undefined;
	/** DEV opt-in: the shared function library the v2 doc's `functionCall` nodes resolve against
	 *  (the editor's `_shared/flow-v2/functions.json`). Unset ⇒ an empty library (calls no-op). */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2_LIB__: FunctionLibraryDoc | undefined;
}

/**
 * The reference template vocabulary the game runs against (Phase 4c) — the SHARED, single-source-of-
 * truth `BOOK_OF_VOCAB` shipped from `engine-flow-v2`, the SAME contract the `/flow-v2` editor
 * authors against. The game BACKS every surface it declares: `actions` → `flowEffect`, `cues` →
 * `eventEmitter.broadcast`, `collections`/engine keys → `linesEngineReader` (`assertVocabBacked`
 * below verifies the action coverage in dev).
 */
const LINES_VOCAB_V2 = BOOK_OF_VOCAB;

/**
 * DEV coverage guard — every `action` the reference vocabulary declares MUST resolve to a real
 * implementation in the `flowEffect` registry, else an authored flow would silently no-op that
 * action. Logged (not thrown) so a partial in-progress vocab never crashes a boot; runs once when
 * the handle is built. Empty diff on a normal boot (the vocab + registry are kept in lock-step).
 */
const assertVocabBacked = (): void => {
	const implemented = new Set(flowEffectNames);
	const missing = LINES_VOCAB_V2.actions.map((a) => a.name).filter((n) => !implemented.has(n));
	if (missing.length) {
		console.warn(
			`[flow-v2] vocabulary actions with no flowEffect implementation: ${missing.join(', ')}`,
		);
	}
};

/** Source the authored v2 FlowDoc — DEV-gated (`window.__IE_FLOW_V2_DOC__`), else `undefined`
 *  (v2 inert, v1/coded path owns). Phase 5 sources it from the baked bundle instead. */
export const loadFlowV2Doc = (): FlowDocV2 | undefined =>
	typeof globalThis !== 'undefined' ? globalThis.__IE_FLOW_V2_DOC__ : undefined;

const loadFlowV2Library = (): FunctionLibraryDoc =>
	(typeof globalThis !== 'undefined' && globalThis.__IE_FLOW_V2_LIB__) || {
		version: 2,
		functions: [],
	};

/** The v2 handle Game.svelte holds — dispatch a book/game event into the flow, plus the mount
 *  model + a scene resolver the `<FlowV2Mount>` renders from. `undefined` when no v2 doc is
 *  authored (v2 inert). */
export type LinesFlowV2 = {
	/** Run the authored v2 handler for `eventName` with `payload` (a no-op if un-authored). */
	dispatch: (eventName: string, payload: Record<string, unknown>) => Promise<void>;
	/** The z-ordered container mount model (show/hide land here; drives `<FlowV2Mount>`). */
	mount: ContainerMountModel;
	/** Resolve a container's `sceneId` → its backing editor `Scene` (for `<FlowV2Mount>`). */
	resolveScene: (sceneId: string) => Scene | undefined;
	/** The current z-ordered mounted containers (seed the Game.svelte rune mirror). */
	ordered: () => MountedContainer[];
};

/**
 * Build the v2 handle from the live editor doc. Returns `undefined` when no v2 FlowDoc is
 * authored (`__IE_FLOW_V2_DOC__` unset) — the game then runs its v1/coded path (parity).
 *
 * `onContainersChange` is the mount model's mirror: Game.svelte passes a setter that writes the
 * z-ordered list into a `$state`, so `<FlowV2Mount>` re-renders whenever a `show`/`hide` changes
 * the shown set (the interpreter's mount model is a plain object, not a rune).
 */
export const createLinesFlowV2 = (
	editorDoc: LayoutDoc,
	onContainersChange?: (containers: MountedContainerRef[]) => void,
): LinesFlowV2 | undefined => {
	const doc = loadFlowV2Doc();
	if (!doc) return undefined;
	assertVocabBacked(); // dev: warn if the vocabulary declares an action the game doesn't implement.

	const mount = createContainerMountModel(doc.containers, onContainersChange);
	const env = createFlowV2Env({
		mount,
		// The game-side effect registry — the SAME closed map of named effects the v1/coded path
		// runs (`flowEffect`), so a v2 `action` node is byte-identical to its coded counterpart.
		effect: flowEffect,
		// A v2 `fireCue` → the existing emitter broadcast (the cue name is the emitter event type).
		broadcast: (cue, payload) => eventEmitter.broadcast({ type: cue, ...payload } as never),
		waitForTimeout,
		// The LIVE turbo scalar — the same `stateBetDerived.timeScale()` the coded delays read, so a
		// turbo toggle mid-round scales the v2 interpreter's delays identically.
		timeScale: stateBetDerived.timeScale,
		// The bounded `$engine.*` reader — reused verbatim from the v1 wiring (one source of truth
		// for what a guard/readout sees).
		engineRead: linesEngineReader,
	});

	const ctx: RunContext = { vocab: LINES_VOCAB_V2, library: loadFlowV2Library(), env };
	const resolveScene = (sceneId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === sceneId);

	return {
		dispatch: (eventName, payload) => runFlowEvent(doc, ctx, eventName, payload),
		mount,
		resolveScene,
		ordered: () => mount.ordered(),
	};
};
