import { redirect } from '@sveltejs/kit';
import { ADMIN_PANEL_CAPABILITY, manifestForRole, roleHasCapability } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import {
	DEFAULT_PROJECT_KEY,
	accessibleProjects,
	ensureDefaultProject,
} from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');

	await ensureDefaultProject();

	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	const projects = await accessibleProjects(locals.user.id, locals.user.role);

	// Resolve the session's active project; fall back to the default when unset
	// or no longer accessible (e.g. the project was deleted or access revoked).
	const stored = await getActiveProjectKey(cookies.get(SESSION_COOKIE));
	const activeProjectKey =
		stored && projects.some((p) => p.key === stored) ? stored : DEFAULT_PROJECT_KEY;

	return {
		user: locals.user,
		tools: manifestForRole(locals.user.role, roleOverrides, overrides),
		canAdmin: roleHasCapability(
			locals.user.role,
			ADMIN_PANEL_CAPABILITY,
			roleOverrides,
			overrides,
		),
		projects,
		activeProjectKey,
	};
};
