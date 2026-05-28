import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getObjectText } from '$lib/server/r2';
import { ENV } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Atlas Maker.');
	}

	const text = await getObjectText(ENV.ATLAS_MANIFEST_KEY);
	if (!text) {
		return { manifestKey: ENV.ATLAS_MANIFEST_KEY, regions: [], style: {}, missing: true };
	}
	const manifest = JSON.parse(text);
	return {
		manifestKey: ENV.ATLAS_MANIFEST_KEY,
		regions: (manifest.regions ?? []).map((r: { name: string; prompt?: string }) => ({
			name: r.name,
			prompt: r.prompt ?? '',
		})),
		style: manifest.style ?? {},
		missing: false,
	};
};
