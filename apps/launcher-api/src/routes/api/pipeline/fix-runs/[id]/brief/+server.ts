import { json } from '@sveltejs/kit';
import { fixRunBrief } from '$lib/server/bugFixRuns';
import type { RequestHandler } from './$types';

/**
 * The fix run's bug, for its Actions job (ADR-0013 §4):
 *
 *   GET /api/pipeline/fix-runs/<id>/brief   Authorization: Bearer <GitHub OIDC token>
 *       → { fixRun, bug, baseSha, budgetUsd, brief, screenshots: [{ id, mediaType, bytes }] }
 *
 * Only that run's job, while the run is live: 401 for a token that does not verify, 403 for a
 * claim that is not a fix run's, 404 for an unknown run, 409 for one that has ended. Moves the
 * run `dispatched → running`. No session: the token is the whole of the authority.
 */
export const GET: RequestHandler = async ({ params, request }) =>
	json(await fixRunBrief(request, params.id), { headers: { 'cache-control': 'no-store' } });
