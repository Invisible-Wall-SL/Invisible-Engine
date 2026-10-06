import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineAccess } from '$lib/server/pipelineAccess';
import { listAgents } from '$lib/server/pipelineAgents';
import type { RequestHandler } from './$types';

/**
 * The Agents tab of Invisible Pipeline Changes (ADR-0007, PLAN 5.4): every runtime-agent
 * definition on `main`, with its model, effort, tools, last change and open agent-definition
 * changes. Session-gated on the `pipelineChanges` tool, like the Changes tab.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requirePipelineAccess(locals);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await listAgents(), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
