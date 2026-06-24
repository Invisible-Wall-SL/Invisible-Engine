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

export type FlowInterpreter<TBookEvent extends { type: string }, TContext> = {
	/** The generic scene mounter — the game reads `resolve(activeScreenId)` to render. */
	mounter: SceneMounter;
	/** The active screen id (the scene the game mounts via the interpreter). */
	readonly activeScreenId: string | undefined;
	/** Dispatch a book event: run its presentation (authored choreography or coded handler)
	 *  AND let the macro graph take a `bookEvent` transition. The two are orthogonal (§6.1).
	 *  Awaits the presentation; the transition is fired after (so a screen swap follows the
	 *  event's own animation, matching the coded serial flow). */
	dispatchBookEvent: (bookEvent: TBookEvent, context: TContext) => Promise<void>;
	/** The active screen's `complete` pin fired — take a `complete` transition (§6.2). */
	complete: () => Promise<boolean>;
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
	/** Notified whenever the active screen changes (the game swaps the mounted scene). */
	onActiveScreenChange?: (screenId: string | undefined) => void;
}): FlowInterpreter<TBookEvent, TContext> => {
	const { flowDoc, runtime, resolveScene, codedHandlers, engine, onActiveScreenChange } = params;

	const mounter = createSceneMounter({ flowDoc, resolveScene });

	// A NULL machine when there is no FlowDoc: every transition is a no-op, the active
	// screen is undefined, and the game mounts entirely via its coded path (parity, §7).
	const machine: PresentationMachine | undefined = flowDoc
		? createPresentationMachine(flowDoc, { runtime, engine, onActiveScreenChange })
		: undefined;

	const { dispatch, isAuthored } = createBookEventDispatcher<TBookEvent, TContext>({
		flowDoc,
		runtime,
		codedHandlers,
	});

	const isActive = Boolean(
		flowDoc && (flowDoc.screens.length > 0 || (flowDoc.events?.length ?? 0) > 0),
	);

	return {
		mounter,
		get activeScreenId() {
			return machine?.activeScreenId;
		},
		dispatchBookEvent: async (bookEvent, context) => {
			await dispatch(bookEvent, context);
			await machine?.onBookEvent(bookEvent);
		},
		complete: () => machine?.onComplete() ?? Promise.resolve(false),
		evaluate: () => machine?.evaluate() ?? Promise.resolve(false),
		start: () => machine?.start() ?? Promise.resolve(),
		isAuthoredEvent: isAuthored,
		get isActive() {
			return isActive;
		},
	};
};
