import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The session gate for the Invisible Editor's per-project component-defaults endpoints
 * (`/api/editor/component-defaults` and its `backups` history): logged-in + entitled to the
 * `editor` tool, role + per-user overrides applied.
 *
 * Returns the non-null user for `requireProjectScope` / `requireOptionalProjectKey`
 * (`toolScope.ts`), which refuse a project this user cannot access — the tool grant alone is not a
 * project grant.
 */
export async function requireEditorAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
	return locals.user;
}
