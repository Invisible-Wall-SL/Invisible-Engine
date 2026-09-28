import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The entitlement gate every Invisible Sound endpoint shares — the doc route (`/api/sounds`) and
 * the file route (`/api/sounds/file`). Mirrors `spine.ts`'s `requireSpineAccess`: one definition,
 * so a second route cannot ship a slightly different gate. Returns the non-null user for
 * `requireProjectScope` (`toolScope.ts`), which resolves `?project=` and refuses a project this
 * user cannot access.
 *
 * Granted by default to `audio`, `developer`, `artist` and `pipelineTester` (and `admin`, which
 * holds every tool) — see `ROLE_TOOLS`. The build-time export (`/api/editor/export-sounds`) does
 * NOT come through here: a build runner is not a logged-in author, so it carries the deploy token
 * instead.
 */
export async function requireSoundAccess(
	locals: App.Locals,
): Promise<NonNullable<App.Locals['user']>> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'sound', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Sound.');
	}
	return locals.user;
}
