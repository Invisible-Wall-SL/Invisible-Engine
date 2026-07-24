import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { loadGameConfigDoc } from '$lib/server/gameConfigStorage';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import type { RequestHandler } from './$types';

/**
 * Read-only export of a project's Invisible Game Config doc for the build-time bake.
 *
 * Same posture as `/api/win-text/doc`: token-gated (`?k=` vs the deploy token) because the bake has
 * no launcher session. Called by `bake-editor-doc.mjs`, which embeds the result at `bundle.config`.
 *
 * `doc` is **null** for a project that has never authored one, and the bake must keep it that way:
 * null means the game runs its compiled `game/config.ts`, which is how an un-authored project stays
 * byte-identical. It deliberately does NOT fall back to the per-game-type template default — that
 * default is what the TOOL opens with, so an author adopts it knowingly rather than having it
 * shipped behind their back the day a template changes.
 *
 * See `docs/design/invisible-game-config.md`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Game-config export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const doc = await loadGameConfigDoc(clientKey, projectKey);
		return json({ clientKey, projectKey, doc });
	} catch {
		throw error(502, 'Failed to load the game-config document.');
	}
};
