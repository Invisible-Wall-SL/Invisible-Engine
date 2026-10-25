import { error, json } from '@sveltejs/kit';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { shaderPublishScope } from '$lib/server/shaderScope';
import { unpublishShader } from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * Remove a graph from the studio-shared library. Needs the `shaderPublish` capability. A project
 * with its own graph of that id keeps it; one that only placed the library's ships nothing for it
 * from its next Publish, which names those entries. The library keeps the removed version.
 *
 * Body: `{ id: <graph id>, projectKey? }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { projectKey } = await shaderPublishScope(locals, cookies);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const rawId = body && typeof body.id === 'string' ? body.id.trim() : '';
	if (!rawId) throw error(400, 'missing id');
	const mismatch = scopeMismatch(body?.projectKey, projectKey);
	if (mismatch) return mismatch;
	const { id } = await unpublishShader(rawId);
	return json({ ok: true, id });
};
