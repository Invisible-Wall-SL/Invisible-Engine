import { json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { resumeChange } from '$lib/server/pipelineHold';
import type { RequestHandler } from './$types';

/**
 * Resume a change that is on hold (ADR-0015 §7): the label comes off and the App comments who did
 * it. No body. Needs the `pipelineMerge` capability (403 otherwise); a change not on hold is a 409
 * `not_on_hold`; any other GitHub failure is a 502.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const user = await requirePipelineMerge(locals, 'Resuming a change');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	try {
		return json(await resumeChange({ number, user }), {
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
