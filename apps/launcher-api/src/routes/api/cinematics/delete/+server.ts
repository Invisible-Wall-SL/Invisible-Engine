import { error, json } from '@sveltejs/kit';
import { assertReach, cinematicGate } from '$lib/server/cinematicAccess';
import { deleteCinematic, loadCinematic } from '$lib/server/cinematicStorage';
import type { RequestHandler } from './$types';

/**
 * Delete one cinematic from the active project. The client confirms first. Scene Editor-only
 * callers may delete a screen timeline and nothing else, so the stored doc is read first.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, access } = await cinematicGate(locals, cookies);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const id = body && typeof body.id === 'string' ? body.id : '';
	if (!id) throw error(400, 'missing id');
	if (access !== 'full') {
		const stored = await loadCinematic(clientKey, projectKey, id);
		if (stored.etag !== null) assertReach(access, stored.doc);
	}

	await deleteCinematic(clientKey, projectKey, id);
	return json({ ok: true, id });
};
