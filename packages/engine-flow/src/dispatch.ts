import type { FlowDoc } from './types';
import type { FlowRuntime } from './runtime';
import { runChoreography } from './executor';

/** A coded book-event handler — the existing `bookEventHandlerMap` entry shape. */
export type CodedEventHandler<TBookEvent, TContext> = (
	bookEvent: TBookEvent,
	context: TContext,
) => Promise<void>;

/**
 * Build the dispatch-with-fall-through entry (design doc §7, §8 — the parity guarantee).
 *
 *   "FlowDoc has this event? run the interpreter; else fall through to the coded handler."
 *
 * For a book event whose `type` has an authored `EventChoreography`, the interpreter runs
 * that choreography (replacing one coded `bookEventHandlerMap` entry). For EVERY other
 * event — or when `flowDoc` is absent — it calls the coded handler unchanged, so an
 * un-baked or partially-authored game is byte-identical to current `main`. This is the
 * single boundary every book event crosses; nothing else may diverge.
 */
export const createBookEventDispatcher = <TBookEvent extends { type: string }, TContext>(params: {
	flowDoc: FlowDoc | undefined;
	runtime: FlowRuntime;
	codedHandlers: Record<string, CodedEventHandler<TBookEvent, TContext>>;
	/** Read a registered engine value feed by `ENGINE_PARAM_CATALOG` key (`$engine.*`), for
	 *  guard / branch / effect-payload accessors inside an authored choreography. */
	engine?: (key: string) => unknown;
}) => {
	const { flowDoc, runtime, codedHandlers, engine } = params;

	const authoredByEvent = new Map(
		(flowDoc?.events ?? []).map((entry) => [entry.event, entry.choreography] as const),
	);

	const dispatch = async (bookEvent: TBookEvent, context: TContext): Promise<void> => {
		const authored = authoredByEvent.get(bookEvent.type);
		if (authored) {
			// Scope carries the trigger (the book event), the per-event context (`{ bookEvents }`),
			// and the `$engine.*` reader — everything an authored handler's accessors / effects need
			// without leaving the bounded model. Matches the coded handler's `(bookEvent, context)`.
			await runChoreography(authored, runtime, { trigger: bookEvent, context, engine });
			return;
		}
		const coded = codedHandlers[bookEvent.type];
		if (coded) {
			await coded(bookEvent, context);
			return;
		}
		console.error('Missing handler (coded + authored) for book event:', bookEvent);
	};

	/** True when an event type is interpreter-driven (for diagnostics / migration audits). */
	const isAuthored = (eventType: string) => authoredByEvent.has(eventType);

	return { dispatch, isAuthored };
};
