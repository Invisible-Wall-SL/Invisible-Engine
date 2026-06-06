import { error, type Cookies } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { SESSION_COOKIE, getActiveProjectKey } from '$lib/server/auth';
import { UNASSIGNED_CLIENT, projectPrefix } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';

/**
 * Single source of truth for tool access scoping in the launcher: the auth+role
 * gate, the session-bound `(client, project)` resolution, and the R2-key prefix
 * allow-list. The FTP browser (`ftpScope.ts`) and the editor endpoints both build
 * on this, so the prefix layout and gate sequence live in exactly ONE place.
 *
 * With the unified project repo, a project owns a SINGLE prefix `<client>/<project>/`
 * (the whole asset-typed tree); the FTP browser then exposes that whole tree. The
 * only cross-project read is the shared `_shared/spines/` bundles, opt-in.
 */

/** The tool id accepted by `roleHasTool` (kept in sync via its signature). */
type ToolId = Parameters<typeof roleHasTool>[1];

export interface ScopeOptions {
	/** Editor-only: also allow the cross-project `_shared/spines/` bundles. */
	includeSharedSpines?: boolean;
	/** Editor-only: also allow the cross-project `_shared/fonts/` library. */
	includeSharedFonts?: boolean;
}

/** Every R2-key prefix (trailing `/`) the active `(client, project)` may touch. */
export function allowedPrefixes(
	clientKey: string,
	projectKey: string,
	opts: ScopeOptions = {},
): string[] {
	const prefixes = [`${projectPrefix(clientKey, projectKey)}/`];
	if (opts.includeSharedSpines) prefixes.push('_shared/spines/');
	if (opts.includeSharedFonts) prefixes.push('_shared/fonts/');
	return prefixes;
}

/** True when `key` is non-empty, escape-free, and inside an allowed prefix. */
export function isKeyAllowed(key: string, prefixes: string[]): boolean {
	if (!key || key.includes('..') || key.startsWith('/')) return false;
	return prefixes.some((p) => key.startsWith(p));
}

/** Throw 403 unless `key` is allowed for the given prefix set. */
export function assertAllowed(key: string, prefixes: string[], message = 'forbidden'): void {
	if (!isKeyAllowed(key, prefixes)) throw error(403, message);
}

export interface GateOptions {
	/** Tool id the caller's role/user must be entitled to. */
	tool: ToolId;
	/** 403 message when the entitlement check fails. */
	forbiddenMessage: string;
	/** Pass through to `allowedPrefixes` (editor opts into `spines/_shared/`). */
	includeSharedSpines?: boolean;
	/** Pass through to `allowedPrefixes` (editor opts into `_shared/fonts/`). */
	includeSharedFonts?: boolean;
}

export interface ToolScope {
	clientKey: string;
	projectKey: string;
	/** The allow-list for this scope (already honours `includeSharedSpines`). */
	prefixes: string[];
}

/**
 * Auth + role gate shared by every scoped tool route. Throws 401 when not logged
 * in, 403 when the role/user lacks the tool, then resolves the SESSION-BOUND
 * active project to its `(client, project)` (never a request param) and returns
 * the matching prefix allow-list.
 */
export async function gate(
	locals: App.Locals,
	cookies: Cookies,
	opts: GateOptions,
): Promise<ToolScope> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, opts.tool, roleOverrides, overrides)) {
		throw error(403, opts.forbiddenMessage);
	}
	const projectKey =
		(await getActiveProjectKey(cookies.get(SESSION_COOKIE))) ?? DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const prefixes = allowedPrefixes(clientKey, projectKey, {
		includeSharedSpines: opts.includeSharedSpines,
		includeSharedFonts: opts.includeSharedFonts,
	});
	return { clientKey, projectKey, prefixes };
}
