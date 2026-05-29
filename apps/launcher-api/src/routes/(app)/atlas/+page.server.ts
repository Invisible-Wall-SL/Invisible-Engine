import { error, redirect } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { ENV } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	if (!roleHasTool(locals.user.role, 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Invisible Atlas Maker.');
	}

	// Full-page, no iframe: send the authenticated user straight to the tool.
	// The role check above gates it; the optional shared secret (?k=) only the
	// launcher knows is appended server-side so the tool's gate lets them in.
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (base) {
		const dest = ENV.ATLAS_TOOL_SECRET
			? `${base}/?k=${encodeURIComponent(ENV.ATLAS_TOOL_SECRET)}`
			: `${base}/`;
		throw redirect(303, dest);
	}
	return { configured: false };
};
