import { error, json } from '@sveltejs/kit';
import { deleteClip } from '$lib/server/flipbookStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Delete an Invisible Flipbook clip from R2 — the sibling of `/api/flipbook/save`, mirroring
 * `/api/fx/delete`. Same auth + scope: the shared `gate` resolves the SESSION-bound
 * `(client, project)` and 403s unless the user is entitled to the `flipbook` tool.
 * `deleteClip` removes `<id>.clip.json`, slugging the id exactly as the save path does.
 *
 * Body: `{ id: <clip id> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const rawId = body && typeof body.id === 'string' ? body.id.trim() : '';
	if (!rawId) throw error(400, 'missing id');

	const { id } = await deleteClip(clientKey, projectKey, rawId);
	return json({ ok: true, id });
};
