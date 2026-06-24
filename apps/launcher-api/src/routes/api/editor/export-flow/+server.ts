import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportEditorFlow } from '$lib/server/flowExport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's Invisible Flow document into
 * `deploy/flow.json` so the bake can embed it (see `$lib/server/flowExport.ts`).
 * Called by `bake-editor-doc.mjs` right before the deploy mirror runs, gated by
 * the same shared read token as `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`)
 * — a build runner has the token, no launcher session. The FlowDoc carries no
 * binary assets, so this is a single JSON copy + normalize. Idempotent; safe to
 * re-run per build. An un-authored project exports an empty doc (parity, §7).
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor flow export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const index = await exportEditorFlow(clientKey, projectKey);
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-flow failed:', e);
		throw error(502, 'Failed to export the project flow.');
	}
};
