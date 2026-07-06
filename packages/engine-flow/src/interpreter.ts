/**
 * Invisible Flow — the runtime interpreter (design doc §8 — the crux).
 *
 * The single object the game wires at boot. It ties together:
 *   - the presentation HSM (`createPresentationMachine`) — the active screen + transitions;
 *   - the generic scene mounter (`createSceneMounter`) — which scene the active screen
 *     points at, with the §7 fall-through boundary;
 *   - the book-event dispatcher (`createBookEventDispatcher`) — per-event choreography vs
 *     the coded handler, with fall-through.
 *
 * It OBSERVES the XState platform FSM (idle↔play) and book events; it NEVER drives a
 * platform transition (§12 "observe, don't model"). The game pushes book events via
 * `dispatchBookEvent` (which both runs the event's presentation AND lets the macro graph
 * take a `bookEvent` transition) and pings `evaluate()` when an observed engine condition
 * changes; the active screen's `complete` choreography fires `complete()`.
 *
 * Parity (§7): with NO FlowDoc, or a screen/event not authored, every method falls through
 * to the coded path, so the game is byte-identical to current `main`. The interpreter is
 * inert until a FlowDoc is supplied.
 */

import type { FlowDoc, FlowTransitionEffect } from './types';
import type { FlowRuntime } from './runtime';
import {
	createPresentationMachine,
	type PresentationMachine,
	type ScreenEntrance,
} from './presentation';
import { createSceneMounter, type MountableScene, type SceneMounter } from './mounter';
import { createBookEventDispatcher, type CodedEventHandler } from './dispatch';
import { isAuthoredFlow } from './normalize';

