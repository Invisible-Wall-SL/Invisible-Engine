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

import type { LayoutDoc, LayoutType, Scene } from 'engine-layout';
import {
	cueAnimationDurationMs,
	emitComponentSignal,
	ENTER_SIGNAL,
	flipbookCycleMs,
	getComponent,
	isRegisteredComponentSignal,
	resolveEffect,
	sceneAnimationDurationMs,
	sceneLayerZIndex,
} from 'engine-layout';
import { emitterSecondsToWallMs } from 'engine-fx';
import type { MountedContainerRef } from 'engine-layout/svelte';
import {
	awaitCompleteContainerIds,
	createContainerMountModel,
	createFlowV2Env,
	flattenGroups,
	flowOwnsContainerEvent,
	flowOwnsSignal,
	flowScreenDrivingStatus,
	hideContainerIds,
	runFlowContainerEvent,
	runFlowEvent,
	SCREEN_LIFECYCLE_SIGNALS,
	templateVocabulary,
	type ContainerMountModel,
	type FlowDoc as FlowDocV2,
	type FunctionLibraryDoc,
	type MountedContainer,
	type RunContext,
	type TemplateVocabulary,
	type TextMessageNode,
} from 'engine-flow-v2';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { stateBetDerived } from 'state-shared';
import { roundSkip } from 'utils-shared/skipToken';

import { bakedFlowV2Doc, bakedFlowV2Library } from '../editor-scenes';
import { eventEmitter } from './eventEmitter';
import { stateApp } from './stateApp';
import { flowEffect, flowEffectNames } from './flowEffects';
import { linesEngineReader } from './flowRuntime.svelte';
import { awaitCue, waitPresentation } from './unskippablePresentation';
import { LINES_FLOW_V2_DOC, LINES_FLOW_V2_LIBRARY } from './flowV2Doc';
import { LINES_FLOW_V2_STACKED_DOC } from './flowV2StackedDoc';

