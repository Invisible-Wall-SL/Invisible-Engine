import { error, fail, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getInstallPaths, setInstallPath } from '$lib/server/toolInstalls';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	return { installPaths: await getInstallPaths(locals.user.id) };
};

export const actions: Actions = {
	saveInstallPath: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');

		const data = await request.formData();
		const toolKey = String(data.get('toolKey') ?? '');
		const installPath = String(data.get('installPath') ?? '');

		if (!toolKey) return fail(400, { error: 'Missing tool.' });
		if (!roleHasTool(locals.user.role, toolKey)) {
			throw error(403, 'Your role does not have access to that tool.');
		}

		await setInstallPath(locals.user.id, toolKey, installPath);
		return { saved: toolKey };
	},
};
