import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { ENV } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Atlas Maker.');
	}

	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	const toolUrl = base
		? ENV.ATLAS_TOOL_SECRET
			? `${base}/?k=${encodeURIComponent(ENV.ATLAS_TOOL_SECRET)}`
			: `${base}/`
		: '';
	return { toolUrl };
};
