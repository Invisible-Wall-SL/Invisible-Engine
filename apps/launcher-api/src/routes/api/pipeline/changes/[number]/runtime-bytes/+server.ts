import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { objectOrNull, readJson } from '$lib/server/http';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { rerecordRuntimeBytes } from '$lib/server/pipelineRuntimeBytes';
import type { RequestHandler } from './$types';

/**
 * Re-record runtime bytes: commit the manifests the failed `runtime-bytes` CI run built (its
 * artifact of that name) onto the change's own branch, as the App. Body: `{ headSha }`, the head
 * the page showed. Needs the `pipelineMerge` capability (403 otherwise). 409 `{ message, code }`
 * for: `no_run` (no finished failed run for this head), `no_artifact`, `head_moved` (the head is
 * not `headSha`, or moved while committing), `invalid_artifact` (it is not what the gate writes)
 * and `nothing_to_change`. Any other GitHub failure is a 502. It merges nothing.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Re-recording runtime bytes');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	const { headSha } = objectOrNull(await readJson(request, 'The body must be JSON.')) ?? {};
	if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
		throw error(400, 'headSha must be the full SHA of the head the page showed.');
	}
	try {
		return json(await rerecordRuntimeBytes({ number, headSha, user }), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof GithubAppError) {
			return json(
				{ error: err.status === 404 ? `There is no change #${number}.` : err.message },
				{ status: err.status === 404 ? 404 : 502 },
			);
		}
		throw err;
	}
};
