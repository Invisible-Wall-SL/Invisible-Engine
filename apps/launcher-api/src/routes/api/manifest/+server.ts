import { json, error } from '@sveltejs/kit';
import { manifestForRole } from '$lib/roles';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const overrides = await getToolOverrides(locals.user.id);
	return json({
		user: {
			email: locals.user.email,
			name: locals.user.name,
			role: locals.user.role,
		},
		tools: manifestForRole(locals.user.role, overrides),
	});
};
