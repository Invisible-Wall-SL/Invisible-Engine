import { error, json } from '@sveltejs/kit';
import { deleteCinematic } from '$lib/server/cinematicStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** Delete one cinematic from the active project. The client confirms first. */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const id = body && typeof body.id === 'string' ? body.id : '';
	if (!id) throw error(400, 'missing id');

	await deleteCinematic(clientKey, projectKey, id);
	return json({ ok: true, id });
};
