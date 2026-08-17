import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportCinematics, loadAuthoredCinematics } from '$lib/server/cinematicExport';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's Invisible Cinematic documents into
 * `deploy/cinematics/` so the offline bake can embed them (`$lib/server/cinematicExport.ts`).
 * The online runtime bundle already does this via `ensureDeployExports`; this is the desktop
 * bake's equivalent entry point, mirroring `/api/editor/export-flow` exactly — same shared
 * deploy token (`?k=`), because a build runner has the token but no launcher session.
 *
 * A cinematic carries no binary assets of its own, so this is a JSON copy. Idempotent; safe to
 * re-run per build. A project with no cinematics returns nothing (parity).
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Cinematic export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const docs = await loadAuthoredCinematics(clientKey, projectKey);
		const index = await exportCinematics(clientKey, projectKey, docs);
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-cinematics failed:', e);
		throw error(502, 'Failed to export the project cinematics.');
	}
};
