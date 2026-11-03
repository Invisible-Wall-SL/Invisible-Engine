import { json } from '@sveltejs/kit';
import { acceptFixRunResult } from '$lib/server/bugFixRuns';
import type { RequestHandler } from './$types';

/**
 * The fix run's result, from its Actions job (ADR-0013 §5):
 *
 *   POST /api/pipeline/fix-runs/<id>/result   Authorization: Bearer <GitHub OIDC token>
 *        Content-Type: application/json [Content-Encoding: gzip]   body: FixRunResultBody
 *        → { fixRun, status, outcome, prNumber, spendUsd }
 *
 * Authorised as the brief is. The spend is recorded first (once per model), then the first result
 * of a live run is accepted — a second is 409 and opens nothing. The answer carries no reason and
 * no run text: the job's log is public, the bug page is where the reason is read.
 */
export const POST: RequestHandler = async ({ params, request }) =>
	json(await acceptFixRunResult(request, params.id), { headers: { 'cache-control': 'no-store' } });
