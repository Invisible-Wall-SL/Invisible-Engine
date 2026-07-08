import { error, json } from '@sveltejs/kit';
import { deleteEffect } from '$lib/server/fxStorage';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Delete an Invisible FX effect from R2 — the sibling of `/api/fx/save`. Same auth + scope: the
 * shared `gate` resolves the SESSION-bound `(client, project)` and 403s unless the user is
 * entitled to the `fx` tool. `deleteEffect` removes BOTH the canonical `<id>.fx.json` and its
 * editor-only `<id>.fx.meta.json` sidecar, slugging the id exactly as the save path does.
 *
 * Body: `{ id: <effect id> }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const rawId = body && typeof body.id === 'string' ? body.id.trim() : '';
	if (!rawId) throw error(400, 'missing id');

	const { id } = await deleteEffect(clientKey, projectKey, rawId);
	return json({ ok: true, id });
};
