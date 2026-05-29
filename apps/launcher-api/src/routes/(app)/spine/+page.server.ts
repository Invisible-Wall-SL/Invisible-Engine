import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'spineViewer', overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Spine Viewer.');
	}
	// Full-page, no iframe: send the user straight to the viewer document.
	throw redirect(303, '/spine/view.html');
};
