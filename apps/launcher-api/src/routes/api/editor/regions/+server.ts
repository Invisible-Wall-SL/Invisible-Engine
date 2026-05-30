import { error, json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { loadRegionSet } from '$lib/server/editorRegions';
import { UNASSIGNED_CLIENT, projectPrefix } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/** Same allow-set as `/api/editor/asset` — keep the two in lockstep. */
function allowedPrefixes(clientKey: string, projectKey: string): string[] {
	const atlas = projectPrefix('atlas_maker', clientKey, projectKey);
	const sheet = projectPrefix('sheet_maker', clientKey, projectKey);
	const spines = projectPrefix('spines', clientKey, projectKey);
	return [`${atlas}/`, `${sheet}/`, `${spines}/`, 'spines/_shared/'];
}

/**
 * List the individual regions defined by a sheet/atlas manifest so the editor
 * can show each frame as its own draggable thumbnail and render dropped region
 * sprites. The `sheet` query param is the library item's `key` (a `sheet`
 * output prefix or an `atlas-manifest` JSON key).
 *
 * Defensive by design: a missing/garbage manifest returns `{ regions: [] }`,
 * never a 500.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Editor.');
	}

	const sheet = url.searchParams.get('sheet');
	if (!sheet) throw error(400, 'missing sheet');
	if (sheet.includes('..') || sheet.startsWith('/')) throw error(403, 'forbidden');

	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	const allowed = allowedPrefixes(clientKey, projectKey);
	if (!allowed.some((p) => sheet.startsWith(p))) throw error(403, 'forbidden');

	const set = await loadRegionSet(sheet, clientKey, projectKey);

	// Never hand back a page key the asset streamer would reject — drop it so the
	// client falls back to per-region placeholders instead of a broken <img>.
	const pageKey = set.pageKey && allowed.some((p) => set.pageKey.startsWith(p)) ? set.pageKey : '';

	return json({
		assetKey: set.assetKey,
		pageKey,
		pageWidth: set.pageWidth,
		pageHeight: set.pageHeight,
		regions: set.regions,
	});
};
