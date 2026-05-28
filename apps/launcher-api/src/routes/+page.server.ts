import { redirect } from '@sveltejs/kit';
import { manifestForRole } from '$lib/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	return {
		user: locals.user,
		tools: manifestForRole(locals.user.role),
	};
};
