import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { SESSION_COOKIE, consumeLoginToken, createSession } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) throw redirect(303, '/login?error=missing');

	const userId = await consumeLoginToken(token);
	if (!userId) throw redirect(303, '/login?error=invalid');

	const sessionToken = await createSession(userId);
	cookies.set(SESSION_COOKIE, sessionToken, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: ENV.SESSION_TTL_DAYS * 86_400,
	});

	throw redirect(303, '/');
};
