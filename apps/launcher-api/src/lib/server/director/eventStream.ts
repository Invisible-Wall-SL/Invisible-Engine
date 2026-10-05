/**
 * The live run stream (ADR-0003 "Live UI"), as Server-Sent Events over `director_events`:
 *
 *  - every frame is one row, `id:` = the row id, `event:` = its kind, `data:` = the row as JSON;
 *  - a client opens with `Last-Event-ID` (or `?after=`) and gets every row after it first, then
 *    tails: each `director_events` insert NOTIFYs `director_events` with `<runId>:<id>` (migration
 *    0024) and the row is fetched and sent;
 *  - a heartbeat comment goes out every 15 s, and re-reads the table past the high-water mark, so a
 *    NOTIFY lost while the listener reconnected is caught within one heartbeat.
 *
 * Reconnects lose nothing committed in order, and nothing committed out of order within
 * {@link LOOKBACK} ids: bigserial ids are taken before commit, so a slow insert can commit with a
 * LOWER id than one already sent. While connected its NOTIFY delivers it (by id, once). To cover a
 * late commit that lands while the client is away, or while the LISTEN connection is reconnecting,
 * every catch-up read — on open and on each heartbeat — starts {@link LOOKBACK} ids below the
 * high-water mark; rows already delivered on this connection are dropped by id, so the only repeats
 * a client sees are the few rows below its `Last-Event-ID` on a reconnect. A page therefore keys
 * events by `id` and treats a repeat as a no-op.
 *
 * Pure over an {@link EventSource}, so the fixture drives it without Postgres; the database source
 * is `eventListener.ts`.
 */

export const HEARTBEAT_MS = 15_000;
export const CATCH_UP_LIMIT = 500;
/** How many ids below the high-water mark a catch-up read re-covers, for late commits. */
export const LOOKBACK = 16;
export const HEARTBEAT_FRAME = ': heartbeat\n\n';

export interface StreamedEvent {
	id: number;
	runId: string;
	at: Date | string;
	agent: string;
	kind: string;
	tool: string | null;
	payloadJson: unknown;
}

export interface EventSource {
	/** Up to `limit` rows of `runId` with `id > afterId`, ascending. */
	after(runId: string, afterId: number, limit: number): Promise<StreamedEvent[]>;
	/** One row by id, or null. */
	one(runId: string, id: number): Promise<StreamedEvent | null>;
	/** Call `onInsert(id)` for each new row of `runId`; returns the unsubscribe. */
	subscribe(runId: string, onInsert: (id: number) => void): () => void;
}

/** `Last-Event-ID` (the header the browser resends) or `?after=`; 0 when absent or not an id. */
export function parseLastEventId(header: string | null, query: string | null): number {
	for (const raw of [header, query]) {
		if (raw === null || raw === undefined) continue;
		const value = raw.trim();
		if (/^\d{1,15}$/.test(value)) return Number(value);
	}
	return 0;
}

/** A NOTIFY payload `<runId>:<id>`; a run id may itself hold `:`, so the id follows the LAST one. */
export function parsePayload(payload: string): { runId: string; id: number } | null {
	const at = payload.lastIndexOf(':');
	if (at <= 0) return null;
	const id = Number(payload.slice(at + 1));
	if (!Number.isInteger(id) || id <= 0) return null;
	return { runId: payload.slice(0, at), id };
}

export function frameEvent(event: StreamedEvent): string {
	const data = JSON.stringify({
		id: event.id,
		at: event.at instanceof Date ? event.at.toISOString() : event.at,
		agent: event.agent,
		kind: event.kind,
		tool: event.tool,
		payload: event.payloadJson,
	});
	// A newline inside `data:` would start a new field; JSON.stringify never emits a raw one.
	return `id: ${event.id}\nevent: ${event.kind}\ndata: ${data}\n\n`;
}

/** How many delivered ids are remembered, to send a late-committed row once and only once. */
const REMEMBERED_IDS = 512;

export interface StreamOptions {
	runId: string;
	afterId: number;
	source: EventSource;
	heartbeatMs?: number;
	/** The request's signal: closing the tab ends the stream and its subscription. */
	signal?: AbortSignal;
	onError?: (error: unknown) => void;
}

export function openEventStream(opts: StreamOptions): ReadableStream<Uint8Array> {
	const { runId, source } = opts;
	const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
	const encoder = new TextEncoder();
	let highWater = opts.afterId;
	const delivered: number[] = [];
	const deliveredSet = new Set<number>();
	let closed = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let unsubscribe: (() => void) | null = null;
	let chain: Promise<void> = Promise.resolve();

	const remember = (id: number) => {
		deliveredSet.add(id);
		delivered.push(id);
		if (delivered.length > REMEMBERED_IDS) deliveredSet.delete(delivered.shift()!);
	};

	return new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (text: string) => {
				if (!closed) controller.enqueue(encoder.encode(text));
			};
			const deliver = (event: StreamedEvent) => {
				if (deliveredSet.has(event.id)) return;
				remember(event.id);
				if (event.id > highWater) highWater = event.id;
				send(frameEvent(event));
			};
			const catchUp = async () => {
				let from = Math.max(0, highWater - LOOKBACK);
				for (;;) {
					const rows = await source.after(runId, from, CATCH_UP_LIMIT);
					for (const row of rows) deliver(row);
					if (rows.length < CATCH_UP_LIMIT) return;
					from = rows[rows.length - 1].id;
				}
			};
			const queue = (work: () => Promise<void>) => {
				chain = chain.then(async () => {
					if (closed) return;
					try {
						await work();
					} catch (error) {
						opts.onError?.(error);
					}
				});
			};
			const close = () => {
				if (closed) return;
				closed = true;
				if (timer) clearInterval(timer);
				unsubscribe?.();
				try {
					controller.close();
				} catch {
					// Already closed by the consumer.
				}
			};

			// Subscribe BEFORE the catch-up read, so a row inserted between the two is not missed:
			// it is either in the read or announced, and `deliver` drops the duplicate.
			unsubscribe = source.subscribe(runId, (id) => {
				queue(async () => {
					if (id > highWater) return catchUp();
					const late = await source.one(runId, id);
					if (late) deliver(late);
				});
			});
			queue(catchUp);
			timer = setInterval(() => {
				send(HEARTBEAT_FRAME);
				queue(catchUp);
			}, heartbeatMs);
			opts.signal?.addEventListener('abort', close, { once: true });
			if (opts.signal?.aborted) close();
		},
		cancel() {
			closed = true;
			if (timer) clearInterval(timer);
			unsubscribe?.();
		},
	});
}

export const SSE_HEADERS = {
	'content-type': 'text/event-stream; charset=utf-8',
	'cache-control': 'no-store, no-transform',
	// Asks any buffering proxy in front of adapter-node to pass frames through as they are written.
	'x-accel-buffering': 'no',
} as const;
