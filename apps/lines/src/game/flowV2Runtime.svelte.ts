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
 * v2 SHIP SOURCE (Phase 5, decision "ship-ready v2, keep v1"): `loadFlowV2Doc()` sources from the
 * baked bundle (`bakedFlowV2Doc()`) — so an authored v2 flow ships — with dev escape hatches on top
 * (`__IE_FLOW_V2_DOC__` ad-hoc; `__IE_FLOW_V2_LINES__` the committed reference flow). Unset + un-baked
 * ⇒ v2 stays inert and the v1/coded path owns the game (parity); v1 remains the incumbent until an
 * explicit cutover. EVENT OWNERSHIP (`ownsEvent` + `game/utils.ts`): a v2 flow drives ONLY the events
 * it authors — each SUPPRESSES its coded/v1 twin (no doubling) — so the game migrates to v2 one event
 * at a time, with everything un-owned still coded (parity). Cues broadcast AWAITED (`broadcastAsync`),
 * so a `fireCue` blocks on its subscribers' completion like the coded handlers' awaited broadcasts.
 *
 * Phase 4c — the game runs against the REAL template vocabulary resolved from the loaded doc's
 * `templateId` via the shared `templateVocabulary()` registry (only `book-of` today) — the SAME
 * contract the `/flow-v2` editor authors against — and BACKS every surface it declares: `actions` →
 * `flowEffect`, `cues` → `eventEmitter.broadcast`, `collections`/`$engine` reads → `linesEngineReader`.
 * `assertVocabBacked` warns (dev) if an authored action has no implementation.
 */

import type { LayoutDoc, Scene } from 'engine-layout';
import type { MountedContainerRef } from 'engine-layout/svelte';
import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	templateVocabulary,
	type ContainerMountModel,
	type FlowDoc as FlowDocV2,
	type FunctionLibraryDoc,
	type MountedContainer,
	type RunContext,
	type TemplateVocabulary,
} from 'engine-flow-v2';
import { stateBetDerived } from 'state-shared';
import { waitForTimeout } from 'utils-shared/wait';

import { bakedFlowV2Doc, bakedFlowV2Library } from '../editor-scenes';
import { eventEmitter } from './eventEmitter';
import { flowEffect, flowEffectNames } from './flowEffects';
import { linesEngineReader } from './flowRuntime.svelte';
import { LINES_FLOW_V2_DOC, LINES_FLOW_V2_LIBRARY } from './flowV2Doc';

declare global {
	/** DEV opt-in: an arbitrary v2 FlowDoc injected at runtime so a v2 flow can drive the game
	 *  WITHOUT a bake/deploy (the Phase-4b live-verify hook). Unset on a normal boot ⇒ v2 inert. */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2_DOC__: FlowDocV2 | undefined;
	/** DEV opt-in: the shared function library the v2 doc's `functionCall` nodes resolve against
	 *  (the editor's `_shared/flow-v2/functions.json`). Unset ⇒ an empty library (calls no-op). */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2_LIB__: FunctionLibraryDoc | undefined;
	/** DEV opt-in: load the COMMITTED reference book-of flow (`LINES_FLOW_V2_DOC` + its library) so
	 *  v2 drives a real game without a bake (mirrors v1's `__IE_FLOW_LINES__`). Unset ⇒ not loaded. */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2_LINES__: boolean | undefined;
}

/**
 * DEV coverage guard — every `action` the resolved template vocabulary declares MUST resolve to a
 * real implementation in the `flowEffect` registry, else an authored flow would silently no-op that
 * action. Logged (not thrown) so a partial in-progress vocab never crashes a boot; runs once when
 * the handle is built. Empty diff on a normal boot (the vocab + registry are kept in lock-step).
 */
const assertVocabBacked = (vocab: TemplateVocabulary): void => {
	const implemented = new Set(flowEffectNames);
	const missing = vocab.actions.map((a) => a.name).filter((n) => !implemented.has(n));
	if (missing.length) {
		console.warn(
			`[flow-v2] vocabulary actions with no flowEffect implementation: ${missing.join(', ')}`,
		);
	}
};

