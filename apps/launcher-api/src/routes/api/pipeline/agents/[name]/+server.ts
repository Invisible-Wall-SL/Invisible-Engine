import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { getAgent, parseAgentName } from '$lib/server/pipelineAgents';
import type { RequestHandler } from './$types';

/**
 * One definition in full: the file as `main` holds it, its blob id (the base a submit names),
 * and the rules an edit must meet — the same ones the editor previews and the submit applies.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	await requirePipelineAccess(locals);
	const name = parseAgentName(params.name);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await getAgent(name), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
