import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportEditorFlow } from '$lib/server/flowExport';
import { exportEditorFlowV2 } from '$lib/server/flowV2Export';
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
		// v1 flow + v2 flow are both exported here so ONE bake call covers both. The v2
		// pair (`flowV2` / `flowV2Library`) is what a flow-v2 game needs to drive its
		// screens; without it the desktop bake embedded only v1 and a v2-authored game
		// ran inert (static scene-editor placement, no flow). Each export self-gates on
		// "authored", so an un-authored side contributes nothing (parity). Mirrors what
		// the online runtime bundle already assembles (`runtimeBundle.ts`).
		const index = await exportEditorFlow(clientKey, projectKey);
		const indexV2 = await exportEditorFlowV2(clientKey, projectKey);
		return json({ clientKey, projectKey, ...index, ...indexV2 });
	} catch (e) {
		console.error('export-flow failed:', e);
		throw error(502, 'Failed to export the project flow.');
	}
};
