import { error, fail, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, setActiveProjectKey } from '$lib/server/auth';
import { DEFAULT_PROJECT_KEY, canAccessProject, getOrMintReadToken } from '$lib/server/projects';
import { listGamesForProject } from '$lib/server/games';
import { getInstallPaths, setInstallPath } from '$lib/server/toolInstalls';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	// Reuse the layout's resolved + access-checked active project to scope games.
	const { activeProjectKey } = await parent();
	return {
		installPaths: await getInstallPaths(locals.user.id),
		games: await listGamesForProject(activeProjectKey),
		// The ACTIVE PROJECT's public read token, ridden along on game URLs (`&k=`)
		// so the game can fetch its scenes. Never the shared build/deploy token —
		// that grants read on every project, and this value reaches the page source
		// of every signed-in user regardless of role. Empty for an unknown project.
		gameReadToken: (await getOrMintReadToken(activeProjectKey)) ?? '',
	};
};

export const actions: Actions = {
	saveInstallPath: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');

		const data = await request.formData();
		const toolKey = String(data.get('toolKey') ?? '');
		const installPath = String(data.get('installPath') ?? '');

		if (!toolKey) return fail(400, { error: 'Missing tool.' });
		const roleOverrides = await getRoleOverrides(locals.user.role);
		const overrides = await getToolOverrides(locals.user.id);
		if (!roleHasTool(locals.user.role, toolKey, roleOverrides, overrides)) {
			throw error(403, 'Your role does not have access to that tool.');
		}

		await setInstallPath(locals.user.id, toolKey, installPath);
		return { saved: toolKey };
	},

	setProject: async ({ request, locals, cookies }) => {
		if (!locals.user) throw redirect(303, '/login');

		const data = await request.formData();
		const projectKey = String(data.get('projectKey') ?? '');

		if (!(await canAccessProject(locals.user.id, locals.user.role, projectKey))) {
			return fail(400, { action: 'setProject', error: 'No access to that project.' });
		}

		// Store null for the default so an unset session resolves to it naturally.
		const stored = projectKey === DEFAULT_PROJECT_KEY ? null : projectKey;
		await setActiveProjectKey(cookies.get(SESSION_COOKIE), stored);
		return { action: 'setProject', activeProjectKey: projectKey };
	},
};
