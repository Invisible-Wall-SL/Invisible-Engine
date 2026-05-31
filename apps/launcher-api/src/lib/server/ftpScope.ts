import { type Cookies } from '@sveltejs/kit';
import * as toolScope from '$lib/server/toolScope';

/**
 * FTP-browser scope — a thin wrapper over the shared `toolScope`. The browser
 * exposes the project's OWN namespaces only (no `spines/_shared/`, no other
 * client/project), so a user can never see or touch files outside the active
 * repository. The prefix layout + gate sequence live in `toolScope` (single
 * source); this module just binds them to the `ftpBrowser` tool and keeps the
 * `(key, clientKey, projectKey)` call shape the `/api/files/*` endpoints use.
 */

/** Every R2-key prefix (trailing `/`) the active (client, project) may touch. */
export function allowedPrefixes(clientKey: string, projectKey: string): string[] {
	return toolScope.allowedPrefixes(clientKey, projectKey);
}

/** True when `key` is non-empty, escape-free, and inside an allowed prefix. */
export function isKeyAllowed(key: string, clientKey: string, projectKey: string): boolean {
	return toolScope.isKeyAllowed(key, allowedPrefixes(clientKey, projectKey));
}

/** Throw 403 unless `key` is allowed for the active (client, project). */
export function assertAllowed(key: string, clientKey: string, projectKey: string): void {
	toolScope.assertAllowed(key, allowedPrefixes(clientKey, projectKey));
}

/**
 * Auth + role gate for the page loader and every `/api/files/*` endpoint. Gates
 * on `ftpBrowser` and resolves the session-bound active project. Throws 401/403.
 */
export async function gate(
	locals: App.Locals,
	cookies: Cookies,
): Promise<{ clientKey: string; projectKey: string }> {
	const { clientKey, projectKey } = await toolScope.gate(locals, cookies, {
		tool: 'ftpBrowser',
		forbiddenMessage: 'Your role does not have access to the Invisible FTP Browser.',
	});
	return { clientKey, projectKey };
}
