import { json } from '@sveltejs/kit';
import { listCinematics } from '$lib/server/cinematicStorage';
import { cinematicGate, isEditorHosted } from '$lib/server/cinematicAccess';
import { scopeMismatch } from '$lib/server/scopeGuard';
import type { RequestHandler } from './$types';

/**
 * Every cinematic in the session's active project. `rigger` sees them all (Cinematic mode lives
 * inside `/rigger`); `editor` alone sees only the screen- and component-hosted timelines its
 * Animate mode edits (`cinematicAccess.ts`).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey, access } = await cinematicGate(locals, cookies);
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;
	const all = await listCinematics(clientKey, projectKey);
	const cinematics = access === 'full' ? all : all.filter((row) => isEditorHosted(row));
	return json({ ok: true, projectKey, cinematics });
};
