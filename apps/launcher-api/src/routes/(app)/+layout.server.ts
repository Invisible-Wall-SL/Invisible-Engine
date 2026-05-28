import { redirect } from '@sveltejs/kit';
import { manifestForRole } from '$lib/roles';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	return {
		user: locals.user,
		tools: manifestForRole(locals.user.role),
	};
};