export type FlowInterpreter<TBookEvent extends { type: string }, TContext> = {
	/** The generic scene mounter — the game reads `resolve(activeScreenId)` to render. */
	mounter: SceneMounter;
	/** The TOPMOST active screen id (the last-activated screen). The full render-ordered
	 *  active set is `activeScreenIds`; this is a convenience for a single "current" screen. */
	readonly activeScreenId: string | undefined;
	/** The ORDERED active SET (base first, later-activated on top) — the pin-driven active-SET
	 *  model. A base-game screen persists under overlays layered on it, so the game mounts every
	 *  entry in this order (base underneath, overlays on top). Empty ⇒ inert / no active screen. */
	readonly activeScreenIds: readonly string[];
	/** Whether a screen id is currently active (in the set) — the game gates a scene's mount
	 *  (e.g. the reel board on the base-game screen being active) on this. */
	isScreenActive: (screenId: string) => boolean;
	/** The entrance transition surfaced for a screen's last activation (the droppable "Transition"
	 *  node, design doc §6), or `undefined` for the initial screen / a hard-cut edge. The host
	 *  primarily reads entrances off the `onActiveScreensChange` `entrances` arg; this queries the
	 *  boot-seeded initial screen (no notify fires for it). Inert ⇒ always `undefined`. */
	entranceTransition: (screenId: string) => FlowTransitionEffect | undefined;
	/** Dispatch a book event: run its presentation (authored choreography or coded handler)
	 *  AND let the macro graph take a `bookEvent` transition. The two are orthogonal (§6.1).
	 *  Awaits the presentation; the transition is fired after (so a screen swap follows the
	 *  event's own animation, matching the coded serial flow). */
	dispatchBookEvent: (bookEvent: TBookEvent, context: TContext) => Promise<void>;
	/**
	 * Take ONLY a book event's macro `bookEvent` transition (activate its screen) WITHOUT running
	 * the event's presentation — the "early mount" hook. Unlike `dispatchBookEvent` (which runs the
	 * choreography/coded handler THEN the transition), this fires the transition alone, so the game
	 * can mount an overlay screen at a chosen point INSIDE that event's own choreography (e.g. the
	 * moment its `*Show` emitter broadcasts, BEFORE a round-blocking await later in the same
	 * choreography). It is idempotent: a layer edge onto an already-active target is a no-op
	 * (`changesActiveSet`), so the later `dispatchBookEvent`'s own `onBookEvent` becomes a safe
	 * no-op. Generic — the caller names the event type; the interpreter knows no game ids. A SAFE
	 * no-op when inert (no FlowDoc). Returns true when a `bookEvent` transition was taken. */
	activateForBookEvent: (bookEvent: { type: string }) => Promise<boolean>;
	/** The active screen's `complete` pin fired — take a `complete` transition (§6.2). */
	complete: () => Promise<boolean>;
	/**
	 * Advance the currently-active screen: run its `exit` choreography then fire its
	 * `complete`/`exited` structural pin, so any `complete`-triggered edge from that screen
	 * fires (the tap-to-continue "complete the active screen" hook, §6.2). The exit phase runs
	 * inside the transition swap exactly as a self-driven `complete` does, so this is the click
	 * analogue of the screen signalling done. A SAFE no-op when the interpreter is inert (no
	 * FlowDoc ⇒ no active screen / no machine). Returns true when a `complete` transition was
	 * taken. (Same boundary as `complete()` — a clearly-named alias for the tap path.) */
	completeActiveScreen: () => Promise<boolean>;
	/**
	 * Emit a named runtime signal: fire any active-screen edge whose trigger is
	 * `{kind:'signal', signal:<name>}` (the tap-to-continue "emit a named signal" hook, §6.2).
	 * A SAFE no-op when inert or when no edge listens for the signal. Returns true when a
	 * `signal` transition was taken. */
	emitSignal: (signal: string) => Promise<boolean>;
	/**
	 * Pure query — is any active-screen outgoing edge an `action` edge for `pin` (design doc §8.5)?
	 * A flow-bound button reads this to decide whether its press routes through the flow (an intent)
	 * or its coded path. Inert interpreter (no FlowDoc) ⇒ always `false`, so the coded path stays
	 * authoritative until a button's action pin is wired (parity §8.8). */
	hasAction: (pin: string) => boolean;
	/**
	 * A flow-bound button's action pin fired — invoke the game intent on each matching
	 * `action → intent` edge's host (design doc §8.5). Does NOT move the active set (base game is
	 * already active). A SAFE no-op when inert or when no edge wires the action. Returns true when
	 * an action edge matched. Mirrors `emitSignal`, scoped to a button's action instead of a tap. */
	emitAction: (pin: string) => Promise<boolean>;
	/**
	 * Resolve a HUD display's engine value FEED, honouring an authored value-binding override
	 * (design doc `flow-driven-game.md` §11.4). Returns the OVERRIDE producer feed key when a
	 * `value` edge rebinds this display (`${instanceId}::${source}`), else the display's OWN `source`
	 * verbatim (auto-bind by name, §11.2 rule 3). The game calls this at mount and subscribes to the
	 * resolved feed's registered `ValueSource` — a subscription redirect, never a copy (§11.2 rule 1).
	 * INERT interpreter (no FlowDoc) ⇒ ALWAYS returns `source` unchanged (byte-parity, §11.6). */
	resolveValueSource: (instanceId: string, source: string) => string;
	/** Re-evaluate `condition` transitions (the game pings this on an observed value change). */
	evaluate: () => Promise<boolean>;
	/** Run the initial screen's enter choreography at boot. */
	start: () => Promise<void>;
	/** True when a book-event type is interpreter-driven (migration audits / diagnostics). */
	isAuthoredEvent: (eventType: string) => boolean;
	/** True when any FlowDoc content is authored (the interpreter is active, not inert). */
	readonly isActive: boolean;
};

