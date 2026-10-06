import { error } from '@sveltejs/kit';
import { canReachRun, requireDirectorAccess } from '$lib/server/director/access';
import { dbEventSource } from '$lib/server/director/eventListener';
import { SSE_HEADERS, openEventStream, parseLastEventId } from '$lib/server/director/eventStream';
import { getRun } from '$lib/server/director/store';
import type { RequestHandler } from './$types';

/**
 * `GET /director/[runId]/events` — the run's live event stream (ADR-0003), Server-Sent Events from
 * `director_events` after `Last-Event-ID` (or `?after=`), with a heartbeat every 15 s.
 *
 * Gated like every Director surface: a session with the `director` tool, then the run's project
 * through `canReachRun` (`access.ts`: `requireProjectScope`, or the run's owner while the project
 * does not exist yet). A run that does not exist and a run outside the caller's projects get the
 * SAME 404, so the route is not an oracle for which run ids exist.
 *
 * Railway's edge keeps an HTTP response open for up to 15 minutes while data flows and closes it
 * after 5 minutes of silence; the heartbeat keeps it flowing and the browser's `EventSource`
 * reconnects with `Last-Event-ID` when the 15 minutes are up — see `eventStream.ts` for what that
 * covers. Teardown: under adapter-node a GET's `request.signal` does not fire when the client goes
 * away; the stream's `cancel()` does (the adapter cancels the body reader on `close`), so both are
 * wired and `cancel()` is the one that matters in production.
 */
export const GET: RequestHandler = async ({ params, request, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await getRun(params.runId);
	if (!run || !(await canReachRun(user, run))) throw error(404, 'No such run.');
	const afterId = parseLastEventId(
		request.headers.get('last-event-id'),
		url.searchParams.get('after'),
	);
	const stream = openEventStream({
		runId: run.id,
		afterId,
		source: dbEventSource,
		signal: request.signal,
		onError: (err) => console.error(`director events ${run.id}:`, err),
	});
	return new Response(stream, { headers: SSE_HEADERS });
};
