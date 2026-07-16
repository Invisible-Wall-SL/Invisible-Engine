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
import { sceneLayerZIndex } from 'engine-layout';
import type { MountedContainerRef } from 'engine-layout/svelte';
import {
	createContainerMountModel,
	createFlowV2Env,
	flowOwnsContainerEvent,
	flowOwnsSignal,
	runFlowContainerEvent,
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
	/** DEBUG: an ordered trace of every flow op (event / show / hide / HOLD / RELEASE / complete /
	 *  cue / action), captured when logging is on (`?flowlog=1`). Read it in the console to see exactly
	 *  what the flow did, in order — the answer to "why didn't my screen show". */
	// eslint-disable-next-line no-var
	var __IE_FLOW_V2_TRACE__: string[] | undefined;
}

/**
 * DEV coverage guard — every `action` the resolved template vocabulary declares MUST resolve to a
 * real implementation in the `flowEffect` registry, else an authored flow would silently no-op that
 * action. Logged (not thrown) so a partial in-progress vocab never crashes a boot; runs once when
 * the handle is built. Empty diff on a normal boot (the vocab + registry are kept in lock-step).
 */
const assertVocabBacked = (vocab: TemplateVocabulary): void => {
	// An action is backed by the `flowEffect` registry OR routed to the `invokeIntent` bridge.
	const implemented = new Set([...flowEffectNames, ...Object.keys(INTENT_COMMANDS)]);
	const missing = vocab.actions.map((a) => a.name).filter((n) => !implemented.has(n));
	if (missing.length) {
		console.warn(
			`[flow-v2] vocabulary actions with no flowEffect implementation: ${missing.join(', ')}`,
		);
	}
};

/** True when the URL opts into the committed reference flow (`?flowV2=lines` or `?flowV2=1`). Read at
 *  BOOT, so — unlike a `window` global — it SURVIVES a reload: paste the URL and the v2 flow drives the
 *  game. This is the natural verify hook (a console global can't be set before the game mounts). */
const flowV2UrlOptIn = (): boolean => {
	if (typeof globalThis === 'undefined' || !globalThis.location) return false;
	const v = new URLSearchParams(globalThis.location.search).get('flowV2');
	return v === 'lines' || v === '1';
};

/** True when the URL opts into flow TRACE LOGGING (`?flowlog=1`). Read at BOOT so it survives a reload
 *  — the reproducible way to see what a shipped v2 flow actually does (a console global can't be set
 *  before the game mounts). Logs every event/show/hide/hold/release/complete + captures the ordered
 *  trace on `window.__IE_FLOW_V2_TRACE__`. Off ⇒ zero overhead (the raw mount/env are used directly). */
const flowV2LogOptIn = (): boolean => {
	if (typeof globalThis === 'undefined' || !globalThis.location) return false;
	const v = new URLSearchParams(globalThis.location.search).get('flowlog');
	return v === '1' || v === 'lines' || v === 'true';
};

/**
 * Source the authored v2 FlowDoc. Precedence — dev escape hatches FIRST (a live-verify override
 * always wins), then the REAL ship source (the baked bundle):
 *  - `window.__IE_FLOW_V2_DOC__` — an arbitrary FlowDoc injected at runtime (the ad-hoc hook);
 *  - `?flowV2=lines` (URL) / `window.__IE_FLOW_V2_LINES__` — the COMMITTED reference `LINES_FLOW_V2_DOC`
 *    (no bake needed; the URL form survives a reload — the natural verify hook);
 *  - `bakedFlowV2Doc()` — the v2 doc embedded in the baked bundle by the export→bake chain (Phase 5
 *    ship path). UNDEFINED on an un-baked / un-authored boot (incl. apps/lines dev with no opt-in),
 *    so v2 stays inert and the v1/coded path owns the game (parity).
 */
