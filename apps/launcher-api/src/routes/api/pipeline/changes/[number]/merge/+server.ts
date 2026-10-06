import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { mergeChange, parseRequestId } from '$lib/server/pipelineMerge';
import type { RequestHandler } from './$types';

/**
 * Merge a Ready change into `main` (ADR-0007 "Merge"): GitHub's squash merge, its `sha` pinned to
 * the head. Body: `{ headSha, requestId }` — `headSha` is the head the user's confirmation showed,
 * so a head that moved since is a 409 and never a merge; `requestId` is the click's own id, which
 * its retry resends, so a resend answers the merge already made (`already`) rather than making or
 * refusing another. Needs the `pipelineMerge` capability (403 otherwise). GitHub's own refusal —
 * 405 branch protection, 409 the head moved under the pinned SHA, 422 — keeps its status and its
 * sentence; any other GitHub failure is a 502.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Merging');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'The body must be JSON.');
	}
	const { headSha, requestId } = (body ?? {}) as { headSha?: unknown; requestId?: unknown };
	if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
		throw error(400, 'headSha must be the full SHA of the head the merge was confirmed on.');
	}
	const id = parseRequestId(requestId);
	try {
		const result = await mergeChange({ number, headSha, requestId: id, user });
		return json(result, { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
