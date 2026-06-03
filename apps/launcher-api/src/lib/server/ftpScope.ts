import { error, type Cookies } from '@sveltejs/kit';
import * as toolScope from '$lib/server/toolScope';

/**
 * FTP-browser scope. Two modes, decided by role:
 *
 * - **Scoped** (developers): a thin wrapper over the shared `toolScope` — the
 *   browser exposes the active project's OWN namespaces only, so a developer can
 *   never see or touch files outside the active (client, project).
 * - **Full** (admins): the whole R2 bucket is browsable from the root; the only
 *   constraint left is that keys stay escape-free. This powers the admin-only
 *   "full server" view (R2 + Railway/Postgres tabs).
 *
 * The prefix layout + scoped gate sequence live in `toolScope` (single source);
 * this module binds them to the `ftpBrowser` tool and folds the admin mode in.
 */

export interface FtpScope {
	/** Admin full-bucket mode: browse the entire bucket, no project scoping. */
	full: boolean;
	clientKey: string;
	projectKey: string;
}

/** A non-empty, escape-free R2 key (no `..`, no leading `/`). */
function isSafeKey(key: string): boolean {
	return Boolean(key) && !key.includes('..') && !key.startsWith('/');
}

/**
 * The top-level folders to seed the browser root with. Scoped mode returns the
 * project's tool namespaces; full mode returns `[]` (the page lists the live
 * bucket root via `/api/files/list` instead).
 */
export function rootPrefixes(scope: FtpScope): string[] {
	return scope.full ? [] : toolScope.allowedPrefixes(scope.clientKey, scope.projectKey);
}

/** True when `key` is safe and inside the scope (any safe key in full mode). */
export function isKeyAllowed(key: string, scope: FtpScope): boolean {
	if (!isSafeKey(key)) return false;
	if (scope.full) return true;
	return toolScope.isKeyAllowed(key, toolScope.allowedPrefixes(scope.clientKey, scope.projectKey));
}

/** Throw 403 unless `key` is allowed for the given scope. */
export function assertAllowed(key: string, scope: FtpScope): void {
	if (!isKeyAllowed(key, scope)) throw error(403, 'forbidden');
}

/**
 * Auth + role gate for the page loader and every `/api/files/*` endpoint. Gates
 * on `ftpBrowser` and resolves the session-bound active project, then flags
 * `full` for the built-in `admin` role. Throws 401/403.
 */
export async function gate(locals: App.Locals, cookies: Cookies): Promise<FtpScope> {
	const { clientKey, projectKey } = await toolScope.gate(locals, cookies, {
		tool: 'ftpBrowser',
		forbiddenMessage: 'Your role does not have access to the Invisible FTP Browser.',
	});
	const full = locals.user?.role === 'admin';
	return { full, clientKey, projectKey };
}

/** Like `gate`, but requires full (admin) mode — used by the Railway/Postgres tab. */
export async function gateFull(locals: App.Locals, cookies: Cookies): Promise<FtpScope> {
	const scope = await gate(locals, cookies);
	if (!scope.full) throw error(403, 'Admins only.');
	return scope;
}
