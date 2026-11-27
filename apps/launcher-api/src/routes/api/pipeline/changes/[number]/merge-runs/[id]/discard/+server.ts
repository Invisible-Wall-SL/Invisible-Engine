import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { discardMergeRun, personOf } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * Discard a merge run's proposal (ADR-0015 §5), or stop one still working. Needs the `pipelineMerge`
 * capability (403 otherwise). The branch is never touched. 409 `{ message, code }` once the run has
 * ended or no proposal waits.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const user = await requirePipelineMerge(locals, 'Discarding a resolution');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		const run = await discardMergeRun({ number, id: params.id, person: personOf(user) });
		return json({ run }, { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
