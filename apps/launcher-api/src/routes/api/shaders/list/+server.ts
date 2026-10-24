import { json } from '@sveltejs/kit';
import { projectMismatch, shaderReadScope } from '$lib/server/shaderScope';
import { listShaders } from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * The active project's shader graphs: its own and the studio-shared ones it does not override.
 *
 * `GET /api/shaders/list[?project=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderReadScope(locals, cookies);
	const mismatch = projectMismatch(url.searchParams.get('project'), projectKey);
	if (mismatch) return mismatch;
	return json({ ok: true, shaders: await listShaders(clientKey, projectKey) });
};
