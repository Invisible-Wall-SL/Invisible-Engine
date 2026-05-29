import { json, error } from '@sveltejs/kit';
import { manifestForRole } from '$lib/roles';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	return json({
		user: {
			email: locals.user.email,
			name: locals.user.name,
			role: locals.user.role,
		},
		tools: manifestForRole(locals.user.role, roleOverrides, overrides),
	});
};
