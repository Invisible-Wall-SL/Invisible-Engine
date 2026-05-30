import { json } from '@sveltejs/kit';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getObjectText } from '$lib/server/r2';
import { requireSpineAccess, resolveSkeletonsRoot } from '$lib/server/spine';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	await requireSpineAccess(locals);
	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	const hit = await resolveSkeletonsRoot(clientKey, projectKey);
	if (!hit) return json({ error: 'No skeletons index in R2.', skeletons: [] });
	const text = await getObjectText(hit.key);
	if (!text) return json({ error: 'No skeletons index in R2.', skeletons: [] });
	const data = JSON.parse(text);
	return json({ root: data.prefix ?? hit.root, skeletons: data.skeletons ?? [] });
};
