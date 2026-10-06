import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { openAgentChange, parseAgentName } from '$lib/server/pipelineAgents';
import type { RequestHandler } from './$types';

/**
 * Submit an edited definition as a pipeline change (ADR-0007 "Agents tab"). Body:
 * `{ requestId, baseSha, text, why }` — `requestId` replays to the same change, `baseSha` is the
 * blob the editor loaded (409 when main's file moved on), `why` the one-line reason the PR title
 * carries. Needs `pipelineMerge` (403 otherwise). Through the App: a branch `agents/<name>-…` off
 * main, one commit changing only that file, a PR labelled `agent-definition`. Never main itself.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Editing an agent definition');
	const name = parseAgentName(params.name);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'The body must be JSON.');
	}
	const { requestId, baseSha, text, why } = (body ?? {}) as Record<string, unknown>;
	if (typeof requestId !== 'string') throw error(400, 'requestId is required.');
	if (typeof baseSha !== 'string' || !/^[0-9a-f]{40}$/.test(baseSha)) {
		throw error(400, 'baseSha is the blob id of the definition that was opened.');
	}
	if (typeof text !== 'string') throw error(400, 'text is required.');
	if (typeof why !== 'string') throw error(400, 'why is required.');
	try {
		const result = await openAgentChange({ name, requestId, baseSha, text, why, user });
		return json(result, { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