/**
 * Source the authored v2 FlowDoc. Precedence — dev escape hatches FIRST (a live-verify override
 * always wins), then the REAL ship source (the baked bundle):
 *  - `window.__IE_FLOW_V2_DOC__` — an arbitrary FlowDoc injected at runtime (the ad-hoc hook);
 *  - `window.__IE_FLOW_V2_LINES__` — the COMMITTED reference `LINES_FLOW_V2_DOC` (no bake needed);
 *  - `bakedFlowV2Doc()` — the v2 doc embedded in the baked bundle by the export→bake chain (Phase 5
 *    ship path). UNDEFINED on an un-baked / un-authored boot (incl. apps/lines dev with no globals),
 *    so v2 stays inert and the v1/coded path owns the game (parity).
 */
export const loadFlowV2Doc = (): FlowDocV2 | undefined => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_V2_DOC__) return globalThis.__IE_FLOW_V2_DOC__;
		if (globalThis.__IE_FLOW_V2_LINES__) return LINES_FLOW_V2_DOC;
	}
	return bakedFlowV2Doc();
};

/** Source the v2 function library, matching `loadFlowV2Doc`'s precedence: the injected
 *  `__IE_FLOW_V2_LIB__`, the committed library when the reference doc is loaded, else the baked
 *  library, else an empty library (a doc with no `functionCall` never needs it). */
const loadFlowV2Library = (): FunctionLibraryDoc => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_V2_LIB__) return globalThis.__IE_FLOW_V2_LIB__;
		if (globalThis.__IE_FLOW_V2_LINES__) return LINES_FLOW_V2_LIBRARY;
	}
	return bakedFlowV2Library() ?? { version: 2, functions: [] };
};

/** The v2 handle Game.svelte holds — dispatch a book/game event into the flow, plus the mount
 *  model + a scene resolver the `<FlowV2Mount>` renders from. `undefined` when no v2 doc is
 *  authored (v2 inert). */
export type LinesFlowV2 = {
	/** Does the flow OWN this event — i.e. author an `event` node for it? An owned event is driven
	 *  by v2 ALONE (its coded/v1 twin is suppressed, no doubling); an un-owned event falls through to
	 *  the coded/v1 path (parity). This is how the game hands events to v2 ONE AT A TIME. */
	ownsEvent: (eventType: string) => boolean;
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
	// Resolve the template vocabulary from the doc's `templateId` (shared registry) — the SAME
	// contract the /flow-v2 editor authors against. Only `book-of` exists today (registry falls back).
	const vocab = templateVocabulary(doc.templateId);
	assertVocabBacked(vocab); // dev: warn if the vocabulary declares an action the game doesn't implement.

	const mount = createContainerMountModel(doc.containers, onContainersChange);
	const env = createFlowV2Env({
		mount,
		// The game-side effect registry — the SAME closed map of named effects the v1/coded path
		// runs (`flowEffect`), so a v2 `action` node is byte-identical to its coded counterpart.
		effect: flowEffect,
		// A v2 `fireCue` → the existing emitter broadcast, AWAITED (`broadcastAsync`): the interpreter
		// awaits it, so a cue whose subscriber returns a completion promise (e.g. the `specialBookReveal`
		// shuffle→land→intro) BLOCKS the flow until it finishes — matching the coded handler's awaited
		// `broadcastAsync`. Sync subscribers resolve immediately, so fire-and-forget cues are unaffected.
		broadcast: (cue, payload) =>
			eventEmitter.broadcastAsync({ type: cue, ...payload } as never).then(() => {}),
		waitForTimeout,
		// The LIVE turbo scalar — the same `stateBetDerived.timeScale()` the coded delays read, so a
		// turbo toggle mid-round scales the v2 interpreter's delays identically.
		timeScale: stateBetDerived.timeScale,
		// The bounded `$engine.*` reader — reused verbatim from the v1 wiring (one source of truth
		// for what a guard/readout sees).
		engineRead: linesEngineReader,
	});

	const ctx: RunContext = { vocab, library: loadFlowV2Library(), env };
	const resolveScene = (sceneId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === sceneId);

	// The set of event types the flow authors (has an `event` node for) — the ownership set.
	const ownedEvents = new Set(
		doc.graph.nodes.filter((n) => n.kind === 'event').map((n) => (n as { ref: string }).ref),
	);

	return {
		ownsEvent: (eventType) => ownedEvents.has(eventType),
		dispatch: (eventName, payload) => runFlowEvent(doc, ctx, eventName, payload),
		mount,
		resolveScene,
		ordered: () => mount.ordered(),
	};
};
