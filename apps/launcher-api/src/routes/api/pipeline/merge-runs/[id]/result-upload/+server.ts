import { json } from '@sveltejs/kit';
import { issueMergeRunResultUpload } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * Where a merge run's job puts a result too large for the launcher's request limit (ADR-0015 §10):
 *
 *   POST /api/pipeline/merge-runs/<id>/result-upload   Authorization: Bearer <GitHub OIDC token>
 *        → { url, key, expiresAt, maxBytes }
 *
 * Authorised as the result is, and only for a working run. `url` is a presigned R2 PUT for the run's
 * one key (`_runs/merge/<id>/result.json.gz`), good for 15 minutes; it carries a signature, so
 * nothing logs it. The job then posts `{ upload: { key, sha256, bytes } }` to `…/result`.
 */
export const POST: RequestHandler = async ({ params, request }) =>
	json(await issueMergeRunResultUpload(request, params.id), {
		headers: { 'cache-control': 'no-store' },
	});
