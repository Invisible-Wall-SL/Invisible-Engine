import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { objectOrNull, readJson } from '$lib/server/http';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { parseChangeNumber } from '$lib/server/pipelineChanges';
import { HOLD_NOTE_MAX, putOnHold } from '$lib/server/pipelineHold';
import type { RequestHandler } from './$types';

/**
 * Put a change on hold (ADR-0015 §7): the label `on-hold` and one App comment naming who and why.
 * Body: `{ note? }`, 500 characters at most. Needs the `pipelineMerge` capability (403 otherwise).
 * 409 `{ message, code }` for `not_open`, `already_on_hold` and `label_missing` (the owner has not
 * made the label). Any other GitHub failure is a 502.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals, 'Putting a change on hold');
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	const { note } = objectOrNull(await readJson(request, 'The body must be JSON.')) ?? {};
	if (note !== undefined && typeof note !== 'string') throw error(400, 'note must be text.');
	if ((note ?? '').length > HOLD_NOTE_MAX) {
		throw error(400, `The note is at most ${HOLD_NOTE_MAX} characters.`);
	}
	try {
		return json(await putOnHold({ number, note: note ?? '', user }), {
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
