import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { runMigrations } from '$lib/server/db/migrate';
import { DEPLOY_CORS_HEADERS } from '$lib/server/deployServe';
import type { Handle, ServerInit } from '@sveltejs/kit';

/** Runs once at server startup, before the first request — apply pending DB
 * migrations so schema-dependent routes never serve against an old schema. */
export const init: ServerInit = async () => {
	await runMigrations();
};

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = await validateSession(token);
	const response = await resolve(event);
	// The read-only deploy asset tree is fetched cross-origin by the game runtime
	// (games.invisiblewall.org → app.invisiblewall.org). The handlers set CORS on the
	// 200/preflight responses, but SvelteKit's error() responses (404/401) don't — so a
	// missing/stale asset surfaces in the browser as a misleading "No
	// Access-Control-Allow-Origin" CORS error that hides its real status. Set the CORS
	// headers on every /api/deploy response so failures report honestly.
	// Same treatment for the generic-runtime boot endpoint AND the layout-doc fallback
	// (`/api/editor/doc`): both set CORS on their 200,
	// but a `throw error()` (401 bad token / 502 / 503) response does NOT — so a game
	// booted with a wrong token sees an opaque "Failed to fetch" (CORS) instead of the
	// real 401, then silently falls back to stale baked assets. Setting CORS on EVERY
	// response makes the failure legible in the console (the boot logs the real status).
	if (
		event.url.pathname.startsWith('/api/deploy') ||
		event.url.pathname === '/api/editor/runtime' ||
		event.url.pathname === '/api/editor/doc'
	) {
		for (const [key, value] of Object.entries(DEPLOY_CORS_HEADERS)) {
			response.headers.set(key, value);
		}
	}
	return response;
};
