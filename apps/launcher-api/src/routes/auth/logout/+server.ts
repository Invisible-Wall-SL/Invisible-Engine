import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, invalidateSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	await invalidateSession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	throw redirect(303, '/login');
};
