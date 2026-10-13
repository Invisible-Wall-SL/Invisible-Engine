import { error, json } from '@sveltejs/kit';
import { assertReach, cinematicGate } from '$lib/server/cinematicAccess';
import { deleteCinematic, loadCinematic } from '$lib/server/cinematicStorage';
import { scopeMismatch } from '$lib/server/scopeGuard';
import type { RequestHandler } from './$types';

/**
 * Delete one cinematic from the active project. The client confirms first. Scene Editor-only
 * callers may delete a screen or component timeline and nothing else, so the stored doc is read
 * first.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, access } = await cinematicGate(locals, cookies);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const id = body && typeof body.id === 'string' ? body.id : '';
	if (!id) throw error(400, 'missing id');
	const mismatch = scopeMismatch(body?.projectKey, projectKey);
	if (mismatch) return mismatch;
	if (access !== 'full') {
		const stored = await loadCinematic(clientKey, projectKey, id);
		if (stored.etag !== null) assertReach(access, stored.doc);
		// KNOWN WINDOW: the delete below is unconditional (`deleteObject` takes no If-Match), so a
		// Rigger cinematic written under this id between the read above and the delete is deleted.
		// It needs a Rigger user to reuse a screen timeline's id within that request; the save path
		// has no such window (it writes under the checked etag).
	}

	await deleteCinematic(clientKey, projectKey, id);
	return json({ ok: true, id });
};
