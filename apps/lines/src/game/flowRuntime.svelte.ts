/**
 * Invisible Flow — the apps/lines runtime wiring (Phase 4, design doc §8, §9 row 4).
 *
 * Builds the engine-flow interpreter wired to THIS game's real primitives — the same
 * `eventEmitter`, `stateBetDerived.timeScale`, and `waitForTimeout` the coded path uses
 * (design doc §8 — "the game wires it to the same primitives the coded path uses at boot")
 * — and the live editor doc's scenes (for the generic mounter to resolve).
 *
 * LOADING IS NOW GENERIC (flow-driven-game §1): the coded `<LoadingScreen>` path was removed,
 * so an un-authored game no longer falls through to a coded splash. Instead `createLinesFlow`
 * SYNTHESIZES a default `loading → basegame` FlowDoc (`synthesizeDefaultFlowDoc`), so the
 * interpreter ALWAYS exists at boot, starts on `loading`, and advances to `basegame` on the
 * loading bar's `completeOnLoaded` capability (or a tap). The synthetic doc carries `events: []`,
 * so book events STILL fall through to the coded `bookEventHandlerMap` (the game's presentation
 * is otherwise unchanged — only the loading/dismiss display moved to the generic mounter).
 *
 * An AUTHORED FlowDoc WINS: a FlowDoc that already includes the loading screen is used verbatim
 * (never overridden by the synthetic default). Authored docs reach the game via:
 *   - the baked `flow` slot in `BakedBundle` (Phase 6 — the real ship source), filled by the
 *     export→deploy→bake→register chain; absent for an un-baked `apps/lines` dev boot;
 *   - dev-only escape hatches on top: `window.__IE_FLOW_DOC__` (an arbitrary FlowDoc, the
 *     Phase-4 ad-hoc live-verify hook), `window.__IE_FLOW_LOADING__` (the committed
 *     `LINES_FLOW_LOADING_DOC` loading→basegame entry-leg fixture, flow-driven-game §1),
 *     `window.__IE_FLOW_WIN__` (the committed `LINES_FLOW_WIN_DOC` win-presentation-transitions
 *     fixture, flow-driven-game §2), `window.__IE_FLOW_FREESPIN__` (the committed
 *     `LINES_FLOW_FREESPIN_DOC` free-spin-lifecycle fixture, design doc §14 FS-1), and
 *     `window.__IE_FLOW_LINES__` (the committed full `LINES_FLOW_DOC` fixture), none set on a
 *     normal boot.
 *
 * It OBSERVES the XState platform FSM and book events; it NEVER drives a platform transition
 * (§12). The dispatcher's coded handlers are the un-authored fall-through.
 */

import type { FlowDoc, ScreenEntrance } from 'engine-flow';
import { createFlowInterpreter } from 'engine-flow';
import type { LayoutDoc, Scene } from 'engine-layout';
import { basegameSceneId, loadingSceneId, sceneByRole } from 'engine-layout';

import {
	gateFreeSpinOwnership,
	resolveFreeSpinOwnership,
	type FreeSpinOwnership,
} from './freeSpinOwnership';
import { gateBookOwnership, resolveBookOwnership } from './bookOwnership';
import { freeSpinsRemaining, freeSpinsTotal } from './freeSpinCounterValues';
import { stateBet, stateBetDerived } from 'state-shared';
import { waitForTimeout } from 'utils-shared/wait';

import { bakedFlowDoc } from '../editor-scenes';
import { BOARD_DIMENSIONS } from './constants';
import { eventEmitter } from './eventEmitter';
import { getFlowInterpreter } from './flowInterpreterHolder';
import { stateGame } from './stateGame.svelte';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { flowEffect } from './flowEffects';
import {
	LINES_FLOW_COND_DOC,
	LINES_FLOW_DOC,
	LINES_FLOW_FREESPIN_DOC,
	LINES_FLOW_LOADING_DOC,
	LINES_FLOW_WIN_DOC,
} from './flowDoc';
import type { BookEvent, BookEventContext } from './typesBookEvent';

