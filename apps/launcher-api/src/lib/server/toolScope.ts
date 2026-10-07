import { error, type Cookies } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import {
	SESSION_COOKIE,
	clearActiveProjectKey,
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
	includeSharedRigs?: boolean;
	/** Editor-only: also allow the cross-project `_shared/fonts/` library. */
	includeSharedFonts?: boolean;
	/** Also allow the cross-project `_shared/sheets/` art library (read — see `GateOptions`). */
	includeSharedSheets?: boolean;
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
	if (opts.includeSharedRigs) prefixes.push('_shared/spines/');
	if (opts.includeSharedFonts) prefixes.push('_shared/fonts/');
	if (opts.includeSharedSheets) prefixes.push('_shared/sheets/');
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
	/**
	 * Alternative tool ids that also satisfy the gate (OR with `tool`). Used by shared
	 * READ endpoints a second tool reuses: the editor's region/asset streamers gate on
	 * `editor` but Invisible FX (`fx`) reads the SAME atlas art, so `fx` is an accepted
	 * alternative. Never widens the R2 prefix allow-list — only the entitlement check.
	 */
	altTools?: ToolId[];
	/** 403 message when the entitlement check fails. */
	forbiddenMessage: string;
	/** Pass through to `allowedPrefixes` (editor opts into `spines/_shared/`). */
	includeSharedRigs?: boolean;
	/** Pass through to `allowedPrefixes` (editor opts into `_shared/fonts/`). */
	includeSharedFonts?: boolean;
	/**
	 * Pass through to `allowedPrefixes` — the `_shared/sheets/` art library. READ-ONLY in practice:
	 * nothing in the launcher writes there, so the library is seeded out-of-band and a tool can only
	 * bind from it. If a publish-to-shared flow is ever added it needs its own capability, the way
	 * `fontPublish` gates `_shared/fonts/` — this flag alone must never be treated as a write gate.
	 */
	includeSharedSheets?: boolean;
	/** Pass through to `allowedPrefixes` (atlas opts into `_shared/blueprints/`). */
	includeBlueprints?: boolean;
}

export interface ToolScope {
	clientKey: string;
	projectKey: string;
	/** The allow-list for this scope (already honours `includeSharedRigs`). */
	prefixes: string[];
}

/**
 * The session's stored active project, re-checked against the user's CURRENT grants — the scope
 * every session-bound surface resolves to: {@link gate}, {@link resolveToolScope} without a
 * `?project=`, and the few routes that read the session directly.
 *
 * The stored key is access-checked when it is SET (`setProject`, `resolveToolScope`, publish), but a
 * grant can be revoked after that, so it is checked again here, where it is read. An inaccessible
 * stored project falls back to the default — what the layout's selector already shows — and is
 * cleared, so the next request takes the fast path. The default is never checked: it is where the
 * fallback lands anyway. Without a user nothing is reachable, but nothing was revoked either, so
 * the stored key is left alone.
 */
export async function sessionProjectScope(
	user: App.Locals['user'],
	sessionToken: string | undefined,
): Promise<{ clientKey: string; projectKey: string }> {
	const scope = await getActiveScope(sessionToken);
	if (scope.projectKey === DEFAULT_PROJECT_KEY) return scope;
	if (user) {
		if (await canAccessProject(user.id, user.role, scope.projectKey)) return scope;
		await clearActiveProjectKey(sessionToken, scope.projectKey);
	}
	return {
		clientKey: (await projectClientKey(DEFAULT_PROJECT_KEY)) ?? UNASSIGNED_CLIENT,
		projectKey: DEFAULT_PROJECT_KEY,
	};
}

/**
 * Auth + role gate shared by every scoped tool route. Throws 401 when not logged
 * in, 403 when the role/user lacks the tool, then resolves the SESSION-BOUND
 * active project (never a request param) through {@link sessionProjectScope} and
 * returns the matching prefix allow-list.
 */
