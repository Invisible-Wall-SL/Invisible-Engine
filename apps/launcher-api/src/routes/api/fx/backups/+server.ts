import { error, json } from '@sveltejs/kit';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { restoreEffect } from '$lib/server/fxStorage';
import { fxDocBackupTarget, r2Slug } from '$lib/server/projectPaths';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for ONE Invisible FX effect: LIST its rolling backups (`docBackups.ts`) and
 * RESTORE one. Same gate + SESSION-bound project as `/api/fx/save`; `?effect=<id>` only ever
 * selects a folder under the project's own backup prefix (it is slugged like the effect's key).
 */
const GATE = {
	tool: 'fx',
	forbiddenMessage: 'Your role does not have access to Invisible FX.',
} as const;

function effectOf(url: URL): string {
	const effect = url.searchParams.get('effect')?.trim() ?? '';
	if (!effect) throw error(400, 'missing effect');
	return r2Slug(effect);
}

/**
 * Newest-first `{ id, savedAt, size }` for the effect's preserved versions. `?projectKey=` is the
 * project the TAB loaded: a session that has since moved on would list another project's effect.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const tabProject = url.searchParams.get('projectKey');
	if (tabProject !== null && tabProject !== projectKey)
		return scopeMismatch(tabProject, projectKey);
	const effect = effectOf(url);
	const target = fxDocBackupTarget(clientKey, projectKey, effect);
	return json({ ok: true, projectKey, effect, backups: await listBackups(target) });
};

/**
 * Restore a backup over the live effect. Body: `{ id, baseEtag: string | null, projectKey }` (or
 * `force: true` in place of `baseEtag`). Goes through `saveEffect` with `'always'`, keeping its
 * CAS — see `docBackupRoutes.ts`. The version is saved under the effect the request names,
 * whatever id it carries, and the live sidecar is kept.
 */
export const POST: RequestHandler = async ({ request, url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = await restoreBody(request);
	// The save route's SCOPE GUARD: never bypassable by `force`.
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey) {
		return scopeMismatch(body.projectKey, projectKey);
	}
	const effect = effectOf(url);
	const target = fxDocBackupTarget(clientKey, projectKey, effect);
	const { id, baseEtag } = restoreArgs(body, target);
	const restored = await readBackupForRestore(target, id);
	if (!restored || typeof restored !== 'object' || Array.isArray(restored)) {
		throw error(422, 'That backup is not an effect and cannot be restored.');
	}
	try {
		const { doc, etag } = await restoreEffect(
			clientKey,
			projectKey,
			effect,
			restored as Record<string, unknown>,
			baseEtag,
		);
		return json({ ok: true, id, etag, doc });
	} catch (e) {
		return restoreWriteFailed(e, 'this effect');
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
