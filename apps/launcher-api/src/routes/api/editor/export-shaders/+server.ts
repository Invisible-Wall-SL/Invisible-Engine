import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { withDeployWrite } from '$lib/server/runtimeBundleCache';
import { exportShaders } from '$lib/server/shaderExport';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: compile the project's shader graphs into `deploy/editor-shaders/` so the bake
 * can embed them as `shaderEffects` (see `$lib/server/shaderExport.ts`). Called by
 * `bake-editor-doc.mjs` beside the other exports, gated by the same deploy token (`?k=`): a build
 * runner has the token, no launcher session. Idempotent; a project with no graphs exports none.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor shader export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const index = await withDeployWrite(projectKey, () => exportShaders(clientKey, projectKey));
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-shaders failed:', e);
		throw error(502, 'Failed to export the project shader effects.');
	}
};
