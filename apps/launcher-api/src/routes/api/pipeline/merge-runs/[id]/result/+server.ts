import { json } from '@sveltejs/kit';
import { acceptMergeRunResult } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * The merge run's result, from its Actions job (ADR-0015 §10):
 *
 *   POST /api/pipeline/merge-runs/<id>/result   Authorization: Bearer <GitHub OIDC token>
 *        Content-Type: application/json [Content-Encoding: gzip]   body: the §10 result
 *        → { mergeRun, status, spendUsd }
 *
 * Authorised as a fix run's result is: the token must be `merge-main.yml`'s job on `main`, dispatched
 * by the App, first attempt, in the `bug-fix` environment, for audience
 * `invisible-launcher-merge-main`, and its Actions run the one bound to this merge run. The spend is
 * recorded first (once per model); the first result of a working run is kept as a proposal for a
 * person to accept, a second is 409. The answer carries no reason and no text of the run: the job's
 * log is public, and the change's page is where the proposal is read.
 */
export const POST: RequestHandler = async ({ params, request }) =>
	json(await acceptMergeRunResult(request, params.id), {
		headers: { 'cache-control': 'no-store' },
	});
