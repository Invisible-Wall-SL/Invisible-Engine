import { json } from '@sveltejs/kit';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { normalizeDoc, saveDoc } from '$lib/server/editorStorage';
import { editorDocBackupTarget } from '$lib/server/projectPaths';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for the Scene Editor doc — LIST the rolling backups (`docBackups.ts`) and
 * RESTORE one.
 *
 * Scoped exactly like every other `/api/editor/*` endpoint: the shared
 * `toolScope.gate` helper does auth + the `editor` entitlement + resolves the
 * SESSION-BOUND active project. Session-bound is the right binding here even though the
 * editor page itself resolves `?project=`: the page SYNCS its explicit `?project=` into the
 * session on load (`resolveToolScope` → `setActiveProjectKey`), so by the time this route can
 * be called the two agree — and taking the project from a request param instead would hand a
 * client the ability to name which project's history it restores over.
 */
const GATE = {
	tool: 'editor',
	forbiddenMessage: 'Your role does not have access to Invisible Editor.',
} as const;

/** Newest-first `{ id, savedAt, size }` for the project's preserved editor docs. */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const target = editorDocBackupTarget(clientKey, projectKey);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * Restore a backup over the live doc. Body: `{ id, baseEtag: string | null }` (or
 * `{ id, force: true }`). Goes through `saveDoc` with `'always'`, keeping its CAS — see
 * `docBackupRoutes.ts`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const target = editorDocBackupTarget(clientKey, projectKey);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	// Re-normalize rather than trusting the stored bytes: a backup may predate a doc migration
	// (the `alwaysOnTop` backfill, the parametric-HUD rewrite), and `saveDoc` normalizes anyway
	// — doing it here means a restore of an old doc lands in exactly the shape a save of it
	// would, instead of round-tripping through a shape the editor no longer reads.
	const restored = normalizeDoc(await readBackupForRestore(target, id), projectKey);

	try {
		const { doc, etag } = await saveDoc(clientKey, projectKey, restored, baseEtag, 'always');
		return json({ ok: true, id, etag, updatedAt: doc.updatedAt });
	} catch (e) {
		return restoreWriteFailed(e, 'this project');
	}
};
