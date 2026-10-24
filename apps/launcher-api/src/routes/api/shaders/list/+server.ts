import { json } from '@sveltejs/kit';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { shaderReadScope } from '$lib/server/shaderScope';
import { listShaders } from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * The active project's shader graphs: its own and the studio-shared ones it does not override.
 *
 * `GET /api/shaders/list[?projectKey=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderReadScope(locals, cookies);
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;
	return json({ ok: true, shaders: await listShaders(clientKey, projectKey) });
};