declare global {
	// eslint-disable-next-line no-var
	var __IE_FLOW_DOC__: FlowDoc | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_LINES__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_LOADING__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_WIN__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_COND__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_FREESPIN__: boolean | undefined;
	/**
	 * Dev-only live-verify hook for value dataflow (design doc §11 step 4). Re-point a HUD value
	 * display at a DIFFERENT engine feed at runtime WITHOUT authoring/baking a FlowDoc, so the
	 * `app.stage` verify can confirm the readout switches to the override feed's number. Call
	 * `window.__IE_FLOW_VALUE__('<instanceId>', '<producerFeed>')` before/after boot; pass a falsy
	 * `producerFeed` to CLEAR an override. It writes a game-side override map the registered value
	 * resolver consults FIRST — it does NOT touch the interpreter's memoized `valueBindings` cache
	 * (so nothing ships-hacked), and it works even with no FlowDoc (inert interpreter). Unset ⇒ the
	 * override map is empty ⇒ every display resolves its own `source` (parity §11.6).
	 */
	// eslint-disable-next-line no-var
	var __IE_FLOW_VALUE__: ((instanceId: string, producerFeed: string) => void) | undefined;
}

/**
 * Dev-only value-binding overrides injected via `window.__IE_FLOW_VALUE__` (see the global above).
 * Keyed `${instanceId}::${source}` → override feed key, mirroring the interpreter's binding table.
 * Empty on a normal boot (the hook is never called) ⇒ the resolver falls straight through to the
 * interpreter / the display's own `source` (parity §11.6).
 */
const devValueOverrides = new Map<string, string>();

if (typeof globalThis !== 'undefined') {
	globalThis.__IE_FLOW_VALUE__ = (instanceId: string, producerFeed: string): void => {
		// A falsy feed clears the override for EVERY source key on that instance (the display's own
		// `source` isn't known here); a truthy feed overrides regardless of the display's own source
		// name, so the verify can target `${instanceId}::${anySource}`. Keyed by instance for a simple
		// "re-point this readout" verify — the value resolver matches on instance id first.
		if (!producerFeed) {
			for (const key of [...devValueOverrides.keys()]) {
				if (key.startsWith(`${instanceId}::`)) devValueOverrides.delete(key);
			}
			return;
		}
		devValueOverrides.set(instanceId, producerFeed);
	};
}

/**
 * Resolve a value display's engine FEED, honouring (in order): a dev-only `__IE_FLOW_VALUE__`
 * override on this instance, then the Flow interpreter's authored value-binding override
 * (`resolveValueSource`, design doc §11.4), else the display's own `source` verbatim (auto-bind by
 * name, §11.2 rule 3). Registered into engine-layout's `registerFlowValueSource` so
 * `<ComponentInstance>` calls it at the subscription site. Interpreter absent/inert AND no dev
 * override ⇒ returns `source` unchanged (byte-parity §11.6).
 */
export const linesValueResolver = (instanceId: string, source: string): string => {
	const devOverride = devValueOverrides.get(instanceId);
	if (devOverride) return devOverride;
	return getFlowInterpreter()?.resolveValueSource(instanceId, source) ?? source;
};

