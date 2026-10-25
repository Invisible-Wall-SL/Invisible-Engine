import { error, json } from '@sveltejs/kit';
import { ConflictError } from '$lib/server/r2';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { canWriteCustomGlsl, shaderPublishScope } from '$lib/server/shaderScope';
import {
	CustomGlslNotAllowedError,
	ShaderDoesNotCompileError,
	ShaderNotFoundError,
	ShaderTooLargeError,
	publishShader,
} from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * Publish one of the active project's shader graphs to the studio-shared library, which every
 * project's set takes in. Needs the `shaderPublish` capability. The graph published is the one
 * saved, and it must compile.
 *
 * A graph holding Custom GLSL also takes `shaderCustomGlsl`: the library reaches every project.
 *
 * Without `replace`, a library graph of that id answers 409 `exists` instead of being replaced;
 * `replace: true` is the publisher's explicit overwrite. The library keeps what a publish replaced.
 *
 * Body: `{ id: <graph id>, projectKey?, replace? }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderPublishScope(locals, cookies);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const rawId = body && typeof body.id === 'string' ? body.id.trim() : '';
	if (!rawId) throw error(400, 'missing id');
	const mismatch = scopeMismatch(body?.projectKey, projectKey);
	if (mismatch) return mismatch;
	try {
		const { id, etag } = await publishShader(
			clientKey,
			projectKey,
			rawId,
			body?.replace === true,
			await canWriteCustomGlsl(locals),
		);
		return json({ ok: true, id, etag });
	} catch (e) {
		if (e instanceof CustomGlslNotAllowedError) {
			return json({ ok: false, error: 'custom-glsl', message: e.message }, { status: 403 });
		}
		if (e instanceof ShaderNotFoundError) {
			return json({ ok: false, error: 'not-found', message: e.message }, { status: 404 });
		}
		if (e instanceof ShaderDoesNotCompileError) {
			return json(
				{ ok: false, error: 'does-not-compile', message: e.message, errors: e.errors },
				{ status: 400 },
			);
		}
		if (e instanceof ShaderTooLargeError) {
			return json({ ok: false, error: 'too-large', message: e.message }, { status: 413 });
		}
		if (!(e instanceof ConflictError)) throw e;
		return json(
			{
				ok: false,
				error: 'exists',
				message: 'The studio library already has a shader effect of this id.',
			},
			{ status: 409 },
		);
	}
};