export const loadFlowV2Doc = (): FlowDocV2 | undefined => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_V2_DOC__) return globalThis.__IE_FLOW_V2_DOC__;
		if (globalThis.__IE_FLOW_V2_LINES__ || flowV2UrlOptIn()) return LINES_FLOW_V2_DOC;
	}
	return bakedFlowV2Doc();
};

/**
 * Does the authored v2 flow DRIVE THE SCREENS — i.e. author the `load` lifecycle entry (an `event`
 * node or a wired `gameSignals` pin for `load`)? This is the CANONICAL, doc-level predicate behind
 * Game.svelte's `flowV2DrivesScreens` (which reads it off the built handle as `ownsEvent('load')`).
 * It resolves SYNCHRONOUSLY from `loadFlowV2Doc()` — no async editor doc — so a BOOT-TIME consumer
 * that runs before the handle exists (Sound.svelte's `onMount`, which decides whether to auto-play
 * the boot music) can gate on the SAME source of truth. Un-authored / un-baked / book-events-only doc
 * ⇒ `false` (parity: the coded/v1 screen + boot-music path owns).
 */
export const flowV2DrivesScreens = (): boolean => {
	const doc = loadFlowV2Doc();
	if (!doc) return false;
	const authorsLoadEvent = doc.graph.nodes.some((n) => n.kind === 'event' && n.ref === 'load');
	return authorsLoadEvent || flowOwnsSignal(doc, 'load');
};

/** Source the v2 function library, matching `loadFlowV2Doc`'s precedence: the injected
 *  `__IE_FLOW_V2_LIB__`, the committed library when the reference doc is loaded (global or `?flowV2`),
 *  else the baked library, else an empty library (a doc with no `functionCall` never needs it). */
const loadFlowV2Library = (): FunctionLibraryDoc => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_V2_LIB__) return globalThis.__IE_FLOW_V2_LIB__;
		if (globalThis.__IE_FLOW_V2_LINES__ || flowV2UrlOptIn()) return LINES_FLOW_V2_LIBRARY;
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
	/** Run the authored v2 handler for `eventName` with `payload` + dispatch `context` (e.g. the
	 *  surrounding `bookEvents` list a mechanic effect reads); a no-op if un-authored. */
	dispatch: (
		eventName: string,
		payload: Record<string, unknown>,
		context?: Record<string, unknown>,
	) => Promise<void>;
	/** The z-ordered container mount model (show/hide land here; drives `<FlowV2Mount>`). */
	mount: ContainerMountModel;
	/** Resolve a container's `sceneId` → its backing editor `Scene` (for `<FlowV2Mount>`). */
	resolveScene: (sceneId: string) => Scene | undefined;
	/** The current z-ordered mounted containers (seed the Game.svelte rune mirror). */
	ordered: () => MountedContainer[];
	/** Does the flow OWN this container event — i.e. author an exec edge from a `showContainer`
	 *  node's fused `<componentId>.on<action>` pin? An owned press routes to the flow ALONE (the
	 *  coded `onpress` is suppressed, no doubling); an un-owned press falls through to the coded
	 *  body (parity). The engine-layout press resolver calls this to decide suppression. */
	ownsContainerEvent: (componentId: string, action: string) => boolean;
	/** Run the authored chain for a container event — walks FROM the fused pin's wired target (does
	 *  NOT re-run the show node). A no-op if un-authored. Invoked only when `ownsContainerEvent` holds. */
	dispatchContainerEvent: (componentId: string, action: string) => Promise<void>;
};

/**
 * Build the v2 handle from the live editor doc. Returns `undefined` when no v2 FlowDoc is
 * authored (`__IE_FLOW_V2_DOC__` unset) — the game then runs its v1/coded path (parity).
 *
 * `onContainersChange` is the mount model's mirror: Game.svelte passes a setter that writes the
 * z-ordered list into a `$state`, so `<FlowV2Mount>` re-renders whenever a `show`/`hide` changes
 * the shown set (the interpreter's mount model is a plain object, not a rune).
 */
