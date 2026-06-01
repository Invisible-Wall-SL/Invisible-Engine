import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { SESSION_COOKIE, createSession, verifyCredentials } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import {
	checkLoginThrottle,
	recordLoginFailure,
	recordLoginSuccess,
} from '$lib/server/loginThrottle';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) throw redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.toLowerCase()
			.trim();
		const password = String(data.get('password') ?? '');
		const remember = data.get('remember') === 'on';

		if (!email || !password) {
			return fail(400, { email, error: 'Enter your email and password.' });
		}

		// Brute-force throttle (shared with the launcher login endpoint).
		const ip = getClientAddress();
		const throttle = await checkLoginThrottle(ip, email);
		if (throttle.blocked) {
			return fail(429, { email, error: 'Too many attempts. Please wait and try again.' });
		}

		const user = await verifyCredentials(email, password);
		if (!user) {
			await recordLoginFailure(ip, email);
			return fail(400, { email, error: 'Invalid email or password.' });
		}
		await recordLoginSuccess(ip, email);

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
