import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { type ToolNs, UNASSIGNED_CLIENT, projectPrefix } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';

/**
 * The tool namespaces the FTP browser may expose. The project's OWN namespaces
 * only — no `spines/_shared/`, no other client/project — so a user can never
 * see or touch files outside the active repository.
 */
export const ALLOWED_TOOL_NS: ToolNs[] = [
	'atlas_maker',
	'sheet_maker',
	'localization',
	'editor',
	'spines',
];

/** Every R2-key prefix (trailing `/`) the active (client, project) may touch. */
export function allowedPrefixes(clientKey: string, projectKey: string): string[] {
	return ALLOWED_TOOL_NS.map((ns) => `${projectPrefix(ns, clientKey, projectKey)}/`);
}

/** True when `key` is non-empty, escape-free, and inside an allowed prefix. */
export function isKeyAllowed(key: string, clientKey: string, projectKey: string): boolean {
	if (!key || key.includes('..') || key.startsWith('/')) return false;
	return allowedPrefixes(clientKey, projectKey).some((p) => key.startsWith(p));
}

/** Throw 403 unless `key` is allowed for the active (client, project). */
export function assertAllowed(key: string, clientKey: string, projectKey: string): void {
	if (!isKeyAllowed(key, clientKey, projectKey)) throw error(403, 'forbidden');
}

/**
 * Auth + role gate shared by the page loader and every `/api/files/*` endpoint.
 * Gates on the `ftpBrowser` tool id and resolves the session-bound active
 * project to its `(client, project)`. Throws 401/403 on failure.
 */
export async function gate(
	locals: App.Locals,
	cookies: import('@sveltejs/kit').Cookies,
): Promise<{ clientKey: string; projectKey: string }> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'ftpBrowser', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible FTP Browser.');
	}
	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}
