import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, sessionIdFromToken } from '$lib/server/auth';
import { changePassword } from '$lib/server/changePassword';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals, cookies, getClientAddress }) => {
		if (!locals.user) throw redirect(303, '/login');

		const data = await request.formData();
		const result = await changePassword({
			user: locals.user,
			ip: getClientAddress(),
			currentSessionId: await sessionIdFromToken(cookies.get(SESSION_COOKIE)),
			current: String(data.get('current') ?? ''),
			next: String(data.get('next') ?? ''),
			confirm: String(data.get('confirm') ?? ''),
		});
		if (!result.ok) return fail(result.status, { error: result.error });
		return { ok: 'Password changed. Other sessions were signed out.' };
	},
};
