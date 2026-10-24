import { error, json } from '@sveltejs/kit';
import { projectMismatch, shaderReadScope } from '$lib/server/shaderScope';
import { loadShader } from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * One shader graph and its ETag (the next save's `baseEtag`; `null` when nothing is stored, so
 * that save takes the create path). `shared=1` reads the studio-shared library's graph.
 *
 * `GET /api/shaders/doc?id=<id>[&shared=1][&project=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderReadScope(locals, cookies);
	const mismatch = projectMismatch(url.searchParams.get('project'), projectKey);
	if (mismatch) return mismatch;
	const id = url.searchParams.get('id')?.trim() ?? '';
	if (!id) throw error(400, 'missing id');
	const shared = url.searchParams.get('shared') === '1';
	const { doc, etag, exists } = await loadShader(clientKey, projectKey, id, shared);
	return json({ ok: true, doc, etag, exists, shared });
};
