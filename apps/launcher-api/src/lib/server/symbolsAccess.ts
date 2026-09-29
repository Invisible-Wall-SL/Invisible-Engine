import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The session gate shared by the Invisible Symbols State Machine authoring endpoints
 * (`/api/editor/symbols` and its `backups` history): logged-in + entitled to the `symbols` tool,
 * role + per-user overrides applied — the SAME entitlement the `/symbols` page checks. NOT the
 * deploy-token gate, which is only for the build-time export.
 *
 * Returns the non-null user for `requireProjectScope` (`toolScope.ts`), which resolves `?project=`
 * and refuses a project this user cannot access — the tool grant alone is not a project grant.
 */
export async function requireSymbolsAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'symbols', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Symbols State Machine.');
	}
	return locals.user;
}
