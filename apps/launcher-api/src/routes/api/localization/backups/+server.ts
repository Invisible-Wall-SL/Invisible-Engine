import { error, json } from '@sveltejs/kit';
import {
	readBackupForRestore,
	restoreArgs,
	restoreBody,
	restoreWriteFailed,
} from '$lib/server/docBackupRoutes';
import { listBackups } from '$lib/server/docBackups';
import { requireTool } from '$lib/server/http';
import { normalizeDoc, saveDoc } from '$lib/server/localization';
import { reconcileWithEditor } from '$lib/server/localizationHarvest';
import { harvestProjectSections } from '$lib/server/localizationSections';
import { localizationDocBackupTarget } from '$lib/server/projectPaths';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Version history for the Invisible Localization doc — LIST the rolling backups of
 * `localization/strings.json` (`docBackups.ts`) and RESTORE one. Gated on the `localization`
 * entitlement, then `requireProjectScope` on `?project=` (the project the page loaded).
 */
const gate = (locals: App.Locals) => requireTool(locals, 'localization', 'Invisible Localization');

/** `?project=<key>` → newest-first `{ id, savedAt, size }` for its preserved docs. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await gate(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = localizationDocBackupTarget(clientKey, projectKey);
	return json({ ok: true, projectKey, backups: await listBackups(target) });
};

/**
 * `?project=<key>`, body `{ id, baseEtag: string | null }` (or `force: true`): restore a backup
 * through `saveDoc` with `'always'`, keeping its CAS — see `docBackupRoutes.ts`. Answers the doc
 * the way the page's load does — the stored doc with today's auto-collected rows folded in — plus
 * the `sections` they display under, so the page can swap both in without a reload.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const user = await gate(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const target = localizationDocBackupTarget(clientKey, projectKey);
	const { id, baseEtag } = restoreArgs(await restoreBody(request), target);
	const restored = await readBackupForRestore(target, id);
	if (!restored || typeof restored !== 'object' || Array.isArray(restored)) {
		throw error(422, 'That backup is not a strings doc and cannot be restored.');
	}
	// Harvested BEFORE the write: a read that fails after a restore landed would answer an error
	// for a write that happened, and the tab would keep a stale ETag.
	const sections = await harvestProjectSections(clientKey, projectKey);
	let saved;
	try {
		saved = await saveDoc(
			clientKey,
			projectKey,
			normalizeDoc(restored),
			baseEtag,
			undefined,
			'always',
		);
	} catch (e) {
		return restoreWriteFailed(e, 'these strings');
	}
	const { entries, display } = reconcileWithEditor(saved.doc, sections);
	return json({
		ok: true,
		id,
		etag: saved.etag,
		doc: { ...saved.doc, entries },
		sections: display,
	});
};
