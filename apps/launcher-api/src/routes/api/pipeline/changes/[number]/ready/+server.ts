import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { markReadyForReview } from '$lib/server/pipelineMerge';
import type { RequestHandler } from './$types';

/**
 * Mark a DRAFT change ready for review (ADR-0013 §8), the step a fix run's draft pull request
 * needs before it can merge: GitHub's `markPullRequestReadyForReview` as the App. No body. Needs
 * the `pipelineMerge` capability (403 otherwise), like merging; a change that is not an open
 * draft is a 409, a number GitHub does not know a 404; any other GitHub failure is a 502. It does not merge.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	await requirePipelineMerge(locals, 'Marking a change ready for review');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await markReadyForReview({ number }), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (err) {
		if (err instanceof GithubAppError) {
			return json(
				{ error: err.status === 404 ? `There is no change #${number}.` : err.message },
				{ status: err.status === 404 ? 404 : 502 },
			);
		}
		throw err;
	}
};
