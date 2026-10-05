import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from '../roleToolAccess';
import { getToolOverrides } from '../userToolAccess';

/**
 * The session gate shared by Invisible Director's own endpoints (mockup uploads, the live event
 * stream): logged in + entitled to the `director` tool, role and per-user overrides applied — the
 * SAME entitlement the `/director` page checks. Not the adapter gate (`gate.ts`), which the worker
 * passes with a service token and never a session.
 *
 * Returns the non-null user for `requireProjectScope` (`toolScope.ts`): the tool grant alone is not
 * a project grant.
 */
export async function requireDirectorAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'director', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Director.');
	}
	return locals.user;
}
