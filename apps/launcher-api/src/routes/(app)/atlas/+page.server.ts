import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import { DEFAULT_PROJECT_KEY } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'atlasTool', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Atlas Maker.');
	}

	// Full-page, no iframe: send the authenticated user straight to the tool.
	// The role check above gates it; the optional shared secret (?k=) only the
	// launcher knows is appended server-side so the tool's gate lets them in.
	// Atlas Maker is project-scoped, so the active project is forwarded as
	// `&project=` (defaulting to `cloud`) per the shared launcher↔tool contract.
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (base) {
		const project = (await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
		const params = new URLSearchParams();
		if (ENV.ATLAS_TOOL_SECRET) params.set('k', ENV.ATLAS_TOOL_SECRET);
		params.set('project', project);
		throw redirect(303, `${base}/?${params.toString()}`);
	}
	return { configured: false };
};
