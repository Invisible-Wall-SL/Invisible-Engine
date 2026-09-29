import { error, json } from '@sveltejs/kit';
import { saveComponentDefaults } from '$lib/server/componentDefaultsStorage';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { requireEditorAccess } from '$lib/server/editorAccess';
import { componentDefaultsBackupTarget, type DocBackupTarget } from '$lib/server/projectPaths';
import { requireOptionalProjectKey } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for ONE component's per-project defaults sidecar — LIST its rolling backups
 * (`docBackups.ts`) and RESTORE one. `?project=&component=`: the project is resolved and
 * access-checked by `requireOptionalProjectKey` exactly like `/api/editor/component-defaults`,
 * and the component id only ever selects a folder under that project's own backup prefix (it is
 * slugged like the sidecar key, so it cannot name anything outside it).
 */
function componentTarget(
	projectKey: string | undefined,
	url: URL,
): { projectKey: string; componentId: string; target: DocBackupTarget } {
	if (!projectKey) throw error(400, 'missing project');
	const componentId = url.searchParams.get('component') ?? '';
	if (!componentId) throw error(400, 'missing component');
	return {
		projectKey,
		componentId,
		target: componentDefaultsBackupTarget(projectKey, componentId),
	};
}

/** Newest-first `{ id, savedAt, size }` for the component's preserved defaults. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireEditorAccess(locals);
	const { projectKey, target } = componentTarget(
		await requireOptionalProjectKey(user, url.searchParams.get('project')),
		url,
	);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * Restore a backup over the live sidecar. Body: `{ id, baseEtag: string | null }` (or
 * `{ id, force: true }`). Goes through `saveComponentDefaults` with `'always'`, so it keeps the
 * ETag CAS (a stale tab answers 409) and backs up what it replaces. The stored envelope is
 * `{ id, params }`; only `params` is restored, under the component the REQUEST names.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireEditorAccess(locals);
	const { projectKey, componentId, target } = componentTarget(
		await requireOptionalProjectKey(user, url.searchParams.get('project')),
		url,
	);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	const restored = await readBackupForRestore(target, id);
	const params = isRecord(restored) && isRecord(restored.params) ? restored.params : null;
	if (!params)
		throw error(422, 'That backup is not a component-defaults file and cannot be restored.');

	try {
		const { etag } = await saveComponentDefaults(
			projectKey,
			componentId,
			params,
			baseEtag,
			'always',
		);
		return json({ ok: true, id, etag, params });
	} catch (e) {
		return restoreWriteFailed(e, 'these component defaults');
	}
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
