import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { loadWinTextDoc } from '$lib/server/winTextStorage';
import type { RequestHandler } from './$types';

/**
 * Read-only export of a project's Invisible Win Text doc for the build-time bake.
 *
 * Same posture as `/api/localization/strings` and `/api/editor/doc`: token-gated (`?k=` vs the
 * deploy token) because the bake has no launcher session. Called by `bake-editor-doc.mjs`,
 * which embeds the result at `bundle.winText`.
 *
 * The doc ships the SOURCE templates; their translations ride the localization bundle (the
 * templates are catalog keys), and the engine resolves template → translation → interpolation
 * at render. See `docs/design/invisible-win-text.md`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Win-text export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const doc = await loadWinTextDoc(clientKey, projectKey);
		return json({ clientKey, projectKey, doc });
	} catch {
		throw error(502, 'Failed to load the win-text document.');
	}
};
