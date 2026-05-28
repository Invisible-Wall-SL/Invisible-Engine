import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { createLoginToken, findActiveUserByEmail } from '$lib/server/auth';
import { sendMagicLink } from '$lib/server/email';
import { ENV } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	return {
		loggedIn: !!locals.user,
		error: url.searchParams.get('error'),
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.toLowerCase()
			.trim();

		if (!email || !email.includes('@')) {
			return fail(400, { email, invalid: true });
		}

		const user = await findActiveUserByEmail(email);

		// Invite-only: only send a link to known, active users. Always return the
		// same response so the form can't be used to enumerate registered emails.
		if (user) {
			const token = await createLoginToken(user.id);
			const link = `${ENV.ORIGIN}/auth/verify?token=${token}`;
			if (dev) console.info(`[launcher-api] magic link for ${email}: ${link}`);
			await sendMagicLink(email, link);
		}

		return { sent: true, email };
	},
};
