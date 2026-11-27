import { json } from '@sveltejs/kit';
import { GithubAppError } from '$lib/server/githubApp';
import { objectOrNull, readJson } from '$lib/server/http';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { personOf, startMergeRun } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * Resolve conflict (ADR-0015 §1, §4): start a merge run on a change that conflicts with `main`. Body:
 * `{ requestId }`, the click's own id, which its retry resends. Needs the `pipelineMerge` capability
 * (403 otherwise). 409 `{ message, code }` for `workflow_not_live` (until `merge-main.yml` is on
 * `main`), `not_open`, `not_conflicted` (use Update from main), `on_hold`, `merge_run_live` and
 * `request_id_reused`. Answers `{ run, created }`; the run is `dispatched`, or `failed` with GitHub's
 * reason when GitHub refused the dispatch. Nothing is written to the branch.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Resolving a conflict');
	const number = parseChangeNumber(params.number);
	const body = objectOrNull(await readJson(request, 'The body must be JSON.'));
	try {
		const answer = await startMergeRun({ number, body, person: personOf(user) });
		return json(answer, {
			status: answer.created ? 201 : 200,
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
