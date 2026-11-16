import { error, redirect } from '@sveltejs/kit';
import { isCapturableGameUrl, PROFILER_READINGS } from '$lib/profiler';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listGamesOwnedByProject } from '$lib/server/games';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { listReports } from '$lib/server/profiler/store';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Profiler (`/profiler`, `docs/design/invisible-profiler.md`): one project's `?perf=1`
 * readings, a New capture for its published games, and Paste for a delivery's Copy. Every role has
 * it (owner decision 2026-11-16). The project is the page's scope like any project tool's.
 */
export const load: PageServerLoad = async ({ locals, parent, url, cookies, depends }) => {
	depends(PROFILER_READINGS);
	if (!locals.user) throw redirect(303, '/login');
	const { tools } = await parent();
	if (!tools.some((t) => t.id === PROFILER_TOOL)) {
		throw error(403, 'Your role does not have access to the Invisible Profiler.');
	}
	const { clientKey, projectKey } = await resolveToolScope({
		url,
		sessionToken: cookies.get(SESSION_COOKIE),
		user: locals.user,
	});
	const [readings, games] = await Promise.all([
		listReports(projectKey),
		listGamesOwnedByProject(projectKey),
	]);
	return {
		clientKey,
		projectKey,
		readings,
		games: games
			.filter((g) => isCapturableGameUrl(g.url))
			.map((g) => ({ key: g.key, name: g.name })),
	};
};