/**
 * The bounded `$engine.*` reader (flow-driven-game §3, design doc §11.4) — a CLOSED key→value
 * map over LIVE engine state, NOT an expression VM. A `condition`/`bookEvent`/`complete` edge
 * guard (or a Branch) reads one of these keys via `{ kind: 'engine', key }`; the interpreter
 * resolves it through this getter when it evaluates the guard.
 *
 * Every value is sourced from the SAME live state singletons the four component registries read
 * (`registerComponentValues` / `registerComponentVisibility` in `Game.svelte`), so there is one
 * source of truth — a guard sees exactly what a bound readout/gate sees:
 *  - `balance` / `win` / `totalWin` / `bet` — the numeric value feeds (mirror `ENGINE_PARAM_CATALOG`).
 *  - `gameType` — `'basegame'` | `'freegame'` (the same field `baseGameShow`/`freeGameShow` gate on).
 *  - `freeSpinsRemaining` / `freeSpinsTotal` — the live free-spin counter (the `freeSpins` feed's parts).
 *  - `isFreeGame` — boolean convenience for the common base/free branch.
 *  - `reels` — the Flow v2 `reels` COLLECTION (`$engine.reels`): `[{ index }, …]`, one per board reel,
 *    so a v2 `forEach` (e.g. the `StaggerStop` per-reel stagger) can iterate the reels. Sourced from
 *    the live board length (falls back to the static reel count before the first spin lands).
 *
 * Keys outside this set resolve `undefined` (a guard over an unknown key is simply false) — the
 * bounded-accessor line we do not cross (no arbitrary state reads, §11.4). Pure-read: calling it
 * never mutates state, so it is harmless to inject for every fixture (a doc with no `$engine.*`
 * guard never calls it).
 */
export const linesEngineReader = (key: string): unknown => {
	switch (key) {
		case 'balance':
			return stateBet.balanceAmount;
		case 'win':
		case 'totalWin':
			return stateBet.winBookEventAmount;
		case 'bet':
			return stateBetDerived.betCost();
		case 'gameType':
			return stateGame.gameType;
		case 'isFreeGame':
			return stateGame.gameType === 'freegame';
		case 'freeSpinsRemaining':
			return freeSpinsRemaining();
		case 'freeSpinsTotal':
			return freeSpinsTotal();
		case 'reels': {
			// The `reels` collection: one `{ index }` per board reel. Prefer the live board length
			// (post-spin), else the static reel count (BOARD_DIMENSIONS.x) so `$engine.reels` is a
			// usable list even before the first reveal.
			const count = stateGame.board?.length || BOARD_DIMENSIONS.x;
			return Array.from({ length: count }, (_unused, index) => ({ index }));
		}
		default:
			return undefined;
	}
};

/** The closed set of `$engine.*` keys the lines reader exposes (the bounded vocabulary, §11.4).
 *  Exported so the game can drive `evaluate()` only on changes to these — and so a harness can
 *  assert the vocabulary is closed. */
export const LINES_ENGINE_KEYS = [
	'balance',
	'win',
	'totalWin',
	'bet',
	'gameType',
	'isFreeGame',
	'freeSpinsRemaining',
	'freeSpinsTotal',
	'reels',
] as const;

/**
 * Source the authored FlowDoc. ABSENT by default ⇒ the interpreter is inert (parity, §7).
 *
 * Precedence — dev escape hatches FIRST (so a live-verify override always wins), then the
 * REAL ship source, the baked `BakedBundle.flow` slot:
 *  - `window.__IE_FLOW_DOC__` — an arbitrary FlowDoc injected at runtime (the Phase-4 hook,
 *    kept for ad-hoc single-screen/event live-verify);
 *  - `window.__IE_FLOW_LINES__` — load the COMMITTED, complete apps/lines FlowDoc
 *    (`LINES_FLOW_DOC` in `flowDoc.ts`) — the Phase-5 full-migration fixture, for live-verify
 *    without a deploy/bake;
 *  - `bakedFlowDoc()` — the FlowDoc embedded in the baked bundle by the export→deploy→bake
 *    chain (Phase 6, the real ship path). UNDEFINED on an un-baked / un-authored boot — incl.
 *    `apps/lines` dev with no globals set — so `loadFlowDoc()` returns `undefined`, the
 *    interpreter is inert, and the game is byte-identical to current `main` (§7).
 */
