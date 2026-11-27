import { error, json } from '@sveltejs/kit';
import { SHA_40 } from '$lib/mergeMainRuns';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { objectOrNull, readJson } from '$lib/server/http';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { acceptMergeRun, personOf } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * Accept a merge run's proposal (ADR-0015 §5). Body: `{ headSha }`, the head the card showed. Needs the
 * `pipelineMerge` capability (403 otherwise). The launcher builds the merge itself and moves the
 * branch with a fast-forward or nothing. 409 `{ message, code }` for `stale` (the branch moved, or
 * `main` changed a conflicted file: resolve again), `not_proposed`, `not_open`, `on_hold` and
 * `needs_person` (the resolution was refused, or GitHub refused the push over a workflow file; the
 * message says which). Any other GitHub failure is a 502.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Accepting a resolution');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	const { headSha } = objectOrNull(await readJson(request, 'The body must be JSON.')) ?? {};
	if (typeof headSha !== 'string' || !SHA_40.test(headSha)) {
		throw error(400, 'headSha must be the full SHA of the head the card showed.');
	}
	try {
		const result = await acceptMergeRun({
			number,
			id: params.id,
			headSha,
			person: personOf(user),
		});
		return json(result, { headers: { 'cache-control': 'no-store' } });
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
