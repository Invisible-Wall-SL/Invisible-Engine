import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { loadDoc } from '$lib/server/editorStorage';
import { listProjectAssets } from '$lib/server/projectAssets';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	const [doc, assets] = await Promise.all([
		loadDoc(clientKey, projectKey),
		listProjectAssets(clientKey, projectKey),
	]);

	return { clientKey, projectKey, doc, assets };
};
