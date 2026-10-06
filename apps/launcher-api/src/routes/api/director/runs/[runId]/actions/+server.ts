import { json } from '@sveltejs/kit';
import { requireDirectorAccess, requireOwnedRun } from '$lib/server/director/access';
import { NO_STORE, answering, jsonBody } from '$lib/server/director/api';
import { performOwnerAction, summarizeRun } from '$lib/server/director/runs';
import type { RequestHandler } from './$types';

/**
 * `POST /api/director/runs/[runId]/actions` — the owner's actions on a run (ADR-0003), each ONE
 * row in `director_events` the worker consumes:
 *
 *   { action: 'start' | 'pause' | 'stop', requestId }
 *   { action: 'resume', requestId, budgetCapUsd? }           raise the cap within Settings' bounds
 *   { action: 'approve' | 'revise', requestId, checkpoint?, note? }
 *                                                            resolve the open checkpoint; approving
 *                                                            `breakdown` is what lets RunPod work begin
 *   { action: 'message', requestId, text }                   to the coordinator
 *   → 200 { action, eventId, replayed, run: <summary> }
 *
 * Owner-only (404 otherwise, like an unknown id). An action the run's state does not allow is
 * refused with the worker's own reason (409 `not_allowed`) and writes nothing. `requestId` replays
 * to the same event id without a second row.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireDirectorAccess(locals);
	const run = await requireOwnedRun(user, params.runId);
	const body = await jsonBody(request);
	return answering(async () => {
		const outcome = await performOwnerAction(user, run, body);
		const fresh = await requireOwnedRun(user, run.id);
		return json({ ...outcome, run: await summarizeRun(fresh) }, { headers: NO_STORE });
	});
};
