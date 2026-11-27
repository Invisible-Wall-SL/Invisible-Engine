import { json } from '@sveltejs/kit';
import { issueFixRunResultUpload } from '$lib/server/bugFixRuns';
import type { RequestHandler } from './$types';

/**
 * Where a fix run's job puts a result too large for the launcher's request limit (ADR-0013 §4):
 *
 *   POST /api/pipeline/fix-runs/<id>/result-upload   Authorization: Bearer <GitHub OIDC token>
 *        → { url, key, expiresAt, maxBytes }
 *
 * Authorised as the result is, and only for a live run. `url` is a presigned R2 PUT for the run's one
 * key (`_runs/fix/<id>/result.json.gz`), good for 15 minutes; it carries a signature, so nothing logs
 * it. The job then posts `{ upload: { key, sha256, bytes } }` to `…/result`.
 */
export const POST: RequestHandler = async ({ params, request }) =>
	json(await issueFixRunResultUpload(request, params.id), {
		headers: { 'cache-control': 'no-store' },
	});
