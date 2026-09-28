import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The session gate shared by the Invisible Game Config authoring endpoints (`/api/game-config` and
 * its `server-paytable` import): logged-in + entitled to the `gameConfig` tool, role + per-user
 * overrides applied — the SAME entitlement the `/config` page checks. NOT the deploy-token gate of
 * the sibling `doc` route, which serves the build-time bake.
 *
 * Returns the non-null user for `requireProjectScope` (`toolScope.ts`), which resolves `?project=`
 * and refuses a project this user cannot access — the tool grant alone is not a project grant.
 */
export async function requireGameConfigAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Game Config.');
	}
	return locals.user;
}
