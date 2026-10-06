import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { revertMerge } from '$lib/server/pipelineMerge';
import type { RequestHandler } from './$types';

const REASON_MAX = 500;

/**
 * Roll back a change merged from here (ADR-0007 "Rollback"): open a revert pull request of its
 * squash commit, which then goes through the same checks, approvals and merge as any change.
 * Body: `{ reason? }`, written into the pull request (never a commit message). A resend needs no
 * id of its own: the branch is named after the merge, so a second call finds the pull request the
 * first one opened and answers it (200, `existing`); a new one is a 201. A revert that does not
 * apply cleanly is a 409 to do by hand, with nothing written to GitHub. Needs `pipelineMerge`.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Rolling back');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'The body must be JSON.');
	}
	const { reason } = (body ?? {}) as { reason?: unknown };
	if (reason !== undefined && reason !== null && typeof reason !== 'string') {
		throw error(400, 'reason must be a string.');
	}
	const trimmed = typeof reason === 'string' ? reason.trim().slice(0, REASON_MAX) : '';
	try {
		const result = await revertMerge({ number, reason: trimmed || null, user });
		return json(result, {
			status: result.existing ? 200 : 201,
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
