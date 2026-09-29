import { error, json } from '@sveltejs/kit';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { isFlowV2Doc, saveFlowV2Doc } from '$lib/server/flowV2Storage';
import { flowV2DocBackupTarget } from '$lib/server/projectPaths';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for the Invisible Flow **v2** doc — LIST the rolling backups of
 * `editor/flow-v2.json` (`docBackups.ts`) and RESTORE one. Same gate + SESSION-bound project as
 * `/api/flow-v2/save` (`/flow-v2` has no registry entry of its own, so it reuses v1 Flow's
 * entitlement).
 */
const GATE = {
	tool: 'flow',
	forbiddenMessage: 'Your role does not have access to Invisible Flow.',
} as const;

/**
 * Newest-first `{ id, savedAt, size }` for the project's preserved flow docs. `?project=` is the
 * project the TAB loaded: when the session has since moved to another project, listing the
 * session's history would offer versions of a flow this tab is not showing, so it is refused the
 * same way the restore is.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const tabProject = url.searchParams.get('project');
	if (tabProject !== null && tabProject !== projectKey)
		return scopeMismatch(tabProject, projectKey);
	const target = flowV2DocBackupTarget(clientKey, projectKey);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * Restore a backup over the live flow. Body: `{ id, baseEtag: string | null, projectKey }` (or
 * `force: true` in place of `baseEtag`). Goes through `saveFlowV2Doc` with `'always'`, keeping its
 * CAS — see `docBackupRoutes.ts`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = await restoreBody(request);

	// The save route's SCOPE GUARD, for the same reason: the project comes from the SESSION, so a
	// project switch in another tab would otherwise restore this tab's history choice over an
	// unrelated project. Never bypassable by `force`.
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return scopeMismatch(body.projectKey, projectKey);
	}

	const target = flowV2DocBackupTarget(clientKey, projectKey);
	const { id, baseEtag } = restoreArgs(body, target);
	const restored = await readBackupForRestore(target, id);
	if (!isFlowV2Doc(restored)) {
		throw error(422, 'That backup is not a v2 flow and cannot be restored.');
	}

	try {
		const { doc, etag } = await saveFlowV2Doc(clientKey, projectKey, restored, baseEtag, 'always');
		return json({ ok: true, id, etag, doc });
	} catch (e) {
		return restoreWriteFailed(e, 'this flow');
	}
};

function scopeMismatch(tabProject: string, sessionProject: string): Response {
	return json(
		{
			ok: false,
			error: 'scope-mismatch',
			message:
				`This tab is editing "${tabProject}" but your active project is now ` +
				`"${sessionProject}". Reload to continue — its history belongs to another project.`,
		},
		{ status: 409 },
	);
}
