import { error, json } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, roleHasCapability } from '$lib/roles';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { listPromotableBundles } from '$lib/server/sharedSpinePromote';
import type { RequestHandler } from './$types';

/**
 * `GET /api/admin/spines?project=<key>` — the spine bundles in one project that are listed in
 * its `skeletons.json`, i.e. the ones that can be promoted into `_shared/spines/`.
 *
 * Lazy rather than folded into the `/admin` page load on purpose: resolving this for every
 * project would put one R2 read per project on EVERY admin page view, including the tabs that
 * have nothing to do with spines. The picker asks only for the project the admin selects.
 *
 * Admin-gated like the page itself, but answers 401/403 rather than redirecting — a fetch that
 * follows a redirect to `/login` gets HTML and a confusing parse error instead of a status.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	if (!roleHasCapability(locals.user.role, ADMIN_PANEL_CAPABILITY, roleOverrides)) {
		throw error(403, 'Admins only.');
	}

	const projectKey = url.searchParams.get('project')?.trim();
	if (!projectKey) throw error(400, 'missing ?project=');

	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return json({ projectKey, bundles: await listPromotableBundles(clientKey, projectKey) });
};
