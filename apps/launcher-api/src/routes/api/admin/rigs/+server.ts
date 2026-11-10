import { error, json } from '@sveltejs/kit';
import { requireAdminPanel } from '$lib/server/admin';
import { listPromotableBundles } from '$lib/server/sharedRigPromote';
import { clientKeyOf } from '$lib/server/projectLookup';
import type { RequestHandler } from './$types';

/**
 * `GET /api/admin/rigs?project=<key>` — the rig bundles in one project that are listed in
 * its `skeletons.json`, i.e. the ones that can be promoted into `_shared/spines/`.
 *
 * Lazy rather than folded into the `/admin` page load on purpose: resolving this for every
 * project would put one R2 read per project on EVERY admin page view, including the tabs that
 * have nothing to do with rigs. The picker asks only for the project the admin selects.
 *
 * Admin-gated like the page itself, but answers 401/403 rather than redirecting — a fetch that
 * follows a redirect to `/login` gets HTML and a confusing parse error instead of a status.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdminPanel(locals, 'api');

	const projectKey = url.searchParams.get('project')?.trim();
	if (!projectKey) throw error(400, 'missing ?project=');

	const clientKey = await clientKeyOf(projectKey);
	return json({ projectKey, bundles: await listPromotableBundles(clientKey, projectKey) });
};
