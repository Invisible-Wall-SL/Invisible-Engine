import { error, type Cookies } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import {
	SESSION_COOKIE,
	getActiveProjectKey,
	getActiveScope,
	setActiveProjectKey,
} from '$lib/server/auth';
import { UNASSIGNED_CLIENT, projectPrefix } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, canAccessProject, projectClientKey } from '$lib/server/projects';
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
	/** Atlas-only: also allow the cross-project `_shared/blueprints/` library (read). */
	includeBlueprints?: boolean;
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
	if (opts.includeBlueprints) prefixes.push('_shared/blueprints/');
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
	/** Pass through to `allowedPrefixes` (atlas opts into `_shared/blueprints/`). */
	includeBlueprints?: boolean;
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
		includeBlueprints: opts.includeBlueprints,
	});
	return { clientKey, projectKey, prefixes };
}

/**
 * Project-explicit tool scoping (see `docs/design/project-explicit-tool-scoping.md`).
 *
 * Resolves the `(client, project)` a full-page tool route should bind to:
 *
 * - When `url` carries a non-empty `?project=<key>` that the authenticated `user` may
 *   ACCESS, that project is **authoritative**: its scope is SYNCED into the session
 *   (`setActiveProjectKey`) so every surface — the top bar, the global selector, and
 *   a later tool opened without a param — now agrees, and `{clientKey, projectKey}`
 *   is returned.
 * - Otherwise (no `?project=`, or one the user can't reach) this falls back to
 *   `getActiveScope(sessionToken)` — **byte-identical to today's behavior**. A bad,
 *   stale, or RESTRICTED `?project=` can never 500 or leak a client; it is silently
 *   ignored.
 *
 * Accessibility uses the SAME per-user rule the home/layout/global selector apply:
 * `canAccessProject` (which wraps `accessibleProjects`). So a non-admin can never
 * deep-link `?project=` into a project their grants don't cover — `projectExists`
 * alone (mere existence) would have been an authorization gap.
 *
 * Purely additive: routes that never receive `?project=` are unchanged. Returns the
 * SAME `{clientKey, projectKey}` shape as `getActiveScope` (the `prefixes` of the
 * gate above is a separate concern for the R2 endpoints, not these page loaders).
 */
export async function resolveToolScope({
	url,
	sessionToken,
	user,
}: {
	url: URL;
	sessionToken: string | undefined;
	user: App.Locals['user'];
}): Promise<{ clientKey: string; projectKey: string }> {
	const requested = url.searchParams.get('project')?.trim();
	if (requested && user && (await canAccessProject(user.id, user.role, requested))) {
		// The project is real AND this user may reach it. Mirror `getActiveScope`'s
		// client resolution: a null `clientKey` means an UNASSIGNED project (not
		// unknown), so map it to `UNASSIGNED_CLIENT` exactly as the active-scope path
		// does — explicit scoping must work for unassigned projects too. An unknown,
		// stale, or RESTRICTED `?project=` (failed `canAccessProject`) is silently
		// ignored below so a hand-typed param can never 500 or surface a bad pairing.
		const clientKey = (await projectClientKey(requested)) ?? UNASSIGNED_CLIENT;
		// Sync the explicit choice into the session so the whole UI agrees.
		await setActiveProjectKey(sessionToken, requested);
		return { clientKey, projectKey: requested };
	}
	return getActiveScope(sessionToken);
}
