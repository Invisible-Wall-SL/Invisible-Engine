import { error, isHttpError } from '@sveltejs/kit';
import { requireDirectorAccess } from '$lib/server/director/access';
import { dbEventSource } from '$lib/server/director/eventListener';
import { SSE_HEADERS, openEventStream, parseLastEventId } from '$lib/server/director/eventStream';
import { getRun } from '$lib/server/director/store';
import { projectExists } from '$lib/server/projects';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * `GET /director/[runId]/events` — the run's live event stream (ADR-0003), Server-Sent Events from
 * `director_events` after `Last-Event-ID` (or `?after=`), with a heartbeat every 15 s.
 *
 * Gated like every Director surface: a session with the `director` tool, then the run's project
 * through `requireProjectScope`. The one allowance is the run's OWNER while the project does not
 * exist yet (a draft, or the first step still copying the template): there is no project row to
 * grant access to, and the owner is the person who is about to create it. Once it exists the
 * project rule applies to the owner too.
 *
 * Railway's edge keeps an HTTP response open for up to 15 minutes while data flows and closes it
 * after 5 minutes of silence; the heartbeat keeps it flowing and the browser's `EventSource`
 * reconnects with `Last-Event-ID` when the 15 minutes are up — lossless, see `eventStream.ts`.
 */
export const GET: RequestHandler = async ({ params, request, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await getRun(params.runId);
	if (!run) throw error(404, 'No such run.');
	try {
		await requireProjectScope(user, run.projectKey);
	} catch (e) {
		const ownerOfUncreated =
			run.ownerUserId === user.id &&
			isHttpError(e) &&
			e.status === 403 &&
			!(await projectExists(run.projectKey));
		if (!ownerOfUncreated) throw e;
	}
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
