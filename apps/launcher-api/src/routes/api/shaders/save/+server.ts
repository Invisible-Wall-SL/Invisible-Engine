import { error, json } from '@sveltejs/kit';
import { requestedBackupMode } from '$lib/server/docBackupRoutes';
import { ConflictError } from '$lib/server/r2';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { canWriteCustomGlsl, shaderWriteScope } from '$lib/server/shaderScope';
import {
	CustomGlslNotAllowedError,
	ShaderTooLargeError,
	saveShader,
} from '$lib/server/shaderStorage';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Save a shader graph to the active project, under its slugged id. A graph is saved while it is
 * being built, so one that does not compile is still saved; the export leaves it out of the game
 * until it does.
 *
 * Guarded by `baseEtag` (`docs/design/multi-user-concurrency.md` Phase 1): a stale one answers 409
 * rather than replacing a colleague's save, and `null` asserts the id is free.
 *
 * The bytes it replaces are kept (`/api/shaders/backups` lists and restores them).
 *
 * Adding Custom GLSL, or changing its code or ports, takes `shaderCustomGlsl` (403 `custom-glsl`
 * without it); saving a graph that keeps an admin's Custom GLSL as it was, or removes it, does not.
 *
 * Body: `{ doc: <ShaderGraphDoc>, baseEtag: string | null, projectKey?, force?, backup? }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderWriteScope(locals, cookies);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body.doc !== 'object' || body.doc === null) throw error(400, 'missing doc');
	const mismatch = scopeMismatch(body.projectKey, projectKey);
	if (mismatch) return mismatch;
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { id, doc, etag } = await saveShader(
			clientKey,
			projectKey,
			body.doc,
			baseEtag,
			requestedBackupMode(body),
			await canWriteCustomGlsl(locals),
		);
		return json({ ok: true, id, name: doc.name, etag });
	} catch (e) {
		if (e instanceof CustomGlslNotAllowedError) {
			return json({ ok: false, error: 'custom-glsl', message: e.message }, { status: 403 });
		}
		if (e instanceof ShaderTooLargeError) {
			return json({ ok: false, error: 'too-large', message: e.message }, { status: 413 });
		}
		if (!(e instanceof ConflictError)) throw e;
		return json(
			{
				ok: false,
				error: 'conflict',
				message:
					baseEtag === null
						? 'A shader effect with that name already exists in this project. Rename yours, or overwrite it.'
						: 'Someone else saved this shader effect while you were editing. Reload to get their version first.',
			},
			{ status: 409 },
		);
	}
};
