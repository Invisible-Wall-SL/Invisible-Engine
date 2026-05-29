import { redirect } from '@sveltejs/kit';
import { manifestForRole } from '$lib/roles';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const overrides = await getToolOverrides(locals.user.id);
	return {
		user: locals.user,
		tools: manifestForRole(locals.user.role, overrides),
		isAdmin: locals.user.role === 'admin',
	};
};