/**
 * Intent-invoking `command` actions → the game intent they invoke (Phase A). When the flow reacts to
 * a `spin`/`buyBonus` button EVENT and runs one of these actions, the env routes it to the game's
 * `invokeIntent` bridge (the SAME coded body the button press runs) instead of the `flowEffect`
 * registry — so a flow-driven button is byte-identical to the coded one.
 */
const INTENT_COMMANDS: Record<string, string> = {
	startSpin: 'spin',
	stopSpin: 'spin', // the spin button is bet-or-stop; the coded body decides by state.
	confirmBuyBonus: 'buyBonus',
	// The standard HUD buttons — each routes to the game intent `invokeHostIntent` already bridges.
	increaseBet: 'increase',
	decreaseBet: 'decrease',
	toggleTurbo: 'turbo',
	toggleFullscreen: 'fullscreen',
	openGameRules: 'gameRules',
	openSettings: 'settings',
	toggleSound: 'soundToggle',
	autoSpin: 'autoSpin',
};

export const createLinesFlowV2 = (
	editorDoc: LayoutDoc,
	onContainersChange?: (containers: MountedContainerRef[]) => void,
	/** Invoke a game INTENT (spin/buyBonus/…) — the SAME `invokeHostIntent` bridge the v1 flow uses.
	 *  The env routes an intent-command action (startSpin/…) here. Absent ⇒ those actions no-op. */
	invokeIntent?: (intent: string) => void,
): LinesFlowV2 | undefined => {
	const doc = loadFlowV2Doc();
	if (!doc) return undefined;
	// Resolve the template vocabulary from the doc's `templateId` (shared registry) — the SAME
	// contract the /flow-v2 editor authors against. Only `book-of` exists today (registry falls back).
	const vocab = templateVocabulary(doc.templateId);
	assertVocabBacked(vocab); // dev: warn if the vocabulary declares an action the game doesn't implement.

	const FLOW_LOG = flowV2LogOptIn();
	// Boot confirmation — v2 is ACTIVE and will drive the events it authors. In DEV always; in a shipped
	// build only with `?flowlog=1`, so live-debugging a published game is one URL param away.
	if (import.meta.env.DEV || FLOW_LOG) {
		const owned = doc.graph.nodes.filter((n) => n.kind === 'event').map((n) => n.ref);
		const wiredSignals = doc.graph.nodes.some((n) => n.kind === 'gameSignals');
		console.info(
			`[flow-v2] ACTIVE — ${owned.length} event nodes: ${owned.join(', ') || '(none)'}` +
				`${wiredSignals ? ' + gameSignals pins' : ''}. Trace: window.__IE_FLOW_V2_TRACE__`,
		);
	}

	// DEBUG trace (`?flowlog=1`) — print every flow op IN ORDER + capture it on the global trace array,
	// so "why didn't my screen show?" is answered by reading the log, not guessing. A no-op when off.
	const trace = (op: string, ...rest: unknown[]): void => {
		if (!FLOW_LOG) return;
		const line = [op, ...rest].join(' ');
		console.log(`%c[flow-v2] ${line}`, 'color:#8fd0b0');
		(globalThis.__IE_FLOW_V2_TRACE__ ??= []).push(line);
	};

	// Cross-screen layering is owned by the EDITOR scene order (the screen list — "top row
	// rendered first"), the SAME source of truth the coded/legacy HUD path reads via
	// `docLayerZIndex` (Game.svelte). A container's own `z` was baked at v1→v2 migration
	// (`translate.ts`: `i * 10` over the v1 SCREEN order) and can DIVERGE from the current scene
	// order — e.g. a `hudBar` placed above the `hud_*` readouts ends up UNDER them in-game though
	// the editor shows it on top. Re-stamp each container's z from the scene order so flow-v2
	// stacking matches the editor and a screen-list reorder re-layers the game. `sceneLayerZIndex`
	// also honours the screen's "Always on top" tick (`Scene.alwaysOnTop`), so a screen pinned to
	// the top band layers the same under v2 as on the coded path. Fall back to the doc's own z
	// when a container's scene isn't in the doc (parity).
	const layeredContainers = doc.containers.map((container) => ({
		...container,
		z: sceneLayerZIndex(editorDoc.scenes, container.sceneId) ?? container.z,
	}));
	const rawMount = createContainerMountModel(layeredContainers, onContainersChange);
	// When tracing, wrap the mount so show/hide/HOLD/RELEASE/complete are visible + ordered in the log.
	const mount: ContainerMountModel = FLOW_LOG
		? {
				show: (id) => {
					trace('show', id);
					rawMount.show(id);
				},
				hide: (id) => {
					trace('hide', id);
					rawMount.hide(id);
				},
				isShown: (id) => rawMount.isShown(id),
				ordered: () => rawMount.ordered(),
				awaitComplete: (id) => {
					trace('HOLD', id, '⏸ awaiting complete (tap)');
					return rawMount.awaitComplete(id).then(() => trace('RELEASE', id, '▶ chain resumes'));
				},
				complete: (id) => {
					const released = rawMount.complete(id);
					trace('complete', id, released ? '✓ released a hold' : '· (nothing held here)');
					return released;
				},
				heldContainers: () => rawMount.heldContainers(),
			}
		: rawMount;
	const env = createFlowV2Env({
		mount,
		// The game-side effect registry — the SAME closed map of named effects the v1/coded path
		// runs (`flowEffect`), so a v2 `action` node is byte-identical to its coded counterpart. An
		// intent-command action (startSpin/…) routes to the `invokeIntent` bridge instead (Phase A).
		effect: (name) => {
			const intent = INTENT_COMMANDS[name];
			if (intent)
				return invokeIntent
					? () => {
							trace('action', name, `→ intent:${intent}`);
							invokeIntent(intent);
						}
					: undefined;
			const impl = flowEffect(name);
			return impl
				? (payload) => {
						trace('action', name);
						return impl(payload);
					}
				: undefined;
		},
		// A v2 `fireCue` → the existing emitter broadcast, AWAITED (`broadcastAsync`): the interpreter
		// awaits it, so a cue whose subscriber returns a completion promise (e.g. the `specialBookReveal`
		// shuffle→land→intro) BLOCKS the flow until it finishes — matching the coded handler's awaited
		// `broadcastAsync`. Sync subscribers resolve immediately, so fire-and-forget cues are unaffected.
		broadcast: (cue, payload) => {
			trace('cue', cue);
			return eventEmitter.broadcastAsync({ type: cue, ...payload } as never).then(() => {});
		},
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
		// An event is owned by v2 if a dedicated `event` node authors it OR a WIRED `gameSignals` pin
		// drives it. Ownership on the gameSignals side MUST be gated on the signal being wired: the node
		// surfaces every book+lifecycle event, but only wired ones are owned — an UNWIRED signal stays
		// un-owned so its coded handler still runs (parity). `dispatch` (`runFlowEvent`) then walks the
		// gameSignals pin (Part 1), so a wired mechanic signal drives v2 with its coded twin suppressed.
		ownsEvent: (eventType) => ownedEvents.has(eventType) || flowOwnsSignal(doc, eventType),
		dispatch: (eventName, payload, context) => {
			trace('event ▶', eventName);
			return runFlowEvent(doc, ctx, eventName, payload, context);
		},
		mount,
		resolveScene,
		ordered: () => mount.ordered(),
		ownsContainerEvent: (componentId, action) => flowOwnsContainerEvent(doc, componentId, action),
		dispatchContainerEvent: (componentId, action) => {
			trace('containerEvent ▶', `${componentId}.${action}`);
			return runFlowContainerEvent(doc, ctx, componentId, action);
		},
	};
};
