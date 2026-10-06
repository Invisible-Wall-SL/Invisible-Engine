import { error, json } from '@sveltejs/kit';
import { githubApp, GithubAppError } from '$lib/server/githubApp';
import { requirePipelineMerge } from '$lib/server/pipelineAccess';
import { approveDiff, parseChangeNumber } from '$lib/server/pipelineChanges';
import type { RequestHandler } from './$types';

const NOTE_MAX = 500;

/**
 * Approve one changed screen of a change (ADR-0007 "Diff approval"). Body: `{ diffId, note? }`,
 * where `diffId` is the screen's id from the current-games report — it embeds the head SHA, so an
 * id from an older head is refused (409) and a new push starts every approval over. Needs the
 * `pipelineMerge` capability (403 otherwise). When this approval completes the set, the launcher
 * posts `success` to `current-games` on that SHA, naming the approver.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const user = await requirePipelineMerge(locals);
	const number = parseChangeNumber(params.number);
	const missing = githubApp.missing();
	if (missing) return json({ error: missing }, { status: 503 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'The body must be JSON.');
	}
	const { diffId, note } = (body ?? {}) as { diffId?: unknown; note?: unknown };
	if (typeof diffId !== 'string' || !diffId) throw error(400, 'diffId is required.');
	if (note !== undefined && note !== null && typeof note !== 'string') {
		throw error(400, 'note must be a string.');
	}
	const trimmedNote = typeof note === 'string' ? note.trim().slice(0, NOTE_MAX) : '';
	try {
		const result = await approveDiff({ number, diffId, note: trimmedNote || null, user });
		return json(result, { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GithubAppError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
