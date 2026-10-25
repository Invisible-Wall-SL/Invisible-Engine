import { error, json } from '@sveltejs/kit';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { shaderDocBackupTarget, shaderSlug } from '$lib/server/projectPaths';
import { scopeMismatch } from '$lib/server/scopeGuard';
import { canWriteCustomGlsl, shaderReadScope, shaderWriteScope } from '$lib/server/shaderScope';
import {
	CustomGlslNotAllowedError,
	ShaderTooLargeError,
	saveShader,
} from '$lib/server/shaderStorage';
import type { RequestHandler } from './$types';

/**
 * Version history for ONE of the active project's shader graphs: LIST its rolling backups
 * (`docBackups.ts`) and RESTORE one. `?graph=<id>` only ever selects a folder under the project's
 * own backup prefix (it is slugged like the graph's key).
 */
function graphOf(url: URL): string {
	const graph = url.searchParams.get('graph')?.trim() ?? '';
	if (!graph) throw error(400, 'missing graph');
	return shaderSlug(graph);
}

/** Newest-first `{ id, savedAt, size }` for the graph's preserved versions. */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderReadScope(locals, cookies);
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;
	const graph = graphOf(url);
	return json({
		ok: true,
		graph,
		backups: await listBackups(shaderDocBackupTarget(clientKey, projectKey, graph)),
	});
};

/**
 * Restore a backup over the live graph. Body: `{ id, baseEtag: string | null }` (or
 * `{ id, force: true }`). Goes through the graph's save with `'always'`, so it keeps the ETag CAS (a
 * stale tab answers 409) and backs up what it replaces. The backup is saved under the graph the
 * request names, whatever id it carries. A version whose Custom GLSL differs from the live graph's
 * takes `shaderCustomGlsl` to restore, as a save does.
 */
export const POST: RequestHandler = async ({ request, url, locals, cookies }) => {
	const { clientKey, projectKey } = await shaderWriteScope(locals, cookies);
	const mismatch = scopeMismatch(url.searchParams.get('projectKey') ?? undefined, projectKey);
	if (mismatch) return mismatch;
	const graph = graphOf(url);
	const target = shaderDocBackupTarget(clientKey, projectKey, graph);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	const restored = await readBackupForRestore(target, id);
	if (!restored || typeof restored !== 'object' || Array.isArray(restored))
		throw error(422, 'That backup is not a shader graph and cannot be restored.');
	try {
		const { doc, etag } = await saveShader(
			clientKey,
			projectKey,
			{ ...restored, id: graph },
			baseEtag,
			'always',
			await canWriteCustomGlsl(locals),
		);
		return json({ ok: true, id, etag, doc });
	} catch (e) {
		if (e instanceof CustomGlslNotAllowedError) throw error(403, e.message);
		if (e instanceof ShaderTooLargeError) throw error(422, e.message);
		return restoreWriteFailed(e, 'this shader graph');
	}
};
