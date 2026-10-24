import { error, json } from '@sveltejs/kit';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { shaderWriteScope } from '$lib/server/shaderScope';
import { deleteShader } from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * Delete one of the active project's shader graphs. The studio-shared library is never touched,
 * so a shared graph the project overrode plays again in its place. An entry still naming the
 * effect keeps its place and plays nothing until a graph of that id exists again.
 *
 * Body: `{ id: <graph id>, projectKey? }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderWriteScope(locals, cookies);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const rawId = body && typeof body.id === 'string' ? body.id.trim() : '';
	if (!rawId) throw error(400, 'missing id');
	const mismatch = scopeMismatch(body?.projectKey, projectKey);
	if (mismatch) return mismatch;
	const { id } = await deleteShader(clientKey, projectKey, rawId);
	return json({ ok: true, id });
};
