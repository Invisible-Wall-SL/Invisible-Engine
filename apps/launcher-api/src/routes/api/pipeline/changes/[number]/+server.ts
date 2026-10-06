import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { getChange, parseChangeNumber } from '$lib/server/pipelineChanges';
import type { RequestHandler } from './$types';

/**
 * One change in full: files, the diff link, its "why", Check 1 (the check runs grouped by
 * workflow) and Check 2 (the current-games report, its changed screens and their approvals).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	await requirePipelineAccess(locals);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await getChange(parseChangeNumber(params.number)), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
