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
 * A 200 means RECORDED: the row is in `director_events` for the worker to apply. A run that has
 * moved on by the time the worker reads it is refused there, as an `error` event whose
 * `payload.type` is `refused_request`, which the Live-run page should watch for on the stream.
 * Owner-only (404 otherwise, like an unknown id). An action the run's state does not allow when
 * it arrives is refused with the worker's own reason (409 `not_allowed`) and writes nothing. A
 * resend — the same `requestId` with the same body — answers the recorded event id with
 * `replayed: true`, whatever the run's state by then; another body under that id is 409.
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
