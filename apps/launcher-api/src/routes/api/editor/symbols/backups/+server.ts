import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { symbolsDocBackupTarget } from '$lib/server/projectPaths';
import { requireSymbolsAccess } from '$lib/server/symbolsAccess';
import { saveSymbolsDoc } from '$lib/server/symbolsStorage';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for the Invisible Symbols State Machine doc — LIST the rolling backups of
 * `symbols/symbols.json` (`docBackups.ts`) and RESTORE one. Gated and scoped exactly like
 * `/api/editor/symbols`: `requireSymbolsAccess`, then `requireProjectScope` on `?project=`, which
 * 403s a project the caller cannot reach.
 */

/** `?project=<key>` → newest-first `{ id, savedAt, size }` for its preserved symbols docs. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireSymbolsAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = symbolsDocBackupTarget(clientKey, projectKey);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * `?project=<key>`, body `{ id, baseEtag: string | null }` (or `force: true` in place of
 * `baseEtag`): restore a backup over the live doc through `saveSymbolsDoc` with `'always'`, which
 * re-validates it against today's schema and keeps its CAS — see `docBackupRoutes.ts`.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireSymbolsAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = symbolsDocBackupTarget(clientKey, projectKey);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	const restored = await readBackupForRestore(target, id);

	try {
		const { doc, etag } = await saveSymbolsDoc(clientKey, projectKey, restored, baseEtag, 'always');
		return json({ ok: true, id, etag, doc });
	} catch (e) {
		if (e instanceof ZodError) {
			throw error(422, 'That backup is not a valid symbols document and cannot be restored.');
		}
		return restoreWriteFailed(e, 'these symbols');
	}
};