export const loadFlowDoc = (): FlowDoc | undefined => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_DOC__) return globalThis.__IE_FLOW_DOC__;
		// Phase 1 (flow-driven-game §1) — the loading→basegame entry-leg fixture, for live-verify
		// of the tap-to-enter leg without a deploy/bake. Checked BEFORE the full `LINES_FLOW_DOC`
		// so a loading-leg verify wins. Unset on a normal boot ⇒ inert (parity, §7).
		if (globalThis.__IE_FLOW_LOADING__) return LINES_FLOW_LOADING_DOC;
		// Phase 2 (flow-driven-game §2) — the win-presentation-transitions fixture, for
		// live-verify of the win-branch leg (big-win + free-spin-intro as exclusive screen nodes,
		// small win as a feed-driven overlay) without a deploy/bake. Checked before the full
		// `LINES_FLOW_DOC` so a win-branch verify wins. Unset on a normal boot ⇒ inert (parity, §7).
		if (globalThis.__IE_FLOW_WIN__) return LINES_FLOW_WIN_DOC;
		// Phase 3 (flow-driven-game §3) — the engine-state `condition`-transition fixture, for
		// live-verify of branching on LIVE engine state (a `$engine.*` guard) without a deploy/bake.
		// Checked before the full `LINES_FLOW_DOC`. Unset on a normal boot ⇒ inert (parity, §7).
		if (globalThis.__IE_FLOW_COND__) return LINES_FLOW_COND_DOC;
		// FS-1 + FS-6 (design doc §14) — the free-spin lifecycle as author-controlled overlays layered
		// over the persistent basegame, for live-verify of the intro/counter/retrigger/outro active-set
		// transitions + the FS-6 PER-STEP ownership flip without a deploy/bake. Checked before the full
		// `LINES_FLOW_DOC`. Each free-spin event is authored (full Phase-5 choreographies); per-step,
		// `resolveFreeSpinOwnership` decides whether a step's event stays authored + its coded scene is
		// mount-gated off, or falls through to coded (see below). Unset on a normal boot ⇒ inert (§7).
		if (globalThis.__IE_FLOW_FREESPIN__) return LINES_FLOW_FREESPIN_DOC;
		if (globalThis.__IE_FLOW_LINES__) return LINES_FLOW_DOC;
	}
	return bakedFlowDoc();
};

/**
 * Add a DEFAULT `loading → basegame` leg so an un-authored game still boots generically (the
 * coded loading path is gone — flow-driven-game §1).
 *
 * Active-SET semantics (the pin-driven model): `loading` is the `initial` (base) screen, so it —
 * and ONLY it — is active at boot; `basegame` is NOT yet active, so the reel board is HIDDEN
 * behind the loading splash (the board mount in `Game.svelte` gates on the base-game screen being
 * active). The `complete` edge (fired by the loading bar's `completeOnLoaded` capability, or a
 * tap) DEACTIVATES `loading` and ACTIVATES `basegame` — the splash unmounts and the reels appear
 * on the clean, undimmed background. `basegame` has no `complete`-triggered outgoing edge, so it
 * PERSISTS thereafter (celebration overlays layer over it and remove themselves on their Complete).
 *
 * - No `base` doc ⇒ synthesize the minimal `loading` (initial) → `basegame` doc with `events: []`
 *   (book events keep falling through to the coded `bookEventHandlerMap`).
 * - A `base` doc that LACKS the loading screen ⇒ PREPEND the loading leg: add the `loading` screen
 *   as the new `initial`, demote the base doc's own `initial`, and add the `complete` edge to the
 *   role-resolved basegame — preserving all of the base doc's screens/transitions/events (so a dev
 *   `__IE_FLOW_LINES__` fixture keeps its full per-event choreographies, now with a loading leg).
 * - A `base` doc that ALREADY includes the loading screen is handled by the caller (it WINS).
 *
 * Returns `undefined` (inert) if the loading or basegame scene can't be resolved, so nothing
 * crashes on a boot with no such scenes (keeps the coded path).
 */
