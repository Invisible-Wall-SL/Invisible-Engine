import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { exportProjectSounds } from '$lib/server/soundExport';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's sound library (Invisible Sound output) into
 * `deploy/sounds/` so the game's asset pull picks it up (see `$lib/server/soundExport.ts`). Called
 * by `bake-editor-doc.mjs` right before the deploy mirror runs, gated by the same shared read token
 * as `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`) — a build runner has the token, no launcher
 * session. Idempotent; safe to re-run per build.
 *
 * Note this is the DEPLOY-TOKEN gate, deliberately not the `sound` tool entitlement that
 * `/api/sounds*` uses: a build runner is not a logged-in author.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Sound export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const index = await exportProjectSounds(clientKey, projectKey);
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-sounds failed:', e);
		throw error(502, 'Failed to export the project sounds.');
	}
};
