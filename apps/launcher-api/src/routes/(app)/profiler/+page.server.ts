import { error, redirect } from '@sveltejs/kit';
import { isCapturableGameUrl, PROFILER_READINGS } from '$lib/profiler';
import { effectiveBudgets, PROFILER_BUDGETS } from '$lib/profilerBudgets';
import { PROFILER_BUILDS } from '$lib/profilerBuilds';
import { SESSION_COOKIE } from '$lib/server/auth';
import { listGamesOwnedByProject } from '$lib/server/games';
import { listBudgetOverrides } from '$lib/server/profiler/budgets';
import { listBuilds } from '$lib/server/profiler/builds';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { listReports } from '$lib/server/profiler/store';
import { resolveToolScope } from '$lib/server/toolScope';
import type { PageServerLoad } from './$types';

/**
 * Invisible Profiler (`/profiler`, `docs/design/invisible-profiler.md`): one project's `?perf=1`
 * readings, a New capture for its published games, Paste for a delivery's Copy, the readings per
 * device judged by the project's budgets (Devices), the desktop builds' breakdowns with the readings
 * taken on each and their verdicts (Builds), and the budgets themselves (Budgets). Every role has
 * it (owner decision 2026-11-16). The project is the page's scope like any project tool's.
 */
export const load: PageServerLoad = async ({ locals, parent, url, cookies, depends }) => {
	depends(PROFILER_READINGS, PROFILER_BUILDS, PROFILER_BUDGETS);
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
	const [readings, builds, games, overrides] = await Promise.all([
		listReports(projectKey),
		listBuilds(projectKey),
		listGamesOwnedByProject(projectKey),
		listBudgetOverrides(projectKey),
	]);
	const tab = url.searchParams.get('tab');
	return {
		clientKey,
		projectKey,
		readings,
		builds,
		budgets: effectiveBudgets(overrides),
		tab:
			(['devices', 'builds', 'budgets'] as const).find((t) => t === tab) ?? ('readings' as const),
		games: games
			.filter((g) => isCapturableGameUrl(g.url))
			.map((g) => ({ key: g.key, name: g.name })),
	};
};
