import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'pipelineUI')) {
		throw error(403, 'Your role does not have access to the pipeline.');
	}
};
