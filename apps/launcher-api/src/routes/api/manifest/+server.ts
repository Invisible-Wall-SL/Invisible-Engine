import { json, error } from '@sveltejs/kit';
import { manifestForRole } from '$lib/roles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	return json({
		user: {
			email: locals.user.email,
			name: locals.user.name,
			role: locals.user.role,
		},
		tools: manifestForRole(locals.user.role),
	});
};
