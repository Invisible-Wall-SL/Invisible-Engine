import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { mergeRunsOfChange } from '$lib/server/pipelineMergeRuns';
import type { RequestHandler } from './$types';

/**
 * A change's Resolve conflict state for its detail (ADR-0015 §5): whether GitHub has an active
 * `merge-main.yml` (until then the page shows no Resolve button), the newest merge run with its
 * proposal, the newest accepted one, and for a proposal waiting how far `main` has moved since it.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	await requirePipelineAccess(locals);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await mergeRunsOfChange(parseChangeNumber(params.number)), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
