import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, getActiveScope } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies, parent }) => {
	if (!locals.user) throw redirect(303, '/login');
	// The parent layout already resolved the effective tool manifest; reuse it
	// instead of re-querying the role/user overrides (same gate, fewer queries).
	const { tools } = await parent();
	if (!tools.some((t) => t.id === 'atlasTool')) {
		throw error(403, 'Your role does not have access to the Invisible Atlas Maker.');
	}

	// Full-page, no iframe: send the authenticated user straight to the tool.
	// The role check above gates it; the optional shared secret (?k=) only the
	// launcher knows is appended server-side so the tool's gate lets them in.
	// Atlas Maker is project-scoped, so the active `(client, project)` pair is
	// forwarded — the launcher is the source of truth, so the tool never needs
	// to look the client up itself.
	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (base) {
		const { projectKey: project, clientKey: client } = await getActiveScope(
			cookies.get(SESSION_COOKIE),
		);
		const params = new URLSearchParams();
		if (ENV.ATLAS_TOOL_SECRET) params.set('k', ENV.ATLAS_TOOL_SECRET);
		params.set('client', client);
		params.set('project', project);
		throw redirect(303, `${base}/?${params.toString()}`);
	}
	return { configured: false };
};