declare global {
	/** DEV opt-in: an arbitrary v2 FlowDoc injected at runtime so a v2 flow can drive the game
	 *  WITHOUT a bake/deploy (the Phase-4b live-verify hook). Unset on a normal boot ⇒ v2 inert. */

	var __IE_FLOW_V2_DOC__: FlowDocV2 | undefined;
	/** DEV opt-in: the shared function library the v2 doc's `functionCall` nodes resolve against
	 *  (the editor's `_shared/flow-v2/functions.json`). Unset ⇒ an empty library (calls no-op). */

	var __IE_FLOW_V2_LIB__: FunctionLibraryDoc | undefined;
	/** DEV opt-in: load the COMMITTED reference book-of flow (`LINES_FLOW_V2_DOC` + its library) so
	 *  v2 drives a real game without a bake (mirrors v1's `__IE_FLOW_LINES__`). Unset ⇒ not loaded. */

	var __IE_FLOW_V2_LINES__: boolean | undefined;
	/** DEV opt-in: load the stacked-picture verify flow (`LINES_FLOW_V2_STACKED_DOC` — the reference
	 *  flow + an `enableStackedPictures` node on `reveal`) so the mode activates through the REAL flow
	 *  interpreter. Mirrors `?flowV2=stacked`. Unset ⇒ not loaded. */

	var __IE_FLOW_V2_STACKED__: boolean | undefined;
	/** DEBUG: an ordered trace of every flow op (event / show / hide / HOLD / RELEASE / complete /
	 *  cue / action), captured when logging is on (`?flowlog=1`). Read it in the console to see exactly
	 *  what the flow did, in order — the answer to "why didn't my screen show". */

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

/** True when the URL opts into the stacked-picture verify flow (`?flowV2=stacked`). Read at BOOT so it
 *  survives a reload — the natural way to test the mode's REAL Flow activation path. */
const flowV2StackedOptIn = (): boolean => {
	if (typeof globalThis === 'undefined' || !globalThis.location) return false;
	return new URLSearchParams(globalThis.location.search).get('flowV2') === 'stacked';
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
		if (globalThis.__IE_FLOW_V2_STACKED__ || flowV2StackedOptIn()) return LINES_FLOW_V2_STACKED_DOC;
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
	/** The set of container ids a `showContainer{awaitComplete}` node targets — i.e. the containers
	 *  that HOLD the round on their tap when shown. Static (read from the doc's graph). The
	 *  spin-button celebration lock reads this to hold the button while ANY such container is shown,
	 *  NAME-AGNOSTICALLY (a win / celebration container can be named anything). */
	awaitTargets: ReadonlySet<string>;
	/** The set of container ids the doc ever `hideContainer`s. Static (read from the doc's graph).
	 *  The celebration lock reads it to know whether a container's MOUNT is evidence it is on screen
	 *  (a doc that shows/hides per round) or means nothing (the `drivenSeed` mount-once model, where
	 *  the container is shown at start-up and toggled by cue). See `hideContainerIds`. */
	hideTargets: ReadonlySet<string>;
	/** Does the flow OWN this container event — i.e. author an exec edge from a `showContainer`
	 *  node's fused `<componentId>.on<action>` pin? An owned press routes to the flow ALONE (the
	 *  coded `onpress` is suppressed, no doubling); an un-owned press falls through to the coded
	 *  body (parity). The engine-layout press resolver calls this to decide suppression. */
	ownsContainerEvent: (componentId: string, action: string) => boolean;
	/** Run the authored chain for a container event — walks FROM the fused pin's wired target (does
	 *  NOT re-run the show node). A no-op if un-authored. Invoked only when `ownsContainerEvent` holds.
	 *  `payload` seeds the fired event's `$trigger` scope (e.g. a repeater card's `{ betModeKey: key }`),
	 *  so a fused list pin's data-out resolves to which item fired; a button passes none. */
	dispatchContainerEvent: (
		componentId: string,
		action: string,
		payload?: Record<string, unknown>,
	) => Promise<void>;
	/** The authored Text Message nodes (§6.3) — static, read from the doc (groups flattened).
	 *  `<FlowV2Messages>` renders one localized text overlay per node at its `place`. */
	textMessages: TextMessageNode[];
	/** Whether a `textMessage` node's FLOW-SHOWN flag is currently raised (a `show` exec fired and no
	 *  `hide`/auto-hide has cleared it). REACTIVE — reads a `SvelteSet`, so a render that calls it
	 *  re-runs on show/hide. `<FlowV2Messages>` OR-s this with the node's `visibleWhile` state-gate. */
	messageShown: (nodeId: string) => boolean;
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
	// NB: buy-bonus is NOT an intent command. The buy-BUTTON press routes through the `buyBonus`
	// intent event (which opens the select screen) via `routeActionThroughFlow`; the CONFIRM commit
	// is the `commitBuyBonus` flowEffect (arm the mode + fire the bet), not a host intent — so it
	// lives in the `flowEffect` registry, not here. (Replaces the old miswired `confirmBuyBonus`
	// command, which merely re-opened the modal.)
	// The standard HUD buttons — each routes to the game intent `invokeHostIntent` already bridges.
	increaseBet: 'increase',
	decreaseBet: 'decrease',
	toggleTurbo: 'turbo',
	toggleFullscreen: 'fullscreen',
	openPayTable: 'payTable',
	openGameRules: 'gameRules',
	openSettings: 'settings',
	toggleSound: 'soundToggle',
	autoSpin: 'autoSpin',
};

/** A structural narrow for a loaded Spine `SkeletonData` — just the `findAnimation` we read, so this
 *  module needs no `@esotericsoftware/spine-*` type import to measure a clip's duration. */
type SkeletonDataLike = { findAnimation(name: string): { duration: number } | null };
const isSkeletonData = (v: unknown): v is SkeletonDataLike =>
	typeof v === 'object' &&
	v !== null &&
	typeof (v as { findAnimation?: unknown }).findAnimation === 'function';

/** The canonical bundle FOLDER of a loaded spine key — the same fallback `EffectLayer` uses so an
 *  authored `assetKey` resolves whether the skeleton shipped under the bare folder or a full R2 prefix. */
const spineBundleFolderOf = (key: string): string => {
	const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
	const m = trimmed.match(/(?:^|\/)spines\/(.+)$/);
	return m ? m[1] : trimmed;
};

export const createLinesFlowV2 = (
	editorDoc: LayoutDoc,
	onContainersChange?: (containers: MountedContainerRef[]) => void,
	/** Invoke a game INTENT (spin/buyBonus/…) — the SAME `invokeHostIntent` bridge the v1 flow uses.
	 *  The env routes an intent-command action (startSpin/…) here. Absent ⇒ those actions no-op. */
	invokeIntent?: (intent: string) => void,
	/** The layout the game is drawing right now (`stateLayoutDerived.layoutType`, which lives in the
	 *  layout CONTEXT, not a module). Read live on each call so an orientation change mid-round is
	 *  picked up. Only `fireCue{await}`'s cue measurement consults it — absent ⇒ no visibility
	 *  gating, so a node hidden for the current layout is measured as if it drew. */
	layoutType?: () => LayoutType,
): LinesFlowV2 | undefined => {
	const doc = loadFlowV2Doc();
	if (!doc) return undefined;
	// Resolve the template vocabulary from the doc's `templateId` (shared registry) — the SAME
	// contract the /flow-v2 editor authors against. Only `book-of` exists today (registry falls back).
	const vocab = templateVocabulary(doc.templateId);
	assertVocabBacked(vocab); // dev: warn if the vocabulary declares an action the game doesn't implement.

	// HALF-ON GUARD (safety net). A flow that has `showContainer`/`hideContainer` nodes (so the author
	// INTENDS to drive screens) but does NOT own `load` cannot actually mount those screens —
	// `flowV2DrivesScreens` (= `ownsEvent('load')`) is false, so a `showContainer` never reaches the
	// active screen set (Game.svelte gates that on `flowV2DrivesScreens`). Yet the flow still OWNS its
	// screen-lifecycle signals (e.g. `tapToStart`), which would SUPPRESS the coded lifecycle transition
	// (loading → tap → basegame) the game otherwise runs — so NEITHER path mounts basegame and the reel
	// silently vanishes. When detected, we (1) shout a single loud line and (2) refuse to let the flow
	// OWN the screen-lifecycle signals (below), so the coded/v1 screen path stays in control and the
	// board mounts. Book-event ownership (reveal/winInfo/…) is UNTOUCHED — only screen lifecycle is
	// guarded. A genuinely book-events-only flow (no container nodes) and a genuinely driven flow (owns
	// `load`) are both unaffected.
	const screenStatus = flowScreenDrivingStatus(doc);
	if (screenStatus.halfOn) {
		console.error(
			'[flow-v2] HALF-ON FLOW IGNORED: this flow has showContainer/hideContainer nodes but does NOT ' +
				'own `load`, so it cannot drive screens (basegame/reel would never mount). Its screen-lifecycle ' +
				'signals are being ignored so the coded loading→tap→basegame path still runs. FIX: wire the ' +
				'gameSignals `load` pin (or add a `load` event node) to drive screens, or remove the ' +
				'showContainer/hideContainer nodes to stay book-events-only.',
		);
	}

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
	// `sceneLayerZIndex` (Game.svelte). A container's own `z` was baked at v1→v2 migration
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
	// Scope the mount model's order-independent completion latch to the containers a
	// `showContainer{awaitComplete}` node actually targets — so a tap that lands BEFORE the hold is
	// registered (e.g. the free-spin outro: the driver arms `freeSpinOutroCountUpComplete` ~300ms
	// before the `showContainer{awaitComplete}` node registers its hold) is latched and consumed by the
	// imminent `awaitComplete`, rather than silently dropped ⇒ the screen never hides. Persistent
	// containers (basegame/hudBar) are NOT targets, so the tap dispatcher's top-down `complete` probe
	// can't spuriously latch them.
	const rawMount = createContainerMountModel(
		layeredContainers,
		onContainersChange,
		awaitCompleteContainerIds(doc),
	);
	// SLAM-AWARE ROUND-BLOCK HOLD. `showContainer{awaitComplete}` was the ONLY await left in the
	// round chain that a slam could not release: every cue, delay and cut-short effect races
	// `roundSkip` (see `broadcast` / `waitForTimeout` below), but this hold is resolved solely by a
	// player tap on a `tapToContinue` overlay. That stalls a slammed round on the free-spin outro —
	// and the spin button the player presses next is INERT there (`runSpinOrSlamStop` early-returns
	// once the token is tripped) and, being drawn above the overlay, swallows the very tap that
	// would have released it. The round then never completes, so `playBet` never returns, the
	// machine never reaches idle and the game reads as frozen.
	//
	// Completing the hold is EXACTLY what the tap does — `complete` releases it and the SAME exec
	// chain resumes linearly (show → hide → next) — so no beat, state write or win is dropped; only
	// the wait for a press the player has already implicitly given.
	//
	// This release stays in force INSIDE an unskippable presentation too (`unskippablePresentation.ts`
	// leaves player-gated holds raced, for the same reason). It cannot strand a rig playing under the
	// next spin the way a raced cue could: the resumed chain runs the authored `hideContainer`, so the
	// screen the hold belonged to is taken down rather than left running detached.
	const slamAwareMount: ContainerMountModel = {
		...rawMount,
		awaitComplete: (id) => {
			const held = rawMount.awaitComplete(id);
			// Subscribed AFTER the hold is registered, because `onSkip` fires SYNCHRONOUSLY when the
			// token is already tripped — the common case here, since the slam usually lands several
			// book events before the outro. Registering first is what makes that immediate release
			// find a hold to release.
			const unsubscribe = roundSkip.onSkip(() => void rawMount.complete(id));
			return held.then(() => {
				unsubscribe();
			});
		},
	};
	// When tracing, wrap the mount so show/hide/HOLD/RELEASE/complete are visible + ordered in the log.
	const mount: ContainerMountModel = FLOW_LOG
		? {
				show: (id) => {
					trace('show', id);
					slamAwareMount.show(id);
				},
				hide: (id) => {
					trace('hide', id);
					slamAwareMount.hide(id);
				},
				isShown: (id) => slamAwareMount.isShown(id),
				ordered: () => slamAwareMount.ordered(),
				awaitComplete: (id) => {
					trace('HOLD', id, '⏸ awaiting complete (tap)');
					return slamAwareMount
						.awaitComplete(id)
						.then(() => trace('RELEASE', id, '▶ chain resumes'));
				},
				complete: (id) => {
					const released = slamAwareMount.complete(id);
					trace('complete', id, released ? '✓ released a hold' : '· (nothing held here)');
					return released;
				},
				heldContainers: () => slamAwareMount.heldContainers(),
			}
		: slamAwareMount;
	// The `showContainer.durationMs` OUTPUT pin: the shown scene's LONGEST animation in wall-clock ms,
	// so an author can wire it into a Delay's `ms` and hold for exactly the screen's animation instead
	// of a guessed literal. Asset-free `sceneAnimationDurationMs` walks the scene; these resolvers turn
	// the layout doc's NAMES into real durations game-side — a spine clip via the LOADED skeleton
	// (`SkeletonData.findAnimation(...).duration`), an effect via its baked doc + the FX time-scale
	// (`emitterSecondsToWallMs`, the shared 0.00234 emit-speed). Any un-loaded / un-baked / unknown
	// asset is skipped ⇒ the scene's max, or 0 when nothing is measurable (parity-safe: a Delay fed 0
	// simply doesn't wait, and a Delay with a literal `ms` is untouched — the wire is opt-in).
	const spineClipMs = (assetKey: string, animation: string | undefined): number | undefined => {
		if (!animation) return undefined;
		const loaded = stateApp.loadedAssets ?? {};
		let data: unknown = loaded[assetKey];
		if (!isSkeletonData(data)) {
			const hit = Object.keys(loaded).find((k) => spineBundleFolderOf(k) === assetKey);
			data = hit ? loaded[hit] : undefined;
		}
		if (!isSkeletonData(data)) return undefined; // skeleton not loaded yet ⇒ not measurable (skip).
		const clip = data.findAnimation(animation);
		return clip ? clip.duration * 1000 : undefined;
	};
	const effectMs = (effectId: string): number | undefined => {
		const effect = resolveEffect(effectId);
		if (!effect) return undefined;
		let max: number | undefined;
		for (const layer of effect.layers) {
			const explicit = layer.trigger?.duration;
			let ms: number | undefined;
			if (typeof explicit === 'number' && Number.isFinite(explicit)) {
				ms = explicit; // authored burst length (already wall-clock ms).
			} else {
				const life = layer.config.emitterLifetime;
				// `emitterLifetime` is emitter-SECONDS (-1 = continuous, no finite end); only a positive
				// finite value is a measurable burst, converted through the runtime time-scale.
				if (typeof life === 'number' && life > 0) ms = emitterSecondsToWallMs(life);
			}
			if (ms !== undefined && (max === undefined || ms > max)) max = ms;
		}
		return max;
	};
	const containerAnimationMs = (containerId: string): number => {
		const sceneId = doc.containers.find((c) => c.id === containerId)?.sceneId;
		const scene = sceneId ? editorDoc.scenes.find((s) => s.id === sceneId) : undefined;
		if (!scene) return 0;
		return sceneAnimationDurationMs(scene, {
			spineClipMs,
			effectMs,
			// A placed flipbook's beat is `frames / fps` off the boot-registered clip — no asset load
			// needed, a clip IS its frame list. `flipbookCycleMs` owns the loop rule (a loop has no end,
			// so it reports nothing and can never hold a showContainer on an ambient background).
			flipbookMs: flipbookCycleMs,
			resolveComponent: (defId) => {
				const def = getComponent(defId);
				return def ? { root: def.root } : undefined;
			},
			// Coded-bind animations are invisible to the layout walk (the clip lives in the bound
			// Svelte component, not a `spine`/`effect` node). The game supplies the clip each animated
			// bind plays — the same declare≠implement seam as `bookEventHandlerMap`. The `Transition`
			// wipe plays the preloaded `transition` skeleton's `animation` clip.
			boundComponentMs: (component) =>
				component === 'Transition' ? spineClipMs('transition', 'animation') : undefined,
		});
	};

	// How long the animation an AUTHOR-NAMED cue starts runs — what `fireCue{await}` waits for on a
	// scene cue. Measured over the scenes currently MOUNTED only: the open signal bus has no replay,
	// so a cue fired at an unmounted screen reaches nobody, and measuring it would hold the exec
	// chain for an animation that never played. A cue no mounted scene names ⇒ 0 ⇒ no wait, which is
	// every engine cue (`reelStop`, `winShow`, …), so the coded paths are untouched.
	const shownScenes = (): Scene[] => {
		const out: Scene[] = [];
		// De-duplicated against the ACCUMULATOR rather than a `Set`: two containers may share one
		// scene, and `svelte/prefer-svelte-reactivity` flags a bare `Set` in a `.svelte.ts` module
		// (it cannot tell a throwaway local from reactive state). A handful of mounted screens makes
		// the linear scan free either way.
		for (const c of mount.ordered()) {
			if (out.some((s) => s.id === c.sceneId)) continue;
			const scene = editorDoc.scenes.find((s) => s.id === c.sceneId);
			if (scene) out.push(scene);
		}
		return out;
	};
	const cueAnimationMs = (cue: string): number => {
		// A name the GAME registered is NOT driven by the open bus — `getComponentSignal` resolves it
		// against the closed registry — and its emitter subscriber already returns a real completion
		// promise, which `awaitCue` already awaits. Measuring it too would stack a SECOND wait on a cue
		// that waits correctly today: `specialBookReveal`/`specialBookHide` are both a vocabulary cue
		// and a catalog signal, so a project whose scene also names one on a spine would silently get
		// `max(real completion, that clip)` — and `specialBookReveal` fires under `setExpandingSymbol`,
		// which is UNSKIPPABLE, so the extra wait would not even be slam-raced. `enter` is instance-fired
		// and takes no bus subscription at all. Skipping both is what keeps every shipped doc identical.
		if (isRegisteredComponentSignal(cue) || cue === ENTER_SIGNAL) return 0;
		return cueAnimationDurationMs(shownScenes(), cue, {
			spineClipMs,
			// ONE CYCLE even when the cue loops — `flipbookCycleMs` reports nothing for a looping clip
			// (right for the implicit `showContainer.durationMs` walk, wrong for an explicit per-node
			// await), so force the override off. See `cueDuration.ts`'s header.
			flipbookCycleMs: (clipId, direction) => flipbookCycleMs(clipId, false, direction),
			resolveComponent: (defId, version) => {
				const def = getComponent(defId, version);
				return def ? { root: def.root } : undefined;
			},
			// The layout being drawn RIGHT NOW, so a node hidden for it is not measured — the same
			// live scalar `<LayoutNodeView>` resolves its own visibility from.
			layoutType: layoutType?.(),
		});
	};

	// §6.3 Text Message overlays. The static list of authored message nodes (groups flattened so a
	// message inside a group still renders + harvests) + the reactive set of the ones a `show` exec has
	// raised. `<FlowV2Messages>` renders each whose `visibleWhile` state-gate matches OR whose id is in
	// this set. A plain-object interpreter can't hold a rune, so the flag lives here as a `SvelteSet`.
	const textMessages = flattenGroups(doc.graph).nodes.filter(
		(n): n is TextMessageNode => n.kind === 'textMessage',
	);
	const flowShownMessages = new SvelteSet<string>();
	/**
	 * Cinematics the flow is currently PLAYING, in mount order. `<FlowV2Cinematics>` renders one
	 * `<Cinematic>` per entry; each entry keeps the resolver for its `awaitComplete` promise so the
	 * component's `oncomplete` can settle the exact play that started it (a cinematic re-played
	 * while already running gets a fresh entry, so an old promise never settles a new play).
	 */
	const playingCinematics = new SvelteMap<
		string,
		{ loop: boolean; speed: number; done?: () => void }
	>();

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
		broadcast: (cue, payload, opts) => {
			// The author-named half: fire the cue NAME on the open component-signal bus too, so a
			// spine whose `cues[]` names it plays its animation. Synchronous and payload-less (a
			// `SignalSource` carries no payload) — the bus is a bare `subscribe(run)` event contract,
			// so a spine it drives can never report back that it finished.
			emitComponentSignal(cue);
			// …which is exactly why "Wait for this cue to finish" is MEASURED for a scene cue rather
			// than listened for. Awaiting the emitter alone returned in the same microtask (nothing
			// subscribes an author-named cue there), so the tick was a silent no-op and the next node
			// ran straight away. `cueAnimationMs` is the length of the clip this cue starts on a
			// MOUNTED screen — 0, and so no wait at all, for every cue no scene names.
			//
			// Only measured when the node actually ticked the box (`opts.await`). Cues fire constantly
			// — a `reelStop` per reel, a sound per beat — and the walk would be thrown away on every
			// one of them.
			//
			// Turbo-scaled like a `delay`, and folded into `awaitCue` so a SLAM collapses it: an
			// authored wait must never outlive the round the player already chose to skip.
			const ms = opts?.await ? cueAnimationMs(cue) : 0;
			trace('cue', cue, ms > 0 ? `⏱ ${Math.round(ms)}ms` : '');
			return awaitCue(
				cue,
				Promise.all([
					ms > 0 ? waitPresentation(ms / (stateBetDerived.timeScale() || 1)) : undefined,
					eventEmitter.broadcastAsync({ type: cue, ...payload } as never),
				]),
			);
		},
		// Slam-aware delay: every authored Delay node collapses when the player slams the round, so
		// a v2-driven presentation fast-forwards exactly like the coded one — except inside an
		// unskippable presentation (the book reveal / free-spin intro), where a Delay paces a rig
		// nothing cancels and so stays a real wait. Un-slammed ⇒ identical to `waitForTimeout`.
		waitForTimeout: waitPresentation,
		// The LIVE turbo scalar — the same `stateBetDerived.timeScale()` the coded delays read, so a
		// turbo toggle mid-round scales the v2 interpreter's delays identically.
		timeScale: stateBetDerived.timeScale,
		// The bounded `$engine.*` reader — reused verbatim from the v1 wiring (one source of truth
		// for what a guard/readout sees).
		engineRead: linesEngineReader,
		// The `showContainer.durationMs` pin — the shown scene's longest animation, in wall-clock ms.
		containerAnimationMs,
		// A `textMessage` node's `show`/`hide` exec toggles its FLOW-SHOWN flag in a reactive set;
		// `<FlowV2Messages>` OR-s that with the node's `visibleWhile` state-gate to decide the overlay.
		setMessageShown: (nodeId, shown) =>
			shown ? flowShownMessages.add(nodeId) : flowShownMessages.delete(nodeId),
		// A `playCinematic` node mounts the cinematic for the flow to render, and (unless it loops)
		// hands back a promise that settles when `<Cinematic>` reports completion — that is what
		// `awaitComplete` holds the exec chain on. A looping cinematic resolves IMMEDIATELY: nothing
		// could ever settle it otherwise, and the runtime + validator both refuse that combination.
		playCinematic: (cinematicId, opts) => {
			const loop = opts.loop === true;
			const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
			if (loop) {
				playingCinematics.set(cinematicId, { loop, speed });
				return;
			}
			return new Promise<void>((resolve) => {
				playingCinematics.set(cinematicId, { loop, speed, done: resolve });
			});
		},
		stopCinematic: (cinematicId) => {
			// Settle a pending await before dropping the entry, or a `stop` mid-play would strand an
			// awaiting chain forever — the same hang `awaitComplete` + loop is guarded against.
			playingCinematics.get(cinematicId)?.done?.();
			playingCinematics.delete(cinematicId);
		},
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
		//
		// HALF-ON GUARD: a flow that intends to drive screens but can't (no `load`) must NOT own its
		// SCREEN-LIFECYCLE signals — else it suppresses the coded loading→basegame path and the reel
		// vanishes (see the loud warning above). Report those as un-owned so they fall through to the
		// coded path; book events are unaffected, so migrated presentation still works.
		ownsEvent: (eventType) => {
			if (screenStatus.halfOn && SCREEN_LIFECYCLE_SIGNALS.has(eventType)) return false;
			return ownedEvents.has(eventType) || flowOwnsSignal(doc, eventType);
		},
		dispatch: (eventName, payload, context) => {
			trace('event ▶', eventName);
			return runFlowEvent(doc, ctx, eventName, payload, context);
		},
		mount,
		resolveScene,
		ordered: () => mount.ordered(),
		awaitTargets: awaitCompleteContainerIds(doc),
		hideTargets: hideContainerIds(doc),
		ownsContainerEvent: (componentId, action) => flowOwnsContainerEvent(doc, componentId, action),
		dispatchContainerEvent: (componentId, action, payload) => {
			trace('containerEvent ▶', `${componentId}.${action}`);
			return runFlowContainerEvent(doc, ctx, componentId, action, payload);
		},
		textMessages,
		messageShown: (nodeId) => flowShownMessages.has(nodeId),
		/** The cinematics the flow currently wants on screen (id → play options). */
		playingCinematics,
		/** Called by `<Cinematic>`'s `oncomplete`: settle a pending await and unmount it. */
		cinematicComplete: (cinematicId: string) => {
			playingCinematics.get(cinematicId)?.done?.();
			playingCinematics.delete(cinematicId);
		},
	};
};
