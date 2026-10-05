import postgres, { type ListenMeta } from 'postgres';
import { ENV } from '../env';
import { parsePayload, type EventSource } from './eventStream';
import { getEvent, listEventsAfter } from './store';

/**
 * The Postgres half of the live stream: ONE `LISTEN director_events` connection per launcher
 * process, fanned out to every open stream by run id. The channel is fed by the `AFTER INSERT`
 * trigger on `director_events` (migration 0024) with `<runId>:<id>`, so an insert from the worker,
 * the atlas callback or a form action reaches the page without any of them knowing about it.
 *
 * The `postgres` driver re-establishes a dropped listen connection itself and calls `onlisten`
 * again; a NOTIFY sent in between is lost, which is why each stream also re-reads the table on every
 * heartbeat (`eventStream.ts`).
 */

export const EVENTS_CHANNEL = 'director_events';

type Handler = (id: number) => void;
const handlers = new Map<string, Set<Handler>>();
let listening: Promise<ListenMeta> | null = null;

function dispatch(payload: string): void {
	const parsed = parsePayload(payload);
	if (!parsed) return;
	for (const handler of handlers.get(parsed.runId) ?? []) handler(parsed.id);
}

function ensureListening(): Promise<ListenMeta> {
	if (!listening) {
		const sql = postgres(ENV.DATABASE_URL, {
			max: 1,
			onnotice: () => {},
			connection: { application_name: 'launcher-director-events' },
		});
		listening = sql.listen(EVENTS_CHANNEL, dispatch).catch((error: unknown) => {
			// Streams still poll on the heartbeat; the next subscriber retries with a fresh client.
			listening = null;
			void sql.end({ timeout: 0 }).catch(() => undefined);
			throw error;
		});
	}
	return listening;
}

export function subscribeToRun(runId: string, onInsert: Handler): () => void {
	let set = handlers.get(runId);
	if (!set) handlers.set(runId, (set = new Set()));
	set.add(onInsert);
	ensureListening().catch((error) => console.error('director events: LISTEN failed:', error));
	return () => {
		set!.delete(onInsert);
		if (set!.size === 0) handlers.delete(runId);
	};
}

export const dbEventSource: EventSource = {
	after: (runId, afterId, limit) => listEventsAfter(runId, afterId, limit),
	one: (runId, id) => getEvent(runId, id),
	subscribe: subscribeToRun,
};
