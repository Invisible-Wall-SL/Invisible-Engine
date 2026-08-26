import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from './projects';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The entitlement gate + project scope every Invisible Sound endpoint shares — the doc route
 * (`/api/sounds`) and the file route (`/api/sounds/file`). Mirrors `spine.ts`'s
 * `requireSpineAccess`: one definition, so a second route cannot ship a slightly different gate.
 *
 * Granted by default to `audio`, `developer`, `artist` and `pipelineTester` (and `admin`, which
 * holds every tool) — see `ROLE_TOOLS`. The build-time export (`/api/editor/export-sounds`) does
 * NOT come through here: a build runner is not a logged-in author, so it carries the deploy token
 * instead.
 */
export async function requireSoundAccess(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'sound', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Sound.');
	}
}

/** The `?project=` scope, defaulted and resolved to its client — the same two lines every tool's
 *  authoring endpoint opens with. */
export async function resolveSoundScope(
	project: string | null,
): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}
