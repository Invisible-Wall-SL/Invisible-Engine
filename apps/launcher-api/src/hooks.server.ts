import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { runMigrations } from '$lib/server/db/migrate';
import type { Handle, ServerInit } from '@sveltejs/kit';

/** Runs once at server startup, before the first request — apply pending DB
 * migrations so schema-dependent routes never serve against an old schema. */
export const init: ServerInit = async () => {
	await runMigrations();
};

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = await validateSession(token);
	return resolve(event);
};
