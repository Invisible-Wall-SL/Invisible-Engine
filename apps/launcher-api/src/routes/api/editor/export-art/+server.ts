import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { exportEditorArt } from '$lib/server/editorArtExport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the art a project's layout doc references into
 * `deploy/editor-art/` so the game's asset pull picks it up (see
 * `$lib/server/editorArtExport.ts`). Called by `bake-editor-doc.mjs` right
 * before the deploy mirror runs, gated by the same shared read token as
 * `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`) — a build runner has the
 * token, no launcher session. Idempotent; safe to re-run per build.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = ENV.EDITOR_DOC_SECRET;
	if (!secret) throw error(503, 'Editor art export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const index = await exportEditorArt(clientKey, projectKey);
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-art failed:', e);
		throw error(502, 'Failed to export the layout-referenced art.');
	}
};
