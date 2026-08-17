import { json } from '@sveltejs/kit';
import { listCinematics } from '$lib/server/cinematicStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Every cinematic in the session's active project. Gated by `rigger` — Cinematic mode lives
 * inside `/rigger`, so it carries the Rigger's entitlement rather than inventing a second one.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	return json({ ok: true, projectKey, cinematics: await listCinematics(clientKey, projectKey) });
};
