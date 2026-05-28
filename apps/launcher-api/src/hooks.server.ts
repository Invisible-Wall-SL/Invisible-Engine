import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = await validateSession(token);
	return resolve(event);
};