const withDefaultLoadingLeg = (
	editorDoc: LayoutDoc,
	base: FlowDoc | undefined,
): FlowDoc | undefined => {
	const loadingId = loadingSceneId(editorDoc.scenes);
	const basegameId = basegameSceneId(editorDoc.scenes);
	// Bail out (inert) if either scene doesn't actually resolve to a real scene — a boot with
	// no loading/basegame scene keeps the coded path, nothing to synthesize.
	const hasLoading =
		sceneByRole(editorDoc.scenes, 'loading') !== undefined ||
		editorDoc.scenes.some((scene) => scene.id === loadingId);
	const hasBasegame =
		sceneByRole(editorDoc.scenes, 'basegame') !== undefined ||
		editorDoc.scenes.some((scene) => scene.id === basegameId);
	if (!hasLoading || !hasBasegame) return undefined;

	const completeEdge: FlowDoc['transitions'][number] = {
		id: `${loadingId}→${basegameId}`,
		from: loadingId,
		to: basegameId,
		trigger: { kind: 'complete' },
	};

	if (!base) {
		return {
			version: 1,
			projectKey: editorDoc.projectKey ?? 'lines',
			screens: [{ id: loadingId, initial: true }, { id: basegameId }],
			transitions: [completeEdge],
			events: [],
		};
	}

	// Prepend the loading leg to the base doc: `loading` becomes the new initial, the base's own
	// initial is demoted, and the `complete` edge feeds into the role-resolved basegame. The base's
	// screens/transitions/events are otherwise untouched.
	return {
		...base,
		screens: [
			{ id: loadingId, initial: true },
			...base.screens.map((screen) => (screen.initial ? { ...screen, initial: false } : screen)),
		],
		transitions: [completeEdge, ...base.transitions],
	};
};

/**
 * Resolve the ACTIVE FlowDoc the game runs: the sourced doc (`loadFlowDoc`) with the default
 * loading leg applied exactly as `createLinesFlow` does. Extracted so `createLinesFlow` (which
 * builds the interpreter) AND `resolveFlowOwnsFreeSpins` (the FS-6 mount-gate) read ONE source of
 * truth — the SAME resolved doc drives event-authoring and the coded-mount suppression, so they
 * flip atomically. Returns `undefined` when no doc is authored (inert / coded path, parity §7).
 */
const resolveActiveFlowDoc = (editorDoc: LayoutDoc): FlowDoc | undefined => {
	const authoredDoc = loadFlowDoc();
	// An AUTHORED doc that already includes the role-resolved loading screen WINS (used verbatim,
	// never overridden). Otherwise add the default loading leg so an un-authored game (or an authored
	// doc that omitted loading) still boots generically. If loading/basegame can't resolve, fall back
	// to the authored doc as-is (inert loading, but the rest of the flow still runs).
	const loadingId = loadingSceneId(editorDoc.scenes);
	const authoredHasLoading = authoredDoc?.screens.some((screen) => screen.id === loadingId);
	return authoredHasLoading
		? authoredDoc
		: (withDefaultLoadingLeg(editorDoc, authoredDoc) ?? authoredDoc);
};

/**
 * FS-6 (design doc §14) — resolve the AUTO-DERIVED PER-STEP free-spin ownership from the SAME active
 * doc `createLinesFlow` builds the interpreter from (via `resolveActiveFlowDoc`) + the live editor
 * scenes. `Game.svelte` calls this to gate each coded fs scene mount PER STEP, so the mount-gate and
 * the interpreter's per-event authoring flip together off ONE source of truth (the atomic-flip
 * invariant, per step). The predicate lives in the pure `freeSpinOwnership.ts` (shared with the
 * headless spike). Absent doc ⇒ every step un-owned (coded, byte-parity).
 */
export const resolveFlowOwnsFreeSpins = (editorDoc: LayoutDoc): FreeSpinOwnership =>
	resolveFreeSpinOwnership(resolveActiveFlowDoc(editorDoc), editorDoc.scenes);

/** The interpreter handle the game holds (or `undefined` when no FlowDoc ⇒ pure coded path). */
export type LinesFlow = ReturnType<typeof createFlowInterpreter<BookEvent, BookEventContext>>;

