import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { requireTool } from '$lib/server/http';
import { winTextDocBackupTarget } from '$lib/server/projectPaths';
import { requireProjectScope } from '$lib/server/toolScope';
import { saveWinTextDoc } from '$lib/server/winTextStorage';
import type { RequestHandler } from './$types';

/**
 * Version history for the Invisible Win Text doc — LIST the rolling backups of
 * `win-text/win-text.json` (`docBackups.ts`) and RESTORE one. Gated and scoped exactly like
 * `/api/win-text`: the `winText` entitlement, then `requireProjectScope` on `?project=`.
 */
const gate = (locals: App.Locals) => requireTool(locals, 'winText', 'Invisible Win Text');

/** `?project=<key>` → newest-first `{ id, savedAt, size }` for its preserved docs. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await gate(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = winTextDocBackupTarget(clientKey, projectKey);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * `?project=<key>`, body `{ id, baseEtag: string | null }` (or `force: true`): restore a backup
 * through `saveWinTextDoc` with `'always'`, which re-validates it and keeps its CAS — see
 * `docBackupRoutes.ts`. A backup today's schema refuses is a 422.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await gate(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = winTextDocBackupTarget(clientKey, projectKey);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	const restored = await readBackupForRestore(target, id);
	try {
		const { doc, etag } = await saveWinTextDoc(
			clientKey,
			projectKey,
			restored,
			baseEtag,
			undefined,
			'always',
			// 'drop': an enum value this build no longer knows loses that one value, not the whole
			// version. 'doc': the backup's own unknown fields travel with it, not the live doc's.
			{ unknownValues: 'drop', unknownFrom: 'doc' },
		);
		return json({ ok: true, id, etag, doc });
	} catch (e) {
		if (e instanceof ZodError) {
			throw error(422, 'That backup is no longer a valid win-text doc and cannot be restored.');
		}
		return restoreWriteFailed(e, 'this win text');
	}
};
