import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { getObjectText } from '$lib/server/r2';
import { ENV } from '$lib/server/env';
import { parseManifest, effectiveConfig } from '$lib/server/atlas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Atlas Maker.');
	}

	const manifest = parseManifest(await getObjectText(ENV.ATLAS_MANIFEST_KEY));
	return {
		manifestKey: ENV.ATLAS_MANIFEST_KEY,
		defaultStyleRef: ENV.ATLAS_STYLE_REF_KEY,
		missing: manifest === null,
		manifest: manifest ?? { atlas: {}, style: {}, config: {}, regions: [] },
		config: effectiveConfig(manifest),
	};
};