/**
 * Build the interpreter from the (optional) FlowDoc + the live editor doc. Returns
 * `undefined` when no FlowDoc is authored — the game then runs entirely coded (parity).
 * `editorDoc` is the live LayoutDoc the game already loads; the generic mounter resolves a
 * screen id to its `Scene` from it, so an authored screen mounts the SAME scene the editor
 * authored (the real scenes, untouched).
 */
export const createLinesFlow = (
	editorDoc: LayoutDoc,
	/** Notified whenever the interpreter's active SET changes (a screen was added/removed —
	 *  the pin-driven active-SET model). The ids are render-ordered (base first, overlays on
	 *  top). The game uses it to drive a `$state` so the mounted scenes re-render — the
	 *  interpreter's internal active set is a plain array (not a rune), so a getter read alone
	 *  is not reactive. Absent ⇒ no notification (headless harnesses don't need it). `entrances`
	 *  lists the screens NEWLY activated by this change with the firing edge's entrance transition
	 *  (the droppable "Transition" node, design doc §6) — the game uses it to fade a screen in. */
	onActiveScreensChange?: (
		screenIds: readonly string[],
		entrances: readonly ScreenEntrance[],
	) => void,
	/** Invoke a game INTENT on a host screen (design doc §8.5) — the target of an `action → intent`
	 *  edge. Supplied by `Game.svelte` (it needs the live `context` state): dispatches each HUD intent
	 *  (`spin`/`increase`/`decrease`/`turbo`/`menu`) to that button's exact coded behaviour. An unknown
	 *  intent, or an absent bridge, is a safe no-op (parity §8.8). */
	invokeIntent?: (screenId: string, intent: string) => void,
): LinesFlow | undefined => {
	const resolvedDoc = resolveActiveFlowDoc(editorDoc);
	if (!resolvedDoc) return undefined;
	// FS-6 PER-STEP ATOMIC FLIP: each free-spin step (intro/counter/outro) is owned INDEPENDENTLY —
	// an un-owned step's event + overlay screen/transitions are STRIPPED so it falls through to its
	// coded handler + coded scene (byte-identical to a doc that never wired it), while an OWNED step
	// keeps its authored event + overlay. `Game.svelte` gates each coded scene mount off the SAME
	// per-step ownership, so event-authoring + mount-suppression flip together per step (no double /
	// empty window). All steps un-owned ⇒ the whole free-spin lifecycle is coded (byte-parity §7).
	const fsGatedDoc = gateFreeSpinOwnership(
		resolvedDoc,
		resolveFreeSpinOwnership(resolvedDoc, editorDoc.scenes),
	);
	// Book-reveal authoring — the SAME per-step ownership flip for the single `reveal` step: an
	// un-owned reveal's `setExpandingSymbol` event + `specialBook` overlay is STRIPPED so it falls
	// through to the coded `SpecialBook` shuffle (byte-parity), while an OWNED reveal keeps its
	// authored event + screen. `Game.svelte` gates the coded `SpecialBook` mount off the SAME
	// ownership (`hasAuthoredBookReveal`), so event-authoring + mount-suppression flip together.
	const flowDoc = gateBookOwnership(
		fsGatedDoc,
		resolveBookOwnership(resolvedDoc, editorDoc.scenes),
	);

	const resolveScene = (screenId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === screenId);

	return createFlowInterpreter<BookEvent, BookEventContext>({
		flowDoc,
		onActiveScreensChange,
		invokeIntent,
		// The bounded `$engine.*` reader (flow-driven-game §3) — sourced from the SAME live state
		// the component value/visibility registries read, so a `condition`/Branch guard sees the
		// same engine values a bound readout/gate does. Harmless to inject for every fixture: a
		// guard that reads no `$engine.*` key never calls it (parity). A guard over an `$engine.*`
		// key returns `undefined` (false) until `evaluate()` is pinged on a value change.
		engine: linesEngineReader,
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
