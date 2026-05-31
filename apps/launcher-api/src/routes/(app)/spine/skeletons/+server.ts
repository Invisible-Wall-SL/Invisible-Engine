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

	// Name the resolved prefix so "wrong project" vs "just empty" is unambiguous,
	// and echo the resolved (client, project) so the viewer can show the real
	// active project instead of a hardcoded placeholder.
	const empty = {
		client: clientKey,
		project: projectKey,
		error: `No skeletons synced for spines/${clientKey}/${projectKey} yet.`,
		skeletons: [],
	};
	const hit = await resolveSkeletonsRoot(clientKey, projectKey);
	if (!hit) return json(empty);
	const text = await getObjectText(hit.key);
	if (!text) return json(empty);
	const data = JSON.parse(text);
	return json({
		client: clientKey,
		project: projectKey,
		root: data.prefix ?? hit.root,
		skeletons: data.skeletons ?? [],
	});
};
