import { error, json } from '@sveltejs/kit';
import { loadCinematic } from '$lib/server/cinematicStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Load one cinematic, WITH the ETag its next save must match.
 *
 * The etag is returned even when `doc` is null-because-malformed: an object that exists must be
 * overwritten with `ifMatch`, never created with `ifNoneMatch:'*'` (which would 412 forever and
 * leave a corrupt cinematic permanently unsaveable).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');

	const { doc, etag } = await loadCinematic(clientKey, projectKey, id);
	if (!doc && etag === null) throw error(404, `No cinematic "${id}" in ${projectKey}.`);
	return json({ ok: true, projectKey, doc, etag, malformed: !doc });
};
