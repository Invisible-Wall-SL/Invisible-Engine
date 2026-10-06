import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { listChanges } from '$lib/server/pipelineChanges';
import type { RequestHandler } from './$types';

/**
 * The Changes tab of Invisible Pipeline Changes (ADR-0007): every open PR into `main` bar Director
 * games, with Dependabot's apart, each with its Testing / Blocked / Ready status. Session-gated on
 * the `pipelineChanges` tool. An unconfigured App is a 503 naming the variable; a GitHub failure a
 * 502 with GitHub's sentence — the page shows either rather than an empty list.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requirePipelineAccess(locals);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await listChanges(), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