export async function gate(
	locals: App.Locals,
	cookies: Cookies,
	opts: GateOptions,
): Promise<ToolScope> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	const candidates: ToolId[] = [opts.tool, ...(opts.altTools ?? [])];
	const entitled = candidates.some((t) =>
		roleHasTool(locals.user!.role, t, roleOverrides, overrides),
	);
	if (!entitled) {
		throw error(403, opts.forbiddenMessage);
	}
	const { clientKey, projectKey } = await sessionProjectScope(
		locals.user,
		cookies.get(SESSION_COOKIE),
	);
	const prefixes = allowedPrefixes(clientKey, projectKey, {
		includeSharedRigs: opts.includeSharedRigs,
		includeSharedFonts: opts.includeSharedFonts,
		includeSharedSheets: opts.includeSharedSheets,
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
 * - Otherwise (no `?project=`, or one the user can't reach) this falls back to the
 *   session's project via {@link sessionProjectScope}, which re-checks it the same
 *   way — so a grant revoked since it was stored lands on the default. A bad, stale,
 *   or RESTRICTED `?project=` can never 500 or leak a client; it is silently ignored.
 *
 * Accessibility uses the SAME per-user rule the home/layout/global selector apply:
 * `canAccessProject` (which wraps `accessibleProjects`). So a non-admin can never
 * deep-link `?project=` into a project their grants don't cover — `projectExists`
 * alone (mere existence) would have been an authorization gap.
 *
 * Returns the SAME `{clientKey, projectKey}` shape as `getActiveScope` (the `prefixes`
 * of the gate above is a separate concern for the R2 endpoints, not these page loaders).
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
	return sessionProjectScope(user, sessionToken);
}

/**
 * {@link resolveToolScope} for a page's form ACTION (a save): the `?project=` the page was loaded
 * with — the form POST preserves it — refused with 403 by {@link requireProjectScope} when the user
 * cannot access it, else the session's re-checked project. Unlike the loader it never falls back
 * from a named project: a page may land elsewhere because it shows where it landed, but a save
 * would write the tab's document into whichever project the fallback chose. It does not sync the
 * session either — the load that rendered the page already did.
 */
export async function resolveActionScope({
	url,
	sessionToken,
	user,
}: {
	url: URL;
	sessionToken: string | undefined;
	user: NonNullable<App.Locals['user']>;
}): Promise<{ clientKey: string; projectKey: string }> {
	const requested = url.searchParams.get('project')?.trim();
	if (requested) return requireProjectScope(user, requested);
	return sessionProjectScope(user, sessionToken);
}

/**
 * The API counterpart of {@link resolveToolScope}, for the session-gated authoring endpoints that
 * take their project from the request: the `(client, project)` that `?project=` names — the default
 * project when it names none — refused with **403** unless `user` may access it under the SAME
 * `canAccessProject` rule the selector and `resolveToolScope` apply. Call it AFTER the tool's
 * entitlement gate, which is what hands back the non-null `user`.
 *
 * Unlike the page resolver it never falls back: a page may land on the session's project because
 * it SHOWS which one it chose, but an API call reads or writes the project it names, so an
 * inaccessible one must fail rather than quietly hit another. The default is checked like any other
 * key — every user is granted it, so it is refused only when its row is gone, and then there is no
 * project to write. An unknown key is a 403 rather than a 404 so the endpoint is not an oracle for
 * which project keys exist.
 */
export async function requireProjectScope(
	user: NonNullable<App.Locals['user']>,
	project: string | null,
): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project?.trim() || DEFAULT_PROJECT_KEY;
	if (!(await canAccessProject(user.id, user.role, projectKey))) {
		throw error(403, `You do not have access to the project "${projectKey}".`);
	}
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

/**
 * {@link requireProjectScope} for routes whose project is OPTIONAL — where naming none means a
 * project-less scope such as the shared component library, never the default project. `undefined`
 * when `project` is absent or blank; otherwise the access-checked (trimmed) key, refused with 403
 * exactly as above. Use the returned key, not the raw param, so the key checked is the key used.
 */
export async function requireOptionalProjectKey(
	user: NonNullable<App.Locals['user']>,
	project: string | null | undefined,
): Promise<string | undefined> {
	if (!project?.trim()) return undefined;
	return (await requireProjectScope(user, project)).projectKey;
}
