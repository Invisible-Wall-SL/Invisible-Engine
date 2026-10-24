import { json } from '@sveltejs/kit';
import { projectMismatch, shaderReadScope } from '$lib/server/shaderScope';
import { compileProjectShaders } from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * The active project's shader graphs compiled, as its game will ship them: the effects an editor
 * registers with `setCustomElementFx` so its pickers list them and its previews play them, and the
 * graphs left out because they do not compile.
 *
 * `GET /api/shaders/effects[?project=<key>]`
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderReadScope(locals, cookies);
	const mismatch = projectMismatch(url.searchParams.get('project'), projectKey);
	if (mismatch) return mismatch;
	return json({ ok: true, ...(await compileProjectShaders(clientKey, projectKey)) });
};
