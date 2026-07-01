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

import type { FlowDoc } from './types';
import type { FlowRuntime } from './runtime';
import { createPresentationMachine, type PresentationMachine } from './presentation';
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
	/** Dispatch a book event: run its presentation (authored choreography or coded handler)
	 *  AND let the macro graph take a `bookEvent` transition. The two are orthogonal (§6.1).
	 *  Awaits the presentation; the transition is fired after (so a screen swap follows the
	 *  event's own animation, matching the coded serial flow). */
	dispatchBookEvent: (bookEvent: TBookEvent, context: TContext) => Promise<void>;
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
	/** Notified whenever the active SET changes (a screen was added/removed). The ids are
	 *  render-ordered (base first, later-activated on top); the game mirrors them into a rune
	 *  so the mounted scenes re-render. */
	onActiveScreensChange?: (screenIds: readonly string[]) => void;
}): FlowInterpreter<TBookEvent, TContext> => {
	const { flowDoc, runtime, resolveScene, codedHandlers, engine, onActiveScreensChange } = params;

	const mounter = createSceneMounter({ flowDoc, resolveScene });

	// A NULL machine when there is no FlowDoc: every transition is a no-op, the active
	// set is empty, and the game mounts entirely via its coded path (parity, §7).
	const machine: PresentationMachine | undefined = flowDoc
		? createPresentationMachine(flowDoc, { runtime, engine, onActiveScreensChange })
		: undefined;

	const { dispatch, isAuthored } = createBookEventDispatcher<TBookEvent, TContext>({
		flowDoc,
		runtime,
		codedHandlers,
		engine,
	});

	const isActive = isAuthoredFlow(flowDoc);

	return {
		mounter,
		get activeScreenId() {
			return machine?.activeScreenId;
		},
		get activeScreenIds() {
			return machine?.activeScreenIds ?? [];
		},
		isScreenActive: (screenId) => machine?.isActive(screenId) ?? false,
		dispatchBookEvent: async (bookEvent, context) => {
			await dispatch(bookEvent, context);
			await machine?.onBookEvent(bookEvent);
		},
		complete: () => machine?.onComplete() ?? Promise.resolve(false),
		completeActiveScreen: () => machine?.onComplete() ?? Promise.resolve(false),
		emitSignal: (signal) => machine?.onSignal(signal) ?? Promise.resolve(false),
		evaluate: () => machine?.evaluate() ?? Promise.resolve(false),
		start: () => machine?.start() ?? Promise.resolve(),
		isAuthoredEvent: isAuthored,
		get isActive() {
			return isActive;
		},
	};
};
