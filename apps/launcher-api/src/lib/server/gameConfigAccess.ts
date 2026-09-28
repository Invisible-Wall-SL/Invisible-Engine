import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from './projects';
import { getRoleOverrides } from './roleToolAccess';
import { getToolOverrides } from './userToolAccess';

/**
 * The session gate shared by the Invisible Game Config authoring endpoints (`/api/game-config` and
 * its `server-paytable` import): logged-in + entitled to the `gameConfig` tool, role + per-user
 * overrides applied — the SAME entitlement the `/config` page checks. NOT the deploy-token gate of
 * the sibling `doc` route, which serves the build-time bake.
 */
export async function requireGameConfigAccess(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameConfig', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Game Config.');
	}
}

/** The `(client, project)` a `?project=` names, the default project when it names none. */
export async function gameConfigScope(
	project: string | null,
): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}
