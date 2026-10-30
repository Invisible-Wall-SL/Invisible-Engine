import { json } from '@sveltejs/kit';
import { requireDirectorAccess } from '$lib/server/director/access';
import { answering, jsonBody, NO_STORE } from '$lib/server/director/api';
import { promptCaller } from '$lib/server/director/promptAccess';
import { deletePrompt, updatePrompt } from '$lib/server/director/prompts';
import type { RequestHandler } from './$types';

/**
 * `PATCH /api/director/prompts/<id>` changes `{ name?, body?, clientKey?, version }`; moving it to
 * another client needs that client to be one the caller may target. `DELETE …?version=` removes it.
 * Both are conditional on the version the caller read: a stale one is 409 `conflict` and writes
 * nothing. A prompt of a client the caller cannot target is the same 404 as one that is not there.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireDirectorAccess(locals);
	const input = await jsonBody(request);
	return answering(async () => {
		const prompt = await updatePrompt(await promptCaller(user), params.id, {
			name: input.name,
			body: input.body,
			clientKey: input.clientKey,
			version: input.version,
		});
		return json({ prompt }, { headers: NO_STORE });
	});
};

export const DELETE: RequestHandler = async ({ params, url, locals }) => {
	const user = await requireDirectorAccess(locals);
	return answering(async () => {
		await deletePrompt(await promptCaller(user), params.id, url.searchParams.get('version'));
		return json({ ok: true }, { headers: NO_STORE });
	});
};
