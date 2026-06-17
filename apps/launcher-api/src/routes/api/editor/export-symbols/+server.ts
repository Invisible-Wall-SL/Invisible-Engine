import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { exportEditorSymbols } from '$lib/server/symbolExport';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the assets a project's Invisible Symbols State
 * Machine doc binds into `deploy/editor-symbols/` so the game's asset pull picks
 * them up (see `$lib/server/symbolExport.ts`). Called by `bake-editor-doc.mjs`
 * right before the deploy mirror runs, gated by the same shared read token as
 * `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`) — a build runner has the token,
 * no launcher session. Idempotent; safe to re-run per build.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor symbols export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const { map, index, highlight, winLine } = await exportEditorSymbols(clientKey, projectKey);
		return json({ clientKey, projectKey, map, index, highlight, winLine });
	} catch (e) {
		console.error('export-symbols failed:', e);
		throw error(502, 'Failed to export the symbol-bound assets.');
	}
};