export const createFlowInterpreter = <TBookEvent extends { type: string }, TContext>(params: {
	/** The authored FlowDoc; `undefined` ⇒ the interpreter is inert (pure fall-through, §7). */
	flowDoc: FlowDoc | undefined;
	runtime: FlowRuntime;
	/** Resolve a screen id → its backing LayoutDoc scene (for the generic mounter). */
	resolveScene: (screenId: string) => MountableScene | undefined;
	/** The coded `bookEventHandlerMap` — the fall-through for un-authored events. */
	codedHandlers: Record<string, CodedEventHandler<TBookEvent, TContext>>;
	/** Read a registered engine value feed by `ENGINE_PARAM_CATALOG` key (`$engine.*`),
	 *  for transition/Branch guards over engine conditions. */
	engine?: (key: string) => unknown;
	/** Invoke a game INTENT on a host screen (design doc §8.5) — the target of an `action → intent`
	 *  edge. The game implements this (for `spin`, today's coded bet/stop). Threaded to the HSM host. */
	invokeIntent?: (screenId: string, intent: string) => void;
	/** Notified whenever the active SET changes (a screen was added/removed). The ids are
	 *  render-ordered (base first, later-activated on top); `entrances` lists the newly-activated
	 *  screens with the firing edge's entrance transition (design doc §6). The game mirrors the ids
	 *  into a rune so the mounted scenes re-render, and reads `entrances` to drive the fade-in. */
	onActiveScreensChange?: (
		screenIds: readonly string[],
		entrances: readonly ScreenEntrance[],
	) => void;
}): FlowInterpreter<TBookEvent, TContext> => {
	const {
		flowDoc,
		runtime,
		resolveScene,
		codedHandlers,
		engine,
		invokeIntent,
		onActiveScreensChange,
	} = params;

	const mounter = createSceneMounter({ flowDoc, resolveScene });

	// A NULL machine when there is no FlowDoc: every transition is a no-op, the active
	// set is empty, and the game mounts entirely via its coded path (parity, §7).
	const machine: PresentationMachine | undefined = flowDoc
		? createPresentationMachine(flowDoc, { runtime, engine, invokeIntent, onActiveScreensChange })
		: undefined;

	const { dispatch, isAuthored } = createBookEventDispatcher<TBookEvent, TContext>({
		flowDoc,
		runtime,
		codedHandlers,
		engine,
	});

	const isActive = isAuthoredFlow(flowDoc);

	// Event types whose macro `bookEvent` transition was ALREADY taken via `activateForBookEvent`
	// (the early-mount hook) during THIS event's own dispatch. `dispatchBookEvent` consumes the mark
	// after `dispatch()` and SKIPS its own post-dispatch `onBookEvent`, so the transition is taken
	// exactly once. Without this, a screen that early-mounts AND then self-completes DURING dispatch
	// (the FS-7 round-gate: its tap-to-continue fires `complete` while the choreography is still
	// blocked) would be RE-ACTIVATED by the post-dispatch `onBookEvent` (the layer edge onto a
	// now-inactive target is no longer the intended no-op) — the overlay would pop back and stick.
	// Empty for every event that never early-mounts ⇒ byte-parity for the whole coded/FS-6 path.
	const earlyActivated = new Set<string>();

	return {
		mounter,
		get activeScreenId() {
			return machine?.activeScreenId;
		},
		get activeScreenIds() {
			return machine?.activeScreenIds ?? [];
		},
		isScreenActive: (screenId) => machine?.isActive(screenId) ?? false,
		entranceTransition: (screenId) => machine?.entranceTransition(screenId),
		dispatchBookEvent: async (bookEvent, context) => {
			await dispatch(bookEvent, context);
			// If this event already took its transition early (during the dispatch above, via
			// `activateForBookEvent`), do NOT re-take it — the screen may have self-completed mid-
			// dispatch (FS-7), so re-firing would wrongly re-activate it. Consume the mark either way.
			if (earlyActivated.delete(bookEvent.type)) return;
			await machine?.onBookEvent(bookEvent);
		},
		// Early-mount hook: fire ONLY the macro `bookEvent` transition, no presentation, and MARK the
		// event type so `dispatchBookEvent` skips its own post-dispatch `onBookEvent` (take-once). The
		// mark is set only when a transition was actually taken (`onBookEvent` returned true — includes
		// the idempotent already-active no-op, which correctly also suppresses a redundant re-fire).
		// Inert ⇒ resolves false and marks nothing (parity). Generic — the caller names the type.
		activateForBookEvent: async (bookEvent) => {
			const took = (await machine?.onBookEvent(bookEvent)) ?? false;
			if (took) earlyActivated.add(bookEvent.type);
			return took;
		},
		complete: () => machine?.onComplete() ?? Promise.resolve(false),
		completeActiveScreen: () => machine?.onComplete() ?? Promise.resolve(false),
		emitSignal: (signal) => machine?.onSignal(signal) ?? Promise.resolve(false),
		hasAction: (pin) => machine?.hasAction(pin) ?? false,
		emitAction: (pin) => machine?.onAction(pin) ?? Promise.resolve(false),
		// Inert (no FlowDoc) ⇒ `machine` is undefined ⇒ `?.` short-circuits BEFORE any binding map is
		// built ⇒ `?? source` returns the display's own feed verbatim (byte-parity, §11.6). An active
		// interpreter with no matching value edge also yields `undefined` from `.get` ⇒ same `source`.
		resolveValueSource: (instanceId, source) =>
			machine?.valueBindings().get(`${instanceId}::${source}`) ?? source,
		evaluate: () => machine?.evaluate() ?? Promise.resolve(false),
		start: () => machine?.start() ?? Promise.resolve(),
		isAuthoredEvent: isAuthored,
		get isActive() {
			return isActive;
		},
	};
};
