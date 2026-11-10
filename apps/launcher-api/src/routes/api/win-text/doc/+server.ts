import { error, json } from '@sveltejs/kit';
import { requireDeployToken } from '$lib/server/deployToken';
import { loadWinTextDoc } from '$lib/server/winTextStorage';
import { clientKeyOf, projectParam } from '$lib/server/projectLookup';
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
	await requireDeployToken(url, 'Win-text export is not configured.');

	const projectKey = projectParam(url);
	const clientKey = await clientKeyOf(projectKey);

	try {
		const doc = await loadWinTextDoc(clientKey, projectKey);
		return json({ clientKey, projectKey, doc });
	} catch {
		throw error(502, 'Failed to load the win-text document.');
	}
};
