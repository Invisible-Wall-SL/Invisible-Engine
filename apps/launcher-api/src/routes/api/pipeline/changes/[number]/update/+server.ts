import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { objectOrNull, readJson } from '$lib/server/http';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { UpdateRefusal, updateFromMain } from '$lib/server/pipelineUpdate';
import type { RequestHandler } from './$types';

/**
 * Update from main (ADR-0015 §1): GitHub's `update-branch` as the App, pinned to the head the page
 * showed. Body: `{ headSha }`. Needs the `pipelineMerge` capability (403 otherwise). 409
 * `{ error, code, githubMessage, url? }` for: `head_moved`, `conflict`, `workflow_refused` (GitHub
 * will not let the App push a merge that brings in main's workflow change; `url` is the pull
 * request, where GitHub's own Update branch acts as the person), `on_hold`, `up_to_date` and
 * `not_clean`. Any other GitHub failure is a 502. It merges nothing into main.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	await requirePipelineMerge(locals, 'Updating a branch from main');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	const { headSha } = objectOrNull(await readJson(request, 'The body must be JSON.')) ?? {};
	if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
		throw error(400, 'headSha must be the full SHA of the head the page showed.');
	}
	try {
		return json(await updateFromMain({ number, headSha }), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof UpdateRefusal) {
			return json(
				{
					error: err.message,
					code: err.code,
					githubMessage: err.githubMessage,
					...(err.url ? { url: err.url } : {}),
				},
				{ status: err.status },
			);
		}
		if (err instanceof GithubAppError) {
			return json(
				{ error: err.status === 404 ? `There is no change #${number}.` : err.message },
				{ status: err.status === 404 ? 404 : 502 },
			);
		}
		throw err;
	}
};
