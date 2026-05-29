import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { SESSION_COOKIE, createSession, verifyCredentials } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) throw redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.toLowerCase()
			.trim();
		const password = String(data.get('password') ?? '');
		const remember = data.get('remember') === 'on';

		if (!email || !password) {
			return fail(400, { email, error: 'Enter your email and password.' });
		}

		const user = await verifyCredentials(email, password);
		if (!user) {
			return fail(400, { email, error: 'Invalid email or password.' });
		}

		const ttlMs = remember ? ENV.REMEMBER_TTL_DAYS * 86_400_000 : ENV.SESSION_TTL_HOURS * 3_600_000;
		const sessionToken = await createSession(user.id, ttlMs);

		cookies.set(SESSION_COOKIE, sessionToken, {
			path: '/',
			httpOnly: true,
			secure: !dev,
			sameSite: 'lax',
			// Persistent cookie when "remember me" is checked; otherwise a
			// browser-session cookie (cleared when the browser closes).
			...(remember ? { maxAge: ENV.REMEMBER_TTL_DAYS * 86_400 } : {}),
		});

		throw redirect(303, '/');
	},
};
