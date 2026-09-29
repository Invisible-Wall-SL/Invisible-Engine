import { json } from '@sveltejs/kit';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { requireGameConfigAccess } from '$lib/server/gameConfigAccess';
import { InvalidGameConfigError, saveGameConfigDoc } from '$lib/server/gameConfigStorage';
import { gameConfigDocBackupTarget } from '$lib/server/projectPaths';
import { invalidateRuntimeBundle } from '$lib/server/runtimeBundleCache';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for the Invisible Game Config doc — LIST the rolling backups of
 * `config/config.json` (`docBackups.ts`) and RESTORE one. Gated and scoped exactly like
 * `/api/game-config`: `requireGameConfigAccess`, then `requireProjectScope` on `?project=`, which
 * 403s a project the caller cannot reach.
 */

/** `?project=<key>` → newest-first `{ id, savedAt, size }` for its preserved configs. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireGameConfigAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = gameConfigDocBackupTarget(clientKey, projectKey);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * `?project=<key>`, body `{ id, baseEtag: string | null }` (or `force: true` in place of
 * `baseEtag`): restore a backup over the live config through `saveGameConfigDoc` with `'always'`,
 * which re-runs today's canonicalizer + ship gate and keeps its CAS — see `docBackupRoutes.ts`.
 * A backup that no longer passes the gate is a 422 carrying the same issue list a save would.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireGameConfigAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = gameConfigDocBackupTarget(clientKey, projectKey);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	const restored = await readBackupForRestore(target, id);

	try {
		const { doc, etag, warnings } = await saveGameConfigDoc(
			clientKey,
			projectKey,
			restored,
			baseEtag,
			'always',
		);
		// Same reason as the save route: `config` feeds `assembleRuntimeBundle`, so a live game
		// should pick the restored config up on its next reload rather than after the cache TTL.
		invalidateRuntimeBundle(projectKey);
		return json({ ok: true, id, etag, doc, warnings });
	} catch (e) {
		if (e instanceof InvalidGameConfigError) {
			return json(
				{
					ok: false,
					error: 'invalid',
					message: 'That backup is no longer a usable config, so it was not restored.',
					issues: e.issues,
				},
				{ status: 422 },
			);
		}
		return restoreWriteFailed(e, 'this config');
	}
};
