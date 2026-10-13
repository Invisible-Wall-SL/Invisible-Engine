import { json } from '@sveltejs/kit';
import { listCinematics } from '$lib/server/cinematicStorage';
import { cinematicGate, isScreenHosted } from '$lib/server/cinematicAccess';
import type { RequestHandler } from './$types';

/**
 * Every cinematic in the session's active project. `rigger` sees them all (Cinematic mode lives
 * inside `/rigger`); `editor` alone sees only the screen-hosted timelines its Animate mode edits
 * (`cinematicAccess.ts`).
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey, access } = await cinematicGate(locals, cookies);
	const all = await listCinematics(clientKey, projectKey);
	const cinematics = access === 'full' ? all : all.filter((row) => isScreenHosted(row));
	return json({ ok: true, projectKey, cinematics });
};
